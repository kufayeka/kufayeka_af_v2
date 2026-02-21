package historian

import (
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"time"
)

type LastValueStore struct {
	path   string
	mu     sync.RWMutex
	latest map[uint32]Point
	queue  chan []byte
	stopCh chan struct{}
	wg     sync.WaitGroup
	errors atomic.Uint64
}

func (s *LastValueStore) upsertNoLock(p Point) {
	cur, ok := s.latest[p.TagID]
	if !ok || p.TsEpoch >= cur.TsEpoch {
		s.latest[p.TagID] = p
	}
}

func NewLastValueStore(dataDir string) *LastValueStore {
	return &LastValueStore{
		path:   filepath.Join(dataDir, "meta", "last-values.log"),
		latest: make(map[uint32]Point),
		queue:  make(chan []byte, 4096),
		stopCh: make(chan struct{}),
	}
}

func (s *LastValueStore) Start() error {
	if err := os.MkdirAll(filepath.Dir(s.path), 0o755); err != nil {
		return err
	}
	b, err := os.ReadFile(s.path)
	if err != nil {
		if os.IsNotExist(err) {
			b = nil
		} else {
			return err
		}
	}
	off := 0
	for off < len(b) {
		p, n, ok := DecodeSegmentRecord(b, off)
		if !ok {
			break
		}
		off += n
		s.mu.Lock()
		s.upsertNoLock(*p)
		s.mu.Unlock()
	}
	if off < len(b) {
		f, err := os.OpenFile(s.path, os.O_WRONLY, 0o644)
		if err == nil {
			_ = f.Truncate(int64(off))
			_ = f.Close()
		}
	}
	s.wg.Add(1)
	go s.flushLoop()
	return nil
}

func (s *LastValueStore) Stop() {
	close(s.stopCh)
	s.wg.Wait()
}

func (s *LastValueStore) UpdateBatch(points []Point) {
	if len(points) == 0 {
		return
	}
	payload := make([]byte, 0, len(points)*32)
	s.mu.Lock()
	for _, p := range points {
		s.upsertNoLock(p)
		payload = append(payload, EncodeSegmentRecord(p)...)
	}
	s.mu.Unlock()
	select {
	case s.queue <- payload:
	default:
		// Best-effort fallback to avoid blocking ingest hot path.
		if err := appendFile(s.path, payload); err != nil {
			s.errors.Add(1)
		}
	}
}

func (s *LastValueStore) GetLatest(tagIDs []uint32) []Point {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]Point, 0, len(tagIDs))
	for _, t := range tagIDs {
		if p, ok := s.latest[t]; ok {
			out = append(out, p)
		}
	}
	return out
}

func (s *LastValueStore) flushLoop() {
	defer s.wg.Done()
	ticker := time.NewTicker(25 * time.Millisecond)
	defer ticker.Stop()
	buf := make([]byte, 0, 256*1024)
	flush := func() {
		if len(buf) == 0 {
			return
		}
		if err := appendFile(s.path, buf); err != nil {
			s.errors.Add(1)
		}
		buf = buf[:0]
	}
	for {
		select {
		case payload := <-s.queue:
			if len(payload) > 0 {
				buf = append(buf, payload...)
			}
			if len(buf) >= 256*1024 {
				flush()
			}
		case <-ticker.C:
			flush()
		case <-s.stopCh:
			for {
				select {
				case payload := <-s.queue:
					if len(payload) > 0 {
						buf = append(buf, payload...)
					}
				default:
					flush()
					return
				}
			}
		}
	}
}

func appendFile(path string, payload []byte) error {
	if len(payload) == 0 {
		return nil
	}
	f, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	defer f.Close()
	_, err = f.Write(payload)
	return err
}
