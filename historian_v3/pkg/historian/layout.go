package historian

import (
	"fmt"
	"os"
	"path/filepath"
	"time"
)

type PartitionInfo struct {
	StartMs int64
	Day     string
	Hour    string
}

func TsToMs(ts int64, unit string) int64 {
	if unit == "ns" {
		return ts / 1_000_000
	}
	return ts / 1_000
}

func ComputePartition(ts int64, cfg Config) PartitionInfo {
	tsMs := TsToMs(ts, cfg.Storage.TimestampUnit)
	p := (tsMs / cfg.Storage.PartitionDurationMs) * cfg.Storage.PartitionDurationMs
	dt := time.UnixMilli(p).UTC()
	return PartitionInfo{
		StartMs: p,
		Day:     dt.Format("2006-01-02"),
		Hour:    dt.Format("15"),
	}
}

func ShardForTag(tagID uint32, shardCount int) int {
	return int(tagID % uint32(shardCount))
}

func SegmentPath(dataDir string, p PartitionInfo, shard int) string {
	return filepath.Join(dataDir, "raw", p.Day, p.Hour, fmt.Sprintf("shard-%02d.seg", shard))
}

func IndexPath(dataDir string, p PartitionInfo, shard int) string {
	return filepath.Join(dataDir, "index", p.Day, p.Hour, fmt.Sprintf("shard-%02d.idx", shard))
}

func EnsureBaseLayout(cfg Config) error {
	if err := os.MkdirAll(filepath.Join(cfg.Storage.DataDir, "raw"), 0o755); err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Join(cfg.Storage.DataDir, "index"), 0o755); err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Join(cfg.Storage.DataDir, "meta"), 0o755); err != nil {
		return err
	}
	return nil
}
