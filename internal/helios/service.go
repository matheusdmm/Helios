package helios

import (
	"context"
	"errors"
	"fmt"
	"math"
	"net/http"
	"sync"
	"time"
)

type Service struct {
	store     store
	collector collector
	weather   weatherCache
	log       func(level, message string)
	ctx       context.Context
	cancel    context.CancelFunc
	workers   sync.WaitGroup

	commit   sync.Mutex // Orders settings changes, poll results and CSV imports.
	mu       sync.Mutex
	state    serviceState
	closed   bool
	started  bool
	pending  chan struct{}
	revision uint64
	failures int
	lastScan time.Time
}

type serviceState struct {
	settings          settings
	latest            *reading
	lastError         *string
	lastCollectorRead time.Time
}

func NewService(config Config, logger func(level, message string)) (*Service, error) {
	if logger == nil {
		logger = func(string, string) {}
	}
	stopRedirect := func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	localTransport := http.DefaultTransport.(*http.Transport).Clone()
	localTransport.Proxy = nil
	s := &Service{
		store:     store{dir: config.DataDir, loc: config.Location},
		collector: collector{&http.Client{Transport: localTransport, CheckRedirect: stopRedirect}},
		log:       logger, state: serviceState{settings: config.settings},
	}
	if config.settings.IP != "" {
		latest, err := s.store.latest()
		if err != nil {
			return nil, err
		}
		s.state.latest = latest
	}
	s.ctx, s.cancel = context.WithCancel(context.Background())
	s.weather = weatherCache{client: &http.Client{CheckRedirect: stopRedirect}, key: config.WeatherKey,
		lat: config.Latitude, lon: config.Longitude, dayOf: s.store.day}
	return s, nil
}

func (s *Service) Start() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed || s.started {
		return
	}
	s.started = true
	s.workers.Go(func() {
		if state := s.snapshot(); state.settings.IP == "" && state.settings.Password == "" {
			s.log("info", "Prévia com dados de exemplo. Use “Localizar coletor” no painel para conectar.")
		}
		ticker := time.NewTicker(time.Minute)
		defer ticker.Stop()
		s.poll(s.ctx)
		for {
			select {
			case <-s.ctx.Done():
				return
			case <-ticker.C:
				s.poll(s.ctx)
			}
		}
	})
}

func (s *Service) Close() {
	s.mu.Lock()
	s.closed = true
	s.cancel()
	s.mu.Unlock()
	s.workers.Wait()
	s.collector.client.CloseIdleConnections()
}

// CollectorConnected reports whether the collector has supplied a recent live reading in this session.
func (s *Service) CollectorConnected() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.collectorConnectedLocked()
}

// LiveCapacityUsagePercent reports current inverter output as a share of its rated capacity.
func (s *Service) LiveCapacityUsagePercent() (int, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	row := s.state.latest
	if !s.collectorConnectedLocked() || row == nil || row.PowerW == nil || row.CapacityW <= 0 {
		return 0, false
	}
	percent := *row.PowerW / row.CapacityW * 100
	return int(math.Round(min(100, max(0, percent)))), true
}

func (s *Service) collectorConnectedLocked() bool {
	return !s.closed && s.state.lastError == nil && time.Since(s.state.lastCollectorRead) < 3*time.Minute
}

func (s *Service) snapshot() serviceState {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.state
}

func (s *Service) requestPoll() <-chan struct{} {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed || s.state.settings.IP == "" && s.state.settings.Password == "" {
		return nil
	}
	if s.pending != nil {
		return s.pending
	}
	if s.state.settings.Password == "" {
		s.state.lastError = new("Informe a senha do coletor no painel para iniciar a leitura.")
		return nil
	}
	pending := make(chan struct{})
	s.pending = pending
	state, revision := s.state, s.revision
	s.workers.Go(func() {
		defer func() {
			s.mu.Lock()
			s.pending = nil
			close(pending)
			s.mu.Unlock()
		}()
		s.collect(state, revision)
	})
	return pending
}

func (s *Service) poll(ctx context.Context) {
	if pending := s.requestPoll(); pending != nil {
		select {
		case <-pending:
		case <-ctx.Done():
		}
	}
}

func (s *Service) collect(state serviceState, revision uint64) {
	config := state.settings
	serial := ""
	if state.latest != nil {
		serial = state.latest.Serial
	}
	row, err := s.readCollector(config, serial)
	recovered := false
	if err != nil && s.canScan(revision) {
		s.log("info", "[S3] Buscando o coletor na rede para restabelecer a conexão.")
		found := s.collector.discover(s.ctx)
		newSettings, sample := recoverCollector(s.ctx, config, serial, found.Devices, s.collector.read)
		if sample != nil {
			row, config, recovered, err = *sample, newSettings, true, nil
		}
	}
	s.commit.Lock()
	defer s.commit.Unlock()
	s.mu.Lock()
	current, stale := s.state, s.closed || s.revision != revision
	s.mu.Unlock()
	if stale {
		return
	}
	if err == nil && current.latest != nil && current.latest.Serial != row.Serial {
		err = errors.New("O IP salvo respondeu com outro inversor.")
	}
	if err != nil {
		s.pollFailed(err, revision)
		return
	}
	if recovered {
		config.Tariff = current.settings.Tariff
		if err := s.store.saveSettings(config); err != nil {
			s.pollFailed(err, revision)
			return
		}
		s.mu.Lock()
		s.state.settings = config
		s.mu.Unlock()
		s.log("info", fmt.Sprintf("[S3] Coletor reencontrado em %s.", config.IP))
	}
	if err := s.store.appendReading(row); err != nil {
		s.pollFailed(err, revision)
		return
	}
	s.mu.Lock()
	announce := s.state.latest == nil || s.failures > 0
	s.state.latest, s.state.lastError, s.failures = &row, nil, 0
	s.state.lastCollectorRead = time.Now()
	s.mu.Unlock()
	if announce {
		s.log("info", "[S3] Leitura do coletor registrada.")
	}
}

func (s *Service) readCollector(config settings, serial string) (reading, error) {
	if config.IP == "" {
		return reading{}, errors.New("O coletor ainda não foi localizado na rede.")
	}
	row, err := s.collector.read(s.ctx, config)
	if err == nil && serial != "" && row.Serial != serial {
		return reading{}, errors.New("O IP salvo respondeu com outro inversor.")
	}
	return row, err
}

func (s *Service) canScan(revision uint64) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed || s.revision != revision || time.Since(s.lastScan) < 2*time.Minute {
		return false
	}
	s.lastScan = time.Now()
	return true
}

func (s *Service) pollFailed(err error, revision uint64) {
	s.log("error", "[S3] "+err.Error())
	if err := s.store.recordFailure(time.Now().UnixMilli()); err != nil {
		s.log("error", err.Error())
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.state.lastError = new(err.Error())
	s.failures++
	if s.closed || s.failures > 2 {
		return
	}
	attempt := s.failures
	s.workers.Go(func() {
		timer := time.NewTimer(time.Duration(attempt) * 15 * time.Second)
		defer timer.Stop()
		select {
		case <-s.ctx.Done():
			return
		case <-timer.C:
			s.mu.Lock()
			retry := s.revision == revision && s.failures == attempt
			s.mu.Unlock()
			if retry {
				s.poll(s.ctx)
			}
		}
	})
}

func (s *Service) setTariff(tariff float64) error {
	s.commit.Lock()
	defer s.commit.Unlock()
	config := s.snapshot().settings
	config.Tariff = tariff
	if err := s.store.saveSettings(config); err != nil {
		return err
	}
	s.mu.Lock()
	s.state.settings = config
	s.mu.Unlock()
	return nil
}

func (s *Service) setCollector(ip, mac, password string, row reading) error {
	s.commit.Lock()
	defer s.commit.Unlock()
	config := s.snapshot().settings
	if mac == "" && ip == config.IP {
		mac = config.MAC
	}
	config.IP, config.MAC, config.Password = ip, mac, password
	if err := s.store.saveSettings(config); err != nil {
		return err
	}
	s.mu.Lock()
	s.state = serviceState{settings: config, latest: &row, lastCollectorRead: time.Now()}
	s.revision++
	s.lastScan, s.failures = time.Time{}, 0
	s.mu.Unlock()
	return s.store.appendReading(row)
}

func (s *Service) importReadings(rows []reading) (importResult, error) {
	s.commit.Lock()
	defer s.commit.Unlock()
	state := s.snapshot()
	if state.latest != nil && state.latest.Serial != rows[0].Serial {
		return importResult{}, errCSVSerial
	}
	result, err := s.store.importRows(rows)
	if err != nil {
		return result, err
	}
	if state.latest == nil {
		latest, err := s.store.latest()
		if err != nil {
			return result, err
		}
		s.mu.Lock()
		s.state.latest = latest
		s.mu.Unlock()
	}
	return result, nil
}

func (s *Service) Export(scope string) CSVExport {
	today := s.store.day(time.Now().UnixMilli())
	prefix, suffix := "", "completo"
	if scope == "month" {
		prefix, suffix = today[:7], today[:7]
	}
	filename := "solis-leituras-" + suffix + "-" + today + ".csv"
	if scope == "summary" {
		filename = "solis-resumo-diario-" + today + ".csv"
	}
	return CSVExport{Filename: filename, store: &s.store, scope: scope, prefix: prefix, tariff: s.snapshot().settings.Tariff}
}
