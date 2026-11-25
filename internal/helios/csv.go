package helios

import (
	"encoding/csv"
	"errors"
	"fmt"
	"io"
	"math"
	"path/filepath"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"
	"unicode/utf16"
	"unicode/utf8"
)

var csvHeader = []string{"timestamp", "power_w", "energy_today_kwh", "energy_total_kwh", "temperature_c", "alarm", "serial", "firmware", "model_code"}
var summaryHeader = []string{"date", "energy_kwh", "peak_w", "peak_time", "max_temperature_c", "generating_minutes_observed", "readings", "estimated_brl"}

const csvTime = "2006-01-02T15:04:05.000Z"

func textCell(text string, forceText bool) string {
	if forceText || text != "" && strings.ContainsRune("=+-@\t\r\n", rune(text[0])) {
		text = "'" + text
	}
	return `"` + strings.ReplaceAll(text, `"`, `""`) + `"`
}

func numericCell(value *float64) string {
	if value == nil {
		return ""
	}
	return strings.Replace(strconv.FormatFloat(*value, 'f', -1, 64), ".", ",", 1)
}

func csvLine(row reading) string {
	return strings.Join([]string{
		time.UnixMilli(*row.UpdatedAt).UTC().Format(csvTime), numericCell(row.PowerW),
		numericCell(row.EnergyTodayKwh), numericCell(row.EnergyTotalKwh), numericCell(row.TemperatureC),
		textCell(row.Alarm, false), textCell(row.Serial, true), textCell(row.Firmware, false), textCell(row.ModelCode, false),
	}, ";") + "\r\n"
}

func summaryLine(day string, readings []reading, tariff float64) string {
	var energy, peak, temp *float64
	var peakAt string
	var count int
	for _, row := range readings {
		if row.UpdatedAt == nil {
			continue
		}
		count++
		if row.EnergyTodayKwh != nil && (energy == nil || *row.EnergyTodayKwh > *energy) {
			energy = new(max(0, *row.EnergyTodayKwh))
		}
		if row.PowerW != nil && (peak == nil || *row.PowerW > *peak) {
			peak, peakAt = row.PowerW, time.UnixMilli(*row.UpdatedAt).UTC().Format(csvTime)
		}
		if row.TemperatureC != nil && (temp == nil || *row.TemperatureC > *temp) {
			temp = row.TemperatureC
		}
	}
	var value *float64
	if tariff > 0 && energy != nil {
		value = new(math.Round(*energy*tariff*100) / 100)
	}
	return strings.Join([]string{day, numericCell(energy), numericCell(peak), peakAt, numericCell(temp),
		strconv.Itoa(generatingMinutes(readings)), strconv.Itoa(count), numericCell(value)}, ";") + "\r\n"
}

var (
	csvTimestamp = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$`)
	csvNumber    = regexp.MustCompile(`^-?\d+(?:[,.]\d+)?$`)
	csvSerial    = regexp.MustCompile(`^[A-Za-z0-9]{10,24}$`)
	csvID        = regexp.MustCompile(`^[A-Za-z0-9.-]{1,24}$`)
)

func decimal(text, column string) (float64, error) {
	if csvNumber.MatchString(text) {
		if value, err := strconv.ParseFloat(strings.Replace(text, ",", ".", 1), 64); err == nil {
			return value, nil
		}
	}
	return 0, fmt.Errorf("Valor inválido na coluna %s.", column)
}

func safeText(text string, limit int, column string) (string, error) {
	text = strings.TrimPrefix(text, "'")
	if !utf8.ValidString(text) || len(utf16.Encode([]rune(text))) > limit || strings.ContainsFunc(text, func(r rune) bool { return r < 32 || r == 127 }) {
		return "", fmt.Errorf("Valor inválido na coluna %s.", column)
	}
	return text, nil
}

func parseCSV(input io.Reader, serial string, now time.Time) ([]reading, error) {
	r := csv.NewReader(input)
	r.Comma, r.FieldsPerRecord = ';', -1
	var rows []reading
	var headerFound bool
	var line int
	for {
		fields, err := r.Read()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			var parseErr *csv.ParseError
			if errors.As(err, &parseErr) {
				return nil, fmt.Errorf("CSV inválido próximo da linha %d.", parseErr.Line)
			}
			return nil, err
		}
		if len(fields) > 0 && !headerFound {
			fields[0] = strings.TrimPrefix(fields[0], "\uFEFF")
		}
		if !slices.ContainsFunc(fields, func(value string) bool { return value != "" }) {
			continue
		}
		line++
		if !headerFound {
			if !slices.Equal(fields, csvHeader) {
				return nil, badCSVHeader()
			}
			headerFound = true
			continue
		}
		if len(rows) >= 500000 {
			return nil, errors.New("O CSV ultrapassa o limite de 500 mil leituras.")
		}
		row, err := parseCSVRow(fields, line, serial, now)
		if err != nil {
			return nil, err
		}
		if len(rows) > 0 && rows[0].Serial != row.Serial {
			return nil, errors.New("O CSV contém leituras de mais de um inversor.")
		}
		rows = append(rows, row)
	}
	if !headerFound {
		return nil, badCSVHeader()
	}
	if len(rows) == 0 {
		return nil, errors.New("O CSV não contém leituras para importar.")
	}
	return rows, nil
}

func badCSVHeader() error {
	return errors.New("Cabeçalho CSV diferente do formato exportado pelo painel.")
}

func parseCSVRow(fields []string, line int, serial string, now time.Time) (reading, error) {
	if len(fields) != len(csvHeader) {
		return reading{}, fmt.Errorf("A linha %d tem %d colunas; eram esperadas %d.", line, len(fields), len(csvHeader))
	}
	if !csvTimestamp.MatchString(fields[0]) {
		return reading{}, fmt.Errorf("Data inválida na linha %d.", line)
	}
	at, err := time.Parse(time.RFC3339Nano, fields[0])
	if err != nil || at.Year() < 2000 || at.After(now.Add(24*time.Hour)) {
		return reading{}, fmt.Errorf("Data fora do intervalo permitido na linha %d.", line)
	}
	var numbers [4]*float64
	for i := 1; i <= 4; i++ {
		if i == 3 && fields[i] == "" {
			continue
		}
		value, err := decimal(fields[i], csvHeader[i])
		if err != nil {
			return reading{}, err
		}
		numbers[i-1] = &value
	}
	power, energy, total, temp := *numbers[0], *numbers[1], numbers[2], *numbers[3]
	if power < 0 || power > 12000 || energy < 0 || energy > 200 || total != nil && (*total < 0 || *total > 1e8) || temp < -40 || temp > 120 {
		return reading{}, fmt.Errorf("Leitura fora do intervalo esperado na linha %d.", line)
	}
	var texts [4]string
	for i, limit := range []int{120, 24, 24, 24} {
		value, err := safeText(fields[i+5], limit, csvHeader[i+5])
		if err != nil {
			return reading{}, err
		}
		texts[i] = value
	}
	alarm, sn, firmware, code := or(texts[0], "NO"), texts[1], texts[2], texts[3]
	if !csvSerial.MatchString(sn) || !csvID.MatchString(firmware) || !csvID.MatchString(code) {
		return reading{}, fmt.Errorf("Identificação inválida na linha %d.", line)
	}
	if serial != "" && sn != serial {
		return reading{}, fmt.Errorf("O número de série na linha %d não corresponde ao inversor conectado.", line)
	}
	return makeReading(at.UnixMilli(), power, energy, total, temp, alarm, sn, firmware, code), nil
}

// CSVExport describes an export shared by the browser and the desktop save dialog.
type CSVExport struct {
	Filename string
	store    *store
	scope    string
	prefix   string
	tariff   float64
}

func (e CSVExport) Write(w io.Writer) error {
	names, err := e.store.files(readingFile, func(name string) bool { return strings.HasPrefix(name, e.prefix) })
	if err != nil {
		return err
	}
	header := csvHeader
	if e.scope == "summary" {
		header = summaryHeader
	}
	if _, err := io.WriteString(w, "\uFEFF"+strings.Join(header, ";")+"\r\n"); err != nil {
		return err
	}
	for _, name := range names {
		if e.scope == "summary" {
			rows, err := readJSONL[reading](e.store.dir, []string{name})
			if err != nil {
				return err
			}
			if len(rows) > 0 {
				if _, err := io.WriteString(w, summaryLine(name[:10], rows, e.tariff)); err != nil {
					return err
				}
			}
			continue
		}
		if err := walkJSONL(filepath.Join(e.store.dir, name), func(row reading) error {
			if row.UpdatedAt == nil {
				return nil
			}
			_, err := io.WriteString(w, csvLine(row))
			return err
		}); err != nil {
			return err
		}
	}
	return nil
}
