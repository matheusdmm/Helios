package helios

import (
	"context"
	"errors"
	"fmt"
	"io"
	"math"
	"net"
	"net/http"
	"net/netip"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"
)

type device struct {
	IP     string  `json:"ip"`
	MAC    *string `json:"mac"`
	Status *int    `json:"status"`
	Realm  string  `json:"realm"`
	Solis  bool    `json:"solis"`
}

type discoveries struct {
	Subnets []string `json:"subnets"`
	Devices []device `json:"devices"`
}

type collector struct{ client *http.Client }

func ipv4(value string) bool {
	addr, err := netip.ParseAddr(value)
	return err == nil && addr.Is4()
}

var (
	totalEnergyPattern = regexp.MustCompile(`^\d+(?:\.\d+)?$`)
	zeroSerial         = regexp.MustCompile(`^0+$`)
	realmPattern       = regexp.MustCompile(`(?i)realm="?([^",]+)`)
	telemetryPreview   = regexp.MustCompile(`^\x00*\d{10,};[^;]+;[^;]+;`)
	virtualInterface   = regexp.MustCompile(`(?i)wsl|virtual|hyper-v|vpn|tunnel|vethernet`)
	macPattern         = regexp.MustCompile(`(?i)^([0-9a-f]{2}:){5}[0-9a-f]{2}$`)
)

func parseTelemetry(raw string, now time.Time) (reading, error) {
	clean := strings.TrimSpace(strings.ReplaceAll(raw, "\x00", ""))
	lower := strings.ToLower(clean)
	if strings.Contains(lower, "<html") || strings.Contains(lower, "unauthorized") {
		return reading{}, errors.New("O coletor retornou uma página de login. Verifique usuário e senha.")
	}
	fields := strings.Split(clean, ";")
	if len(fields) < 8 {
		return reading{}, errors.New("O coletor não retornou os dados esperados em /inverter.cgi.")
	}
	if fields[0] == "" || zeroSerial.MatchString(fields[0]) {
		return reading{}, errors.New("O inversor ainda não enviou dados válidos ao coletor.")
	}
	var values [3]float64
	for i := range values {
		value, err := strconv.ParseFloat(strings.TrimSpace(fields[i+3]), 64)
		if err != nil || math.IsNaN(value) || math.IsInf(value, 0) {
			return reading{}, errors.New("Os dados recebidos do coletor estão incompletos.")
		}
		values[i] = value
	}
	temp, power, energy := values[0], values[1], values[2]
	if power < 0 || energy < 0 {
		return reading{}, errors.New("O coletor retornou valores inválidos.")
	}
	var total *float64
	if totalEnergyPattern.MatchString(fields[6]) {
		if value, err := strconv.ParseFloat(fields[6], 64); err == nil {
			total = &value
		}
	}
	return makeReading(now.UnixMilli(), power, energy, total, temp, or(strings.TrimSpace(fields[7]), "NO"), fields[0], fields[1], fields[2]), nil
}

func (c collector) read(ctx context.Context, config settings) (reading, error) {
	if !ipv4(config.IP) {
		return reading{}, errors.New("Configure um endereço IPv4 válido para o S3-WIFI-ST.")
	}
	ctx, cancel := context.WithTimeout(ctx, 6*time.Second)
	defer cancel()
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, "http://"+config.IP+"/inverter.cgi", nil)
	if err != nil {
		return reading{}, err
	}
	request.Header.Set("Cache-Control", "no-store")
	request.SetBasicAuth(config.User, config.Password)
	response, err := c.client.Do(request)
	if err != nil {
		return reading{}, collectorUnreachable()
	}
	defer response.Body.Close()
	switch {
	case response.StatusCode == 401 || response.StatusCode == 403:
		return reading{}, errors.New("O coletor rejeitou usuário ou senha. Alguns S3-WIFI-ST passam a usar a senha do Wi-Fi da casa na página local.")
	case response.StatusCode < 200 || response.StatusCode >= 300:
		return reading{}, fmt.Errorf("O coletor respondeu HTTP %d.", response.StatusCode)
	}
	const maxTelemetry = 64 * 1024
	data, err := io.ReadAll(io.LimitReader(response.Body, maxTelemetry+1))
	if err != nil {
		return reading{}, collectorUnreachable()
	}
	if len(data) > maxTelemetry {
		return reading{}, errors.New("O coletor não retornou os dados esperados em /inverter.cgi.")
	}
	return parseTelemetry(string(data), time.Now())
}

func collectorUnreachable() error {
	return errors.New("Não foi possível alcançar o S3-WIFI-ST pela rede. Confira o IP e a conexão Wi-Fi.")
}

func (c collector) probe(ctx context.Context, ip string) *device {
	ctx, cancel := context.WithTimeout(ctx, 1100*time.Millisecond)
	defer cancel()
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, "http://"+ip+"/inverter.cgi", nil)
	if err != nil {
		return nil
	}
	request.Header.Set("User-Agent", "solis-local-discovery/1.0")
	request.Header.Set("Cache-Control", "no-store")
	response, err := c.client.Do(request)
	if err != nil {
		return nil
	}
	defer response.Body.Close()
	result := &device{IP: ip, Status: &response.StatusCode}
	if match := realmPattern.FindStringSubmatch(response.Header.Get("WWW-Authenticate")); match != nil {
		result.Realm = match[1]
		result.Solis = strings.Contains(strings.ToLower(result.Realm), "solis")
	}
	if !result.Solis {
		preview, err := io.ReadAll(io.LimitReader(response.Body, 2048))
		if err != nil {
			return nil
		}
		result.Solis = telemetryPreview.Match(preview)
	}
	return result
}

func localSubnets() []netip.Prefix {
	interfaces, _ := net.Interfaces()
	found := make(map[netip.Prefix]bool)
	var subnets []netip.Prefix
	for _, iface := range interfaces {
		if iface.Flags&net.FlagUp == 0 || iface.Flags&net.FlagLoopback != 0 || virtualInterface.MatchString(iface.Name) {
			continue
		}
		addresses, _ := iface.Addrs()
		for _, address := range addresses {
			prefix, err := netip.ParsePrefix(address.String())
			if err != nil || !prefix.Addr().Is4() || !prefix.Addr().IsPrivate() {
				continue
			}
			// Limit discovery to the local /24, even on larger networks.
			subnet := netip.PrefixFrom(prefix.Addr(), 24).Masked()
			if !found[subnet] {
				found[subnet] = true
				subnets = append(subnets, subnet)
			}
		}
	}
	return subnets
}

func (c collector) discover(ctx context.Context) discoveries {
	subnets := localSubnets()
	result := discoveries{Subnets: make([]string, 0, len(subnets)), Devices: []device{}}
	for _, subnet := range subnets {
		result.Subnets = append(result.Subnets, subnet.String())
	}
	jobs := make(chan string, 508)
	for _, subnet := range subnets[:min(2, len(subnets))] {
		ip := subnet.Addr()
		for range 254 {
			ip = ip.Next()
			jobs <- ip.String()
		}
	}
	close(jobs)
	found := make(chan device, len(jobs))
	var workers sync.WaitGroup
	for range min(40, len(jobs)) {
		workers.Go(func() {
			for ip := range jobs {
				if ctx.Err() != nil {
					return
				}
				if response := c.probe(ctx, ip); response != nil {
					found <- *response
				}
			}
		})
	}
	workers.Wait()
	close(found)
	byIP := arpDevices(ctx, subnets)
	for response := range found {
		response.MAC = byIP[response.IP].MAC
		byIP[response.IP] = response
	}
	for _, d := range byIP {
		result.Devices = append(result.Devices, d)
	}
	slices.SortFunc(result.Devices, func(a, b device) int {
		if a.Solis != b.Solis {
			if a.Solis {
				return -1
			}
			return 1
		}
		return netip.MustParseAddr(a.IP).Compare(netip.MustParseAddr(b.IP))
	})
	return result
}

// Recovery identifies Solis before sending the saved password to a new IP.
func recoverCollector(ctx context.Context, config settings, serial string, devices []device, read func(context.Context, settings) (reading, error)) (settings, *reading) {
	var candidates, matching []device
	for _, d := range devices {
		if !d.Solis || d.IP == config.IP {
			continue
		}
		candidates = append(candidates, d)
		if config.MAC != "" && d.MAC != nil && strings.EqualFold(*d.MAC, config.MAC) {
			matching = append(matching, d)
		}
	}
	if len(matching) == 0 && len(candidates) == 1 && (config.MAC == "" || candidates[0].MAC == nil) {
		matching = candidates
	}
	for _, d := range matching {
		updated := config
		updated.IP = d.IP
		if d.MAC != nil {
			updated.MAC = *d.MAC
		}
		row, err := read(ctx, updated)
		if err == nil && (serial == "" || serial == row.Serial) {
			return updated, &row
		}
	}
	return config, nil
}
