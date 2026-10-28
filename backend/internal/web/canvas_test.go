//go:build embed || unit

package web

import (
	"net/http/httptest"
	"testing"
	"testing/fstest"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func TestCanvasIndependentRoutes(t *testing.T) {
	assets := fstest.MapFS{
		"canvas/index.html":    {Data: []byte("<script>window.theme=1</script><div>canvas-only</div>")},
		"canvas/assets/app.js": {Data: []byte("const canvas = true")},
	}
	for _, tc := range []struct {
		path   string
		status int
	}{
		{"/canvas/image", 200}, {"/canvas/", 200}, {"/canvas/assets/app.js", 200},
		{"/canvas/assets/missing.js", 404}, {"/canvas/video", 404}, {"/canvas/config", 404},
	} {
		t.Run(tc.path, func(t *testing.T) {
			writer := httptest.NewRecorder()
			ctx, _ := gin.CreateTestContext(writer)
			ctx.Request = httptest.NewRequest("GET", tc.path, nil)
			require.True(t, serveCanvas(ctx, assets))
			require.Equal(t, tc.status, writer.Code)
			if tc.path == "/canvas/image" {
				require.Equal(t, "SAMEORIGIN", writer.Header().Get("X-Frame-Options"))
				require.Contains(t, writer.Header().Get("Content-Security-Policy"), "frame-ancestors 'self'")
				require.Contains(t, writer.Body.String(), "<script nonce=\"")
			}
		})
	}
}

func TestCanvasDoesNotHandleDashboard(t *testing.T) {
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	ctx.Request = httptest.NewRequest("GET", "/admin/dashboard", nil)
	require.False(t, serveCanvas(ctx, fstest.MapFS{}))
}
