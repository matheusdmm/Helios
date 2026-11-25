//go:build windows

package main

import (
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"

	"helios/internal/helios"

	"github.com/wailsapp/wails/v3/pkg/application"
)

func exportCSV(w http.ResponseWriter, r *http.Request, dialogs *application.DialogManager, window application.Window, service *helios.Service, logs *sessionLog) {
	if r.Header.Get("X-Local-Setup") != "1" {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "Exportação permitida apenas neste computador."})
		return
	}
	if service == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": serviceUnavailable})
		return
	}
	scope := r.URL.Query().Get("scope")
	switch scope {
	case "all", "month", "summary":
	default:
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Escopo de exportação inválido."})
		return
	}
	fail := func(err error) {
		logs.add("error", "[CSV] Falha na exportação: "+err.Error())
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Não foi possível exportar o CSV. Consulte os logs."})
	}
	export := service.Export(scope)
	title := "Salvar arquivo CSV"
	if r.URL.Query().Get("lang") == "en" {
		title = "Save CSV file"
	}
	target, err := dialogs.SaveFileWithOptions(&application.SaveFileDialogOptions{
		Title: title, Filename: export.Filename, Window: window,
		Filters: []application.FileFilter{{DisplayName: "CSV (*.csv)", Pattern: "*.csv"}},
	}).PromptForSingleSelection()
	var dialogError interface{ Code() uintptr }
	if err != nil && (err.Error() == "cancelled by user" ||
		errors.As(err, &dialogError) && uint32(dialogError.Code()) == 0x800704C7) {
		// Wails' Windows dialog uses an internal error for IFileSaveDialog cancellation.
		err = nil
	}
	if err != nil {
		fail(err)
		return
	}
	if target == "" || target == "." {
		writeJSON(w, http.StatusOK, map[string]bool{"saved": false})
		return
	}
	if err := replaceFile(target, export.Write); err != nil {
		fail(err)
		return
	}
	logs.add("info", "[CSV] Exportação concluída: "+filepath.Base(target))
	writeJSON(w, http.StatusOK, map[string]bool{"saved": true})
}

func replaceFile(target string, write func(io.Writer) error) error {
	file, err := os.CreateTemp(filepath.Dir(target), ".helios-*.tmp")
	if err != nil {
		return err
	}
	defer os.Remove(file.Name())
	writeErr := write(file)
	if err := errors.Join(writeErr, file.Close()); err != nil {
		return err
	}
	return os.Rename(file.Name(), target)
}
