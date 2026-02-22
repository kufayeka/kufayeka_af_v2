package historian

import (
	"container/list"
	"os"
	"sync"
	"time"
)

type fdCacheEntry struct {
	path     string
	f        *os.File
	refCount int
	lastUsed time.Time
	elem     *list.Element
}

type fdCache struct {
	mu      sync.Mutex
	lru     *list.List
	entries map[string]*fdCacheEntry
	maxOpen int
	idleFor time.Duration
	closed  bool
}

func newFDCache(maxOpen int, idleFor time.Duration) *fdCache {
	if maxOpen <= 0 {
		maxOpen = 256
	}
	if idleFor <= 0 {
		idleFor = 30 * time.Second
	}
	return &fdCache{
		lru:     list.New(),
		entries: make(map[string]*fdCacheEntry),
		maxOpen: maxOpen,
		idleFor: idleFor,
	}
}

func (c *fdCache) Acquire(path string) (*os.File, func(), error) {
	now := time.Now()
	c.mu.Lock()
	if c.closed {
		c.mu.Unlock()
		return nil, nil, os.ErrClosed
	}
	if e := c.entries[path]; e != nil {
		e.refCount++
		e.lastUsed = now
		c.lru.MoveToFront(e.elem)
		f := e.f
		c.mu.Unlock()
		return f, c.releaseFn(path), nil
	}
	c.evictLocked(now)
	c.mu.Unlock()

	f, err := os.Open(path)
	if err != nil {
		return nil, nil, err
	}

	c.mu.Lock()
	defer c.mu.Unlock()
	if c.closed {
		_ = f.Close()
		return nil, nil, os.ErrClosed
	}
	if e := c.entries[path]; e != nil {
		// Lost the race, reuse existing fd.
		e.refCount++
		e.lastUsed = now
		c.lru.MoveToFront(e.elem)
		_ = f.Close()
		return e.f, c.releaseFn(path), nil
	}
	e := &fdCacheEntry{
		path:     path,
		f:        f,
		refCount: 1,
		lastUsed: now,
	}
	e.elem = c.lru.PushFront(e)
	c.entries[path] = e
	c.evictLocked(now)
	return f, c.releaseFn(path), nil
}

func (c *fdCache) releaseFn(path string) func() {
	return func() {
		c.mu.Lock()
		defer c.mu.Unlock()
		e := c.entries[path]
		if e == nil {
			return
		}
		if e.refCount > 0 {
			e.refCount--
		}
		e.lastUsed = time.Now()
		c.lru.MoveToFront(e.elem)
	}
}

func (c *fdCache) CleanupIdle(now time.Time) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.closed {
		return
	}
	for it := c.lru.Back(); it != nil; {
		prev := it.Prev()
		e := it.Value.(*fdCacheEntry)
		if e.refCount == 0 && now.Sub(e.lastUsed) >= c.idleFor {
			c.removeEntryLocked(e)
		}
		it = prev
	}
}

func (c *fdCache) CloseAll() {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.closed {
		return
	}
	c.closed = true
	for _, e := range c.entries {
		_ = e.f.Close()
	}
	c.entries = map[string]*fdCacheEntry{}
	c.lru.Init()
}

func (c *fdCache) evictLocked(now time.Time) {
	if c.closed {
		return
	}
	// First pass: close idle files that are not in use.
	for it := c.lru.Back(); it != nil; {
		prev := it.Prev()
		e := it.Value.(*fdCacheEntry)
		if e.refCount == 0 && now.Sub(e.lastUsed) >= c.idleFor {
			c.removeEntryLocked(e)
		}
		it = prev
	}
	// Keep cache bounded; if all FDs are in use this may temporarily exceed maxOpen.
	for len(c.entries) > c.maxOpen {
		it := c.lru.Back()
		if it == nil {
			break
		}
		e := it.Value.(*fdCacheEntry)
		if e.refCount > 0 {
			break
		}
		c.removeEntryLocked(e)
	}
}

func (c *fdCache) removeEntryLocked(e *fdCacheEntry) {
	delete(c.entries, e.path)
	c.lru.Remove(e.elem)
	_ = e.f.Close()
}

