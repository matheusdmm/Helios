//go:build windows

package main

import (
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
)

const (
	minWindowWidth  = 420
	minWindowHeight = 530
	windowSizeDelay = 250 * time.Millisecond
)

type windowDimensions struct {
	Width  int `json:"width"`
	Height int `json:"height"`
}

func (size windowDimensions) valid() bool {
	return size.Width >= minWindowWidth && size.Height >= minWindowHeight
}

type windowSizePreference struct {
	path string
	logs *sessionLog

	mu     sync.Mutex
	latest windowDimensions
	saved  windowDimensions
	timer  *time.Timer
}

func loadWindowSizePreference(logs *sessionLog) *windowSizePreference {
	pref := &windowSizePreference{logs: logs, latest: windowDimensions{Width: 1240, Height: 850}}
	dir, err := os.UserConfigDir()
	if err != nil {
		logs.add("error", "Falha ao localizar a pasta de preferências da janela: "+err.Error())
		return pref
	}
	pref.path = filepath.Join(dir, "Helios", "window.json")
	data, err := os.ReadFile(pref.path)
	var saved windowDimensions
	if err == nil && json.Unmarshal(data, &saved) == nil && saved.valid() {
		pref.latest = saved
	}
	pref.saved = pref.latest
	return pref
}

// capture runs on Wails' UI thread so the window state and size are read together.
func (pref *windowSizePreference) capture(window *application.WebviewWindow) {
	if pref.path == "" || window == nil || window.IsMinimised() || window.IsMaximised() || window.IsFullscreen() {
		return
	}
	width, height := window.Size()
	pref.remember(windowDimensions{Width: width, Height: height})
}

func (pref *windowSizePreference) remember(size windowDimensions) {
	if !size.valid() {
		return
	}
	pref.mu.Lock()
	defer pref.mu.Unlock()
	if size == pref.latest {
		return
	}
	pref.latest = size
	if pref.timer != nil {
		pref.timer.Stop()
	}
	var timer *time.Timer
	timer = time.AfterFunc(windowSizeDelay, func() {
		pref.mu.Lock()
		defer pref.mu.Unlock()
		if pref.timer == timer {
			pref.flushLocked()
		}
	})
	pref.timer = timer
}

func (pref *windowSizePreference) flush() {
	pref.mu.Lock()
	defer pref.mu.Unlock()
	pref.flushLocked()
}

func (pref *windowSizePreference) flushLocked() {
	if pref.timer != nil {
		pref.timer.Stop()
		pref.timer = nil
	}
	if pref.path == "" || pref.latest == pref.saved {
		return
	}
	err := os.MkdirAll(filepath.Dir(pref.path), 0o755)
	if err == nil {
		err = replaceFile(pref.path, func(w io.Writer) error {
			return json.NewEncoder(w).Encode(pref.latest)
		})
	}
	if err != nil {
		pref.logs.add("error", "Falha ao salvar o tamanho da janela: "+err.Error())
		return
	}
	pref.saved = pref.latest
}
