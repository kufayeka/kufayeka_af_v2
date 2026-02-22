package historian

import (
	"os"
	"sort"
	"strconv"
	"sync"
	"sync/atomic"
	"time"
)

type QueryEngine struct {
	cfg Config
}

func NewQueryEngine(cfg Config) *QueryEngine { return &QueryEngine{cfg: cfg} }

var scanBufPool = sync.Pool{
	New: func() any {
		return make([]byte, 0, 64*1024)
	},
}

type RawResult struct {
	Points    []Point `json:"points"`
	Truncated bool    `json:"truncated"`
}

type BucketValue struct {
	BucketStart string `json:"bucketStart"`
	Value       any    `json:"value"`
}

type RangeResult struct {
	Buckets   map[string][]BucketValue `json:"buckets"`
	Truncated bool                     `json:"truncated"`
}

func (q *QueryEngine) Raw(tagIDs []uint32, from, to int64, limit int, order QueryOrder) (RawResult, error) {
	shards := make(map[int]struct{})
	tagSet := make(map[uint32]struct{})
	minTag, maxTag := uint32(^uint32(0)), uint32(0)
	for _, t := range tagIDs {
		shards[ShardForTag(t, q.cfg.Storage.ShardCount)] = struct{}{}
		tagSet[t] = struct{}{}
		if t < minTag {
			minTag = t
		}
		if t > maxTag {
			maxTag = t
		}
	}
	parts := q.partitionsBetween(from, to, order)
	type piece struct{ points []Point }
	outCh := make(chan piece, len(parts)*len(shards))
	sem := make(chan struct{}, q.cfg.Query.MaxParallel)
	var wg sync.WaitGroup
	var remaining int64 = int64(limit)
	for _, p := range parts {
		for s := range shards {
			wg.Add(1)
			sem <- struct{}{}
			go func(p PartitionInfo, shard int) {
				defer wg.Done()
				defer func() { <-sem }()
				points := q.scanPartitionShard(p, shard, tagSet, minTag, maxTag, from, to, order, limit, &remaining)
				if len(points) > 0 {
					outCh <- piece{points: points}
				}
			}(p, s)
		}
	}
	go func() {
		wg.Wait()
		close(outCh)
	}()
	all := make([]Point, 0, limit*2)
	for p := range outCh {
		all = append(all, p.points...)
	}
	sort.Slice(all, func(i, j int) bool {
		if all[i].TsEpoch == all[j].TsEpoch {
			return all[i].TagID < all[j].TagID
		}
		if order == OrderDesc {
			return all[i].TsEpoch > all[j].TsEpoch
		}
		return all[i].TsEpoch < all[j].TsEpoch
	})
	truncated := false
	if len(all) > limit {
		all = all[:limit]
		truncated = true
	}
	return RawResult{Points: all, Truncated: truncated}, nil
}

func (q *QueryEngine) scanPartitionShard(
	p PartitionInfo,
	shard int,
	tagSet map[uint32]struct{},
	minTag, maxTag uint32,
	from, to int64,
	order QueryOrder,
	limit int,
	remaining *int64,
) []Point {
	segPath := SegmentPath(q.cfg.Storage.DataDir, p, shard)
	idxPath := IndexPath(q.cfg.Storage.DataDir, p, shard)
	stat, err := os.Stat(segPath)
	if err != nil || stat.Size() == 0 {
		return nil
	}
	var ranges [][2]uint64
	if ib, err := os.ReadFile(idxPath); err == nil && len(ib) >= BlockIndexEntrySize {
		for _, e := range DecodeBlockIndex(ib) {
			if e.MaxTs < from || e.MinTs > to {
				continue
			}
			if e.MaxTagID < minTag || e.MinTagID > maxTag {
				continue
			}
			ranges = append(ranges, [2]uint64{e.ByteOffsetStart, e.ByteOffsetEnd})
		}
	}
	if len(ranges) == 0 {
		ranges = append(ranges, [2]uint64{0, uint64(stat.Size())})
	}
	if order == OrderDesc {
		for i, j := 0, len(ranges)-1; i < j; i, j = i+1, j-1 {
			ranges[i], ranges[j] = ranges[j], ranges[i]
		}
	}
	out := make([]Point, 0, limit)
	f, err := os.Open(segPath)
	if err != nil {
		return nil
	}
	defer f.Close()
	for _, r := range ranges {
		if atomic.LoadInt64(remaining) <= 0 {
			break
		}
		n := int(r[1] - r[0])
		if n <= 0 {
			continue
		}
		buf := getScanBuf(n)
		readN, err := f.ReadAt(buf, int64(r[0]))
		if err != nil && readN <= 0 {
			putScanBuf(buf)
			continue
		}
		buf = buf[:readN]
		if order == OrderAsc {
			off := 0
			for off < len(buf) {
				p, n, ok := DecodeSegmentRecord(buf, off)
				if !ok {
					break
				}
				off += n
				if _, ok := tagSet[p.TagID]; !ok {
					continue
				}
				if p.TsEpoch < from || p.TsEpoch > to {
					continue
				}
				if !takeBudget(remaining) {
					return out
				}
				out = append(out, *p)
				if len(out) >= limit {
					putScanBuf(buf)
					return out
				}
			}
		} else {
			blockPts := decodeFilteredInto(nil, buf, tagSet, from, to)
			for i := len(blockPts) - 1; i >= 0; i-- {
				if !takeBudget(remaining) {
					putScanBuf(buf)
					return out
				}
				out = append(out, blockPts[i])
				if len(out) >= limit {
					putScanBuf(buf)
					return out
				}
			}
		}
		putScanBuf(buf)
	}
	return out
}

func decodeFilteredInto(dst []Point, buf []byte, tags map[uint32]struct{}, from, to int64) []Point {
	out := dst[:0]
	off := 0
	for off < len(buf) {
		p, n, ok := DecodeSegmentRecord(buf, off)
		if !ok {
			break
		}
		off += n
		if _, ok := tags[p.TagID]; !ok {
			continue
		}
		if p.TsEpoch < from || p.TsEpoch > to {
			continue
		}
		out = append(out, *p)
	}
	return out
}

func getScanBuf(n int) []byte {
	if n <= 0 {
		return nil
	}
	v := scanBufPool.Get()
	if v == nil {
		return make([]byte, n)
	}
	b := v.([]byte)
	if cap(b) < n {
		return make([]byte, n)
	}
	return b[:n]
}

func putScanBuf(b []byte) {
	const maxPooled = 8 * 1024 * 1024
	if b == nil || cap(b) > maxPooled {
		return
	}
	scanBufPool.Put(b[:0])
}

func takeBudget(remaining *int64) bool {
	for {
		cur := atomic.LoadInt64(remaining)
		if cur <= 0 {
			return false
		}
		if atomic.CompareAndSwapInt64(remaining, cur, cur-1) {
			return true
		}
	}
}

func (q *QueryEngine) Range(tagIDs []uint32, from, to int64, bucketMs *int64, agg string, order QueryOrder, limit int) (RangeResult, error) {
	raw, err := q.Raw(tagIDs, from, to, limit, order)
	if err != nil {
		return RangeResult{}, err
	}
	if bucketMs == nil {
		buckets := map[string][]BucketValue{}
		for _, p := range raw.Points {
			buckets[itoa(int(p.TagID))] = append(buckets[itoa(int(p.TagID))], BucketValue{
				BucketStart: itoa64(p.TsEpoch),
				Value:       p.Value,
			})
		}
		return RangeResult{Buckets: buckets, Truncated: raw.Truncated}, nil
	}
	step := (*bucketMs) * 1000
	if q.cfg.Storage.TimestampUnit == "ns" {
		step = (*bucketMs) * 1_000_000
	}
	type aggState struct {
		First, Last any
		Min, Max    *float64
		Sum         float64
		NumCount    int64
		Count       int64
	}
	states := map[uint32]map[int64]*aggState{}
	for _, p := range raw.Points {
		bk := ((p.TsEpoch - from) / step * step) + from
		m := states[p.TagID]
		if m == nil {
			m = map[int64]*aggState{}
			states[p.TagID] = m
		}
		s := m[bk]
		if s == nil {
			s = &aggState{}
			m[bk] = s
		}
		s.Count++
		if s.First == nil {
			s.First = p.Value
		}
		s.Last = p.Value
		if p.TypeCode.IsNumeric() {
			v := toFloat(p.Value)
			if s.Min == nil || v < *s.Min {
				s.Min = &v
			}
			if s.Max == nil || v > *s.Max {
				s.Max = &v
			}
			s.Sum += v
			s.NumCount++
		}
	}
	out := map[string][]BucketValue{}
	for tag, bm := range states {
		keys := make([]int64, 0, len(bm))
		for k := range bm {
			keys = append(keys, k)
		}
		sort.Slice(keys, func(i, j int) bool {
			if order == OrderDesc {
				return keys[i] > keys[j]
			}
			return keys[i] < keys[j]
		})
		rows := make([]BucketValue, 0, len(keys))
		for _, k := range keys {
			s := bm[k]
			var v any
			switch agg {
			case "count":
				v = s.Count
			case "first":
				v = s.First
			case "last":
				v = s.Last
			case "min":
				if s.Min != nil {
					v = *s.Min
				}
			case "max":
				if s.Max != nil {
					v = *s.Max
				}
			default: // avg
				if s.NumCount > 0 {
					v = s.Sum / float64(s.NumCount)
				}
			}
			rows = append(rows, BucketValue{BucketStart: itoa64(k), Value: v})
		}
		out[itoa(int(tag))] = rows
	}
	return RangeResult{Buckets: out, Truncated: raw.Truncated}, nil
}

func (q *QueryEngine) partitionsBetween(from, to int64, order QueryOrder) []PartitionInfo {
	fromMs := TsToMs(from, q.cfg.Storage.TimestampUnit)
	toMs := TsToMs(to, q.cfg.Storage.TimestampUnit)
	step := q.cfg.Storage.PartitionDurationMs
	start := (fromMs / step) * step
	out := make([]PartitionInfo, 0, 64)
	for ms := start; ms <= toMs; ms += step {
		dt := time.UnixMilli(ms).UTC()
		out = append(out, PartitionInfo{
			StartMs: ms,
			Day:     dt.Format("2006-01-02"),
			Hour:    dt.Format("15"),
		})
	}
	if order == OrderDesc {
		for i, j := 0, len(out)-1; i < j; i, j = i+1, j-1 {
			out[i], out[j] = out[j], out[i]
		}
	}
	return out
}

func itoa64(v int64) string { return strconv.FormatInt(v, 10) }
