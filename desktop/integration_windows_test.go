package main

import (
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"helios"
	"helios/internal/helios"

	"github.com/wailsapp/wails/v3/pkg/w32"
)

func TestConnectedTrayIconLoadsOnWindows(t *testing.T) {
	icon, err := connectedTrayIcon(assets.Icon())
	if err != nil {
		t.Fatal(err)
	}
	handle, err := w32.CreateSmallHIconFromImage(icon)
	if err != nil || handle == 0 {
		t.Fatalf("Windows could not load the connected tray icon: %v", err)
	}
	w32.DestroyIcon(handle)
}

func TestDesktopServiceAndSave(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("HELIOS_DATA_DIR", "")
	t.Setenv("S3_IP", "")
	t.Setenv("S3_PASSWORD", "")
	t.Setenv("HOST", "192.0.2.1")
	t.Setenv("PORT", "1")
	t.Setenv("HTTPS_CERT", "unused.pem")
	config, err := helios.LoadConfig(dir)
	if err != nil {
		t.Fatal(err)
	}
	logs := &sessionLog{}
	service, err := helios.NewService(config, logs.add)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(service.Close)
	request := httptest.NewRequest(http.MethodPost, "/api/preferences", strings.NewReader(`{"tariffBrlPerKwh":0.75}`))
	request.Header.Set("X-Local-Setup", "1")
	response := httptest.NewRecorder()
	service.Handler(true).ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("desktop update: %d %s", response.Code, response.Body)
	}
	content, err := os.ReadFile(filepath.Join(dir, "data", "local-settings.json"))
	if err != nil || !strings.Contains(string(content), `"tariffBrlPerKwh":0.75`) {
		t.Fatalf("tariff was not saved: %s, %v", content, err)
	}
	if entries := logs.snapshot(0); len(entries) != 1 || entries[0].Message != "Tarifa de referência salva." {
		t.Fatalf("service log missing: %+v", entries)
	}
	export := service.Export("all")
	if !strings.HasPrefix(export.Filename, "solis-leituras-completo-") {
		t.Fatalf("invalid filename: %q", export.Filename)
	}
	target := filepath.Join(dir, "export.csv")
	if err := os.WriteFile(target, []byte("previous export"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := replaceFile(target, export.Write); err != nil {
		t.Fatal(err)
	}
	content, err = os.ReadFile(target)
	if err != nil || !strings.HasPrefix(string(content), "\uFEFFtimestamp;") {
		t.Fatalf("invalid CSV: %q, %v", content, err)
	}
	writeError := errors.New("interrupted export")
	if err := replaceFile(target, func(w io.Writer) error {
		_, _ = io.WriteString(w, "partial")
		return writeError
	}); !errors.Is(err, writeError) {
		t.Fatalf("expected export error, got %v", err)
	}
	current, err := os.ReadFile(target)
	if err != nil || string(current) != string(content) {
		t.Fatalf("failed export replaced the previous file: %q, %v", current, err)
	}
}
