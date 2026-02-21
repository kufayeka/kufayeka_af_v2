package historian

import (
	"strconv"
	"strings"
)

func atoi(s string) int {
	n, _ := strconv.Atoi(s)
	return n
}

func itoa(n int) string { return strconv.Itoa(n) }

func split3(s string) [3]string {
	parts := strings.SplitN(s, "/", 3)
	var out [3]string
	for i := 0; i < 3 && i < len(parts); i++ {
		out[i] = parts[i]
	}
	return out
}
