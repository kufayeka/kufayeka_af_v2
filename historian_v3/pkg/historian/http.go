package historian

import (
	"encoding/json"
	"errors"
	"io"
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
	logger              *ActivityLogger
	queryCount          uint64
	queryErrors         uint64
	queryTotalLatencyMs uint64
}

func NewServer(cfg Config, writer *HistorianWriter, query *QueryEngine, lastStore *LastValueStore, wal *WAL, logger *ActivityLogger) *Server {
	return &Server{cfg: cfg, writer: writer, query: query, lastStore: lastStore, wal: wal, logger: logger}
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/health", s.handleHealth)
	mux.HandleFunc("/hist/last", s.handleLast)
	mux.HandleFunc("/hist/raw", s.handleRaw)
	mux.HandleFunc("/hist/range", s.handleRange)
	mux.HandleFunc("/hist/delete", s.handleDelete)
	mux.HandleFunc("/logs", s.handleLogs)
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
	if s.logger != nil {
		payload["logs"] = map[string]any{
			"ingestLast100": len(s.logger.Snapshot("ingest", 100)),
			"systemLast100": len(s.logger.Snapshot("system", 100)),
		}
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
	if s.logger != nil {
		s.logger.AddSystem("info", "query last", map[string]any{
			"tagCount": len(tagIDs),
			"rows":     len(rows),
		})
	}
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
		if s.logger != nil {
			s.logger.AddSystem("error", "query raw failed", map[string]any{"error": err.Error()})
		}
		return
	}
	rows := pivotPoints(res.Points, tf, s.cfg.Storage.TimestampUnit, order)
	writeJSON(w, map[string]any{"rows": rows, "truncated": res.Truncated}, http.StatusOK)
	if s.logger != nil {
		s.logger.AddSystem("info", "query raw", map[string]any{
			"tagCount":   len(tagIDs),
			"rows":       len(rows),
			"truncated":  res.Truncated,
			"from":       from,
			"to":         to,
			"order":      order,
			"limit":      limit,
			"durationMs": time.Since(start).Milliseconds(),
		})
	}
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
		if s.logger != nil {
			s.logger.AddSystem("error", "query range failed", map[string]any{"error": err.Error()})
		}
		return
	}
	rows := pivotBuckets(res.Buckets, tf, s.cfg.Storage.TimestampUnit, order)
	writeJSON(w, map[string]any{"rows": rows, "truncated": res.Truncated, "agg": agg}, http.StatusOK)
	if s.logger != nil {
		s.logger.AddSystem("info", "query range", map[string]any{
			"tagCount":   len(tagIDs),
			"rows":       len(rows),
			"truncated":  res.Truncated,
			"agg":        agg,
			"durationMs": time.Since(start).Milliseconds(),
		})
	}
}

type deleteReq struct {
	TagIDs []uint32 `json:"tagIds"`
	From   *string  `json:"from,omitempty"`
	To     *string  `json:"to,omitempty"`
}

func (s *Server) handleDelete(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost && r.Method != http.MethodDelete {
		writeJSON(w, map[string]any{"error": "method not allowed"}, http.StatusMethodNotAllowed)
		return
	}
	body, err := io.ReadAll(r.Body)
	if err != nil {
		writeJSON(w, map[string]any{"error": "invalid body"}, http.StatusBadRequest)
		return
	}
	req := deleteReq{}
	if len(body) > 0 {
		if err := json.Unmarshal(body, &req); err != nil {
			writeJSON(w, map[string]any{"error": "invalid json body"}, http.StatusBadRequest)
			return
		}
	}
	if len(req.TagIDs) == 0 {
		writeJSON(w, map[string]any{"error": "tagIds is required"}, http.StatusBadRequest)
		return
	}
	var fromTs *int64
	var toTs *int64
	if req.From != nil && *req.From != "" {
		v, err := parseTimestamp(*req.From, "from", s.cfg.Storage.TimestampUnit)
		if err != nil {
			writeErr(w, err)
			return
		}
		fromTs = &v
	}
	if req.To != nil && *req.To != "" {
		v, err := parseTimestamp(*req.To, "to", s.cfg.Storage.TimestampUnit)
		if err != nil {
			writeErr(w, err)
			return
		}
		toTs = &v
	}
	err = s.writer.RunMaintenance(func() error {
		result, err := s.query.DeleteByTags(req.TagIDs, fromTs, toTs)
		if err != nil {
			return err
		}
		if err := s.lastStore.RebuildTags(s.cfg.Storage.DataDir, req.TagIDs); err != nil {
			return err
		}
		writeJSON(w, map[string]any{
			"ok":             true,
			"deletedRecords": result.DeletedRecords,
			"touchedSegments": result.TouchedSegments,
			"tagIds":         req.TagIDs,
		}, http.StatusOK)
		if s.logger != nil {
			s.logger.AddSystem("info", "historian delete", map[string]any{
				"tagIds":          req.TagIDs,
				"deletedRecords":  result.DeletedRecords,
				"touchedSegments": result.TouchedSegments,
				"from":            fromTs,
				"to":              toTs,
			})
		}
		return nil
	})
	if err != nil {
		writeJSON(w, map[string]any{"error": err.Error()}, http.StatusInternalServerError)
		if s.logger != nil {
			s.logger.AddSystem("error", "historian delete failed", map[string]any{"error": err.Error()})
		}
		return
	}
}

func (s *Server) handleLogs(w http.ResponseWriter, r *http.Request) {
	kind := r.URL.Query().Get("kind")
	limit := 100
	if raw := r.URL.Query().Get("limit"); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil && n > 0 {
			limit = n
		}
	}
	if s.logger == nil {
		writeJSON(w, map[string]any{"items": []LogEntry{}}, http.StatusOK)
		return
	}
	items := s.logger.Snapshot(kind, limit)
	writeJSON(w, map[string]any{
		"kind":  kind,
		"count": len(items),
		"items": items,
	}, http.StatusOK)
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
	var sec int64
	var nsec int64
	if unit == "ns" {
		sec = ts / 1_000_000_000
		nsec = ts % 1_000_000_000
	} else {
		sec = ts / 1_000_000
		nsec = (ts % 1_000_000) * 1_000
	}
	if nsec < 0 {
		sec -= 1
		nsec += 1_000_000_000
	}
	return time.Unix(sec, nsec).UTC().Format(time.RFC3339Nano)
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
