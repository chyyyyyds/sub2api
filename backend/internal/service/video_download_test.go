package service

import (
	"context"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

type kokoDownloadRepo struct {
	VideoRepository
	record *VideoTaskRecord
}

func (r kokoDownloadRepo) Get(context.Context, string, int64, int64, int64) (*VideoTask, error) {
	return &VideoTask{ID: "vtsk_mock", Status: "COMPLETED", DownloadState: "AVAILABLE"}, nil
}
func (r kokoDownloadRepo) Record(context.Context, string) (*VideoTaskRecord, error) {
	return r.record, nil
}
func TestKokoDownloadRedirectAndHeaderIsolation(t *testing.T) {
	for _, method := range []string{"GET", "HEAD"} {
		t.Run(method, func(t *testing.T) {
			a := kokoTestAccount()
			p := NewKokoVideoProvider()
			p.Client.Transport = kokoTestTransport(func(req *http.Request) (*http.Response, error) {
				body := `{"user":{"id":"mock-subject","status":"active"},"balance":100,"currency":"points"}`
				if strings.Contains(req.URL.Path, "/videos/") {
					body = `{"id":"original","status":"completed","video_url":"https://pay.kokoai.online/signed/file?signature=mock"}`
				}
				return &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(body))}, nil
			})
			s := &VideoService{Accounts: kokoWorkerAccounts{account: a}, Provider: p, secret: []byte("mock"), now: time.Now}
			s.Repo = kokoDownloadRepo{record: &VideoTaskRecord{AccountID: a.ID, Scope: s.scope("mock-subject"), UpstreamID: "original"}}
			requests := 0
			s.contentClient = &http.Client{Transport: kokoTestTransport(func(req *http.Request) (*http.Response, error) {
				requests++
				require.Equal(t, method, req.Method)
				for _, header := range []string{"Authorization", "Cookie", "X-Api-Key", "Referer"} {
					require.Empty(t, req.Header.Get(header))
				}
				require.Equal(t, "bytes=0-3", req.Header.Get("Range"))
				require.Equal(t, `"mock-etag"`, req.Header.Get("If-Range"))
				if requests == 1 {
					return &http.Response{StatusCode: 307, Header: http.Header{"Location": []string{"https://cdn.dola.com/video.mp4?temporary=mock"}}, Body: io.NopCloser(strings.NewReader("redirect")), Request: req}, nil
				}
				return &http.Response{StatusCode: 206, Header: http.Header{"Content-Type": []string{"video/mp4"}, "Content-Range": []string{"bytes 0-3/20"}}, Body: io.NopCloser(strings.NewReader("MP4!")), Request: req}, nil
			}), CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
			result, e := s.OpenContent(context.Background(), "vtsk_mock", 1, 2, 3, method, "bytes=0-3", `"mock-etag"`)
			require.NoError(t, e)
			defer result.Body.Close()
			require.Equal(t, 2, requests)
			require.Equal(t, 206, result.StatusCode)
		})
	}
}
