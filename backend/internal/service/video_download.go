package service

import (
	"bufio"
	"context"
	"errors"
	"io"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"strings"
	"time"
)

type videoReadCloser struct {
	io.Reader
	io.Closer
}

var newVideoContentHTTPClient = NewVideoSafeClient

func validateVideoPublicHost(ctx context.Context, host string) error {
	ips, e := net.DefaultResolver.LookupNetIP(ctx, "ip", host)
	if e != nil || len(ips) == 0 {
		return errors.New("VIDEO_DNS_FAILED")
	}
	for _, ip := range ips {
		if !publicVideoIP(ip) {
			return errors.New("VIDEO_PRIVATE_HOST_BLOCKED")
		}
	}
	return nil
}

// NewVideoSafeClient 固定本次实际连接的公共 IP，防止校验后 DNS 重绑定。
func NewVideoSafeClient() *http.Client {
	transport := &http.Transport{ResponseHeaderTimeout: 10 * time.Minute, TLSHandshakeTimeout: 15 * time.Second, IdleConnTimeout: 90 * time.Second, DisableCompression: true}
	transport.DialContext = func(ctx context.Context, network, address string) (net.Conn, error) {
		host, port, e := net.SplitHostPort(address)
		if e != nil {
			return nil, e
		}
		ips, e := net.DefaultResolver.LookupNetIP(ctx, "ip", host)
		if e != nil {
			return nil, errors.New("VIDEO_DNS_FAILED")
		}
		if len(ips) == 0 {
			return nil, errors.New("VIDEO_DNS_EMPTY")
		}
		for _, ip := range ips {
			if !publicVideoIP(ip) {
				return nil, errors.New("VIDEO_PRIVATE_HOST_BLOCKED")
			}
		}
		dialer := net.Dialer{Timeout: 15 * time.Second}
		// 地址均已校验为公网；依次尝试已固定的地址，避免首个 IPv6 不可达导致整次下载失败。
		for _, ip := range ips {
			conn, err := dialer.DialContext(ctx, network, net.JoinHostPort(ip.String(), port))
			if err == nil {
				return conn, nil
			}
			if ctx.Err() != nil {
				return nil, ctx.Err()
			}
		}
		return nil, errors.New("VIDEO_DIAL_FAILED")
	}
	return &http.Client{Transport: transport, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
}
func publicVideoIP(ip netip.Addr) bool {
	ip = ip.Unmap()
	if !ip.IsGlobalUnicast() || ip.IsPrivate() || ip.IsLoopback() || ip.IsLinkLocalUnicast() || ip.IsMulticast() {
		return false
	}
	for _, prefix := range []string{"100.64.0.0/10", "192.0.0.0/24", "192.0.2.0/24", "198.18.0.0/15", "198.51.100.0/24", "203.0.113.0/24", "240.0.0.0/4", "2001:db8::/32"} {
		if netip.MustParsePrefix(prefix).Contains(ip) {
			return false
		}
	}
	return true
}
func validVideoDownloadURL(u *url.URL) bool {
	if u == nil || u.Scheme != "https" || u.User != nil || u.Fragment != "" || (u.Port() != "" && u.Port() != "443") {
		return false
	}
	host := strings.ToLower(u.Hostname())
	return host == "pay.kokoai.online" || strings.HasSuffix(host, ".dola.com") || strings.HasSuffix(host, ".douyinvod.com")
}

// OpenContent 每次下载重查原任务；不落盘，不缓存整片，不转发任何客户端凭据。
func (s *VideoService) OpenContent(ctx context.Context, id string, user, key, group int64, method, rangeHeader, ifRange string) (*http.Response, error) {
	view, e := s.Repo.Get(ctx, id, user, key, group)
	if e != nil {
		return nil, e
	}
	if view.Status != "COMPLETED" {
		return nil, errors.New("VIDEO_NOT_READY")
	}
	if view.DownloadState == "EXPIRED" || (view.ExpiresAt != nil && view.ExpiresAt.Before(s.now())) {
		return nil, errors.New("VIDEO_EXPIRED")
	}
	task, e := s.Repo.Record(ctx, id)
	if e != nil {
		return nil, e
	}
	account, e := s.Accounts.GetByID(ctx, task.AccountID)
	if e != nil {
		return nil, errors.New("VIDEO_ORIGINAL_ACCOUNT_UNAVAILABLE")
	}
	identity, e := s.Provider.Account(ctx, account)
	if e != nil || s.scope(identity.ScopeIdentity) != task.Scope {
		return nil, errors.New("VIDEO_ACCOUNT_IDENTITY_REVIEW")
	}
	result, e := s.Provider.Query(ctx, account, task.UpstreamID)
	if e != nil {
		return nil, e
	}
	if result.Status != "completed" {
		return nil, errors.New("VIDEO_DOWNLOAD_UNAVAILABLE")
	}
	target, e := url.Parse(result.VideoURL)
	if e != nil || !validVideoDownloadURL(target) {
		return nil, errors.New("VIDEO_DOWNLOAD_HOST_BLOCKED")
	}
	client := s.contentClient
	if client == nil {
		client = NewVideoSafeClient()
	}
	seen := map[string]bool{}
	for hop := 0; hop <= 5; hop++ {
		if !validVideoDownloadURL(target) || seen[target.String()] {
			return nil, errors.New("VIDEO_DOWNLOAD_REDIRECT_BLOCKED")
		}
		seen[target.String()] = true
		req, e := http.NewRequestWithContext(ctx, method, target.String(), nil)
		if e != nil {
			return nil, e
		}
		req.Header.Set("Accept-Encoding", "identity")
		// 全新请求仅复制内容头；即使同源签名入口也不添加 Bearer、Cookie、Referer。
		if rangeHeader != "" {
			req.Header.Set("Range", rangeHeader)
		}
		if ifRange != "" {
			req.Header.Set("If-Range", ifRange)
		}
		var res *http.Response
		if account.ProxyID != nil {
			res, e = s.Provider.proxyRequest(req, account)
		} else {
			res, e = client.Do(req)
		}
		if e != nil {
			return nil, errors.New("VIDEO_DOWNLOAD_TRANSPORT_ERROR")
		}
		if res.StatusCode >= 300 && res.StatusCode < 400 {
			location, e := res.Location()
			res.Body.Close()
			if e != nil {
				return nil, errors.New("VIDEO_DOWNLOAD_REDIRECT_INVALID")
			}
			target = location
			continue
		}
		if res.StatusCode == 416 {
			return res, nil
		}
		if res.StatusCode != 200 && res.StatusCode != 206 {
			res.Body.Close()
			return nil, errors.New("VIDEO_DOWNLOAD_TEMP_UNAVAILABLE")
		}
		if encoding := res.Header.Get("Content-Encoding"); encoding != "" && encoding != "identity" {
			res.Body.Close()
			return nil, errors.New("VIDEO_DOWNLOAD_ENCODING_UNSUPPORTED")
		}
		contentType := strings.ToLower(strings.Split(res.Header.Get("Content-Type"), ";")[0])
		if !strings.HasPrefix(contentType, "video/") && contentType != "application/octet-stream" && contentType != "binary/octet-stream" {
			res.Body.Close()
			return nil, errors.New("VIDEO_DOWNLOAD_NOT_MEDIA")
		}
		if method != http.MethodHead && (rangeHeader == "" || strings.HasPrefix(rangeHeader, "bytes=0-")) {
			// 只检查固定小前缀并回放，防止 JSON/HTML 错误伪装成二进制视频。
			reader := bufio.NewReaderSize(res.Body, 512)
			prefix, _ := reader.Peek(512)
			head := strings.ToLower(strings.TrimSpace(string(prefix)))
			if strings.HasPrefix(head, "{") || strings.HasPrefix(head, "[") || strings.HasPrefix(head, "<!doctype") || strings.HasPrefix(head, "<html") {
				res.Body.Close()
				return nil, errors.New("VIDEO_DOWNLOAD_NOT_MEDIA")
			}
			res.Body = videoReadCloser{Reader: reader, Closer: res.Body}
		}
		return res, nil
	}
	return nil, errors.New("VIDEO_DOWNLOAD_TOO_MANY_REDIRECTS")
}

// StreamVideoContent 保留 Range/HEAD 语义，仅向浏览器输出允许的内容响应头。
func StreamVideoContent(w http.ResponseWriter, res *http.Response, id, method string) error {
	defer res.Body.Close()
	for _, name := range []string{"Content-Type", "Content-Length", "Content-Range", "Accept-Ranges", "ETag", "Last-Modified"} {
		if v := res.Header.Get(name); v != "" {
			w.Header().Set(name, v)
		}
	}
	w.Header().Set("Cache-Control", "private, no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("Content-Disposition", `attachment; filename="`+id+`.mp4"`)
	w.WriteHeader(res.StatusCode)
	if method == http.MethodHead {
		return nil
	}
	_, e := io.Copy(w, res.Body)
	return e
}
