package historian

import (
	"context"
	"net"
	"time"
)

func RunUDPServer(ctx context.Context, cfg Config, writer *HistorianWriter) error {
	addr := net.UDPAddr{IP: net.ParseIP(cfg.UDP.Host), Port: cfg.UDP.Port}
	conn, err := net.ListenUDP("udp", &addr)
	if err != nil {
		return err
	}
	defer conn.Close()
	_ = conn.SetReadBuffer(16 * 1024 * 1024)
	buf := make([]byte, 1024*1024)
	for {
		_ = conn.SetReadDeadline(time.Now().Add(1 * time.Second))
		n, _, err := conn.ReadFromUDP(buf)
		if err != nil {
			if ne, ok := err.(net.Error); ok && ne.Timeout() {
				select {
				case <-ctx.Done():
					return nil
				default:
					continue
				}
			}
			continue
		}
		points, err := DecodeUDPBatch(buf[:n])
		if err != nil {
			writer.MarkDecodeError()
			continue
		}
		_ = writer.IngestBatch(points)
	}
}
