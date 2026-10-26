package main

import (
	"context"
	"errors"
	"fmt"
	"github.com/Stygian-Tech/latr-link/services/latr-gateway/internal/config"
	"github.com/Stygian-Tech/latr-link/services/latr-gateway/internal/developer"
	"github.com/Stygian-Tech/latr-link/services/latr-gateway/internal/server"
	"github.com/jackc/pgx/v5/pgxpool"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
)

func main() {
	if e := run(); e != nil {
		slog.Error("Gateway stopped", "error", e)
		os.Exit(1)
	}
}
func run() error {
	cfg := config.Load()
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	var pool *pgxpool.Pool
	var e error
	if cfg.DatabaseURL != "" && cfg.AppEnv != "test" {
		pool, e = pgxpool.New(ctx, cfg.DatabaseURL)
		if e != nil {
			return fmt.Errorf("configure database: %w", e)
		}
		defer pool.Close()
		probe, cancel := context.WithTimeout(ctx, 10*time.Second)
		e = pool.Ping(probe)
		cancel()
		if e != nil {
			return errors.New("database unavailable")
		}
	}
	store, e := developer.New(ctx, cfg, pool)
	if e != nil {
		return e
	}
	handler := server.New(cfg, store, pool, &http.Client{Timeout: 30 * time.Second})
	defer handler.Close()
	httpServer := &http.Server{Addr: fmt.Sprintf(":%d", cfg.Port), Handler: handler, ReadHeaderTimeout: 10 * time.Second, ReadTimeout: 30 * time.Second, WriteTimeout: 120 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 1024 * 1024}
	done := make(chan error, 1)
	go func() { done <- httpServer.ListenAndServe() }()
	slog.Info("latr-gateway listening", "port", cfg.Port, "env", cfg.AppEnv)
	select {
	case e = <-done:
		if errors.Is(e, http.ErrServerClosed) {
			return nil
		}
		return e
	case <-ctx.Done():
		shutdown, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		return httpServer.Shutdown(shutdown)
	}
}
