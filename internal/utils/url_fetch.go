package utils

import (
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const (
	// DefaultFetchTimeout is the default HTTP client timeout for URL fetch (large files / slow CDN)
	DefaultFetchTimeout = 5 * 60 * time.Second
	// DefaultMaxFetchSize is the default max body size (100MB), same as upload limit
	DefaultMaxFetchSize = 100 * 1024 * 1024
)

// 常见站点会屏蔽非浏览器 UA，使用常见浏览器标识以提高从 GitHub/ModelScope/镜像 拉取成功率
const fetchUserAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

// FetchURLToFile fetches content from a URL and saves it to destPath.
// Only http/https URLs are allowed. Response body is limited to maxBytes.
// Follows redirects; accepts any 2xx status (e.g. 200, 206).
func FetchURLToFile(rawURL string, destPath string, maxBytes int64) (written int64, err error) {
	u, err := url.Parse(rawURL)
	if err != nil {
		return 0, fmt.Errorf("invalid URL: %w", err)
	}
	switch strings.ToLower(u.Scheme) {
	case "http", "https":
	default:
		return 0, fmt.Errorf("only http and https URLs are allowed")
	}

	client := &http.Client{
		Timeout: DefaultFetchTimeout,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 10 {
				return fmt.Errorf("too many redirects")
			}
			req.Header.Set("User-Agent", fetchUserAgent)
			return nil
		},
	}
	req, err := http.NewRequest(http.MethodGet, rawURL, nil)
	if err != nil {
		return 0, err
	}
	req.Header.Set("User-Agent", fetchUserAgent)
	req.Header.Set("Accept", "text/csv, text/plain, application/octet-stream, */*")

	resp, err := client.Do(req)
	if err != nil {
		return 0, fmt.Errorf("fetch failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return 0, fmt.Errorf("HTTP %d: %s", resp.StatusCode, resp.Status)
	}

	if err := EnsureDir(filepath.Dir(destPath)); err != nil {
		return 0, err
	}
	f, err := os.Create(destPath)
	if err != nil {
		return 0, fmt.Errorf("failed to create file: %w", err)
	}
	defer f.Close()

	limited := io.LimitReader(resp.Body, maxBytes)
	n, err := io.Copy(f, limited)
	if err != nil {
		os.Remove(destPath)
		return 0, err
	}
	return n, nil
}
