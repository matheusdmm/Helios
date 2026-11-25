package helios

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestChartsAndInsights(t *testing.T) {
	zone := time.FixedZone("UTC-3", -3*3600)
	dayOf := func(at int64) string { return time.UnixMilli(at).In(zone).Format(time.DateOnly) }
	rows := []reading{
		testReading(t, "2026-11-01T01:00:00Z", 0, 6),
		testReading(t, "2026-11-01T12:00:50Z", 2500, 2),
		testReading(t, "2026-11-01T12:00:10Z", 2000, 1),
		testReading(t, "2026-11-01T18:00:00Z", 0, 5),
		testReading(t, "2026-11-02T12:00:00Z", 1000, 3),
	}
	day := chartSeries(rows[1:4], "day", zone)
	if len(day) != 2 || day[0].Label != "09:00" || day[0].Value != 2500 || *day[0].Timestamp != *rows[1].UpdatedAt {
		t.Fatalf("daily curve: %+v", day)
	}
	months := chartSeries(rows, "year", zone)
	if len(months) != 2 || months[0].Label != "2026-10" || months[0].Value != 6 || months[1].Value != 8 {
		t.Fatalf("monthly totals: %+v", months)
	}
	now := *rows[4].UpdatedAt
	events := []connectionEvent{{now - 120000, true}, {now - 60000, false}, {now, true}}
	result := buildInsights("2026-11-02", rows[4:], rows, rows[1:], events, 0.9, dayOf, now)
	if *result.TodayKwh != 3 || *result.YesterdayKwh != 5 || *result.Average7Kwh != 5.5 || result.Average7Days != 2 ||
		*result.PeakW != 1000 || *result.GeneratingMinutes != 1 || result.MonthKwh != 8 || result.BestDay.Date != "2026-11-01" ||
		*result.Connection.SuccessRate24h != 67 || result.Connection.Failures24h != 1 {
		t.Fatalf("unexpected insights: %+v", result)
	}
	if shiftDay("2026-03-01", -1) != "2026-02-28" {
		t.Fatal("date did not cross month boundary")
	}
	empty := buildInsights("2026-03-01", nil, nil, nil, nil, 0, dayOf, now)
	if empty.YesterdayKwh != nil || empty.Average7Kwh != nil || empty.Connection.SuccessRate24h != nil || empty.EstimatedTodayBrl != nil {
		t.Fatalf("missing data was treated as zero: %+v", empty)
	}
}

func TestForecastAndWeather(t *testing.T) {
	dayOf := func(at int64) string { return time.UnixMilli(at).Add(-3 * time.Hour).UTC().Format(time.DateOnly) }
	today := "2026-11-04"
	rows := []reading{testReading(t, "2026-10-01T12:00:00Z", 1000, 100), testReading(t, today+"T12:00:00Z", 1000, 99)}
	for i, energy := range []float64{0, 5, 10, 15, 20} {
		rows = append(rows, testReading(t, fmt.Sprintf("2026-10-%02dT12:00:00Z", 20+i), 1000, energy))
	}
	history := buildForecast(rows, today, dayOf)
	if history.DaysUsed != 5 || len(history.Days) != 7 || *history.TotalKwh != 70 || history.Days[0].Date != "2026-11-05" || history.Days[6].Date != "2026-11-11" {
		t.Fatalf("history forecast: %+v", history)
	}
	if sparse := buildForecast(rows[:3], today, dayOf); sparse.DaysUsed != 1 || sparse.TotalKwh != nil || len(sparse.Days) != 0 {
		t.Fatalf("sparse forecast: %+v", sparse)
	}
	start, _ := time.Parse(time.RFC3339, "2026-11-04T12:00:00Z")
	var list []weatherSlot
	for i := range 24 {
		at := start.Add(time.Duration(i) * 3 * time.Hour)
		hour := at.Add(-3 * time.Hour).UTC().Hour()
		slot := weatherSlot{At: at.Unix()}
		slot.Clouds.All, slot.Main.Temp, slot.Sys.Part = new(100.0), new(18.0), "n"
		if hour >= 6 && hour < 18 {
			slot.Main.Temp, slot.Sys.Part = new(29.0), "d"
			if dayOf(at.UnixMilli()) == "2026-11-05" {
				slot.Clouds.All = new(0.0)
			}
		}
		list = append(list, slot)
	}
	body, err := json.Marshal(map[string]any{"list": list})
	if err != nil {
		t.Fatal(err)
	}
	var requests atomic.Int32
	client := &http.Client{Transport: transportFunc(func(r *http.Request) (*http.Response, error) {
		requests.Add(1)
		if r.URL.Host != "api.openweathermap.org" || r.URL.Query().Get("units") != "metric" || r.URL.Query().Get("appid") != "test-key" {
			t.Errorf("unexpected OpenWeather request: %v", r.URL)
		}
		return response(200, string(body)), nil
	})}
	cache := weatherCache{client: client, key: "test-key", lat: "-23.55", lon: "-46.63", dayOf: dayOf}
	var concurrent sync.WaitGroup
	for range 2 {
		concurrent.Go(func() {
			status, days := cache.get(t.Context())
			projection, ok := weatherProjection(status, days, history, today).(map[string]any)
			if !ok || len(days) != 2 || *days[0].CloudPct != 0 || *days[1].CloudPct != 100 || days[0].MinC != 18 || days[0].MaxC != 29 {
				t.Errorf("weather forecast: %s %+v", status, days)
				return
			}
			if *projection["totalKwh"].(*float64) != 20 || *projection["averageKwh"].(*float64) != 10 {
				t.Errorf("weather projection: %v", projection)
			}
		})
	}
	concurrent.Wait()
	if got := requests.Load(); got != 1 {
		t.Fatalf("expected one shared request, got %d", got)
	}
	invalid := weatherCache{client: client, key: "test-key", lat: "", lon: "0", dayOf: dayOf}
	if status, _ := invalid.get(t.Context()); status != "invalid-location" || requests.Load() != 1 {
		t.Fatalf("invalid coordinates: %s, requests %d", status, requests.Load())
	}
	unauthorized := weatherCache{key: "test-key", lat: "0", lon: "0", dayOf: dayOf,
		client: &http.Client{Transport: transportFunc(func(*http.Request) (*http.Response, error) {
			requests.Add(1)
			return response(401, "test-key"), nil
		})}}
	for range 2 {
		if status, _ := unauthorized.get(t.Context()); status != "unauthorized" {
			t.Fatalf("unauthorized weather response: %s", status)
		}
	}
	if requests.Load() != 2 {
		t.Fatalf("unauthorized result was not cached: %d", requests.Load())
	}
}

func TestCSVValidation(t *testing.T) {
	now := time.Date(2026, 11, 22, 12, 0, 0, 0, time.UTC)
	row := makeReading(now.UnixMilli(), 1500.25, 2.5, nil, 37.5, "=1+2", "SERIAL1234", "FW", "S6")
	header := "\uFEFF" + strings.Join(csvHeader, ";") + "\r\n"
	line := csvLine(row)
	if !strings.Contains(line, `;1500,25;2,5;;37,5;"'=1+2";"'SERIAL1234";`) {
		t.Fatalf("incorrect localized CSV or unescaped formula: %q", line)
	}
	rows, err := parseCSV(strings.NewReader(header+line), row.Serial, now)
	if err != nil || len(rows) != 1 || *rows[0].PowerW != 1500.25 || *rows[0].UpdatedAt != now.UnixMilli() || rows[0].Alarm != row.Alarm || rows[0].EnergyTotalKwh != nil {
		t.Fatalf("CSV round trip: %+v %v", rows, err)
	}
	for _, input := range []string{header, header + strings.Replace(line, "1500,25", "15000", 1), header + line + strings.Replace(line, "SERIAL1234", "SERIAL5678", 1)} {
		if _, err := parseCSV(strings.NewReader(input), "", now); err == nil {
			t.Fatalf("invalid CSV was accepted: %q", input)
		}
	}
	if _, err := parseCSV(strings.NewReader(header+line), "OTHER12345", now); err == nil {
		t.Fatal("CSV from a different inverter was accepted")
	}
	if got := summaryLine("2026-11-22", rows, .75); !strings.Contains(got, ";37,5;1;1;1,88\r\n") {
		t.Fatalf("daily CSV summary: %q", got)
	}
}

func TestCollectorProbeAndRecovery(t *testing.T) {
	var requests []string
	c := collector{&http.Client{Transport: transportFunc(func(r *http.Request) (*http.Response, error) {
		if r.URL.Host == "192.0.2.11" {
			<-r.Context().Done()
			return nil, r.Context().Err()
		}
		if user, pass, ok := r.BasicAuth(); ok {
			if user != "admin" || pass != "test-password" {
				t.Errorf("unexpected credentials")
			}
			requests = append(requests, r.URL.Host)
			return response(200, "1234567890;FW;S6;35.5;2400;4.2;1450;NO"), nil
		}
		res := response(401, "")
		res.Header.Set("WWW-Authenticate", `Basic realm="Solis"`)
		return res, nil
	})}}
	first := c.probe(t.Context(), "192.0.2.10")
	if first == nil || !first.Solis || *first.Status != 401 || len(requests) != 0 {
		t.Fatalf("discovery probe: %+v, authenticated requests: %v", first, requests)
	}
	ctx, cancel := context.WithTimeout(t.Context(), 20*time.Millisecond)
	defer cancel()
	if stalled := c.probe(ctx, "192.0.2.11"); stalled != nil {
		t.Fatalf("stalled probe returned %+v", stalled)
	}
	config := settings{IP: "192.0.2.1", User: "admin", Password: "test-password", MAC: "aa:bb:cc:dd:ee:ff"}
	unidentified := device{IP: "192.0.2.20", MAC: &config.MAC}
	mismatch := device{IP: "192.0.2.21", Solis: true, MAC: new("12:34:56:78:90:ab")}
	if _, row := recoverCollector(t.Context(), config, "1234567890", []device{unidentified, mismatch}, c.read); row != nil || len(requests) != 0 {
		t.Fatalf("attempted to authenticate an incorrect device: %v", requests)
	}
	first.MAC = new("AA:BB:CC:DD:EE:FF")
	updated, row := recoverCollector(t.Context(), config, "1234567890", []device{mismatch, *first}, c.read)
	if row == nil || updated.IP != first.IP || len(requests) != 1 || requests[0] != first.IP || *row.PowerW != 2400 {
		t.Fatalf("could not restore matching collector: %v %+v", requests, row)
	}
	if _, row := recoverCollector(t.Context(), config, "OTHER12345", []device{*first}, c.read); row != nil {
		t.Fatal("recovered a different inverter serial")
	}
	config.IP, config.MAC = "", ""
	if _, row := recoverCollector(t.Context(), config, "", []device{*first}, c.read); row == nil {
		t.Fatal("failed to recover a single Solis with no saved IP")
	}
}

func TestCollectorConnectionUsesLiveReadings(t *testing.T) {
	config := Config{
		DataDir: t.TempDir(), Location: time.UTC,
		settings: settings{IP: "192.0.2.10", User: "admin", Password: "test-password"},
	}
	previous := makeReading(time.Now().Add(-time.Minute).UnixMilli(), 500, 2, nil, 30, "NO", "1234567890", "FW", "S6")
	store := store{dir: config.DataDir, loc: config.Location}
	if err := store.appendReading(previous); err != nil {
		t.Fatal(err)
	}
	service, err := NewService(config, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(service.Close)
	if service.snapshot().latest == nil || service.CollectorConnected() {
		t.Fatal("a cached reading must not confirm a live connection")
	}
	checkCapacity := func(want int, wantOK bool) {
		t.Helper()
		if got, ok := service.LiveCapacityUsagePercent(); got != want || ok != wantOK {
			t.Fatalf("live capacity usage = (%d, %t), want (%d, %t)", got, ok, want, wantOK)
		}
	}
	checkCapacity(0, false)

	service.lastScan = time.Now() // Keep recovery from scanning the local network during this test.
	status := http.StatusOK
	power := 2400
	service.collector.client.Transport = transportFunc(func(*http.Request) (*http.Response, error) {
		return response(status, fmt.Sprintf("1234567890;FW;S6;35.5;%d;4.2;1450;NO", power)), nil
	})
	checkPoll := func(want bool) {
		t.Helper()
		service.poll(t.Context())
		if got := service.CollectorConnected(); got != want {
			t.Fatalf("after HTTP %d, CollectorConnected = %t, want %t", status, got, want)
		}
	}
	checkPoll(true)
	checkCapacity(40, true)
	status = http.StatusServiceUnavailable
	checkPoll(false)
	checkCapacity(0, false)
	status = http.StatusOK
	power = 0
	checkPoll(true)
	checkCapacity(0, true)
	power = 6300
	checkPoll(true)
	checkCapacity(100, true)

	service.mu.Lock()
	service.state.lastCollectorRead = time.Now().Add(-4 * time.Minute)
	service.mu.Unlock()
	if service.CollectorConnected() {
		t.Fatal("the connection must expire when the last live reading is stale")
	}
	checkCapacity(0, false)
}

func testReading(t *testing.T, at string, power, energy float64) reading {
	t.Helper()
	stamp, err := time.Parse(time.RFC3339Nano, at)
	if err != nil {
		t.Fatal(err)
	}
	return makeReading(stamp.UnixMilli(), power, energy, nil, 30, "NO", "SERIAL1234", "FW", "S6")
}

type transportFunc func(*http.Request) (*http.Response, error)

func (f transportFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func response(status int, body string) *http.Response {
	return &http.Response{StatusCode: status, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(body))}
}
