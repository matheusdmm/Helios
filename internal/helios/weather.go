package helios

import (
	"cmp"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"slices"
	"strconv"
	"sync"
	"time"
)

type weatherDay struct {
	Date     string   `json:"date"`
	CloudPct *float64 `json:"cloudPct"`
	MinC     float64  `json:"minC"`
	MaxC     float64  `json:"maxC"`
}

type weatherSlot struct {
	At     int64 `json:"dt"`
	Clouds struct {
		All *float64 `json:"all"`
	} `json:"clouds"`
	Main struct {
		Temp *float64 `json:"temp"`
	} `json:"main"`
	Sys struct {
		Part string `json:"pod"`
	} `json:"sys"`
}

type weatherCache struct {
	client        *http.Client
	key, lat, lon string
	dayOf         func(int64) string
	mu            sync.Mutex
	status        string
	days          []weatherDay
	expires       time.Time
}

func (w *weatherCache) get(ctx context.Context) (string, []weatherDay) {
	if w.key == "" {
		return "unconfigured", nil
	}
	if !validCoordinate(w.lat, 90) || !validCoordinate(w.lon, 180) {
		return "invalid-location", nil
	}
	// Hold the cache lock across the bounded request so concurrent calls share it.
	w.mu.Lock()
	defer w.mu.Unlock()
	if time.Now().Before(w.expires) {
		return w.status, w.days
	}
	w.status, w.days = w.fetch(ctx)
	ttl := time.Minute
	if w.status == "ready" {
		ttl = 10 * time.Minute
	}
	w.expires = time.Now().Add(ttl)
	return w.status, w.days
}

func validCoordinate(value string, limit float64) bool {
	n, err := strconv.ParseFloat(value, 64)
	return err == nil && n >= -limit && n <= limit
}

func (w *weatherCache) fetch(ctx context.Context) (string, []weatherDay) {
	ctx, cancel := context.WithTimeout(ctx, 2500*time.Millisecond)
	defer cancel()
	query := url.Values{"lat": {w.lat}, "lon": {w.lon}, "appid": {w.key}, "units": {"metric"}}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://api.openweathermap.org/data/2.5/forecast?"+query.Encode(), nil)
	if err != nil {
		return "unavailable", nil
	}
	res, err := w.client.Do(req)
	if err != nil {
		return "unavailable", nil
	}
	defer res.Body.Close()
	if res.StatusCode == 401 || res.StatusCode == 403 {
		return "unauthorized", nil
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return "unavailable", nil
	}
	var body struct {
		List []json.RawMessage `json:"list"`
	}
	if err := json.NewDecoder(io.LimitReader(res.Body, 2<<20)).Decode(&body); err != nil {
		return "unavailable", nil
	}
	slots := make([]weatherSlot, 0, len(body.List))
	for _, entry := range body.List {
		var slot weatherSlot
		if json.Unmarshal(entry, &slot) == nil {
			slots = append(slots, slot)
		}
	}
	days := completeWeatherDays(slots, w.dayOf)
	if len(days) == 0 {
		return "unavailable", nil
	}
	return "ready", days
}

func completeWeatherDays(list []weatherSlot, dayOf func(int64) string) []weatherDay {
	const stepSeconds = 3 * 60 * 60
	unique := make(map[int64]weatherSlot)
	for _, slot := range list {
		if slot.At <= 0 || slot.At%stepSeconds != 0 || slot.At >= 8_640_000_000_000-stepSeconds ||
			slot.Clouds.All == nil || *slot.Clouds.All < 0 || *slot.Clouds.All > 100 || slot.Main.Temp == nil ||
			(slot.Sys.Part != "d" && slot.Sys.Part != "n") {
			continue
		}
		unique[slot.At] = slot
	}
	grouped := make(map[string][]weatherSlot)
	for at, slot := range unique {
		day := dayOf(at * 1000)
		grouped[day] = append(grouped[day], slot)
	}
	var days []weatherDay
	for date, slots := range grouped {
		slices.SortFunc(slots, func(a, b weatherSlot) int { return cmp.Compare(a.At, b.At) })
		first, last := slots[0].At, slots[len(slots)-1].At
		if dayOf((first-stepSeconds)*1000) == date || dayOf((last+stepSeconds)*1000) == date || (last-first)/stepSeconds+1 != int64(len(slots)) {
			continue
		}
		day := weatherDay{Date: date, MinC: *slots[0].Main.Temp, MaxC: *slots[0].Main.Temp}
		var sum float64
		var count int
		for _, slot := range slots {
			day.MinC = min(day.MinC, *slot.Main.Temp)
			day.MaxC = max(day.MaxC, *slot.Main.Temp)
			if slot.Sys.Part == "d" {
				sum += *slot.Clouds.All
				count++
			}
		}
		if count > 0 {
			day.CloudPct = new(sum / float64(count))
		}
		days = append(days, day)
	}
	slices.SortFunc(days, func(a, b weatherDay) int { return cmp.Compare(a.Date, b.Date) })
	return days
}

type projectedWeatherDay struct {
	weatherDay
	EnergyKwh *float64 `json:"energyKwh"`
}

func weatherProjection(status string, days []weatherDay, history *forecast, today string) any {
	if status != "ready" {
		return map[string]string{"status": status}
	}
	var upcoming []projectedWeatherDay
	var sum float64
	var count int
	for _, day := range days {
		if day.Date <= today {
			continue
		}
		item := projectedWeatherDay{weatherDay: day}
		if history != nil && len(history.Days) > 0 && day.CloudPct != nil {
			baseline := history.Days[0]
			cloudPct := *day.CloudPct
			energy := baseline.HighKwh - (baseline.HighKwh-baseline.LowKwh)*cloudPct/100
			item.EnergyKwh = &energy
			sum += energy
			count++
		}
		upcoming = append(upcoming, item)
	}
	if len(upcoming) == 0 {
		return map[string]string{"status": "unavailable"}
	}
	var total, average *float64
	if count > 0 {
		total, average = &sum, new(sum/float64(count))
	}
	return map[string]any{"status": "ready", "days": upcoming, "totalKwh": total, "averageKwh": average, "estimatedDays": count}
}
