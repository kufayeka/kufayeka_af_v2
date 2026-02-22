package historian

import (
	"os"
	"path/filepath"
	"sync"
	"time"
)

type WriterStats struct {
	AcceptedPoints    uint64 `json:"acceptedPoints"`
	DroppedPoints     uint64 `json:"droppedPoints"`
	DecodeErrors      uint64 `json:"decodeErrors"`
	SegmentSyncCount  uint64 `json:"segmentSyncCount"`
	SegmentSyncErrors uint64 `json:"segmentSyncErrors"`
}

type queueState struct {
	points []Point
	bytes  int
}

type HistorianWriter struct {
	cfg             Config
	lastStore       *LastValueStore
	wal             *WAL
	mu              sync.Mutex
	flushMu         sync.Mutex
	queues          map[string]*queueState
	stats           WriterStats
	stopCh          chan struct{}
	lastSegmentSync time.Time
}

func NewHistorianWriter(cfg Config, lastStore *LastValueStore, wal *WAL) *HistorianWriter {
	return &HistorianWriter{
		cfg:       cfg,
		lastStore: lastStore,
		wal:       wal,
		queues:    make(map[string]*queueState),
		stopCh:    make(chan struct{}),
	}
}

func (w *HistorianWriter) Start() {
	t := time.NewTicker(time.Duration(w.cfg.Flush.FlushIntervalMs) * time.Millisecond)
	go func() {
		for {
			select {
			case <-t.C:
				_ = w.FlushAll()
			case <-w.stopCh:
				t.Stop()
				return
			}
		}
	}()
}

func (w *HistorianWriter) Stop() {
	close(w.stopCh)
	_ = w.FlushAll()
}

func (w *HistorianWriter) RecoverFromWAL() error {
	if w.wal == nil {
		return nil
	}
	return w.wal.Replay(func(points []Point) error {
		return w.ingestBatchNoWAL(points)
	})
}

func (w *HistorianWriter) MarkDecodeError() {
	w.mu.Lock()
	w.stats.DecodeErrors++
	w.mu.Unlock()
}

func (w *HistorianWriter) Stats() WriterStats {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.stats
}

func (w *HistorianWriter) IngestBatch(points []Point) error {
	if w.wal != nil {
		if err := w.wal.Append(points); err != nil {
			return err
		}
	}
	return w.ingestBatchNoWAL(points)
}

func (w *HistorianWriter) ingestBatchNoWAL(points []Point) error {
	accepted := make([]Point, 0, len(points))
	needFlush := false
	w.mu.Lock()
	for _, p := range points {
		part := ComputePartition(p.TsEpoch, w.cfg)
		shard := ShardForTag(p.TagID, w.cfg.Storage.ShardCount)
		key := part.Day + "/" + part.Hour + "/" + itoa(shard)
		q := w.queues[key]
		if q == nil {
			q = &queueState{}
			w.queues[key] = q
		}
		if len(q.points) >= w.cfg.Flush.MaxQueuePoints {
			if w.cfg.Flush.BackpressurePolicy == "drop_new" {
				w.stats.DroppedPoints++
				continue
			}
			if len(q.points) > 0 {
				removed := SegmentRecordSize(q.points[0])
				q.points = q.points[1:]
				q.bytes -= removed
				if q.bytes < 0 {
					q.bytes = 0
				}
				w.stats.DroppedPoints++
			}
		}
		recLen := SegmentRecordSize(p)
		q.points = append(q.points, p)
		q.bytes += recLen
		w.stats.AcceptedPoints++
		accepted = append(accepted, p)
		if q.bytes >= w.cfg.Flush.FlushBytes {
			needFlush = true
		}
	}
	w.mu.Unlock()
	if len(accepted) > 0 {
		w.lastStore.UpdateBatch(accepted)
	}
	if needFlush {
		return w.FlushAll()
	}
	return nil
}

func (w *HistorianWriter) FlushAll() error {
	w.flushMu.Lock()
	defer w.flushMu.Unlock()
	return w.flushAllLocked()
}

func (w *HistorianWriter) flushAllLocked() error {
	type batch struct {
		key    string
		points []Point
		bytes  int
	}
	batches := make([]batch, 0, len(w.queues))
	w.mu.Lock()
	for k, q := range w.queues {
		if len(q.points) == 0 {
			continue
		}
		pts := q.points
		bytes := q.bytes
		q.points = nil
		q.bytes = 0
		batches = append(batches, batch{key: k, points: pts, bytes: bytes})
	}
	w.mu.Unlock()

	for _, b := range batches {
		if err := w.flushOne(b.key, b.points, b.bytes); err != nil {
			return err
		}
	}
	if w.wal != nil && len(batches) > 0 {
		rotated, err := w.wal.Rotate()
		if err == nil && rotated != "" {
			_ = os.Remove(rotated)
		}
	}
	return nil
}

func (w *HistorianWriter) RunMaintenance(fn func() error) error {
	w.flushMu.Lock()
	defer w.flushMu.Unlock()
	if err := w.flushAllLocked(); err != nil {
		return err
	}
	return fn()
}

func (w *HistorianWriter) flushOne(key string, points []Point, payloadBytes int) error {
	day, hour, shard := parseQueueKey(key)
	p := PartitionInfo{Day: day, Hour: hour}
	segPath := SegmentPath(w.cfg.Storage.DataDir, p, shard)
	idxPath := IndexPath(w.cfg.Storage.DataDir, p, shard)
	if err := os.MkdirAll(filepath.Dir(segPath), 0o755); err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(idxPath), 0o755); err != nil {
		return err
	}
	if payloadBytes <= 0 {
		for i := range points {
			payloadBytes += SegmentRecordSize(points[i])
		}
	}
	payload := make([]byte, payloadBytes)
	payloadOff := 0
	minTs := int64(^uint64(0) >> 1)
	maxTs := int64(-1 << 63)
	minTag := uint32(^uint32(0))
	maxTag := uint32(0)
	for _, point := range points {
		if point.TsEpoch < minTs {
			minTs = point.TsEpoch
		}
		if point.TsEpoch > maxTs {
			maxTs = point.TsEpoch
		}
		if point.TagID < minTag {
			minTag = point.TagID
		}
		if point.TagID > maxTag {
			maxTag = point.TagID
		}
		payloadOff += encodeSegmentRecordTo(payload[payloadOff:], point)
	}
	if payloadOff != len(payload) {
		payload = payload[:payloadOff]
	}
	startOff := uint64(0)
	if st, err := os.Stat(segPath); err == nil {
		startOff = uint64(st.Size())
	}
	sf, err := os.OpenFile(segPath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	if _, err := sf.Write(payload); err != nil {
		_ = sf.Close()
		return err
	}
	w.syncSegmentFileByPolicy(sf)
	_ = sf.Close()
	endOff := startOff + uint64(len(payload))

	if w.cfg.Index.IndexBlockOnFlush {
		entry := BlockIndexEntry{
			MinTs: minTs, MaxTs: maxTs,
			ByteOffsetStart: startOff, ByteOffsetEnd: endOff,
			PointCount: uint32(len(points)),
			MinTagID:   minTag, MaxTagID: maxTag,
		}
		iff, err := os.OpenFile(idxPath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
		if err != nil {
			return err
		}
		if _, err := iff.Write(EncodeBlockIndexEntry(entry)); err != nil {
			_ = iff.Close()
			return err
		}
		w.syncSegmentFileByPolicy(iff)
		_ = iff.Close()
	}
	return nil
}

func parseQueueKey(k string) (day string, hour string, shard int) {
	parts := split3(k)
	return parts[0], parts[1], atoi(parts[2])
}

func (w *HistorianWriter) syncSegmentFileByPolicy(f *os.File) {
	needSync := false
	switch w.cfg.FSync.SegmentPolicy {
	case "always":
		needSync = true
	case "interval":
		needSync = time.Since(w.lastSegmentSync) >= time.Duration(w.cfg.FSync.SegmentIntervalMs)*time.Millisecond
	case "off":
		needSync = false
	default:
		needSync = time.Since(w.lastSegmentSync) >= time.Duration(w.cfg.FSync.SegmentIntervalMs)*time.Millisecond
	}
	if !needSync {
		return
	}
	if err := f.Sync(); err != nil {
		w.mu.Lock()
		w.stats.SegmentSyncErrors++
		w.mu.Unlock()
		return
	}
	w.lastSegmentSync = time.Now()
	w.mu.Lock()
	w.stats.SegmentSyncCount++
	w.mu.Unlock()
}
