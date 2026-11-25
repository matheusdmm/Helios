//go:build windows

package main

import (
	"strings"
	"sync"
	"time"
)

const maxLogEntries = 300

type logEntry struct {
	ID      uint64    `json:"id"`
	At      time.Time `json:"at"`
	Level   string    `json:"level"`
	Message string    `json:"message"`
}

type sessionLog struct {
	mu      sync.Mutex
	entries [maxLogEntries]logEntry
	total   uint64
}

func (logs *sessionLog) add(level, message string) {
	if len(message) > 4096 {
		message = strings.ToValidUTF8(message[:4096], "") + "…"
	}
	logs.mu.Lock()
	defer logs.mu.Unlock()
	logs.entries[logs.total%maxLogEntries] = logEntry{logs.total + 1, time.Now(), level, message}
	logs.total++
}

func (logs *sessionLog) snapshot(after uint64) []logEntry {
	logs.mu.Lock()
	defer logs.mu.Unlock()
	if after != 0 && after == logs.total {
		return nil
	}
	entries := make([]logEntry, min(logs.total, maxLogEntries))
	for i := range entries {
		entries[i] = logs.entries[(logs.total-1-uint64(i))%maxLogEntries]
	}
	return entries
}
