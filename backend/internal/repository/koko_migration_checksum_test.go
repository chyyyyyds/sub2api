package repository

import (
	"crypto/sha256"
	"encoding/hex"
	"github.com/Wei-Shaw/sub2api/migrations"
	"github.com/stretchr/testify/require"
	"io/fs"
	"strings"
	"testing"
)

// 只兼容两份既定 SQL 的换行差异；内容改动或其他文件仍严格拒绝。
func TestKokoMigrationLineEndingCompatibility(t *testing.T) {
	digest := func(s string) string {
		sum := sha256.Sum256([]byte(strings.TrimSpace(s)))
		return hex.EncodeToString(sum[:])
	}
	for _, name := range []string{"248_koko_video_tasks.sql", "249_koko_video_group_gate.sql"} {
		t.Run(name, func(t *testing.T) {
			content, err := fs.ReadFile(migrations.FS, name)
			require.NoError(t, err)
			lf := string(content)
			require.NotContains(t, lf, "\r")
			lfs, crlfs := digest(lf), digest(strings.ReplaceAll(lf, "\n", "\r\n"))
			require.Equal(t, lfs, migrationChecksumCompatibilityRules[name].fileChecksum)
			require.True(t, isMigrationChecksumCompatible(name, crlfs, lfs))
			require.True(t, isMigrationChecksumCompatible(name, lfs, crlfs))
			require.False(t, isMigrationChecksumCompatible(name, crlfs, digest(lf+"\n-- unexpected edit")))
			require.False(t, isMigrationChecksumCompatible("another.sql", crlfs, lfs))
		})
	}
}
