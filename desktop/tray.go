//go:build windows

package main

import (
	"bytes"
	"context"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"image/png"
	"log/slog"
	"time"

	"helios/internal/helios"

	"github.com/wailsapp/wails/v3/pkg/application"
)

const (
	trayDisconnectedTooltip = "Helios — Sem conexão confirmada com o coletor"
	trayCapacityUnavailable = "Capacidade nominal em uso — sem leitura recente"
)

func trayCapacityLabel(service *helios.Service) string {
	if service != nil {
		if percent, ok := service.LiveCapacityUsagePercent(); ok {
			return fmt.Sprintf("Capacidade nominal em uso — %d%%", percent)
		}
	}
	return trayCapacityUnavailable
}

func watchTrayConnection(ctx context.Context, tray *application.SystemTray, service *helios.Service, icon []byte) {
	connectedIcon, err := connectedTrayIcon(icon)
	if err != nil {
		slog.Error("Falha ao gerar o ícone de conexão do Helios", "error", err)
	}

	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	connected := false
	tooltip := trayDisconnectedTooltip
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			current := service.CollectorConnected()
			currentTooltip := trayDisconnectedTooltip
			if current {
				currentTooltip = trayCapacityLabel(service)
			}
			connectionChanged := current != connected
			if !connectionChanged && currentTooltip == tooltip {
				continue
			}
			connected, tooltip = current, currentTooltip
			application.InvokeAsync(func() {
				if ctx.Err() != nil {
					return
				}
				if connectionChanged && connectedIcon != nil {
					if current {
						tray.SetIcon(connectedIcon)
					} else {
						tray.SetIcon(icon)
					}
				}
				tray.SetTooltip(currentTooltip)
			})
		}
	}
}

func connectedTrayIcon(icon []byte) ([]byte, error) {
	logo, err := png.Decode(bytes.NewReader(icon))
	if err != nil {
		return nil, err
	}
	bounds := logo.Bounds()
	badged := image.NewNRGBA(bounds)
	draw.Draw(badged, bounds, logo, bounds.Min, draw.Src)

	size := min(bounds.Dx(), bounds.Dy())
	center := bounds.Max.Sub(image.Pt(size/5, size/5))
	radius, fillRadius := size*3/16, size*2/15
	outline := color.NRGBA{R: 20, G: 35, B: 29, A: 255}
	green := color.NRGBA{R: 88, G: 229, B: 114, A: 255}
	for y := -radius; y <= radius; y++ {
		for x := -radius; x <= radius; x++ {
			switch distance := x*x + y*y; {
			case distance <= fillRadius*fillRadius:
				badged.SetNRGBA(center.X+x, center.Y+y, green)
			case distance <= radius*radius:
				badged.SetNRGBA(center.X+x, center.Y+y, outline)
			}
		}
	}

	var output bytes.Buffer
	if err := png.Encode(&output, badged); err != nil {
		return nil, err
	}
	return output.Bytes(), nil
}
