package main

import (
	"context"
	"errors"
	"flag"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"helios"
	"helios/internal/helios"
)

func main() {
	root := flag.String("dir", ".", "diretório do .env e dos dados do Helios")
	flag.Parse()
	if err := run(*root); err != nil {
		log.Fatal(err)
	}
}

func run(root string) error {
	config, err := helios.LoadConfig(root)
	if err != nil {
		return err
	}
	if (config.Cert == "") != (config.Key == "") {
		return errors.New("Configure HTTPS_CERT e HTTPS_KEY juntos")
	}
	service, err := helios.NewService(config, func(_ string, message string) { log.Print(message) })
	if err != nil {
		return err
	}
	defer service.Close()
	listener, err := net.Listen("tcp", net.JoinHostPort(config.Host, config.Port))
	if err != nil {
		return err
	}
	defer listener.Close()
	mux := http.NewServeMux()
	mux.Handle("/api/", service.Handler(false))
	mux.Handle("/", assets.Handler(false))
	server := &http.Server{Handler: mux, ReadHeaderTimeout: 5 * time.Second, IdleTimeout: 90 * time.Second}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	finished := make(chan error, 1)
	if config.Cert != "" {
		log.Printf("Painel Solis: https://%s", listener.Addr())
		go func() { finished <- server.ServeTLS(listener, config.Cert, config.Key) }()
	} else {
		log.Printf("Painel Solis: http://%s", listener.Addr())
		go func() { finished <- server.Serve(listener) }()
	}
	service.Start()
	select {
	case err := <-finished:
		return err
	case <-ctx.Done():
		service.Close()
		shutdown, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		return server.Shutdown(shutdown)
	}
}
