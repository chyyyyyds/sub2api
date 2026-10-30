package middleware

import (
	"github.com/Wei-Shaw/sub2api/internal/config"
	"github.com/stretchr/testify/require"
	"strings"
	"testing"
)

func TestVideoMediaCSPAllowsOnlyLocalPreviewSources(t *testing.T) {
	for _, policy := range []string{config.DefaultCSPPolicy, "default-src 'self'; script-src 'self' __CSP_NONCE__", "default-src 'self'; media-src 'self'"} {
		result := enhanceCSPPolicy(policy)
		require.True(t, directiveHasValue(result, "media-src", "'self'"))
		require.True(t, directiveHasValue(result, "media-src", "blob:"))
		for _, directive := range strings.Split(result, ";") {
			fields := strings.Fields(directive)
			if len(fields) > 0 && fields[0] == "media-src" {
				require.ElementsMatch(t, []string{"media-src", "'self'", "blob:"}, fields)
			}
		}
		require.True(t, directiveHasValue(result, "default-src", "'self'"))
	}
}
