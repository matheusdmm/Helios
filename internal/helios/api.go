package helios

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/netip"
	"regexp"
	"strings"
	"time"
	"unicode/utf16"
)

const maxCSVBytes = 100 << 20

var (
	requestedDate  = regexp.MustCompile(`^20\d{2}-\d{2}-\d{2}$`)
	requestedMonth = regexp.MustCompile(`^20\d{2}-(0[1-9]|1[0-2])$`)
	errCSVSerial   = errors.New("O número de série não corresponde ao inversor conectado.")
)

// Handler serves the shared API. The Wails asset server uses desktop mode and
// does not bind this handler to a network listener.
func (s *Service) Handler(desktop bool) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		local := desktop || isLocalRequest(r)
		canUpdate := local && r.Header.Get("X-Local-Setup") == "1"
		ctx, cancel := context.WithCancel(r.Context())
		defer cancel()
		stop := context.AfterFunc(s.ctx, cancel)
		defer stop()
		r = r.WithContext(ctx)
		switch path, method := r.URL.Path, r.Method; {
		case path == "/api/discover" && method == http.MethodGet:
			if !local {
				apiError(w, 403, "Busca permitida apenas neste computador.")
				return
			}
			s.discover(w, r)
		case path == "/api/settings" && method == http.MethodPost:
			if !canUpdate {
				apiError(w, 403, "Configuração permitida apenas neste computador.")
				return
			}
			s.updateSettings(w, r)
		case path == "/api/preferences" && method == http.MethodPost:
			if !canUpdate {
				apiError(w, 403, "Configuração permitida apenas neste computador.")
				return
			}
			s.updatePreferences(w, r)
		case path == "/api/import.csv" && method == http.MethodPost:
			if !canUpdate {
				apiError(w, 403, "Importação permitida apenas neste computador.")
				return
			}
			s.importCSV(w, r)
		case path == "/api/export.csv" && (method == http.MethodHead || method == http.MethodGet):
			if !local {
				apiError(w, 403, "Exportação permitida apenas neste computador.")
				return
			}
			s.exportCSV(w, r)
		case method != http.MethodGet:
			apiError(w, 405, "Método não permitido.")
		case path == "/api/config":
			config := s.snapshot().settings
			writeJSON(w, 200, map[string]any{
				"configured": config.IP != "", "hasPassword": config.Password != "", "needsPassword": config.IP != "" && config.Password == "",
				"ip": config.IP, "mac": config.MAC, "timeZone": s.store.loc.String(), "tariffBrlPerKwh": config.Tariff, "canManage": local,
			})
		case path == "/api/dashboard":
			s.dashboard(w, r)
		case path == "/api/calendar":
			s.calendar(w, r)
		default:
			apiError(w, 404, "Página não encontrada.")
		}
	})
}

func isLocalRequest(r *http.Request) bool {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return false
	}
	ip, err := netip.ParseAddr(host)
	return err == nil && (ip.Unmap() == netip.AddrFrom4([4]byte{127, 0, 0, 1}) || ip == netip.IPv6Loopback())
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func apiError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}

func (s *Service) internalError(w http.ResponseWriter, err error) {
	s.log("error", err.Error())
	apiError(w, 500, "Erro ao carregar o painel.")
}

func (s *Service) discover(w http.ResponseWriter, r *http.Request) {
	s.log("info", "[S3] Busca de coletores iniciada.")
	result := s.collector.discover(r.Context())
	count := 0
	for _, d := range result.Devices {
		if d.Solis {
			count++
		}
	}
	s.log("info", fmt.Sprintf("[S3] Busca concluída. Coletores Solis identificados: %d.", count))
	writeJSON(w, 200, result)
}

func decodeRequest(w http.ResponseWriter, r *http.Request, limit int64, output any) bool {
	content, err := io.ReadAll(http.MaxBytesReader(w, r.Body, limit))
	var tooLarge *http.MaxBytesError
	switch {
	case errors.As(err, &tooLarge):
		apiError(w, 413, "Configuração muito grande.")
	case err != nil || json.Unmarshal(content, output) != nil:
		apiError(w, 400, "Configuração inválida.")
	default:
		return true
	}
	return false
}

func (s *Service) updateSettings(w http.ResponseWriter, r *http.Request) {
	var input struct{ IP, Password, MAC string }
	if !decodeRequest(w, r, 4096, &input) {
		return
	}
	config := s.snapshot().settings
	ip := strings.TrimSpace(input.IP)
	password := or(input.Password, config.Password)
	if !ipv4(ip) {
		apiError(w, 400, "Informe um IP válido do coletor.")
		return
	}
	if password == "" || len(utf16.Encode([]rune(password))) > 256 {
		apiError(w, 400, "Informe a senha do coletor.")
		return
	}
	identity := s.collector.probe(r.Context(), ip)
	if identity == nil || !identity.Solis {
		apiError(w, 400, "O IP não respondeu como coletor Solis. A senha não foi enviada.")
		return
	}
	config.IP, config.Password = ip, password
	row, err := s.collector.read(r.Context(), config)
	if err != nil {
		s.log("error", "[S3] "+err.Error())
		writeJSON(w, 400, map[string]any{"error": err.Error(), "connected": false})
		return
	}
	mac := ""
	if macPattern.MatchString(input.MAC) {
		mac = strings.ToLower(input.MAC)
	}
	if err := s.setCollector(ip, mac, password, row); err != nil {
		s.internalError(w, err)
		return
	}
	s.log("info", fmt.Sprintf("[S3] Coletor conectado em %s.", ip))
	writeJSON(w, 200, map[string]any{"saved": true, "connected": true, "error": nil})
}

func (s *Service) updatePreferences(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Tariff *float64 `json:"tariffBrlPerKwh"`
	}
	if !decodeRequest(w, r, 256, &input) {
		return
	}
	if input.Tariff == nil || !validTariff(*input.Tariff) {
		apiError(w, 400, "Informe uma tarifa entre R$ 0 e R$ 100 por kWh.")
		return
	}
	if err := s.setTariff(*input.Tariff); err != nil {
		s.internalError(w, err)
		return
	}
	s.log("info", "Tarifa de referência salva.")
	writeJSON(w, 200, map[string]any{"saved": true, "tariffBrlPerKwh": *input.Tariff})
}

func (s *Service) importCSV(w http.ResponseWriter, r *http.Request) {
	state := s.snapshot()
	if state.settings.IP == "" {
		apiError(w, 400, "Conecte um coletor antes de importar leituras.")
		return
	}
	if !strings.HasPrefix(r.Header.Get("Content-Type"), "text/csv") {
		apiError(w, 415, "Envie um arquivo CSV.")
		return
	}
	if r.ContentLength > maxCSVBytes {
		apiError(w, 413, "O CSV deve ter até 100 MB.")
		return
	}
	serial := ""
	if state.latest != nil {
		serial = state.latest.Serial
	}
	rows, err := parseCSV(http.MaxBytesReader(w, r.Body, maxCSVBytes), serial, time.Now())
	var tooLarge *http.MaxBytesError
	if errors.As(err, &tooLarge) {
		apiError(w, 413, "O CSV deve ter até 100 MB.")
		return
	}
	if err != nil {
		apiError(w, 400, err.Error())
		return
	}
	result, err := s.importReadings(rows)
	if errors.Is(err, errCSVSerial) {
		apiError(w, 400, err.Error())
		return
	}
	if err != nil {
		s.internalError(w, err)
		return
	}
	s.log("info", fmt.Sprintf("[CSV] Importação concluída. Leituras importadas: %d. Duplicatas: %d.", result.Imported, result.Duplicates))
	writeJSON(w, 200, result)
}

func (s *Service) exportCSV(w http.ResponseWriter, r *http.Request) {
	export := s.Export(r.URL.Query().Get("scope"))
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="`+export.Filename+`"`)
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(200)
	if r.Method != http.MethodHead {
		if err := export.Write(w); err != nil {
			s.log("error", "[CSV] "+err.Error())
		}
	}
}

type alarm struct {
	Message string `json:"message"`
	BeganAt int64  `json:"beganAt"`
}

func (s *Service) dashboard(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query()
	period, date := query.Get("period"), query.Get("date")
	if period != "month" && period != "year" {
		period = "day"
	}
	now := time.Now()
	today := s.store.day(now.UnixMilli())
	if !requestedDate.MatchString(date) {
		date = today
	}
	state := s.snapshot()
	if state.settings.IP == "" && state.settings.Password == "" {
		writeJSON(w, 200, demo(period, date, now.In(s.store.loc)))
		return
	}
	if query.Get("refresh") == "1" {
		s.poll(r.Context())
	} else if state.latest == nil {
		s.mu.Lock()
		pending := s.pending != nil
		s.mu.Unlock()
		if !pending {
			s.poll(r.Context())
		}
	}
	state = s.snapshot()
	now = time.Now()
	today = s.store.day(now.UnixMilli())
	data, err := s.dashboardHistory(date, period, today)
	if err != nil {
		s.internalError(w, err)
		return
	}
	insights := buildInsights(today, data.today, data.recent, data.month, data.events, state.settings.Tariff, s.store.day, now.UnixMilli())
	alarms := []alarm{}
	var inverter any
	status := http.StatusServiceUnavailable
	if state.latest != nil {
		status = http.StatusOK
		inverter = struct {
			reading
			EnergyMonthKwh float64 `json:"energyMonthKwh"`
		}{*state.latest, insights.MonthKwh}
		if state.latest.Alarm != "" && !strings.EqualFold(state.latest.Alarm, "NO") {
			alarms = append(alarms, alarm{state.latest.Alarm, *state.latest.UpdatedAt})
		}
	}
	writeJSON(w, status, map[string]any{
		"mode": "local", "period": period, "date": date, "fetchedAt": now.UnixMilli(), "inverter": inverter,
		"series": chartSeries(data.selected, period, s.store.loc), "insights": insights, "alarms": alarms, "error": state.lastError,
	})
}

type dashboardHistory struct {
	selected, today, month, recent []reading
	events                         []connectionEvent
}

func (s *Service) dashboardHistory(date, period, today string) (dashboardHistory, error) {
	prefix := date
	switch period {
	case "month":
		prefix = date[:7]
	case "year":
		prefix = date[:4]
	}
	month, since := today[:7], shiftDay(today, -7)
	var data dashboardHistory
	names, err := s.store.files(readingFile, func(name string) bool {
		return strings.HasPrefix(name, prefix) || strings.HasPrefix(name, month) || (name[:10] >= since && name[:10] <= today)
	})
	if err != nil {
		return data, err
	}
	for _, name := range names {
		rows, err := readJSONL[reading](s.store.dir, []string{name})
		if err != nil {
			return data, err
		}
		day := name[:10]
		if strings.HasPrefix(day, prefix) {
			data.selected = append(data.selected, rows...)
		}
		if strings.HasPrefix(day, month) {
			data.month = append(data.month, rows...)
		}
		if day == today {
			data.today = rows
		}
		if day >= since && day <= today {
			data.recent = append(data.recent, rows...)
		}
	}
	yesterday := shiftDay(today, -1)
	connections, err := s.store.files(connectionFile, func(name string) bool { return name[11:21] >= yesterday })
	if err == nil {
		data.events, err = readJSONL[connectionEvent](s.store.dir, connections)
	}
	return data, err
}

func (s *Service) calendar(w http.ResponseWriter, r *http.Request) {
	today := s.store.day(time.Now().UnixMilli())
	month := r.URL.Query().Get("month")
	if !requestedMonth.MatchString(month) {
		month = today[:7]
	}
	mode := "demo"
	var monthRows, recentRows []reading
	var prediction *forecast
	if s.snapshot().settings.IP != "" {
		mode = "local"
		first := shiftDay(today, -30)
		names, err := s.store.files(readingFile, func(name string) bool {
			return strings.HasPrefix(name, month) || (name[:10] >= first && name[:10] <= today)
		})
		if err != nil {
			s.internalError(w, err)
			return
		}
		for _, name := range names {
			rows, err := readJSONL[reading](s.store.dir, []string{name})
			if err != nil {
				s.internalError(w, err)
				return
			}
			if strings.HasPrefix(name, month) {
				monthRows = append(monthRows, rows...)
			}
			if name[:10] >= first && name[:10] <= today {
				recentRows = append(recentRows, rows...)
			}
		}
		prediction = buildForecast(recentRows, today, s.store.day)
	}
	status, weather := s.weather.get(s.ctx)
	writeJSON(w, 200, map[string]any{
		"mode": mode, "month": month, "today": today, "days": calendar(monthRows, s.store.day), "forecast": prediction,
		"weather": weatherProjection(status, weather, prediction, today),
	})
}
