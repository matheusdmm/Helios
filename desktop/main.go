//go:build windows

package main

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strconv"

	"helios"
	"helios/internal/helios"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

const serviceUnavailable = "Serviço local indisponível. Consulte os logs."

func main() {
	logs := &sessionLog{}
	logs.add("info", "Helios iniciado.")
	service, err := localService(logs)
	if err != nil {
		logs.add("error", "Falha ao iniciar o serviço local: "+err.Error())
	} else {
		defer service.Close()
	}
	mux := http.NewServeMux()
	mux.Handle("/", assets.Handler(true))
	windowSize := loadWindowSizePreference(logs)
	var window *application.WebviewWindow
	showWindow := func() {
		if window != nil {
			application.InvokeAsync(func() {
				window.Show().Focus()
			})
		}
	}
	icon := assets.Icon()
	app := application.New(application.Options{
		Name:        "Helios",
		Description: "Painel local de monitoramento solar",
		Icon:        icon,
		LogLevel:    slog.LevelError,
		Assets:      application.AssetOptions{Handler: mux, DisableLogging: true},
		SingleInstance: &application.SingleInstanceOptions{
			UniqueID: "br.helios.painel-solar",
			OnSecondInstanceLaunch: func(application.SecondInstanceData) {
				showWindow()
			},
		},
		OnShutdown: func() {
			windowSize.capture(window)
			windowSize.flush()
			if service != nil {
				service.Close()
			}
		},
	})
	window = app.Window.NewWithOptions(application.WebviewWindowOptions{
		Title: "Helios", URL: "/", Width: windowSize.latest.Width, Height: windowSize.latest.Height,
		MinWidth: minWindowWidth, MinHeight: minWindowHeight,
		BackgroundColour: application.NewRGB(245, 242, 233),
	})
	window.OnWindowEvent(events.Common.WindowDidResize, func(*application.WindowEvent) {
		application.InvokeAsync(func() { windowSize.capture(window) })
	})
	// Capture the final size before Wails destroys the window on close.
	window.RegisterHook(events.Common.WindowClosing, func(*application.WindowEvent) {
		application.InvokeSync(func() { windowSize.capture(window) })
		windowSize.flush()
	})
	window.OnWindowEvent(events.Common.WindowMinimise, func(*application.WindowEvent) {
		application.InvokeAsync(func() {
			if window.IsMinimised() {
				window.Hide()
			}
		})
	})

	tray := app.SystemTray.New().SetIcon(icon).OnClick(showWindow)
	tray.SetTooltip(trayDisconnectedTooltip)
	trayMenu := app.NewMenu()
	capacityItem := trayMenu.Add(trayCapacityUnavailable).SetEnabled(false)
	trayMenu.AddSeparator()
	trayMenu.Add("Abrir Helios").OnClick(func(*application.Context) { showWindow() })
	trayMenu.Add("Sair").OnClick(func(*application.Context) { app.Quit() })
	tray.SetMenu(trayMenu).OnRightClick(func() {
		capacityItem.SetLabel(trayCapacityLabel(service))
		tray.ShowMenu()
	})

	mux.HandleFunc("GET /api/desktop/logs", func(w http.ResponseWriter, r *http.Request) {
		after, _ := strconv.ParseUint(r.URL.Query().Get("after"), 10, 64)
		entries := logs.snapshot(after)
		if entries == nil {
			w.Header().Set("Cache-Control", "no-store")
			w.WriteHeader(http.StatusNoContent)
			return
		}
		writeJSON(w, http.StatusOK, entries)
	})
	mux.HandleFunc("POST /api/desktop/export", func(w http.ResponseWriter, r *http.Request) {
		exportCSV(w, r, app.Dialog, window, service, logs)
	})
	if service == nil {
		mux.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": serviceUnavailable})
		})
	} else {
		mux.Handle("/api/", service.Handler(true))
		app.Event.OnApplicationEvent(events.Windows.ApplicationStarted, func(*application.ApplicationEvent) {
			watchTrayConnection(app.Context(), tray, service, icon)
		})
		logs.add("info", "Serviço local pronto.")
		service.Start()
	}
	if err := app.Run(); err != nil {
		slog.Error("Falha ao abrir o Helios", "error", err)
	}
}

func localService(logs *sessionLog) (*helios.Service, error) {
	executable, err := os.Executable()
	if err != nil {
		return nil, err
	}
	config, err := helios.LoadConfig(filepath.Dir(executable))
	if err != nil {
		return nil, err
	}
	return helios.NewService(config, logs.add)
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}
