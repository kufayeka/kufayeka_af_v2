package historian

import (
	"log"
	"sync"
	"time"
)

type LogEntry struct {
	Time   string         `json:"time"`
	Kind   string         `json:"kind"`
	Level  string         `json:"level"`
	Msg    string         `json:"msg"`
	Fields map[string]any `json:"fields,omitempty"`
}

type ringLog struct {
	capacity int
	items    []LogEntry
}

func newRingLog(capacity int) *ringLog {
	return &ringLog{capacity: capacity, items: make([]LogEntry, 0, capacity)}
}

func (r *ringLog) add(e LogEntry) {
	if len(r.items) >= r.capacity {
		copy(r.items, r.items[1:])
		r.items[len(r.items)-1] = e
		return
	}
	r.items = append(r.items, e)
}

func (r *ringLog) snapshot(limit int) []LogEntry {
	if limit <= 0 || limit > len(r.items) {
		limit = len(r.items)
	}
	start := len(r.items) - limit
	out := make([]LogEntry, 0, limit)
	out = append(out, r.items[start:]...)
	return out
}

type ActivityLogger struct {
	mu     sync.RWMutex
	ingest *ringLog
	system *ringLog
}

func NewActivityLogger(capacity int) *ActivityLogger {
	if capacity <= 0 {
		capacity = 100
	}
	return &ActivityLogger{
		ingest: newRingLog(capacity),
		system: newRingLog(capacity),
	}
}

func (l *ActivityLogger) AddIngest(level, msg string, fields map[string]any) {
	l.add("ingest", level, msg, fields)
}

func (l *ActivityLogger) AddSystem(level, msg string, fields map[string]any) {
	l.add("system", level, msg, fields)
}

func (l *ActivityLogger) add(kind, level, msg string, fields map[string]any) {
	e := LogEntry{
		Time:   time.Now().UTC().Format(time.RFC3339Nano),
		Kind:   kind,
		Level:  level,
		Msg:    msg,
		Fields: fields,
	}
	l.mu.Lock()
	if kind == "ingest" {
		l.ingest.add(e)
	} else {
		l.system.add(e)
	}
	l.mu.Unlock()
	log.Printf("[%s][%s] %s fields=%v", kind, level, msg, fields)
}

func (l *ActivityLogger) Snapshot(kind string, limit int) []LogEntry {
	l.mu.RLock()
	defer l.mu.RUnlock()
	if kind == "ingest" {
		return l.ingest.snapshot(limit)
	}
	if kind == "system" {
		return l.system.snapshot(limit)
	}
	out := make([]LogEntry, 0, limit*2)
	out = append(out, l.system.snapshot(limit)...)
	out = append(out, l.ingest.snapshot(limit)...)
	return out
}
