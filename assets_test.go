package assets

import (
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"
)

func TestSharedFrontend(t *testing.T) {
	get := func(t *testing.T, h http.Handler, path string) *httptest.ResponseRecorder {
		t.Helper()
		w := httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest(http.MethodGet, path, nil))
		if w.Code != 200 {
			t.Fatalf("GET %s: %d", path, w.Code)
		}
		return w
	}
	web, desktop := Handler(false), Handler(true)
	webHTML, desktopHTML := get(t, web, "/").Body.String(), get(t, desktop, "/").Body.String()
	if strings.Contains(webHTML, "<html data-desktop") || !strings.Contains(desktopHTML, "<html data-desktop") || !strings.Contains(webHTML, `type="module" src="/app.js"`) {
		t.Fatal("missing native module entry point or incorrect desktop mode")
	}
	worker := get(t, web, "/sw.js").Body.String()
	modules := regexp.MustCompile(`from "\./([^"\n]+)"`).FindAllStringSubmatch(get(t, web, "/app.js").Body.String(), -1)
	if len(modules) != 3 {
		t.Fatalf("unexpected module imports: %v", modules)
	}
	for _, module := range modules {
		path := "/" + module[1]
		if !strings.Contains(worker, "'"+path+"'") {
			t.Fatalf("missing offline module %s", path)
		}
		for _, h := range []http.Handler{web, desktop} {
			if got := get(t, h, path).Header().Get("Content-Type"); got != "text/javascript; charset=utf-8" {
				t.Fatalf("%s MIME type: %q", path, got)
			}
		}
	}
}
