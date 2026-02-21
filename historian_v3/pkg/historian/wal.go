package historian

import (
	"encoding/binary"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"
)

type WALStats struct {
	AppendOK      uint64 `json:"appendOk"`
	AppendErrors  uint64 `json:"appendErrors"`
	ReplayBatches uint64 `json:"replayBatches"`
	ReplayPoints  uint64 `json:"replayPoints"`
	RotateCount   uint64 `json:"rotateCount"`
	SyncCount     uint64 `json:"syncCount"`
	SyncErrors    uint64 `json:"syncErrors"`
}

type WAL struct {
	dir        string
	activePath string
	cfg        Config
	mu         sync.Mutex
	f          *os.File
	stats      WALStats
	lastSync   time.Time
}

func NewWAL(dataDir string, cfg Config) *WAL {
	dir := filepath.Join(dataDir, "meta")
	return &WAL{
		dir:        dir,
		activePath: filepath.Join(dir, "ingest-active.wal"),
		cfg:        cfg,
	}
}

func (w *WAL) Start() error {
	if err := os.MkdirAll(w.dir, 0o755); err != nil {
		return err
	}
	f, err := os.OpenFile(w.activePath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	w.mu.Lock()
	w.f = f
	w.mu.Unlock()
	return nil
}

func (w *WAL) Stop() {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.f != nil {
		_ = w.f.Close()
		w.f = nil
	}
}

func (w *WAL) Append(points []Point) error {
	if len(points) == 0 {
		return nil
	}
	payload := EncodeUDPBatch(points)
	frame := make([]byte, 4+len(payload))
	binary.LittleEndian.PutUint32(frame[:4], uint32(len(payload)))
	copy(frame[4:], payload)

	w.mu.Lock()
	defer w.mu.Unlock()
	if w.f == nil {
		w.stats.AppendErrors++
		return os.ErrClosed
	}
	_, err := w.f.Write(frame)
	if err != nil {
		w.stats.AppendErrors++
		return err
	}
	w.stats.AppendOK++
	w.syncLockedByPolicy()
	return nil
}

func (w *WAL) Rotate() (string, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.f == nil {
		return "", os.ErrClosed
	}
	w.forceSyncLocked()
	_ = w.f.Close()
	rotated := filepath.Join(w.dir, "ingest-"+time.Now().UTC().Format("20060102-150405.000000000")+".wal")
	if err := os.Rename(w.activePath, rotated); err != nil {
		return "", err
	}
	f, err := os.OpenFile(w.activePath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		return "", err
	}
	w.f = f
	w.stats.RotateCount++
	return rotated, nil
}

func (w *WAL) Replay(apply func([]Point) error) error {
	paths, err := filepath.Glob(filepath.Join(w.dir, "*.wal"))
	if err != nil {
		return err
	}
	sort.Strings(paths)
	for _, p := range paths {
		data, err := os.ReadFile(p)
		if err != nil {
			continue
		}
		off := 0
		for off+4 <= len(data) {
			n := int(binary.LittleEndian.Uint32(data[off : off+4]))
			off += 4
			if off+n > len(data) {
				break
			}
			points, err := DecodeUDPBatch(data[off : off+n])
			off += n
			if err != nil {
				continue
			}
			if err := apply(points); err != nil {
				return err
			}
			w.mu.Lock()
			w.stats.ReplayBatches++
			w.stats.ReplayPoints += uint64(len(points))
			w.mu.Unlock()
		}
		_ = os.Remove(p)
	}
	return nil
}

func (w *WAL) Stats() WALStats {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.stats
}

func (w *WAL) syncLockedByPolicy() {
	switch w.cfg.FSync.WALPolicy {
	case "always":
		w.forceSyncLocked()
	case "interval":
		if time.Since(w.lastSync) >= time.Duration(w.cfg.FSync.WALIntervalMs)*time.Millisecond {
			w.forceSyncLocked()
		}
	case "off":
		return
	default:
		if time.Since(w.lastSync) >= time.Duration(w.cfg.FSync.WALIntervalMs)*time.Millisecond {
			w.forceSyncLocked()
		}
	}
}

func (w *WAL) forceSyncLocked() {
	if w.f == nil {
		return
	}
	if err := w.f.Sync(); err != nil {
		w.stats.SyncErrors++
		return
	}
	w.lastSync = time.Now()
	w.stats.SyncCount++
}
