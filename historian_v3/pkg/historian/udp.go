package historian

import (
	"context"
	"net"
	"time"
)

func RunUDPServer(ctx context.Context, cfg Config, writer *HistorianWriter, logger *ActivityLogger) error {
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
			if logger != nil {
				logger.AddSystem("error", "udp read error", map[string]any{"error": err.Error()})
			}
			continue
		}
		points, err := DecodeUDPBatch(buf[:n])
		if err != nil {
			writer.MarkDecodeError()
			if logger != nil {
				logger.AddSystem("error", "udp decode error", map[string]any{"error": err.Error(), "bytes": n})
			}
			continue
		}
		_ = writer.IngestBatch(points)
		if logger != nil {
			minTs, maxTs := int64(0), int64(0)
			if len(points) > 0 {
				minTs = points[0].TsEpoch
				maxTs = points[0].TsEpoch
				for i := 1; i < len(points); i++ {
					if points[i].TsEpoch < minTs {
						minTs = points[i].TsEpoch
					}
					if points[i].TsEpoch > maxTs {
						maxTs = points[i].TsEpoch
					}
				}
			}
			logger.AddIngest("info", "udp batch ingested", map[string]any{
				"packetBytes": n,
				"points":      len(points),
				"minTs":       minTs,
				"maxTs":       maxTs,
			})
		}
	}
}
