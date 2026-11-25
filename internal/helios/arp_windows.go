package helios

import (
	"context"
	"net/netip"
	"os/exec"
	"regexp"
	"slices"
	"strings"
	"syscall"
	"time"
)

var arpLine = regexp.MustCompile(`(?i)^\s*(\d{1,3}(?:\.\d{1,3}){3})\s+([0-9a-f]{2}(?:-[0-9a-f]{2}){5})\s+`)

func arpDevices(ctx context.Context, subnets []netip.Prefix) map[string]device {
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "arp.exe", "-a")
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	output, err := cmd.Output()
	devices := make(map[string]device)
	if err != nil {
		return devices
	}
	for _, line := range strings.Split(string(output), "\n") {
		m := arpLine.FindStringSubmatch(line)
		if m == nil {
			continue
		}
		ip, err := netip.ParseAddr(m[1])
		if err != nil || !slices.ContainsFunc(subnets, func(subnet netip.Prefix) bool { return subnet.Contains(ip) }) {
			continue
		}
		last := ip.As4()[3]
		mac := strings.ToLower(strings.ReplaceAll(m[2], "-", ":"))
		if last == 0 || last == 255 || strings.HasPrefix(mac, "01:") || mac == "ff:ff:ff:ff:ff:ff" {
			continue
		}
		devices[m[1]] = device{IP: m[1], MAC: &mac}
	}
	return devices
}
