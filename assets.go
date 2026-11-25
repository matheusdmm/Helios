package assets

import (
	"bytes"
	"embed"
	"net/http"
	"path"
	"strings"
)

//go:embed public/*.html public/*.js public/*.css public/*.png public/*.svg public/*.webmanifest
var files embed.FS

var contentTypes = map[string]string{
	".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
	".png": "image/png", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json",
}

func Icon() []byte {
	icon, _ := files.ReadFile("public/icon-192.png")
	return icon
}

func Handler(desktop bool) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			w.Header().Set("Allow", "GET, HEAD")
			http.Error(w, "Método não permitido.", http.StatusMethodNotAllowed)
			return
		}
		name := strings.TrimPrefix(r.URL.Path, "/")
		if name == "" {
			name = "index.html"
		}
		if path.Base(name) != name {
			http.NotFound(w, r)
			return
		}
		content, err := files.ReadFile("public/" + name)
		if err != nil {
			http.NotFound(w, r)
			return
		}
		if desktop && name == "index.html" {
			content = bytes.Replace(content, []byte("<html "), []byte("<html data-desktop "), 1)
		}
		w.Header().Set("Content-Type", contentTypes[path.Ext(name)])
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		if r.Method == http.MethodGet {
			_, _ = w.Write(content)
		}
	})
}
