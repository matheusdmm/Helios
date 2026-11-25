package helios

import (
	"bufio"
	"bytes"
	"cmp"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"sync"
	"time"
)

type reading struct {
	UpdatedAt      *int64   `json:"updatedAt,omitempty"`
	PowerW         *float64 `json:"powerW,omitempty"`
	EnergyTodayKwh *float64 `json:"energyTodayKwh,omitempty"`
	EnergyTotalKwh *float64 `json:"energyTotalKwh"`
	TemperatureC   *float64 `json:"temperatureC,omitempty"`
	Alarm          string   `json:"alarm"`
	Serial         string   `json:"sn"`
	Firmware       string   `json:"firmware"`
	ModelCode      string   `json:"modelCode"`
	Model          string   `json:"model"`
	StationName    string   `json:"stationName"`
	State          string   `json:"state"`
	CapacityW      float64  `json:"capacityW"`
}

func makeReading(at int64, power, energy float64, total *float64, temp float64, alarm, serial, firmware, code string) reading {
	state := "online"
	if !strings.EqualFold(alarm, "NO") {
		state = "alarm"
	}
	return reading{
		UpdatedAt: &at, PowerW: &power, EnergyTodayKwh: &energy, EnergyTotalKwh: total, TemperatureC: &temp,
		Alarm: alarm, Serial: serial, Firmware: firmware, ModelCode: code,
		Model: "Solis S6-GR1P6K", StationName: "Minha usina solar", State: state, CapacityW: 6000,
	}
}

type connectionEvent struct {
	At int64 `json:"at"`
	OK bool  `json:"ok"`
}

type store struct {
	dir string
	loc *time.Location
	mu  sync.Mutex // Serializes appends and the read-before-append in CSV imports.
}

var (
	readingFile    = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}\.jsonl$`)
	connectionFile = regexp.MustCompile(`^connection-\d{4}-\d{2}-\d{2}\.jsonl$`)
)

func loadSettings(dir string, base settings) (settings, error) {
	content, err := os.ReadFile(filepath.Join(dir, "local-settings.json"))
	if errors.Is(err, os.ErrNotExist) {
		return base, nil
	}
	if err != nil {
		return settings{}, err
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(content, &fields); err != nil {
		return settings{}, fmt.Errorf("local-settings.json inválido: %w", err)
	}
	for key, target := range map[string]*string{"s3Ip": &base.IP, "s3User": &base.User, "s3Password": &base.Password, "s3Mac": &base.MAC} {
		var value *string
		if json.Unmarshal(fields[key], &value) == nil && value != nil && (*value != "" || key == "s3User" || key == "s3Mac") {
			*target = *value
		}
	}
	var tariff *float64
	if json.Unmarshal(fields["tariffBrlPerKwh"], &tariff) == nil && tariff != nil && *tariff >= 0 {
		base.Tariff = *tariff
	}
	return base, nil
}

func (s *store) saveSettings(value settings) error {
	if err := os.MkdirAll(s.dir, 0o700); err != nil {
		return err
	}
	file, err := os.CreateTemp(s.dir, ".local-settings-*.tmp")
	if err != nil {
		return err
	}
	defer os.Remove(file.Name())
	writeErr := json.NewEncoder(file).Encode(value)
	if err := errors.Join(writeErr, file.Close()); err != nil {
		return err
	}
	return os.Rename(file.Name(), filepath.Join(s.dir, "local-settings.json"))
}

func (s *store) day(at int64) string { return time.UnixMilli(at).In(s.loc).Format(time.DateOnly) }

func (s *store) appendReading(row reading) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	at := *row.UpdatedAt
	if err := s.appendRows(s.day(at)+".jsonl", []reading{row}); err != nil {
		return err
	}
	return s.appendEvent(connectionEvent{At: at, OK: true})
}

func (s *store) recordFailure(at int64) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.appendEvent(connectionEvent{At: at})
}

func (s *store) appendEvent(event connectionEvent) error {
	content, err := json.Marshal(event)
	if err != nil {
		return err
	}
	return s.appendFile("connection-"+s.day(event.At)+".jsonl", append(content, '\n'))
}

func (s *store) appendRows(name string, rows []reading) error {
	var buffer bytes.Buffer
	enc := json.NewEncoder(&buffer)
	for _, row := range rows {
		if err := enc.Encode(row); err != nil {
			return err
		}
	}
	return s.appendFile(name, buffer.Bytes())
}

func (s *store) appendFile(name string, content []byte) error {
	if err := os.MkdirAll(s.dir, 0o700); err != nil {
		return err
	}
	file, err := os.OpenFile(filepath.Join(s.dir, name), os.O_CREATE|os.O_RDWR|os.O_APPEND, 0o600)
	if err != nil {
		return err
	}
	end, err := file.Seek(0, io.SeekEnd)
	if err == nil && end > 0 {
		var last [1]byte
		_, err = file.ReadAt(last[:], end-1)
		if err == nil && last[0] != '\n' {
			_, err = file.Write([]byte{'\n'})
		}
	}
	if err == nil {
		_, err = file.Write(content)
	}
	return errors.Join(err, file.Close())
}

func (s *store) files(pattern *regexp.Regexp, keep func(string) bool) ([]string, error) {
	entries, err := os.ReadDir(s.dir)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var names []string
	for _, entry := range entries {
		if entry.Type().IsRegular() && pattern.MatchString(entry.Name()) && keep(entry.Name()) {
			names = append(names, entry.Name())
		}
	}
	return names, nil
}

func walkJSONL[T any](path string, visit func(T) error) error {
	file, err := os.Open(path)
	if err != nil {
		return err
	}
	defer file.Close()
	lines := bufio.NewReader(file)
	for {
		line, err := lines.ReadBytes('\n')
		var value T
		if len(line) > 0 && json.Unmarshal(line, &value) == nil {
			if err := visit(value); err != nil {
				return err
			}
		}
		if errors.Is(err, io.EOF) {
			return nil
		}
		if err != nil {
			return err
		}
	}
}

func readJSONL[T any](dir string, names []string) ([]T, error) {
	var rows []T
	for _, name := range names {
		if err := walkJSONL(filepath.Join(dir, name), func(row T) error {
			rows = append(rows, row)
			return nil
		}); err != nil {
			return nil, err
		}
	}
	return rows, nil
}

func (s *store) latest() (*reading, error) {
	names, err := s.files(readingFile, func(string) bool { return true })
	if err != nil {
		return nil, err
	}
	for _, name := range slices.Backward(names) {
		var last *reading
		err := walkJSONL(filepath.Join(s.dir, name), func(row reading) error {
			if row.Serial != "" && row.UpdatedAt != nil && row.PowerW != nil {
				last = &row
			}
			return nil
		})
		if err != nil || last != nil {
			return last, err
		}
	}
	return nil, nil
}

type importResult struct {
	Imported   int `json:"imported"`
	Duplicates int `json:"duplicates"`
	Days       int `json:"days"`
}

func (s *store) importRows(rows []reading) (importResult, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	byDay := make(map[string][]reading)
	for _, row := range rows {
		day := s.day(*row.UpdatedAt)
		byDay[day] = append(byDay[day], row)
	}
	days := make([]string, 0, len(byDay))
	for day := range byDay {
		days = append(days, day)
	}
	slices.Sort(days)
	type rowKey struct {
		at     int64
		serial string
	}
	result := importResult{Days: len(days)}
	for _, day := range days {
		name := day + ".jsonl"
		keys := make(map[rowKey]bool)
		err := walkJSONL(filepath.Join(s.dir, name), func(row reading) error {
			if row.UpdatedAt != nil {
				keys[rowKey{*row.UpdatedAt, row.Serial}] = true
			}
			return nil
		})
		if err != nil && !errors.Is(err, os.ErrNotExist) {
			return result, err
		}
		candidates := byDay[day]
		slices.SortStableFunc(candidates, func(a, b reading) int { return cmp.Compare(*a.UpdatedAt, *b.UpdatedAt) })
		additions := candidates[:0]
		for _, row := range candidates {
			key := rowKey{*row.UpdatedAt, row.Serial}
			if keys[key] {
				result.Duplicates++
				continue
			}
			keys[key] = true
			additions = append(additions, row)
		}
		if len(additions) > 0 {
			if err := s.appendRows(name, additions); err != nil {
				return result, err
			}
			result.Imported += len(additions)
		}
	}
	return result, nil
}
