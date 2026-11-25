package main

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
	"testing/synctest"
	"time"
)

func TestWindowSizePreference(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("APPDATA", dir)
	logs := &sessionLog{}
	pref := loadWindowSizePreference(logs)
	path := filepath.Join(dir, "Helios", "window.json")
	defaultSize := windowDimensions{Width: 1240, Height: 850}
	if pref.path != path || pref.latest != defaultSize {
		t.Fatalf("initial preference: %q, %+v", pref.path, pref.latest)
	}

	synctest.Test(t, func(t *testing.T) {
		pref.remember(windowDimensions{Width: 920, Height: 710})
		time.Sleep(windowSizeDelay / 2)
		want := windowDimensions{Width: 940, Height: 720}
		pref.remember(want)
		time.Sleep(windowSizeDelay / 2)
		if _, err := os.Stat(path); !errors.Is(err, os.ErrNotExist) {
			t.Fatalf("expected debounce to wait for the latest resize, got %v", err)
		}
		time.Sleep(windowSizeDelay / 2)
		synctest.Wait()
		if got := loadWindowSizePreference(logs).latest; got != want {
			t.Fatalf("restored after debounce: %+v, want %+v", got, want)
		}

		want = windowDimensions{Width: 1000, Height: 750}
		pref.remember(want)
		pref.remember(windowDimensions{})
		pref.flush()
		if got := loadWindowSizePreference(logs).latest; got != want {
			t.Fatalf("restored after immediate flush: %+v, want %+v", got, want)
		}
	})

	for _, invalid := range []string{`{"width": 900,`, `{"width": 419, "height": 700}`} {
		if err := os.WriteFile(path, []byte(invalid), 0o600); err != nil {
			t.Fatal(err)
		}
		if got := loadWindowSizePreference(logs).latest; got != defaultSize {
			t.Fatalf("fallback for %q: %+v, want %+v", invalid, got, defaultSize)
		}
	}
}
