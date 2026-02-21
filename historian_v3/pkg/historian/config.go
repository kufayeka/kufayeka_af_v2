package historian

import (
	"encoding/json"
	"os"
	"runtime"
)

type Config struct {
	UDP struct {
		Host string `json:"host"`
		Port int    `json:"port"`
	} `json:"udp"`
	HTTP struct {
		Host                  string `json:"host"`
		Port                  int    `json:"port"`
		MaxPoints             int    `json:"maxPoints"`
		StreamThresholdPoints int    `json:"streamThresholdPoints"`
	} `json:"http"`
	Storage struct {
		DataDir             string `json:"dataDir"`
		ShardCount          int    `json:"shardCount"`
		PartitionDurationMs int64  `json:"partitionDurationMs"`
		TimestampUnit       string `json:"timestampUnit"` // us | ns
	} `json:"storage"`
	Flush struct {
		FlushIntervalMs    int    `json:"flushIntervalMs"`
		FlushBytes         int    `json:"flushBytes"`
		MaxQueuePoints     int    `json:"maxQueuePoints"`
		BackpressurePolicy string `json:"backpressurePolicy"` // drop_new | drop_oldest
	} `json:"flush"`
	Index struct {
		IndexBlockOnFlush     bool `json:"indexBlockOnFlush"`
		EnablePerTagSparseIdx bool `json:"enablePerTagSparseIndex"`
		IndexStridePerTag     int  `json:"indexStridePerTag"`
	} `json:"index"`
	Retention struct {
		Enabled         bool `json:"enabled"`
		MaxAgeHours     int  `json:"maxAgeHours"`
		CheckIntervalMs int  `json:"checkIntervalMs"`
	} `json:"retention"`
	Query struct {
		MaxParallel int `json:"maxParallel"`
	} `json:"query"`
	FSync struct {
		WALPolicy         string `json:"walPolicy"`         // always | interval | off
		WALIntervalMs     int    `json:"walIntervalMs"`     // used when walPolicy=interval
		SegmentPolicy     string `json:"segmentPolicy"`     // always | interval | off
		SegmentIntervalMs int    `json:"segmentIntervalMs"` // used when segmentPolicy=interval
	} `json:"fsync"`
}

func DefaultConfig() Config {
	var c Config
	c.UDP.Host = "0.0.0.0"
	c.UDP.Port = 9900
	c.HTTP.Host = "0.0.0.0"
	c.HTTP.Port = 8080
	c.HTTP.MaxPoints = 100000
	c.HTTP.StreamThresholdPoints = 5000
	c.Storage.DataDir = "./data"
	c.Storage.ShardCount = 16
	c.Storage.PartitionDurationMs = 3600000
	c.Storage.TimestampUnit = "us"
	c.Flush.FlushIntervalMs = 5
	c.Flush.FlushBytes = 256 * 1024
	c.Flush.MaxQueuePoints = 200000
	c.Flush.BackpressurePolicy = "drop_new"
	c.Index.IndexBlockOnFlush = true
	c.Index.IndexStridePerTag = 4096
	c.Retention.Enabled = false
	c.Retention.MaxAgeHours = 168
	c.Retention.CheckIntervalMs = 300000
	c.Query.MaxParallel = runtime.NumCPU()
	if c.Query.MaxParallel < 1 {
		c.Query.MaxParallel = 1
	}
	c.FSync.WALPolicy = "interval"
	c.FSync.WALIntervalMs = 200
	c.FSync.SegmentPolicy = "interval"
	c.FSync.SegmentIntervalMs = 500
	return c
}

func LoadConfig(path string) (Config, error) {
	cfg := DefaultConfig()
	b, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return cfg, nil
		}
		return cfg, err
	}
	if err := json.Unmarshal(b, &cfg); err != nil {
		return cfg, err
	}
	if cfg.Query.MaxParallel <= 0 {
		cfg.Query.MaxParallel = 1
	}
	if cfg.FSync.WALPolicy == "" {
		cfg.FSync.WALPolicy = "interval"
	}
	if cfg.FSync.WALIntervalMs <= 0 {
		cfg.FSync.WALIntervalMs = 200
	}
	if cfg.FSync.SegmentPolicy == "" {
		cfg.FSync.SegmentPolicy = "interval"
	}
	if cfg.FSync.SegmentIntervalMs <= 0 {
		cfg.FSync.SegmentIntervalMs = 500
	}
	return cfg, nil
}
