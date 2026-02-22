package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"historian_v3/pkg/historian"
)

func main() {
	cfg, err := historian.LoadConfig("historian.config.yaml")
	if err != nil {
		log.Fatal(err)
	}
	if err := historian.EnsureBaseLayout(cfg); err != nil {
		log.Fatal(err)
	}
	if err := historian.RepairStorageTail(cfg); err != nil {
		log.Fatal(err)
	}
	b, _ := json.MarshalIndent(cfg, "", "  ")
	_ = os.WriteFile(filepath.Join(cfg.Storage.DataDir, "meta", "config.json"), b, 0o644)

	lastStore := historian.NewLastValueStore(cfg.Storage.DataDir)
	if err := lastStore.Start(); err != nil {
		log.Fatal(err)
	}
	wal := historian.NewWAL(cfg.Storage.DataDir, cfg)
	if err := wal.Start(); err != nil {
		log.Fatal(err)
	}
	writer := historian.NewHistorianWriter(cfg, lastStore, wal)
	if err := writer.RecoverFromWAL(); err != nil {
		log.Fatal(err)
	}
	if err := writer.FlushAll(); err != nil {
		log.Fatal(err)
	}
	writer.Start()
	historian.StartRetentionLoop(cfg)
	query := historian.NewQueryEngine(cfg)
	activity := historian.NewActivityLogger(100)
	server := historian.NewServer(cfg, writer, query, lastStore, wal, activity)
	activity.AddSystem("info", "historian starting", map[string]any{
		"udpHost": cfg.UDP.Host,
		"udpPort": cfg.UDP.Port,
		"httpHost": cfg.HTTP.Host,
		"httpPort": cfg.HTTP.Port,
	})

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go func() {
		if err := historian.RunUDPServer(ctx, cfg, writer, activity); err != nil {
			log.Fatal(err)
		}
	}()

	addr := fmt.Sprintf("%s:%d", cfg.HTTP.Host, cfg.HTTP.Port)
	log.Printf("Historian v3 started. UDP %s:%d, HTTP %s", cfg.UDP.Host, cfg.UDP.Port, addr)
	httpSrv := &http.Server{
		Addr:    addr,
		Handler: server.Handler(),
	}
	go func() {
		if err := httpSrv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatal(err)
		}
	}()

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	<-sigCh
	cancel()
	shCtx, shCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer shCancel()
	_ = httpSrv.Shutdown(shCtx)
	writer.Stop()
	lastStore.Stop()
	wal.Stop()
}
