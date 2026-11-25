package helios

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestLegacyDataAndAPI(t *testing.T) {
	root := t.TempDir()
	for key, value := range map[string]string{
		"HELIOS_DATA_DIR": "", "S3_IP": "192.0.2.1", "S3_USER": "admin", "S3_PASSWORD": "",
		"TIME_ZONE": "America/Sao_Paulo", "TARIFF_BRL_PER_KWH": "0.5", "OPENWEATHER_API_KEY": "",
	} {
		t.Setenv(key, value)
	}
	legacy := filepath.Join(root, "data")
	if err := os.Mkdir(legacy, 0o700); err != nil {
		t.Fatal(err)
	}
	loc, err := time.LoadLocation("America/Sao_Paulo")
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().In(loc)
	previousDay := time.Date(now.Year(), now.Month(), now.Day(), 12, 0, 0, 0, loc).AddDate(0, 0, -1)
	at := previousDay.UnixMilli()
	day := time.UnixMilli(at).In(loc).Format(time.DateOnly)
	rowsPath := filepath.Join(legacy, day+".jsonl")
	writeFixture(t, filepath.Join(legacy, "local-settings.json"), `{"s3Ip":"192.0.2.42","s3User":"saved","s3Mac":"aa:bb:cc:dd:ee:ff","s3Password":"","tariffBrlPerKwh":0.75}`)
	writeFixture(t, rowsPath, fmt.Sprintf(`{"updatedAt":%d,"powerW":500,"energyTodayKwh":2,"energyTotalKwh":null,"temperatureC":31,"sn":"SERIAL1234","alarm":"NO","firmware":"FW","modelCode":"S6"}`+"\r\n"+`{"incomplete":`, at))
	writeFixture(t, filepath.Join(legacy, "connection-"+day+".jsonl"), fmt.Sprintf("{\"at\":%d,\"ok\":true}\n", at))
	config, err := LoadConfig(root)
	if err != nil {
		t.Fatal(err)
	}
	service, err := NewService(config, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(service.Close)
	if latest := service.snapshot().latest; latest == nil || latest.Serial != "SERIAL1234" || *latest.PowerW != 500 || latest.EnergyTotalKwh != nil {
		t.Fatalf("legacy reading: %+v", latest)
	}
	handler := service.Handler(false)
	request := func(method, path, body string, local, setup bool) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, path, strings.NewReader(body))
		if local {
			r.RemoteAddr = "[::ffff:127.0.0.1]:41200"
		}
		if setup {
			r.Header.Set("X-Local-Setup", "1")
		}
		r.Header.Set("Content-Type", "text/csv")
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		return w
	}
	configResponse := request(http.MethodGet, "/api/config", "", true, false)
	var configBody map[string]any
	if err := json.Unmarshal(configResponse.Body.Bytes(), &configBody); err != nil {
		t.Fatal(err)
	}
	if configBody["ip"] != "192.0.2.42" || configBody["canManage"] != true || configBody["tariffBrlPerKwh"] != .75 || configBody["needsPassword"] != true {
		t.Fatalf("invalid config: %v", configBody)
	}
	if _, found := configBody["s3Password"]; found {
		t.Fatal("config exposed the password")
	}
	const tariff = `{"tariffBrlPerKwh":0.92}`
	if got := request(http.MethodPost, "/api/preferences", tariff, false, true); got.Code != 403 {
		t.Fatalf("remote update: %d", got.Code)
	}
	if got := request(http.MethodPost, "/api/preferences", tariff, true, true); got.Code != 200 {
		t.Fatalf("local update: %d %s", got.Code, got.Body)
	}
	reopened, err := LoadConfig(root)
	if err != nil || reopened.settings.Tariff != .92 || reopened.settings.MAC != "aa:bb:cc:dd:ee:ff" {
		t.Fatalf("settings after update: %+v, %v", reopened.settings, err)
	}
	if got := request(http.MethodGet, "/api/dashboard?date="+day, "", false, false); got.Code != 200 || !strings.Contains(got.Body.String(), `"value":500`) {
		t.Fatalf("dashboard history: %d %s", got.Code, got.Body)
	}
	if got := request(http.MethodGet, "/api/calendar?month="+day[:7], "", false, false); got.Code != 200 || !strings.Contains(got.Body.String(), `"energyKwh":2`) {
		t.Fatalf("calendar history: %d %s", got.Code, got.Body)
	}
	row := makeReading(at+1234, 750, 2.5, nil, 33, "NO", "SERIAL1234", "FW", "S6")
	csv := "\uFEFF" + strings.Join(csvHeader, ";") + "\r\n" + csvLine(row)
	if got := request(http.MethodPost, "/api/import.csv", csv, true, false); got.Code != 403 {
		t.Fatalf("import without setup header: %d", got.Code)
	}
	if got := request(http.MethodPost, "/api/import.csv", "bad csv", true, true); got.Code != 400 {
		t.Fatalf("invalid import: %d", got.Code)
	}
	const importPath = "/api/import.csv"
	results := make(chan *httptest.ResponseRecorder, 2)
	var imports sync.WaitGroup
	for range 2 {
		imports.Go(func() { results <- request(http.MethodPost, importPath, csv, true, true) })
	}
	imports.Wait()
	close(results)
	var imported, duplicates int
	for got := range results {
		var result importResult
		if got.Code != 200 || json.Unmarshal(got.Body.Bytes(), &result) != nil {
			t.Fatalf("import: %d %s", got.Code, got.Body)
		}
		imported += result.Imported
		duplicates += result.Duplicates
	}
	if imported != 1 || duplicates != 1 {
		t.Fatalf("concurrent imports: %d imported, %d duplicates", imported, duplicates)
	}
	if latest, err := service.store.latest(); err != nil || latest == nil || *latest.UpdatedAt != at+1234 {
		t.Fatalf("failed to recover imported reading after a partial line: %+v, %v", latest, err)
	}
	if got := request(http.MethodHead, "/api/export.csv", "", true, false); got.Code != 200 || got.Body.Len() != 0 || !strings.Contains(got.Header().Get("Content-Disposition"), "solis-leituras-completo-") {
		t.Fatalf("export metadata: %d %v %s", got.Code, got.Header(), got.Body)
	}
	if got := request(http.MethodGet, "/api/export.csv", "", true, false); got.Code != 200 || strings.Count(got.Body.String(), "SERIAL1234") != 2 || !strings.Contains(got.Body.String(), ";750;2,5;") {
		t.Fatalf("CSV export: %d %s", got.Code, got.Body)
	}
}

func TestEnvAndDemo(t *testing.T) {
	root := t.TempDir()
	for key, value := range map[string]string{"S3_IP": "", "S3_PASSWORD": "", "TIME_ZONE": "", "HELIOS_DATA_DIR": "", "TARIFF_BRL_PER_KWH": ""} {
		t.Setenv(key, value)
	}
	t.Setenv("PORT", "4242")
	writeFixture(t, filepath.Join(root, ".env"), " PORT = 3000\r\nS3_PASSWORD='ignored by the environment'\n")
	config, err := LoadConfig(root)
	if err != nil || config.Port != "4242" || config.settings.Password != "" || config.Location.String() != "America/Sao_Paulo" {
		t.Fatalf("environment config: %+v, %v", config, err)
	}
	service, err := NewService(config, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(service.Close)
	service.Start()
	w := httptest.NewRecorder()
	service.Handler(false).ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/dashboard?period=year", nil))
	var output struct {
		Mode   string
		Series []point
	}
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &output) != nil || output.Mode != "demo" || len(output.Series) != 12 {
		t.Fatalf("demo dashboard: %d %s", w.Code, w.Body)
	}
}

func writeFixture(t *testing.T, path, content string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
}
