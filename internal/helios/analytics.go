package helios

import (
	"cmp"
	"fmt"
	"math"
	"slices"
	"time"
)

type point struct {
	Label     string  `json:"label"`
	Value     float64 `json:"value"`
	Timestamp *int64  `json:"timestamp,omitempty"`
}

func chartSeries(rows []reading, period string, loc *time.Location) []point {
	groups, dailyMax := make(map[string]point), make(map[string]float64)
	for _, row := range rows {
		value := row.EnergyTodayKwh
		if period == "day" {
			value = row.PowerW
		}
		if row.UpdatedAt == nil || value == nil || *value < 0 {
			continue
		}
		at := time.UnixMilli(*row.UpdatedAt).In(loc)
		day := at.Format(time.DateOnly)
		switch period {
		case "day":
			label := at.Format("15:04")
			prev, found := groups[label]
			if !found || *row.UpdatedAt >= *prev.Timestamp {
				groups[label] = point{label, *value, row.UpdatedAt}
			}
		case "month":
			prev, found := groups[day]
			if !found || *value > prev.Value {
				groups[day] = point{day, *value, row.UpdatedAt}
			}
		case "year":
			prev, found := dailyMax[day]
			if !found || *value > prev {
				dailyMax[day] = *value
				label := at.Format("2006-01")
				groups[label] = point{label, groups[label].Value + *value - prev, row.UpdatedAt}
			}
		}
	}
	series := make([]point, 0, len(groups))
	for _, p := range groups {
		series = append(series, p)
	}
	slices.SortFunc(series, func(a, b point) int { return cmp.Compare(a.Label, b.Label) })
	return series
}

type calendarDay struct {
	Date      string   `json:"date"`
	EnergyKwh *float64 `json:"energyKwh"`
	Samples   int      `json:"samples"`
}

type daySummary struct {
	calendarDay
	PeakW  *float64 `json:"peakW"`
	PeakAt *int64   `json:"peakAt"`
}

func shiftDay(day string, offset int) string {
	date, _ := time.Parse(time.DateOnly, day)
	return date.AddDate(0, 0, offset).Format(time.DateOnly)
}

func summarizeDays(rows []reading, dayOf func(int64) string) map[string]daySummary {
	days := make(map[string]daySummary)
	for _, row := range rows {
		if row.UpdatedAt == nil {
			continue
		}
		day := dayOf(*row.UpdatedAt)
		item := days[day]
		item.Date = day
		item.Samples++
		if row.EnergyTodayKwh != nil && *row.EnergyTodayKwh >= 0 && (item.EnergyKwh == nil || *row.EnergyTodayKwh > *item.EnergyKwh) {
			item.EnergyKwh = row.EnergyTodayKwh
		}
		if row.PowerW != nil && (item.PeakW == nil || *row.PowerW > *item.PeakW) {
			item.PeakW, item.PeakAt = row.PowerW, row.UpdatedAt
		}
		days[day] = item
	}
	return days
}

func calendar(rows []reading, dayOf func(int64) string) []calendarDay {
	summaries := summarizeDays(rows, dayOf)
	days := make([]calendarDay, 0, len(summaries))
	for _, item := range summaries {
		days = append(days, item.calendarDay)
	}
	slices.SortFunc(days, func(a, b calendarDay) int { return cmp.Compare(a.Date, b.Date) })
	return days
}

type connectionSummary struct {
	Attempts24h         int    `json:"attempts24h"`
	Successes24h        int    `json:"successes24h"`
	Failures24h         int    `json:"failures24h"`
	SuccessRate24h      *int   `json:"successRate24h"`
	LastSuccessAt       *int64 `json:"lastSuccessAt"`
	LastFailureAt       *int64 `json:"lastFailureAt"`
	MinutesSinceSuccess *int64 `json:"minutesSinceSuccess"`
}

func summarizeConnection(events []connectionEvent, now int64) connectionSummary {
	var result connectionSummary
	for _, event := range events {
		if event.OK {
			result.LastSuccessAt = &event.At
		} else {
			result.LastFailureAt = &event.At
		}
		if event.At >= now-(24*time.Hour).Milliseconds() && event.At <= now {
			result.Attempts24h++
			if event.OK {
				result.Successes24h++
			}
		}
	}
	result.Failures24h = result.Attempts24h - result.Successes24h
	if result.Attempts24h > 0 {
		result.SuccessRate24h = new(int(math.Round(float64(result.Successes24h) / float64(result.Attempts24h) * 100)))
	}
	if result.LastSuccessAt != nil {
		result.MinutesSinceSuccess = new(max(0, (now-*result.LastSuccessAt)/time.Minute.Milliseconds()))
	}
	return result
}

type temperaturePoint struct {
	At      int64    `json:"at"`
	Celsius float64  `json:"celsius"`
	PowerW  *float64 `json:"powerW,omitempty"`
}

type insights struct {
	TodayKwh          *float64           `json:"todayKwh"`
	YesterdayKwh      *float64           `json:"yesterdayKwh"`
	Average7Kwh       *float64           `json:"average7Kwh"`
	Average7Days      int                `json:"average7Days"`
	PeakW             *float64           `json:"peakW"`
	PeakAt            *int64             `json:"peakAt"`
	GeneratingMinutes *int               `json:"generatingMinutes"`
	MonthKwh          float64            `json:"monthKwh"`
	BestDay           *daySummary        `json:"bestDay"`
	Calendar          []calendarDay      `json:"calendar"`
	Temperature       []temperaturePoint `json:"temperature"`
	Connection        connectionSummary  `json:"connection"`
	Tariff            float64            `json:"tariff"`
	EstimatedTodayBrl *float64           `json:"estimatedTodayBrl"`
	EstimatedMonthBrl *float64           `json:"estimatedMonthBrl"`
}

func buildInsights(today string, todayRows, recentRows, monthRows []reading, events []connectionEvent, tariff float64, dayOf func(int64) string, now int64) insights {
	recent := summarizeDays(recentRows, dayOf)
	todayData := recent[today]
	monthly := summarizeDays(monthRows, dayOf)
	result := insights{
		TodayKwh: todayData.EnergyKwh, YesterdayKwh: recent[shiftDay(today, -1)].EnergyKwh,
		PeakW: todayData.PeakW, PeakAt: todayData.PeakAt, Tariff: tariff,
		Calendar: make([]calendarDay, 0, len(monthly)), Temperature: []temperaturePoint{},
		Connection: summarizeConnection(events, now),
	}
	var total float64
	for offset := -1; offset >= -7; offset-- {
		if value := recent[shiftDay(today, offset)].EnergyKwh; value != nil {
			total += *value
			result.Average7Days++
		}
	}
	if result.Average7Days > 0 {
		result.Average7Kwh = new(total / float64(result.Average7Days))
	}
	for _, summary := range monthly {
		result.Calendar = append(result.Calendar, summary.calendarDay)
	}
	slices.SortFunc(result.Calendar, func(a, b calendarDay) int { return cmp.Compare(a.Date, b.Date) })
	for _, day := range result.Calendar {
		if day.EnergyKwh != nil {
			result.MonthKwh += *day.EnergyKwh
			if result.BestDay == nil || *day.EnergyKwh > *result.BestDay.EnergyKwh {
				result.BestDay = new(monthly[day.Date])
			}
		}
	}
	if len(todayRows) > 0 {
		result.GeneratingMinutes = new(generatingMinutes(todayRows))
	}
	for _, row := range todayRows {
		if row.TemperatureC != nil && row.UpdatedAt != nil {
			result.Temperature = append(result.Temperature, temperaturePoint{*row.UpdatedAt, *row.TemperatureC, row.PowerW})
		}
	}
	slices.SortStableFunc(result.Temperature, func(a, b temperaturePoint) int { return cmp.Compare(a.At, b.At) })
	if tariff > 0 && result.TodayKwh != nil {
		result.EstimatedTodayBrl = new(*result.TodayKwh * tariff)
	}
	if tariff > 0 && len(result.Calendar) > 0 {
		result.EstimatedMonthBrl = new(result.MonthKwh * tariff)
	}
	return result
}

func generatingMinutes(rows []reading) int {
	minutes := make(map[int64]bool)
	for _, row := range rows {
		if row.PowerW != nil && *row.PowerW > 50 && row.UpdatedAt != nil {
			minutes[*row.UpdatedAt/time.Minute.Milliseconds()] = true
		}
	}
	return len(minutes)
}

type forecastDay struct {
	Date      string  `json:"date"`
	EnergyKwh float64 `json:"energyKwh"`
	LowKwh    float64 `json:"lowKwh"`
	HighKwh   float64 `json:"highKwh"`
}

type forecast struct {
	DaysUsed     int           `json:"daysUsed"`
	RequiredDays int           `json:"requiredDays"`
	Days         []forecastDay `json:"days"`
	TotalKwh     *float64      `json:"totalKwh"`
	LowTotalKwh  *float64      `json:"lowTotalKwh"`
	HighTotalKwh *float64      `json:"highTotalKwh"`
}

func buildForecast(rows []reading, today string, dayOf func(int64) string) *forecast {
	var values []float64
	first := shiftDay(today, -30)
	for day, summary := range summarizeDays(rows, dayOf) {
		if day >= first && day < today && summary.EnergyKwh != nil {
			values = append(values, *summary.EnergyKwh)
		}
	}
	result := &forecast{DaysUsed: len(values), RequiredDays: 5, Days: []forecastDay{}}
	if len(values) < result.RequiredDays {
		return result
	}
	slices.Sort(values)
	percentile := func(fraction float64) float64 {
		position := float64(len(values)-1) * fraction
		lower := int(position)
		return values[lower] + (values[int(math.Ceil(position))]-values[lower])*(position-float64(lower))
	}
	median, low, high := percentile(.5), percentile(.2), percentile(.8)
	for i := 1; i <= 7; i++ {
		result.Days = append(result.Days, forecastDay{shiftDay(today, i), median, low, high})
	}
	result.TotalKwh, result.LowTotalKwh, result.HighTotalKwh = new(median*7), new(low*7), new(high*7)
	return result
}

func demo(period, date string, now time.Time) map[string]any {
	profile := func(hour float64) float64 {
		return max(0, math.Sin((hour-6)/12*math.Pi)) * (.83 + .08*math.Sin(hour*1.7))
	}
	power := math.Round(profile(float64(now.Hour())) * 5600)
	var energy float64
	for i := range min(now.Hour(), 18) {
		energy += profile(float64(i+6)) * 3.4
	}
	var series []point
	switch period {
	case "month":
		for i := range 30 {
			x := float64(i)
			value := max(0, math.Round((21+7*math.Sin(x*.81)+3*math.Cos(x*1.73))*10)/10)
			series = append(series, point{Label: fmt.Sprintf("%s-%02d", date[:7], i+1), Value: value})
		}
	case "year":
		for i := range 12 {
			value := math.Round(470 + 120*math.Sin(float64(i-1)*math.Pi/6))
			series = append(series, point{Label: fmt.Sprintf("%s-%02d", date[:4], i+1), Value: value})
		}
	default:
		for i := range 49 {
			value := math.Round(profile(6+float64(i)/4) * 5600)
			series = append(series, point{Label: fmt.Sprintf("%02d:%02d", 6+i/4, (i%4)*15), Value: value})
		}
	}
	inverter := makeReading(now.UnixMilli(), power, math.Round(energy*10)/10, new(12842.0), 34.8, "NO", "", "", "")
	return map[string]any{
		"mode": "demo", "period": period, "date": date, "fetchedAt": now.UnixMilli(),
		"inverter": struct {
			reading
			EnergyMonthKwh float64 `json:"energyMonthKwh"`
		}{inverter, 428.6},
		"series": series, "alarms": []alarm{},
	}
}
