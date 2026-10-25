package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/Wei-Shaw/sub2api/internal/server/middleware"
	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

type monitorDisplayConfigRepo struct {
	service.ChannelMonitorV2Repository
	config service.ChannelMonitorV2Config
}

func (r *monitorDisplayConfigRepo) GetConfig(context.Context) (*service.ChannelMonitorV2Config, error) {
	return &r.config, nil
}

func TestChannelMonitorDisplayScopeIntersectsAuthorizedGroups(t *testing.T) {
	cfg := service.ChannelMonitorV2Config{
		Enabled: true, GroupIDs: []int64{2, 99},
		Platforms: []service.ChannelMonitorV2PlatformConfig{
			{Platform: "openai", Enabled: true, Models: []string{"GPT-6 Sol"}},
			{Platform: "anthropic", Enabled: true, Models: []string{"private"}},
			{Platform: "gemini", Enabled: false, Models: []string{"hidden"}},
		},
	}
	groups := []service.Group{{ID: 1, Platform: "anthropic"}, {ID: 2, Platform: "openai"}}
	scope := buildChannelMonitorDisplayScope(cfg, groups)
	require.Equal(t, []int64{2}, scope.GroupIDs)
	require.Equal(t, []channelMonitorDisplayPlatform{{Platform: "openai", Models: []string{"GPT-6 Sol"}}}, scope.Platforms)
	// 返回值不能共享可变模型列表，也不修改任何授权数据或监控配置。
	scope.Platforms[0].Models[0] = "changed"
	require.Equal(t, "GPT-6 Sol", cfg.Platforms[0].Models[0])
	require.Len(t, groups, 2)
	require.Equal(t, []int64{2, 99}, cfg.GroupIDs)

	cfg.GroupIDs = nil
	scope = buildChannelMonitorDisplayScope(cfg, groups)
	require.Equal(t, []int64{1, 2}, scope.GroupIDs)
	require.Len(t, scope.Platforms, 2)
	scope = buildChannelMonitorDisplayScope(cfg, []service.Group{{ID: 3, Platform: service.PlatformComposite}})
	require.Len(t, scope.Platforms, 2)

	for _, disabled := range []bool{false, true} {
		cfg.Enabled = !disabled
		empty := buildChannelMonitorDisplayScope(cfg, nil)
		require.Empty(t, empty.GroupIDs)
		require.NotNil(t, empty.GroupIDs)
		require.Empty(t, empty.Platforms)
		require.NotNil(t, empty.Platforms)
	}
	cfg.Enabled = false
	require.Empty(t, buildChannelMonitorDisplayScope(cfg, groups).Platforms)
}

func TestChannelMonitorDisplayScopeRequiresAuthentication(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet, "/api/v1/channel-monitor-v2/display-scope", nil)
	(&ChannelMonitorV2Handler{}).DisplayScope(c)
	require.Equal(t, http.StatusUnauthorized, w.Code)
}

func TestChannelMonitorDisplayScopeAdminOnUserPageStillUsesUserGroups(t *testing.T) {
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet, "/api/v1/channel-monitor-v2/display-scope", nil)
	c.Set(string(middleware.ContextKeyUser), middleware.AuthSubject{UserID: 42})
	c.Set(string(middleware.ContextKeyUserRole), service.RoleAdmin)
	authorizer := &channelMonitorV2GroupAuthorizerStub{groups: []service.Group{{ID: 2, Platform: "openai"}}}
	repo := &monitorDisplayConfigRepo{config: service.ChannelMonitorV2Config{
		Enabled: true, GroupIDs: []int64{2, 99},
		Platforms: []service.ChannelMonitorV2PlatformConfig{{Platform: "openai", Enabled: true, Models: []string{"gpt-6-sol"}}},
	}}
	h := &ChannelMonitorV2Handler{service: service.NewChannelMonitorV2Service(repo), apiKeyService: authorizer}
	h.DisplayScope(c)
	require.Equal(t, http.StatusOK, w.Code)
	var result struct {
		Data channelMonitorDisplayScope `json:"data"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &result))
	require.Equal(t, []int64{2}, result.Data.GroupIDs)
	require.Equal(t, []int64{42}, authorizer.calls)
}
