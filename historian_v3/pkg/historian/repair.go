package historian

import (
	"os"
	"path/filepath"
)

func RepairStorageTail(cfg Config) error {
	rawRoot := filepath.Join(cfg.Storage.DataDir, "raw")
	_ = filepath.Walk(rawRoot, func(path string, info os.FileInfo, err error) error {
		if err != nil || info == nil || info.IsDir() || filepath.Ext(path) != ".seg" {
			return nil
		}
		b, err := os.ReadFile(path)
		if err != nil {
			return nil
		}
		off := 0
		for off < len(b) {
			_, n, ok := DecodeSegmentRecord(b, off)
			if !ok {
				break
			}
			off += n
		}
		if off < len(b) {
			if f, err := os.OpenFile(path, os.O_WRONLY, 0o644); err == nil {
				_ = f.Truncate(int64(off))
				_ = f.Close()
			}
		}
		return nil
	})
	idxRoot := filepath.Join(cfg.Storage.DataDir, "index")
	_ = filepath.Walk(idxRoot, func(path string, info os.FileInfo, err error) error {
		if err != nil || info == nil || info.IsDir() || filepath.Ext(path) != ".idx" {
			return nil
		}
		sz := int(info.Size())
		good := (sz / BlockIndexEntrySize) * BlockIndexEntrySize
		if good < sz {
			if f, err := os.OpenFile(path, os.O_WRONLY, 0o644); err == nil {
				_ = f.Truncate(int64(good))
				_ = f.Close()
			}
		}
		return nil
	})
	return nil
}
