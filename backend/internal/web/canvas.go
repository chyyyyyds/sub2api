//go:build embed || unit

package web

import (
	"bytes"
	"io/fs"
	"net/http"
	"strings"

	"github.com/Wei-Shaw/sub2api/internal/server/middleware"
	"github.com/gin-gonic/gin"
)

// serveCanvas 将固定构建的画布与主站 HTML 分开，缺失资源不回退成 Vue 页面。
func serveCanvas(c *gin.Context, assets fs.FS) bool {
	path := c.Request.URL.Path
	if path != "/canvas" && !strings.HasPrefix(path, "/canvas/") {
		return false
	}
	if c.Request.Method != http.MethodGet && c.Request.Method != http.MethodHead {
		c.AbortWithStatus(http.StatusMethodNotAllowed)
		return true
	}
	if path == "/canvas" || path == "/canvas/" || path == "/canvas/image" || path == "/canvas/index.html" || path == "/canvas/assets" || path == "/canvas/canvas" || strings.HasPrefix(path, "/canvas/canvas/") {
		body, err := fs.ReadFile(assets, "canvas/index.html")
		if err != nil {
			c.AbortWithStatus(http.StatusNotFound)
			return true
		}
		nonce := middleware.GetNonceFromContext(c)
		if nonce == "" {
			nonce, err = middleware.GenerateNonce()
			if err != nil {
				c.AbortWithStatus(http.StatusInternalServerError)
				return true
			}
		}
		// 例外只作用于画布 HTML；主站与后台继续使用原有禁止嵌入策略。
		c.Header("X-Frame-Options", "SAMEORIGIN")
		c.Header("Content-Security-Policy", "default-src 'self'; script-src 'self' 'nonce-"+nonce+"'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self' https: data: blob:; media-src 'self' blob: data:; worker-src 'self' blob:; frame-ancestors 'self'; object-src 'none'; base-uri 'self'; form-action 'none'")
		c.Header("Cache-Control", "no-store")
		c.Header("Referrer-Policy", "no-referrer")
		body = bytes.ReplaceAll(body, []byte("<script>"), []byte("<script nonce=\""+nonce+"\">"))
		c.Data(http.StatusOK, "text/html; charset=utf-8", body)
		c.Abort()
		return true
	}
	name := strings.TrimPrefix(path, "/")
	if !fs.ValidPath(name) {
		c.AbortWithStatus(http.StatusNotFound)
		return true
	}
	info, err := fs.Stat(assets, name)
	if err != nil || info.IsDir() {
		c.AbortWithStatus(http.StatusNotFound)
		return true
	}
	applyStaticAssetCacheHeaders(c.Writer.Header(), strings.TrimPrefix(name, "canvas/"))
	http.FileServer(http.FS(assets)).ServeHTTP(c.Writer, c.Request)
	c.Abort()
	return true
}
