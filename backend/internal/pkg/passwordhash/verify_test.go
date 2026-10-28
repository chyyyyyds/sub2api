package passwordhash

import (
	"encoding/base64"
	"fmt"
	"strings"
	"testing"

	"golang.org/x/crypto/argon2"
	"golang.org/x/crypto/bcrypt"
)

func legacyHash(password string) string {
	salt := []byte("migration-fixtur")
	key := argon2.IDKey([]byte(password), salt, 2, 19*1024, 1, 32)
	return fmt.Sprintf("$argon2id$v=19$m=19456,t=2,p=1$%s$%s",
		base64.RawStdEncoding.EncodeToString(salt), base64.RawStdEncoding.EncodeToString(key))
}

func TestVerifyLegacyArgon2AndBcrypt(t *testing.T) {
	for _, password := range []string{"旧密码Abc123", "  密码保留空格  ", strings.Repeat("长", 128)} {
		hash := legacyHash(password)
		if !Verify(password, hash) {
			t.Fatal("原 Argon2id 密码应保持可用")
		}
		if Verify(password+"错误", hash) {
			t.Fatal("错误密码不能通过")
		}
	}
	hash, err := bcrypt.GenerateFromPassword([]byte("existing-password"), bcrypt.MinCost)
	if err != nil || !Verify("existing-password", string(hash)) || Verify("wrong", string(hash)) {
		t.Fatal("原 bcrypt 账号的密码校验必须保持一致")
	}
}

func TestVerifyRejectsMalformedAndUnboundedArgon2(t *testing.T) {
	hash := legacyHash("test-password")
	for _, invalid := range []string{
		strings.Replace(hash, "m=19456", "m=999999999", 1),
		strings.Replace(hash, "v=19", "v=16", 1),
		strings.Replace(hash, "t=2,p=1", "t=2,p=2", 1),
		"$argon2id$v=19$m=19456,t=2,p=1$invalid$invalid",
		hash + "$extra",
		strings.Repeat("x", 257), "",
	} {
		if Verify("test-password", invalid) {
			t.Fatal("格式或参数错误的哈希必须拒绝")
		}
	}
	if Verify(strings.Repeat("x", 513), hash) {
		t.Fatal("过长密码必须在计算 Argon2id 前拒绝")
	}
}
