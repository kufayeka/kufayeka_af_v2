package main

import (
	"fmt"
	"math"
	"net"
	"os"
	"strconv"
	"time"

	"historian_v3/pkg/historian"
)

const threeDaysSeconds = 3 * 24 * 60 * 60

func toEpoch(ms int64, unit string) int64 {
	if unit == "ns" {
		return ms * 1_000_000
	}
	return ms * 1_000
}

func main() {
	cfg, err := historian.LoadConfig("historian.config.json")
	if err != nil {
		panic(err)
	}
	secondsPerPacket := 600
	intervalMs := 0
	if len(os.Args) > 1 {
		if n, err := strconv.Atoi(os.Args[1]); err == nil && n > 0 {
			secondsPerPacket = n
		}
	}
	if len(os.Args) > 2 {
		if n, err := strconv.Atoi(os.Args[2]); err == nil && n >= 0 {
			intervalMs = n
		}
	}
	nowMs := time.Now().UTC().UnixMilli()
	startMs := nowMs - int64(threeDaysSeconds*1000)
	step := toEpoch(1000, cfg.Storage.TimestampUnit)
	startTs := toEpoch(startMs, cfg.Storage.TimestampUnit)
	addr, _ := net.ResolveUDPAddr("udp", fmt.Sprintf("%s:%d", cfg.UDP.Host, cfg.UDP.Port))
	conn, err := net.DialUDP("udp", nil, addr)
	if err != nil {
		panic(err)
	}
	defer conn.Close()

	fmt.Printf("sending 3-day per-second data: %s -> %s\n", time.UnixMilli(startMs).UTC(), time.UnixMilli(nowMs).UTC())
	sent := 0
	for sec := 0; sec < threeDaysSeconds; sec += secondsPerPacket {
		until := sec + secondsPerPacket
		if until > threeDaysSeconds {
			until = threeDaysSeconds
		}
		points := make([]historian.Point, 0, (until-sec)*3)
		for s := sec; s < until; s++ {
			ts := startTs + int64(s)*step
			points = append(points,
				historian.Point{TagID: 1, TsEpoch: ts, TypeCode: historian.TypeInt32, Value: float64((s % 2000) - 1000)},
				historian.Point{TagID: 2, TsEpoch: ts, TypeCode: historian.TypeFloat32, Value: math.Sin(float64(s)/25.0) * 100},
				historian.Point{TagID: 3, TsEpoch: ts, TypeCode: historian.TypeString, Value: fmt.Sprintf("state-%d", s%5)},
			)
		}
		payload := historian.EncodeUDPBatch(points)
		_, _ = conn.Write(payload)
		sent += len(points)
		if intervalMs > 0 {
			time.Sleep(time.Duration(intervalMs) * time.Millisecond)
		}
	}
	fmt.Printf("finished sending %d points\n", sent)
}
