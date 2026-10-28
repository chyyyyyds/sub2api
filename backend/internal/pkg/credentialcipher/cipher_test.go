package credentialcipher

import (
	"bytes"
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestStage7R2ECredentialEnvelope(t *testing.T) {
	oldKey, newKey := bytes.Repeat([]byte{1}, 32), bytes.Repeat([]byte{2}, 32)
	c, err := New("old", map[string][]byte{"old": oldKey})
	require.NoError(t, err)
	credentials := map[string]any{"api_key": "fixture-only-not-a-real-key", "base_url": "https://example.invalid"}
	a, err := c.Encrypt(7, credentials)
	require.NoError(t, err)
	b, err := c.Encrypt(7, credentials)
	require.NoError(t, err)
	require.NotEqual(t, a.Nonce, b.Nonce)
	raw, err := json.Marshal(a)
	require.NoError(t, err)
	require.NotContains(t, string(raw), credentials["api_key"])
	got, err := c.Decrypt(7, a)
	require.NoError(t, err)
	require.Equal(t, credentials, got)
	for _, tc := range []struct {
		name   string
		mutate func(*Envelope)
		id     int64
	}{
		{"跨账号", func(e *Envelope) {}, 8},
		{"版本", func(e *Envelope) { e.Version = 2 }, 7},
		{"密钥丢失", func(e *Envelope) { e.KeyID = "missing" }, 7},
		{"随机值损坏", func(e *Envelope) { e.Nonce = "!" }, 7},
		{"密文篡改", func(e *Envelope) { e.Ciphertext = "AAAA" }, 7},
	} {
		t.Run(tc.name, func(t *testing.T) {
			v := *a
			tc.mutate(&v)
			got, err := c.Decrypt(tc.id, &v)
			require.ErrorIs(t, err, ErrEnvelope)
			require.Nil(t, got)
		})
	}
	// 轮换先保留旧读密钥，再用新密钥重封装；缺少密钥的备份不能恢复。
	rotated, err := New("new", map[string][]byte{"old": oldKey, "new": newKey})
	require.NoError(t, err)
	got, err = rotated.Decrypt(7, a)
	require.NoError(t, err)
	next, err := rotated.Encrypt(7, got)
	require.NoError(t, err)
	require.Equal(t, "new", next.KeyID)
	_, err = c.Decrypt(7, next)
	require.ErrorIs(t, err, ErrEnvelope)
	_, err = New("missing", map[string][]byte{})
	require.Error(t, err)
	_, err = New("bad", map[string][]byte{"bad": []byte("short")})
	require.Error(t, err)
}
