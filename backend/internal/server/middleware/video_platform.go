package middleware

import (
	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/gin-gonic/gin"
	"net/http"
	"strings"
)

// VideoPlatformBoundary 将视频 Key 限制在视频接口，防止进入聊天、图片和其他平台调度。
func VideoPlatformBoundary() gin.HandlerFunc {
	return func(c *gin.Context) {
		key, ok := GetAPIKeyFromContext(c)
		if !ok || key == nil || key.Group == nil || key.Group.Platform != service.PlatformVideo {
			c.Next()
			return
		}
		path := c.Request.URL.Path
		read := c.Request.Method == http.MethodGet || c.Request.Method == http.MethodHead
		allowed := read && (path == "/v1/models" || path == "/v1/video-models" || path == "/v1/video-quote" || path == "/v1/sub2api/billing" || path == "/v1/usage" || path == "/v1/videos" || strings.HasPrefix(path, "/v1/videos/vtsk_") || strings.HasPrefix(path, "/videos/vtsk_"))
		allowed = allowed || (c.Request.Method == http.MethodPost && (path == "/v1/videos" || path == "/videos"))
		if !allowed {
			c.AbortWithStatusJSON(http.StatusNotFound, gin.H{"error": gin.H{"code": "VIDEO_PLATFORM_ENDPOINT_REQUIRED", "message": "视频创作 Key 仅支持视频生成、查询和下载接口"}})
			return
		}
		c.Next()
	}
}
