package handler

import (
	"github.com/Wei-Shaw/sub2api/internal/pkg/response"
	"github.com/Wei-Shaw/sub2api/internal/server/middleware"
	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/gin-gonic/gin"
)

// channelMonitorDisplayScope 仅供渠道状态页过滤展示，不参与模型调用授权。
type channelMonitorDisplayScope struct {
	// 当前用户已授权且被纳入监控的分组；空数组表示没有可展示分组。
	GroupIDs []int64 `json:"group_ids" example:"1,2"`
	// 已启用且当前用户分组可访问的平台及监控模型范围。
	Platforms []channelMonitorDisplayPlatform `json:"platforms"`
}

// channelMonitorDisplayPlatform 用户渠道状态页的平台展示范围。
type channelMonitorDisplayPlatform struct {
	// 平台标识。
	Platform string `json:"platform" example:"openai"`
	// 监控模型名称；空数组沿用监控配置中“全部模型”的含义。
	Models []string `json:"models" example:"gpt-6-sol"`
}

// DisplayScope 返回渠道状态页专用范围，保留其他目录及调用接口的既有语义。
// @Summary 获取当前用户渠道状态页的展示范围
// @Tags 用户渠道监控
// @Produce json
// @Success 200 {object} response.Response{data=channelMonitorDisplayScope} "当前用户授权与管理员监控配置的交集"
// @Failure 401 {object} response.Response "未登录"
// @Router /api/v1/channel-monitor-v2/display-scope [get]
func (h *ChannelMonitorV2Handler) DisplayScope(c *gin.Context) {
	subject, ok := middleware.GetAuthSubjectFromContext(c)
	if !ok || subject.UserID <= 0 {
		response.Unauthorized(c, "user not found in context")
		return
	}
	// 即使管理员访问用户页面，也必须按该用户的既有分组授权取交集。
	groups, err := h.apiKeyService.GetAvailableGroups(c.Request.Context(), subject.UserID)
	if err != nil {
		response.ErrorFrom(c, err)
		return
	}
	cfg, err := h.service.GetConfig(c.Request.Context())
	if err != nil {
		response.ErrorFrom(c, err)
		return
	}
	response.Success(c, buildChannelMonitorDisplayScope(*cfg, groups))
}

func buildChannelMonitorDisplayScope(cfg service.ChannelMonitorV2Config, groups []service.Group) channelMonitorDisplayScope {
	out := channelMonitorDisplayScope{GroupIDs: []int64{}, Platforms: []channelMonitorDisplayPlatform{}}
	if !cfg.Enabled {
		return out
	}
	selected := make(map[int64]bool, len(cfg.GroupIDs))
	for _, id := range cfg.GroupIDs {
		selected[id] = true
	}
	platforms := make(map[string]bool)
	for _, group := range groups {
		// 配置中的空分组范围表示全部已授权分组，不能解释为取消授权。
		if len(selected) == 0 || selected[group.ID] {
			out.GroupIDs = append(out.GroupIDs, group.ID)
			platforms[group.Platform] = true
		}
	}
	for _, platform := range cfg.Platforms {
		if platform.Enabled && (platforms[platform.Platform] || platforms[service.PlatformComposite]) {
			models := append([]string{}, platform.Models...)
			out.Platforms = append(out.Platforms, channelMonitorDisplayPlatform{Platform: platform.Platform, Models: models})
		}
	}
	return out
}
