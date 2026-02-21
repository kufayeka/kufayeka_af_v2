package main

import (
	"fmt"
	"io"
	"net/http"
	"time"

	"historian_v3/pkg/historian"
)

func main() {
	cfg, err := historian.LoadConfig("historian.config.json")
	if err != nil {
		panic(err)
	}
	host := cfg.HTTP.Host
	if host == "0.0.0.0" {
		host = "127.0.0.1"
	}
	base := fmt.Sprintf("http://%s:%d", host, cfg.HTTP.Port)
	now := time.Now().UTC()
	from := now.Add(-time.Hour).Format(time.RFC3339)
	to := now.Format(time.RFC3339)
	urls := []string{
		base + "/hist/last?tagIds=1,2,3&time=iso",
		base + "/hist/raw?tagIds=1,2,3&from=" + from + "&to=" + to + "&order=desc&time=iso&limit=100",
		base + "/hist/range?tagIds=1,2,3&from=" + from + "&to=" + to + "&bucketMs=1000&agg=avg&order=desc&time=iso",
	}
	for _, u := range urls {
		resp, err := http.Get(u)
		if err != nil {
			fmt.Printf("\nGET %s\nERR %v\n", u, err)
			continue
		}
		body, _ := io.ReadAll(resp.Body)
		_ = resp.Body.Close()
		fmt.Printf("\nGET %s\n%s\n", u, string(body))
	}
}
