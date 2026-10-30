package service

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/Wei-Shaw/sub2api/internal/pkg/credentialcipher"
	"github.com/stretchr/testify/require"
)

type kokoWorkerAccounts struct {
	AccountRepository
	account *Account
}

func (a kokoWorkerAccounts) GetByID(context.Context, int64) (*Account, error) { return a.account, nil }

type kokoWorkerRepo struct {
	VideoRepository
	result   *KokoTaskResult
	code     string
	rejected bool
}

func (r *kokoWorkerRepo) Observe(_ context.Context, _ *VideoTaskRecord, result *KokoTaskResult, code string, rejected bool, _ time.Time) error {
	r.result = result
	r.code = code
	r.rejected = rejected
	return nil
}
func TestKokoWorkerRecoveryNeverResubmitsUnknown(t *testing.T) {
	for _, epoch := range []int64{1, 2} {
		t.Run(string(rune('0'+epoch)), func(t *testing.T) {
			repo := &kokoWorkerRepo{}
			account := kokoTestAccount()
			account.Status = StatusDisabled
			key := sha256.Sum256([]byte("mock-only-encryption"))
			cipher, e := credentialcipher.New("mock", map[string][]byte{"mock": key[:]})
			require.NoError(t, e)
			p := NewKokoVideoProvider()
			posts := 0
			p.Client.Transport = kokoTestTransport(func(req *http.Request) (*http.Response, error) {
				body := `{"user":{"id":"mock-subject","status":"active"},"balance":100,"currency":"points"}`
				if req.Method == "POST" {
					posts++
					body = `{"id":"mock_upstream","status":"running"}`
				}
				return &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(body))}, nil
			})
			s := &VideoService{Repo: repo, Accounts: kokoWorkerAccounts{account: account}, Provider: p, cipher: cipher, secret: key[:], now: time.Now}
			envelope, e := cipher.Encrypt(account.ID, map[string]any{"request": VideoCreateRequest{Model: "mock"}})
			require.NoError(t, e)
			raw, _ := json.Marshal(envelope)
			task := &VideoTaskRecord{AccountID: account.ID, Status: "SUBMITTING", LeaseEpoch: epoch, Scope: s.scope("mock-subject"), PublicID: "vtsk_mock", Ciphertext: raw}
			s.process(context.Background(), task)
			if epoch == 1 {
				require.Equal(t, 1, posts)
				require.NotNil(t, repo.result)
			} else {
				require.Zero(t, posts)
				require.Nil(t, repo.result)
				require.False(t, repo.rejected)
			}
		})
	}
}
func TestKokoWorkerDisabledAccountStillQueriesOriginal(t *testing.T) {
	repo := &kokoWorkerRepo{}
	account := kokoTestAccount()
	account.Status = StatusDisabled
	p := NewKokoVideoProvider()
	queries := 0
	p.Client.Transport = kokoTestTransport(func(req *http.Request) (*http.Response, error) {
		require.Equal(t, http.MethodGet, req.Method)
		body := `{"user":{"id":"mock-subject","status":"active"},"balance":100,"currency":"points"}`
		if strings.Contains(req.URL.Path, "/videos/") {
			queries++
			require.True(t, strings.HasSuffix(req.URL.Path, "/original_task"))
			body = `{"id":"original_task","status":"failed"}`
		}
		return &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(body))}, nil
	})
	s := &VideoService{Repo: repo, Accounts: kokoWorkerAccounts{account: account}, Provider: p, secret: []byte("mock-secret"), now: time.Now}
	s.process(context.Background(), &VideoTaskRecord{AccountID: account.ID, Status: "RUNNING", LeaseEpoch: 9, Scope: s.scope("mock-subject"), UpstreamID: "original_task"})
	require.Equal(t, 1, queries)
	require.Equal(t, "failed", repo.result.Status)
}

// 首次提交前的只读失败有明确未发送证据；已有或未知提交仍必须保留冻结。
func TestKokoWorkerPreSubmitFailureOnlyReleasesUnsentTask(t *testing.T) {
	for _, tc := range []struct {
		status, id string
		epoch      int64
		rejected   bool
	}{{"SUBMITTING", "", 1, true}, {"SUBMISSION_UNKNOWN", "", 2, false}, {"RUNNING", "original", 3, false}} {
		t.Run(tc.status, func(t *testing.T) {
			repo := &kokoWorkerRepo{}
			p := NewKokoVideoProvider()
			posts := 0
			p.Client.Transport = kokoTestTransport(func(req *http.Request) (*http.Response, error) {
				if req.Method == "POST" {
					posts++
				}
				return &http.Response{StatusCode: 401, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(`{"error":"unauthorized"}`))}, nil
			})
			s := &VideoService{Repo: repo, Accounts: kokoWorkerAccounts{account: kokoTestAccount()}, Provider: p, secret: []byte("mock-secret"), now: time.Now}
			s.process(context.Background(), &VideoTaskRecord{AccountID: 1, Status: tc.status, UpstreamID: tc.id, LeaseEpoch: tc.epoch})
			require.Zero(t, posts)
			require.Equal(t, tc.rejected, repo.rejected)
			require.Nil(t, repo.result)
		})
	}
}
