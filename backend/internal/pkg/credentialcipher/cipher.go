// Package credentialcipher 提供待接入的凭据封装；当前账号仓储与调度缓存尚未启用。
package credentialcipher

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
)

var ErrEnvelope = errors.New("凭据密文无效或密钥不可用")

// Envelope 为版本化密文，密钥材料不进入此结构。
type Envelope struct {
	// Version 为格式版本，只接受 1。
	Version int `json:"version" example:"1"`
	// KeyID 为外部密钥环标识，供轮换时双密钥读取。
	KeyID string `json:"key_id" example:"stage7-v1"`
	// Nonce 为每次加密独立生成的随机值。
	Nonce string `json:"nonce"`
	// Ciphertext 含 GCM 认证标签，不包含明文。
	Ciphertext string `json:"ciphertext"`
}

// Cipher 只在内存保存外部提供的密钥，不从数据库读取主密钥。
type Cipher struct {
	active string
	keys   map[string]cipher.AEAD
}

func New(active string, keys map[string][]byte) (*Cipher, error) {
	c := &Cipher{active: active, keys: map[string]cipher.AEAD{}}
	for id, key := range keys {
		if id == "" || len(key) != 32 {
			return nil, ErrEnvelope
		}
		block, err := aes.NewCipher(key)
		if err != nil {
			return nil, ErrEnvelope
		}
		aead, err := cipher.NewGCM(block)
		if err != nil {
			return nil, ErrEnvelope
		}
		c.keys[id] = aead
	}
	if c.keys[active] == nil {
		return nil, ErrEnvelope
	}
	return c, nil
}

func aad(accountID int64, keyID string) []byte {
	return []byte(fmt.Sprintf("sub2api:account-credentials:v1:%d:%s", accountID, keyID))
}

// Encrypt 必须使用已确定的账号 ID 绑定密文，禁止交换账号间的凭据。
func (c *Cipher) Encrypt(accountID int64, credentials map[string]any) (*Envelope, error) {
	if c == nil || c.keys[c.active] == nil || accountID <= 0 {
		return nil, ErrEnvelope
	}
	plain, err := json.Marshal(credentials)
	if err != nil {
		return nil, ErrEnvelope
	}
	defer func() {
		for i := range plain {
			plain[i] = 0
		}
	}()
	aead := c.keys[c.active]
	nonce := make([]byte, aead.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return nil, ErrEnvelope
	}
	sealed := aead.Seal(nil, nonce, plain, aad(accountID, c.active))
	return &Envelope{Version: 1, KeyID: c.active, Nonce: base64.StdEncoding.EncodeToString(nonce), Ciphertext: base64.StdEncoding.EncodeToString(sealed)}, nil
}

// Decrypt 不对错误密文回落明文，也不以空凭据继续调度。
func (c *Cipher) Decrypt(accountID int64, e *Envelope) (map[string]any, error) {
	if c == nil || e == nil || e.Version != 1 || accountID <= 0 {
		return nil, ErrEnvelope
	}
	aead := c.keys[e.KeyID]
	if aead == nil {
		return nil, ErrEnvelope
	}
	nonce, err := base64.StdEncoding.DecodeString(e.Nonce)
	if err != nil || len(nonce) != aead.NonceSize() {
		return nil, ErrEnvelope
	}
	sealed, err := base64.StdEncoding.DecodeString(e.Ciphertext)
	if err != nil {
		return nil, ErrEnvelope
	}
	plain, err := aead.Open(nil, nonce, sealed, aad(accountID, e.KeyID))
	if err != nil {
		return nil, ErrEnvelope
	}
	defer func() {
		for i := range plain {
			plain[i] = 0
		}
	}()
	var credentials map[string]any
	if json.Unmarshal(plain, &credentials) != nil || credentials == nil {
		return nil, ErrEnvelope
	}
	return credentials, nil
}
