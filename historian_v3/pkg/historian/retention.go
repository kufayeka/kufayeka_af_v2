package historian

import (
	"os"
	"path/filepath"
	"strings"
	"time"
)

func StartRetentionLoop(cfg Config) {
	if !cfg.Retention.Enabled {
		return
	}
	ticker := time.NewTicker(time.Duration(cfg.Retention.CheckIntervalMs) * time.Millisecond)
	go func() {
		for range ticker.C {
			_ = runRetention(cfg)
		}
	}()
}

func runRetention(cfg Config) error {
	cutoff := time.Now().UTC().Add(-time.Duration(cfg.Retention.MaxAgeHours) * time.Hour)
	for _, root := range []string{"raw", "index"} {
		base := filepath.Join(cfg.Storage.DataDir, root)
		_ = filepath.Walk(base, func(path string, info os.FileInfo, err error) error {
			if err != nil || info == nil || !info.IsDir() {
				return nil
			}
			rel, err := filepath.Rel(base, path)
			if err != nil || rel == "." {
				return nil
			}
			parts := strings.Split(filepath.ToSlash(rel), "/")
			if len(parts) != 2 {
				return nil
			}
			t, err := time.Parse(time.RFC3339, parts[0]+"T"+parts[1]+":00:00Z")
			if err != nil {
				return nil
			}
			if t.Before(cutoff) {
				_ = os.RemoveAll(path)
			}
			return nil
		})
	}
	return nil
}
