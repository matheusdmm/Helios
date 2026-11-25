//go:build !windows

package helios

import (
	"context"
	"net/netip"
)

func arpDevices(context.Context, []netip.Prefix) map[string]device { return make(map[string]device) }
