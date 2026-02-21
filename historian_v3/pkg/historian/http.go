package historian

import (
	"encoding/json"
	"errors"
	"net/http"
	"sort"
	"strconv"
	"sync/atomic"
	"time"
)

type Server struct {
	cfg                 Config
	writer              *HistorianWriter
	query               *QueryEngine
	lastStore           *LastValueStore
	wal                 *WAL
	queryCount          uint64
	queryErrors         uint64
	queryTotalLatencyMs uint64
}

func NewServer(cfg Config, writer *HistorianWriter, query *QueryEngine, lastStore *LastValueStore, wal *WAL) *Server {
	return &Server{cfg: cfg, writer: writer, query: query, lastStore: lastStore, wal: wal}
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/health", s.handleHealth)
	mux.HandleFunc("/hist/last", s.handleLast)
	mux.HandleFunc("/hist/raw", s.handleRaw)
	mux.HandleFunc("/hist/range", s.handleRange)
	mux.HandleFunc("/metrics", s.handleMetrics)
	return withCORS(mux)
}

func (s *Server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, map[string]any{"ok": true}, http.StatusOK)
}

func (s *Server) handleMetrics(w http.ResponseWriter, _ *http.Request) {
	payload := map[string]any{
		"writer": s.writer.Stats(),
		"query": map[string]any{
			"count":          atomic.LoadUint64(&s.queryCount),
			"errors":         atomic.LoadUint64(&s.queryErrors),
			"totalLatencyMs": atomic.LoadUint64(&s.queryTotalLatencyMs),
		},
	}
	if s.wal != nil {
		payload["wal"] = s.wal.Stats()
	}
	writeJSON(w, payload, http.StatusOK)
}

func (s *Server) handleLast(w http.ResponseWriter, r *http.Request) {
	start := time.Now()
	atomic.AddUint64(&s.queryCount, 1)
	defer func() { atomic.AddUint64(&s.queryTotalLatencyMs, uint64(time.Since(start).Milliseconds())) }()
	tagIDs, err := parseTagIDs(r.URL.Query().Get("tagIds"))
	if err != nil {
		atomic.AddUint64(&s.queryErrors, 1)
		writeErr(w, err)
		return
	}
	tf, err := parseTimeFormat(r.URL.Query().Get("time"))
	if err != nil {
		atomic.AddUint64(&s.queryErrors, 1)
		writeErr(w, err)
		return
	}
	points := s.lastStore.GetLatest(tagIDs)
	rows := pivotPoints(points, tf, s.cfg.Storage.TimestampUnit, OrderDesc)
	writeJSON(w, map[string]any{"rows": rows}, http.StatusOK)
}

func (s *Server) handleRaw(w http.ResponseWriter, r *http.Request) {
	start := time.Now()
	atomic.AddUint64(&s.queryCount, 1)
	defer func() { atomic.AddUint64(&s.queryTotalLatencyMs, uint64(time.Since(start).Milliseconds())) }()
	q := r.URL.Query()
	if q.Get("bucketMs") != "" || q.Get("agg") != "" {
		atomic.AddUint64(&s.queryErrors, 1)
		writeErr(w, errors.New("bucketMs/agg is not supported on /hist/raw. Use /hist/range instead"))
		return
	}
	tagIDs, err := parseTagIDs(q.Get("tagIds"))
	if err != nil {
		atomic.AddUint64(&s.queryErrors, 1)
		writeErr(w, err)
		return
	}
	from, err := parseTimestamp(q.Get("from"), "from", s.cfg.Storage.TimestampUnit)
	if err != nil {
		atomic.AddUint64(&s.queryErrors, 1)
		writeErr(w, err)
		return
	}
	to, err := parseTimestamp(q.Get("to"), "to", s.cfg.Storage.TimestampUnit)
	if err != nil {
		atomic.AddUint64(&s.queryErrors, 1)
		writeErr(w, err)
		return
	}
	if to < from {
		atomic.AddUint64(&s.queryErrors, 1)
		writeErr(w, errors.New("to must be >= from"))
		return
	}
	order, err := parseOrder(q.Get("order"))
	if err != nil {
		atomic.AddUint64(&s.queryErrors, 1)
		writeErr(w, err)
		return
	}
	tf, err := parseTimeFormat(q.Get("time"))
	if err != nil {
		atomic.AddUint64(&s.queryErrors, 1)
		writeErr(w, err)
		return
	}
	limit := s.cfg.HTTP.MaxPoints
	if rawLimit := q.Get("limit"); rawLimit != "" {
		if n, err := strconv.Atoi(rawLimit); err == nil && n > 0 {
			if n < limit {
				limit = n
			}
		}
	}
	res, err := s.query.Raw(tagIDs, from, to, limit, order)
	if err != nil {
		atomic.AddUint64(&s.queryErrors, 1)
		writeErr(w, err)
		return
	}
	rows := pivotPoints(res.Points, tf, s.cfg.Storage.TimestampUnit, order)
	writeJSON(w, map[string]any{"rows": rows, "truncated": res.Truncated}, http.StatusOK)
}

func (s *Server) handleRange(w http.ResponseWriter, r *http.Request) {
	start := time.Now()
	atomic.AddUint64(&s.queryCount, 1)
	defer func() { atomic.AddUint64(&s.queryTotalLatencyMs, uint64(time.Since(start).Milliseconds())) }()
	q := r.URL.Query()
	tagIDs, err := parseTagIDs(q.Get("tagIds"))
	if err != nil {
		atomic.AddUint64(&s.queryErrors, 1)
		writeErr(w, err)
		return
	}
	from, err := parseTimestamp(q.Get("from"), "from", s.cfg.Storage.TimestampUnit)
	if err != nil {
		atomic.AddUint64(&s.queryErrors, 1)
		writeErr(w, err)
		return
	}
	to, err := parseTimestamp(q.Get("to"), "to", s.cfg.Storage.TimestampUnit)
	if err != nil {
		atomic.AddUint64(&s.queryErrors, 1)
		writeErr(w, err)
		return
	}
	if to < from {
		atomic.AddUint64(&s.queryErrors, 1)
		writeErr(w, errors.New("to must be >= from"))
		return
	}
	order, err := parseOrder(q.Get("order"))
	if err != nil {
		atomic.AddUint64(&s.queryErrors, 1)
		writeErr(w, err)
		return
	}
	tf, err := parseTimeFormat(q.Get("time"))
	if err != nil {
		atomic.AddUint64(&s.queryErrors, 1)
		writeErr(w, err)
		return
	}
	agg := q.Get("agg")
	if agg == "" {
		agg = "avg"
	}
	var bucketMs *int64
	if raw := q.Get("bucketMs"); raw != "" {
		if n, err := strconv.ParseInt(raw, 10, 64); err == nil && n > 0 {
			bucketMs = &n
		}
	}
	res, err := s.query.Range(tagIDs, from, to, bucketMs, agg, order, s.cfg.HTTP.MaxPoints)
	if err != nil {
		atomic.AddUint64(&s.queryErrors, 1)
		writeErr(w, err)
		return
	}
	rows := pivotBuckets(res.Buckets, tf, s.cfg.Storage.TimestampUnit, order)
	writeJSON(w, map[string]any{"rows": rows, "truncated": res.Truncated, "agg": agg}, http.StatusOK)
}

func parseTagIDs(v string) ([]uint32, error) {
	if v == "" {
		return nil, errors.New("tagIds is required")
	}
	parts := splitCSV(v)
	out := make([]uint32, 0, len(parts))
	seen := map[uint32]struct{}{}
	for _, p := range parts {
		n, err := strconv.ParseUint(p, 10, 32)
		if err != nil {
			return nil, errors.New("invalid tagIds")
		}
		id := uint32(n)
		if _, ok := seen[id]; !ok {
			seen[id] = struct{}{}
			out = append(out, id)
		}
	}
	if len(out) == 0 {
		return nil, errors.New("tagIds is empty")
	}
	return out, nil
}

func parseTimestamp(v, name, unit string) (int64, error) {
	if v == "" {
		return 0, errors.New(name + " is required")
	}
	if n, err := strconv.ParseInt(v, 10, 64); err == nil {
		return n, nil
	}
	t, err := time.Parse(time.RFC3339, v)
	if err != nil {
		return 0, errors.New(name + " must be epoch integer or ISO timestamp")
	}
	ms := t.UTC().UnixMilli()
	if unit == "ns" {
		return ms * 1_000_000, nil
	}
	return ms * 1_000, nil
}

func parseOrder(v string) (QueryOrder, error) {
	if v == "" || v == "desc" {
		return OrderDesc, nil
	}
	if v == "asc" {
		return OrderAsc, nil
	}
	return "", errors.New("order must be asc|desc")
}

func parseTimeFormat(v string) (string, error) {
	if v == "" || v == "epoch" {
		return "epoch", nil
	}
	if v == "iso" {
		return "iso", nil
	}
	return "", errors.New("time must be epoch|iso")
}

func formatTime(ts int64, unit, tf string) string {
	if tf == "epoch" {
		return strconv.FormatInt(ts, 10)
	}
	ms := ts / 1_000
	if unit == "ns" {
		ms = ts / 1_000_000
	}
	return time.UnixMilli(ms).UTC().Format(time.RFC3339)
}

func pivotPoints(points []Point, tf, unit string, order QueryOrder) []map[string]any {
	rows := map[int64]map[string]any{}
	for _, p := range points {
		row := rows[p.TsEpoch]
		if row == nil {
			row = map[string]any{"time": formatTime(p.TsEpoch, unit, tf)}
			rows[p.TsEpoch] = row
		}
		row["tag"+itoa(int(p.TagID))] = p.Value
	}
	keys := make([]int64, 0, len(rows))
	for k := range rows {
		keys = append(keys, k)
	}
	sort.Slice(keys, func(i, j int) bool {
		if order == OrderDesc {
			return keys[i] > keys[j]
		}
		return keys[i] < keys[j]
	})
	out := make([]map[string]any, 0, len(keys))
	for _, k := range keys {
		out = append(out, rows[k])
	}
	return out
}

func pivotBuckets(buckets map[string][]BucketValue, tf, unit string, order QueryOrder) []map[string]any {
	rows := map[int64]map[string]any{}
	for tag, vals := range buckets {
		for _, v := range vals {
			ts, err := strconv.ParseInt(v.BucketStart, 10, 64)
			if err != nil {
				continue
			}
			row := rows[ts]
			if row == nil {
				row = map[string]any{"time": formatTime(ts, unit, tf)}
				rows[ts] = row
			}
			row["tag"+tag] = v.Value
		}
	}
	keys := make([]int64, 0, len(rows))
	for k := range rows {
		keys = append(keys, k)
	}
	sort.Slice(keys, func(i, j int) bool {
		if order == OrderDesc {
			return keys[i] > keys[j]
		}
		return keys[i] < keys[j]
	})
	out := make([]map[string]any, 0, len(keys))
	for _, k := range keys {
		out = append(out, rows[k])
	}
	return out
}

func splitCSV(v string) []string {
	raw := make([]string, 0, 8)
	cur := ""
	for _, c := range v {
		if c == ',' {
			if cur != "" {
				raw = append(raw, cur)
			}
			cur = ""
			continue
		}
		cur += string(c)
	}
	if cur != "" {
		raw = append(raw, cur)
	}
	return raw
}

func writeErr(w http.ResponseWriter, err error) {
	writeJSON(w, map[string]any{"error": err.Error()}, http.StatusBadRequest)
}

func writeJSON(w http.ResponseWriter, v any, code int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}
