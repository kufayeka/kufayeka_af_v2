package historian

import (
	"errors"
	"fmt"
	"math"
	"os"
	"runtime"
	"strconv"
	"strings"

	"gopkg.in/yaml.v3"
)

type Config struct {
	UDP struct {
		Host string `json:"host" yaml:"host"`
		Port int    `json:"port" yaml:"port"`
	} `json:"udp" yaml:"udp"`
	HTTP struct {
		Host                  string `json:"host" yaml:"host"`
		Port                  int    `json:"port" yaml:"port"`
		MaxPoints             int    `json:"maxPoints" yaml:"maxPoints"`
		StreamThresholdPoints int    `json:"streamThresholdPoints" yaml:"streamThresholdPoints"`
	} `json:"http" yaml:"http"`
	Storage struct {
		DataDir             string `json:"dataDir" yaml:"dataDir"`
		ShardCount          int    `json:"shardCount" yaml:"shardCount"`
		PartitionDurationMs int64  `json:"partitionDurationMs" yaml:"partitionDurationMs"`
		TimestampUnit       string `json:"timestampUnit" yaml:"timestampUnit"` // us | ns
	} `json:"storage" yaml:"storage"`
	Flush struct {
		FlushIntervalMs    int    `json:"flushIntervalMs" yaml:"flushIntervalMs"`
		FlushBytes         int    `json:"flushBytes" yaml:"flushBytes"`
		MaxQueuePoints     int    `json:"maxQueuePoints" yaml:"maxQueuePoints"`
		BackpressurePolicy string `json:"backpressurePolicy" yaml:"backpressurePolicy"` // drop_new | drop_oldest
	} `json:"flush" yaml:"flush"`
	Index struct {
		IndexBlockOnFlush     bool `json:"indexBlockOnFlush" yaml:"indexBlockOnFlush"`
		EnablePerTagSparseIdx bool `json:"enablePerTagSparseIndex" yaml:"enablePerTagSparseIndex"`
		IndexStridePerTag     int  `json:"indexStridePerTag" yaml:"indexStridePerTag"`
	} `json:"index" yaml:"index"`
	Retention struct {
		Enabled         bool `json:"enabled" yaml:"enabled"`
		MaxAgeHours     int  `json:"maxAgeHours" yaml:"maxAgeHours"`
		CheckIntervalMs int  `json:"checkIntervalMs" yaml:"checkIntervalMs"`
	} `json:"retention" yaml:"retention"`
	Query struct {
		MaxParallel    int  `json:"maxParallel" yaml:"maxParallel"`
		ScanChunkBytes int  `json:"scanChunkBytes" yaml:"scanChunkBytes"`
		FDCacheEnabled bool `json:"fdCacheEnabled" yaml:"fdCacheEnabled"`
		FDCacheMaxOpen int  `json:"fdCacheMaxOpen" yaml:"fdCacheMaxOpen"`
		FDCacheIdleMs  int  `json:"fdCacheIdleMs" yaml:"fdCacheIdleMs"`
	} `json:"query" yaml:"query"`
	FSync struct {
		WALPolicy         string `json:"walPolicy" yaml:"walPolicy"`                 // always | interval | off
		WALIntervalMs     int    `json:"walIntervalMs" yaml:"walIntervalMs"`         // used when walPolicy=interval
		SegmentPolicy     string `json:"segmentPolicy" yaml:"segmentPolicy"`         // always | interval | off
		SegmentIntervalMs int    `json:"segmentIntervalMs" yaml:"segmentIntervalMs"` // used when segmentPolicy=interval
	} `json:"fsync" yaml:"fsync"`
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
	c.Query.ScanChunkBytes = 512 * 1024
	c.Query.FDCacheEnabled = true
	c.Query.FDCacheMaxOpen = 256
	c.Query.FDCacheIdleMs = 30000
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
	var raw map[string]any
	if err := yaml.Unmarshal(b, &raw); err != nil {
		return cfg, err
	}
	if err := applyConfigValues(&cfg, raw); err != nil {
		return cfg, err
	}
	normalizeConfig(&cfg)
	return cfg, nil
}

func normalizeConfig(cfg *Config) {
	if cfg.Query.MaxParallel <= 0 {
		cfg.Query.MaxParallel = 1
	}
	if cfg.Query.ScanChunkBytes <= 0 {
		cfg.Query.ScanChunkBytes = 512 * 1024
	}
	if cfg.Query.FDCacheMaxOpen <= 0 {
		cfg.Query.FDCacheMaxOpen = 256
	}
	if cfg.Query.FDCacheIdleMs <= 0 {
		cfg.Query.FDCacheIdleMs = 30000
	}
	if cfg.Storage.ShardCount <= 0 {
		cfg.Storage.ShardCount = 1
	}
	if cfg.Storage.PartitionDurationMs <= 0 {
		cfg.Storage.PartitionDurationMs = 3600000
	}
	if cfg.Storage.TimestampUnit != "us" && cfg.Storage.TimestampUnit != "ns" {
		cfg.Storage.TimestampUnit = "us"
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
}

func applyConfigValues(cfg *Config, raw map[string]any) error {
	var err error
	setString(raw, "udp.host", &cfg.UDP.Host)
	if err = setInt(raw, "udp.port", &cfg.UDP.Port); err != nil {
		return err
	}

	setString(raw, "http.host", &cfg.HTTP.Host)
	if err = setInt(raw, "http.port", &cfg.HTTP.Port); err != nil {
		return err
	}
	if err = setInt(raw, "http.maxPoints", &cfg.HTTP.MaxPoints); err != nil {
		return err
	}
	if err = setInt(raw, "http.streamThresholdPoints", &cfg.HTTP.StreamThresholdPoints); err != nil {
		return err
	}

	setString(raw, "storage.dataDir", &cfg.Storage.DataDir)
	if err = setInt(raw, "storage.shardCount", &cfg.Storage.ShardCount); err != nil {
		return err
	}
	if err = setInt64(raw, "storage.partitionDurationMs", &cfg.Storage.PartitionDurationMs); err != nil {
		return err
	}
	setString(raw, "storage.timestampUnit", &cfg.Storage.TimestampUnit)

	if err = setInt(raw, "flush.flushIntervalMs", &cfg.Flush.FlushIntervalMs); err != nil {
		return err
	}
	if err = setInt(raw, "flush.flushBytes", &cfg.Flush.FlushBytes); err != nil {
		return err
	}
	if err = setInt(raw, "flush.maxQueuePoints", &cfg.Flush.MaxQueuePoints); err != nil {
		return err
	}
	setString(raw, "flush.backpressurePolicy", &cfg.Flush.BackpressurePolicy)

	setBool(raw, "index.indexBlockOnFlush", &cfg.Index.IndexBlockOnFlush)
	setBool(raw, "index.enablePerTagSparseIndex", &cfg.Index.EnablePerTagSparseIdx)
	if err = setInt(raw, "index.indexStridePerTag", &cfg.Index.IndexStridePerTag); err != nil {
		return err
	}

	setBool(raw, "retention.enabled", &cfg.Retention.Enabled)
	if err = setInt(raw, "retention.maxAgeHours", &cfg.Retention.MaxAgeHours); err != nil {
		return err
	}
	if err = setInt(raw, "retention.checkIntervalMs", &cfg.Retention.CheckIntervalMs); err != nil {
		return err
	}

	if err = setInt(raw, "query.maxParallel", &cfg.Query.MaxParallel); err != nil {
		return err
	}
	if err = setInt(raw, "query.scanChunkBytes", &cfg.Query.ScanChunkBytes); err != nil {
		return err
	}
	setBool(raw, "query.fdCacheEnabled", &cfg.Query.FDCacheEnabled)
	if err = setInt(raw, "query.fdCacheMaxOpen", &cfg.Query.FDCacheMaxOpen); err != nil {
		return err
	}
	if err = setInt(raw, "query.fdCacheIdleMs", &cfg.Query.FDCacheIdleMs); err != nil {
		return err
	}

	setString(raw, "fsync.walPolicy", &cfg.FSync.WALPolicy)
	if err = setInt(raw, "fsync.walIntervalMs", &cfg.FSync.WALIntervalMs); err != nil {
		return err
	}
	setString(raw, "fsync.segmentPolicy", &cfg.FSync.SegmentPolicy)
	if err = setInt(raw, "fsync.segmentIntervalMs", &cfg.FSync.SegmentIntervalMs); err != nil {
		return err
	}

	return nil
}

func getPath(raw map[string]any, path string) (any, bool) {
	parts := strings.Split(path, ".")
	var cur any = raw
	for _, p := range parts {
		m, ok := cur.(map[string]any)
		if !ok {
			return nil, false
		}
		n, exists := m[p]
		if !exists {
			return nil, false
		}
		cur = n
	}
	return cur, true
}

func setString(raw map[string]any, path string, dst *string) {
	v, ok := getPath(raw, path)
	if !ok {
		return
	}
	if s, ok := v.(string); ok {
		*dst = strings.TrimSpace(s)
	}
}

func setBool(raw map[string]any, path string, dst *bool) {
	v, ok := getPath(raw, path)
	if !ok {
		return
	}
	switch t := v.(type) {
	case bool:
		*dst = t
	case string:
		if b, err := strconv.ParseBool(strings.TrimSpace(t)); err == nil {
			*dst = b
		}
	}
}

func setInt(raw map[string]any, path string, dst *int) error {
	v, ok := getPath(raw, path)
	if !ok {
		return nil
	}
	n, err := evalIntValue(v)
	if err != nil {
		return fmt.Errorf("%s: %w", path, err)
	}
	*dst = int(n)
	return nil
}

func setInt64(raw map[string]any, path string, dst *int64) error {
	v, ok := getPath(raw, path)
	if !ok {
		return nil
	}
	n, err := evalIntValue(v)
	if err != nil {
		return fmt.Errorf("%s: %w", path, err)
	}
	*dst = n
	return nil
}

func evalIntValue(v any) (int64, error) {
	switch t := v.(type) {
	case int:
		return int64(t), nil
	case int8:
		return int64(t), nil
	case int16:
		return int64(t), nil
	case int32:
		return int64(t), nil
	case int64:
		return t, nil
	case uint:
		return int64(t), nil
	case uint8:
		return int64(t), nil
	case uint16:
		return int64(t), nil
	case uint32:
		return int64(t), nil
	case uint64:
		if t > math.MaxInt64 {
			return 0, errors.New("uint64 overflow")
		}
		return int64(t), nil
	case float64:
		if math.Trunc(t) != t {
			return 0, errors.New("must be integer")
		}
		return int64(t), nil
	case string:
		return parseIntExpr(strings.TrimSpace(t))
	default:
		return 0, fmt.Errorf("unsupported value type %T", v)
	}
}

type exprParser struct {
	s   string
	pos int
}

func parseIntExpr(s string) (int64, error) {
	if s == "" {
		return 0, errors.New("empty expression")
	}
	p := &exprParser{s: s}
	v, err := p.parseExpr()
	if err != nil {
		return 0, err
	}
	p.skipSpaces()
	if p.pos != len(p.s) {
		return 0, fmt.Errorf("unexpected token at %d", p.pos)
	}
	return v, nil
}

func (p *exprParser) parseExpr() (int64, error) {
	left, err := p.parseTerm()
	if err != nil {
		return 0, err
	}
	for {
		p.skipSpaces()
		if p.pos >= len(p.s) {
			return left, nil
		}
		op := p.s[p.pos]
		if op != '+' && op != '-' {
			return left, nil
		}
		p.pos++
		right, err := p.parseTerm()
		if err != nil {
			return 0, err
		}
		if op == '+' {
			left += right
		} else {
			left -= right
		}
	}
}

func (p *exprParser) parseTerm() (int64, error) {
	left, err := p.parseFactor()
	if err != nil {
		return 0, err
	}
	for {
		p.skipSpaces()
		if p.pos >= len(p.s) || p.s[p.pos] != '*' {
			return left, nil
		}
		p.pos++
		right, err := p.parseFactor()
		if err != nil {
			return 0, err
		}
		left *= right
	}
}

func (p *exprParser) parseFactor() (int64, error) {
	p.skipSpaces()
	if p.pos >= len(p.s) {
		return 0, errors.New("unexpected end of expression")
	}
	ch := p.s[p.pos]
	if ch == '+' || ch == '-' {
		p.pos++
		v, err := p.parseFactor()
		if err != nil {
			return 0, err
		}
		if ch == '-' {
			return -v, nil
		}
		return v, nil
	}
	if ch == '(' {
		p.pos++
		v, err := p.parseExpr()
		if err != nil {
			return 0, err
		}
		p.skipSpaces()
		if p.pos >= len(p.s) || p.s[p.pos] != ')' {
			return 0, errors.New("missing closing parenthesis")
		}
		p.pos++
		return v, nil
	}
	start := p.pos
	for p.pos < len(p.s) && p.s[p.pos] >= '0' && p.s[p.pos] <= '9' {
		p.pos++
	}
	if start == p.pos {
		return 0, fmt.Errorf("expected number at %d", p.pos)
	}
	v, err := strconv.ParseInt(p.s[start:p.pos], 10, 64)
	if err != nil {
		return 0, err
	}
	return v, nil
}

func (p *exprParser) skipSpaces() {
	for p.pos < len(p.s) {
		switch p.s[p.pos] {
		case ' ', '\t', '\n', '\r':
			p.pos++
		default:
			return
		}
	}
}
