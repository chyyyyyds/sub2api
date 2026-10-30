package middleware

import (
	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
	"net/http/httptest"
	"testing"
)

func TestVideoPlatformBoundary(t *testing.T) {
	gin.SetMode(gin.TestMode)
	for _, tc := range []struct {
		method, path, platform string
		want                   int
	}{
		{"POST", "/v1/videos", service.PlatformVideo, 200},
		{"GET", "/v1/video-models", service.PlatformVideo, 200},
		{"GET", "/v1/videos/vtsk_owned/content", service.PlatformVideo, 200},
		{"POST", "/v1/chat/completions", service.PlatformVideo, 404},
		{"POST", "/v1/messages", service.PlatformVideo, 404},
		{"POST", "/v1/images/generations", service.PlatformVideo, 404},
		{"POST", "/v1/chat/completions", service.PlatformOpenAI, 200},
	} {
		r := gin.New()
		r.Use(func(c *gin.Context) { c.Set("api_key", &service.APIKey{Group: &service.Group{Platform: tc.platform}}) })
		r.Use(VideoPlatformBoundary())
		r.Handle(tc.method, tc.path, func(c *gin.Context) { c.Status(200) })
		w := httptest.NewRecorder()
		r.ServeHTTP(w, httptest.NewRequest(tc.method, tc.path, nil))
		require.Equal(t, tc.want, w.Code, tc.path)
	}
}
