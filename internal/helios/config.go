package helios

import (
	"bufio"
	"errors"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"
	_ "time/tzdata"
)

type Config struct {
	DataDir, Host, Port string
	Cert, Key           string
	Location            *time.Location
	WeatherKey          string
	Latitude, Longitude string
	settings            settings
}

type settings struct {
	IP       string  `json:"s3Ip"`
	User     string  `json:"s3User"`
	Password string  `json:"s3Password"`
	MAC      string  `json:"s3Mac"`
	Tariff   float64 `json:"tariffBrlPerKwh"`
}

var envLine = regexp.MustCompile(`^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)$`)

// LoadConfig resolves local files relative to the application's writable directory.
func LoadConfig(root string) (Config, error) {
	env, err := readEnv(filepath.Join(root, ".env"))
	if err != nil {
		return Config{}, err
	}
	get := func(key string) string {
		if value, ok := os.LookupEnv(key); ok {
			return value
		}
		return env[key]
	}
	zone := or(get("TIME_ZONE"), "America/Sao_Paulo")
	location, err := time.LoadLocation(zone)
	if err != nil {
		return Config{}, fmt.Errorf("TIME_ZONE inválido: %w", err)
	}
	config := Config{
		DataDir: resolve(root, or(get("HELIOS_DATA_DIR"), "data")),
		Host:    or(get("HOST"), "127.0.0.1"), Port: or(get("PORT"), "3000"),
		Cert: resolve(root, strings.TrimSpace(get("HTTPS_CERT"))),
		Key:  resolve(root, strings.TrimSpace(get("HTTPS_KEY"))), Location: location,
		WeatherKey: strings.TrimSpace(get("OPENWEATHER_API_KEY")),
		Latitude:   strings.TrimSpace(get("OPENWEATHER_LAT")), Longitude: strings.TrimSpace(get("OPENWEATHER_LON")),
		settings: settings{IP: strings.TrimSpace(get("S3_IP")), User: or(strings.TrimSpace(get("S3_USER")), "admin"), Password: get("S3_PASSWORD")},
	}
	tariff := strings.TrimSpace(get("TARIFF_BRL_PER_KWH"))
	config.settings.Tariff, err = strconv.ParseFloat(or(tariff, "0"), 64)
	if err != nil {
		config.settings.Tariff = math.NaN()
	}
	config.settings, err = loadSettings(config.DataDir, config.settings)
	if err != nil {
		return Config{}, err
	}
	if !validTariff(config.settings.Tariff) {
		return Config{}, errors.New("TARIFF_BRL_PER_KWH deve estar entre 0 e 100")
	}
	return config, nil
}

func readEnv(path string) (map[string]string, error) {
	values := make(map[string]string)
	file, err := os.Open(path)
	if errors.Is(err, os.ErrNotExist) {
		return values, nil
	}
	if err != nil {
		return nil, err
	}
	defer file.Close()
	lines := bufio.NewScanner(file)
	for lines.Scan() {
		match := envLine.FindStringSubmatch(lines.Text())
		if match == nil {
			continue
		}
		if _, exists := values[match[1]]; exists {
			continue
		}
		value := strings.TrimSpace(match[2])
		if len(value) >= 2 && (value[0] == '"' || value[0] == '\'') && value[len(value)-1] == value[0] {
			value = value[1 : len(value)-1]
		}
		values[match[1]] = value
	}
	return values, lines.Err()
}

func resolve(root, name string) string {
	if name == "" || filepath.IsAbs(name) {
		return name
	}
	return filepath.Join(root, name)
}

func or(value, fallback string) string {
	if value == "" {
		return fallback
	}
	return value
}

func validTariff(tariff float64) bool { return tariff >= 0 && tariff <= 100 }
