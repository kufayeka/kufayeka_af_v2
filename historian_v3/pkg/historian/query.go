package historian

import (
	"io"
	"os"
	"sort"
	"strconv"
	"sync"
	"sync/atomic"
	"time"
)

type QueryEngine struct {
	cfg            Config
	fdCache        *fdCache
	scanChunkBytes int
	stopJanitor    chan struct{}
}

func NewQueryEngine(cfg Config) *QueryEngine {
	q := &QueryEngine{
		cfg:            cfg,
		scanChunkBytes: cfg.Query.ScanChunkBytes,
	}
	if q.scanChunkBytes < 4*1024 {
		q.scanChunkBytes = 4 * 1024
	}
	if cfg.Query.FDCacheEnabled {
		q.fdCache = newFDCache(
			cfg.Query.FDCacheMaxOpen,
			time.Duration(cfg.Query.FDCacheIdleMs)*time.Millisecond,
		)
		q.stopJanitor = make(chan struct{})
		t := time.NewTicker(5 * time.Second)
		go func() {
			defer t.Stop()
			for {
				select {
				case <-t.C:
					q.fdCache.CleanupIdle(time.Now())
				case <-q.stopJanitor:
					return
				}
			}
		}()
	}
	return q
}

func (q *QueryEngine) Close() {
	if q.stopJanitor != nil {
		close(q.stopJanitor)
		q.stopJanitor = nil
	}
	if q.fdCache != nil {
		q.fdCache.CloseAll()
		q.fdCache = nil
	}
}

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

type aggState struct {
	First, Last any
	Min, Max    *float64
	Sum         float64
	NumCount    int64
	Count       int64
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
	var (
		f       *os.File
		release func()
	)
	if q.fdCache != nil {
		f, release, err = q.fdCache.Acquire(segPath)
	} else {
		f, err = os.Open(segPath)
		if err == nil {
			release = func() { _ = f.Close() }
		}
	}
	if err != nil || f == nil {
		return nil
	}
	defer release()

	scratch := make([]Point, 0, 256)
	for _, r := range ranges {
		if atomic.LoadInt64(remaining) <= 0 {
			break
		}
		if r[1] <= r[0] {
			continue
		}
		blockPts := q.scanRangeChunked(f, r[0], r[1], tagSet, from, to, scratch)
		if order == OrderAsc {
			for i := 0; i < len(blockPts); i++ {
				if !takeBudget(remaining) {
					return out
				}
				out = append(out, blockPts[i])
				if len(out) >= limit {
					return out
				}
			}
		} else {
			for i := len(blockPts) - 1; i >= 0; i-- {
				if !takeBudget(remaining) {
					return out
				}
				out = append(out, blockPts[i])
				if len(out) >= limit {
					return out
				}
			}
		}
		scratch = blockPts[:0]
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

func (q *QueryEngine) scanRangeChunked(
	f *os.File,
	start, end uint64,
	tags map[uint32]struct{},
	from, to int64,
	scratch []Point,
) []Point {
	out := scratch[:0]
	if end <= start {
		return out
	}
	chunk := q.scanChunkBytes
	if chunk <= 0 {
		chunk = 512 * 1024
	}
	var carry []byte
	pos := start
	for pos < end {
		remaining := int(end - pos)
		readSize := chunk
		if readSize > remaining {
			readSize = remaining
		}
		buf := getScanBuf(readSize)
		n, err := f.ReadAt(buf[:readSize], int64(pos))
		if n > 0 {
			pos += uint64(n)
		}
		if n <= 0 {
			putScanBuf(buf)
			break
		}
		data := buf[:n]
		var proc []byte
		if len(carry) > 0 {
			proc = make([]byte, len(carry)+len(data))
			copy(proc, carry)
			copy(proc[len(carry):], data)
		} else {
			proc = data
		}
		off := 0
		for off < len(proc) {
			p, recN, ok := DecodeSegmentRecord(proc, off)
			if !ok {
				break
			}
			off += recN
			if _, ok := tags[p.TagID]; !ok {
				continue
			}
			if p.TsEpoch < from || p.TsEpoch > to {
				continue
			}
			out = append(out, *p)
		}
		if off < len(proc) {
			rem := len(proc) - off
			if cap(carry) < rem {
				carry = make([]byte, rem)
			} else {
				carry = carry[:rem]
			}
			copy(carry, proc[off:])
			// Defensive guard for malformed tails.
			if len(carry) > 16*1024*1024 {
				carry = carry[:0]
			}
		} else {
			carry = carry[:0]
		}
		putScanBuf(buf)
		if err != nil && err != io.EOF {
			break
		}
	}
	return out
}

func (q *QueryEngine) scanRangeChunkedVisit(
	f *os.File,
	start, end uint64,
	tags map[uint32]struct{},
	from, to int64,
	onPoint func(Point),
) {
	if end <= start {
		return
	}
	chunk := q.scanChunkBytes
	if chunk <= 0 {
		chunk = 512 * 1024
	}
	var carry []byte
	pos := start
	for pos < end {
		remaining := int(end - pos)
		readSize := chunk
		if readSize > remaining {
			readSize = remaining
		}
		buf := getScanBuf(readSize)
		n, err := f.ReadAt(buf[:readSize], int64(pos))
		if n > 0 {
			pos += uint64(n)
		}
		if n <= 0 {
			putScanBuf(buf)
			break
		}
		data := buf[:n]
		var proc []byte
		if len(carry) > 0 {
			proc = make([]byte, len(carry)+len(data))
			copy(proc, carry)
			copy(proc[len(carry):], data)
		} else {
			proc = data
		}
		off := 0
		for off < len(proc) {
			p, recN, ok := DecodeSegmentRecord(proc, off)
			if !ok {
				break
			}
			off += recN
			if _, ok := tags[p.TagID]; !ok {
				continue
			}
			if p.TsEpoch < from || p.TsEpoch > to {
				continue
			}
			onPoint(*p)
		}
		if off < len(proc) {
			rem := len(proc) - off
			if cap(carry) < rem {
				carry = make([]byte, rem)
			} else {
				carry = carry[:rem]
			}
			copy(carry, proc[off:])
			if len(carry) > 16*1024*1024 {
				carry = carry[:0]
			}
		} else {
			carry = carry[:0]
		}
		putScanBuf(buf)
		if err != nil && err != io.EOF {
			break
		}
	}
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
	if bucketMs == nil {
		// Keep backward compatibility: no bucket means raw-like series.
		raw, err := q.Raw(tagIDs, from, to, limit, order)
		if err != nil {
			return RangeResult{}, err
		}
		buckets := map[string][]BucketValue{}
		for _, p := range raw.Points {
			buckets[itoa(int(p.TagID))] = append(buckets[itoa(int(p.TagID))], BucketValue{
				BucketStart: itoa64(p.TsEpoch),
				Value:       p.Value,
			})
		}
		return RangeResult{Buckets: buckets, Truncated: raw.Truncated}, nil
	}

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
	parts := q.partitionsBetween(from, to, OrderAsc)
	step := (*bucketMs) * 1000
	if q.cfg.Storage.TimestampUnit == "ns" {
		step = (*bucketMs) * 1_000_000
	}
	if step <= 0 {
		return RangeResult{}, nil
	}

	globalStates := map[uint32]map[int64]*aggState{}
	var globalMu sync.Mutex
	sem := make(chan struct{}, q.cfg.Query.MaxParallel)
	var wg sync.WaitGroup
	for _, p := range parts {
		for s := range shards {
			wg.Add(1)
			sem <- struct{}{}
			go func(part PartitionInfo, shard int) {
				defer wg.Done()
				defer func() { <-sem }()
				localStates := map[uint32]map[int64]*aggState{}
				q.scanPartitionShardStream(part, shard, tagSet, minTag, maxTag, from, to, func(pt Point) {
					bk := ((pt.TsEpoch - from) / step * step) + from
					tagMap := localStates[pt.TagID]
					if tagMap == nil {
						tagMap = map[int64]*aggState{}
						localStates[pt.TagID] = tagMap
					}
					st := tagMap[bk]
					if st == nil {
						st = &aggState{}
						tagMap[bk] = st
					}
					accumulateAggState(st, pt)
				})
				if len(localStates) == 0 {
					return
				}
				globalMu.Lock()
				mergeAggMaps(globalStates, localStates)
				globalMu.Unlock()
			}(p, s)
		}
	}
	wg.Wait()

	out := map[string][]BucketValue{}
	totalRows := 0
	truncated := false
	for tag, bm := range globalStates {
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
			if limit > 0 && totalRows >= limit {
				truncated = true
				break
			}
			s := bm[k]
			v := aggregateValue(agg, s)
			rows = append(rows, BucketValue{BucketStart: itoa64(k), Value: v})
			totalRows++
		}
		out[itoa(int(tag))] = rows
		if truncated {
			break
		}
	}
	return RangeResult{Buckets: out, Truncated: truncated}, nil
}

func (q *QueryEngine) scanPartitionShardStream(
	p PartitionInfo,
	shard int,
	tagSet map[uint32]struct{},
	minTag, maxTag uint32,
	from, to int64,
	onPoint func(Point),
) {
	segPath := SegmentPath(q.cfg.Storage.DataDir, p, shard)
	idxPath := IndexPath(q.cfg.Storage.DataDir, p, shard)
	stat, err := os.Stat(segPath)
	if err != nil || stat.Size() == 0 {
		return
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
	var (
		f       *os.File
		release func()
	)
	if q.fdCache != nil {
		f, release, err = q.fdCache.Acquire(segPath)
	} else {
		f, err = os.Open(segPath)
		if err == nil {
			release = func() { _ = f.Close() }
		}
	}
	if err != nil || f == nil {
		return
	}
	defer release()

	for _, r := range ranges {
		q.scanRangeChunkedVisit(f, r[0], r[1], tagSet, from, to, onPoint)
	}
}

func accumulateAggState(s *aggState, p Point) {
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

func mergeAggMaps(dst map[uint32]map[int64]*aggState, src map[uint32]map[int64]*aggState) {
	for tag, srcBuckets := range src {
		dstBuckets := dst[tag]
		if dstBuckets == nil {
			dstBuckets = map[int64]*aggState{}
			dst[tag] = dstBuckets
		}
		for bk, s := range srcBuckets {
			d := dstBuckets[bk]
			if d == nil {
				clone := *s
				dstBuckets[bk] = &clone
				continue
			}
			if d.First == nil {
				d.First = s.First
			}
			d.Last = s.Last
			d.Count += s.Count
			d.Sum += s.Sum
			d.NumCount += s.NumCount
			if s.Min != nil && (d.Min == nil || *s.Min < *d.Min) {
				v := *s.Min
				d.Min = &v
			}
			if s.Max != nil && (d.Max == nil || *s.Max > *d.Max) {
				v := *s.Max
				d.Max = &v
			}
		}
	}
}

func aggregateValue(agg string, s *aggState) any {
	switch agg {
	case "count":
		return s.Count
	case "first":
		return s.First
	case "last":
		return s.Last
	case "min":
		if s.Min != nil {
			return *s.Min
		}
		return nil
	case "max":
		if s.Max != nil {
			return *s.Max
		}
		return nil
	default: // avg
		if s.NumCount > 0 {
			return s.Sum / float64(s.NumCount)
		}
		return nil
	}
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
