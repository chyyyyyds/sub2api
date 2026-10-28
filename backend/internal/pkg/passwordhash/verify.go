// Package passwordhash 统一校验现有 bcrypt 密码与从旧站迁入的 Argon2id 密码。
package passwordhash

import (
	"crypto/subtle"
	"encoding/base64"
	"strings"

	"golang.org/x/crypto/argon2"
	"golang.org/x/crypto/bcrypt"
)

// Verify 校验原密码，不改写哈希，也不裁剪或归一化用户输入的密码。
func Verify(password, encoded string) bool {
	if !strings.HasPrefix(encoded, "$argon2id$") {
		return bcrypt.CompareHashAndPassword([]byte(encoded), []byte(password)) == nil
	}

	// 仅接受旧 newapi 实际生成的固定参数，防止损坏数据触发超量内存分配。
	if len(password) > 512 || len(encoded) > 256 {
		return false
	}
	parts := strings.Split(encoded, "$")
	if len(parts) != 6 || parts[0] != "" || parts[1] != "argon2id" ||
		parts[2] != "v=19" || parts[3] != "m=19456,t=2,p=1" {
		return false
	}
	salt, err := base64.RawStdEncoding.Strict().DecodeString(parts[4])
	if err != nil || len(salt) != 16 {
		return false
	}
	expected, err := base64.RawStdEncoding.Strict().DecodeString(parts[5])
	if err != nil || len(expected) != 32 {
		return false
	}
	actual := argon2.IDKey([]byte(password), salt, 2, 19*1024, 1, 32)
	return subtle.ConstantTimeCompare(actual, expected) == 1
}
