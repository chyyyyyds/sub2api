package admin

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/Wei-Shaw/sub2api/internal/config"
	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/stretchr/testify/require"
)

type automaticProbeAccountRepo struct {
	service.AccountRepository
	called chan int64
}

func (r *automaticProbeAccountRepo) GetByID(_ context.Context, id int64) (*service.Account, error) {
	r.called <- id
	// 在加载账号后终止，确保单元测试不会产生任何网络或付费请求。
	return nil, errors.New("隔离测试终止自动探测")
}

func TestScheduleOpenAIResponsesProbeConfig(t *testing.T) {
	for _, tc := range []struct {
		name string
		cfg  *config.Config
		want bool
	}{
		{name: "旧调用方无配置保留自动探测", want: true},
		{name: "默认配置保留自动探测", cfg: &config.Config{}, want: true},
		{name: "显式关闭不读取账号不发请求", cfg: &config.Config{Gateway: config.GatewayConfig{DisableOpenAIResponsesProbe: true}}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			repo := &automaticProbeAccountRepo{called: make(chan int64, 1)}
			h := &AccountHandler{cfg: tc.cfg, accountTestService: service.NewAccountTestService(repo, nil, nil, nil, nil, nil, nil, nil)}
			h.scheduleOpenAIResponsesProbe(&service.Account{ID: 73, Platform: service.PlatformOpenAI, Type: service.AccountTypeAPIKey})
			if tc.want {
				select {
				case id := <-repo.called:
					require.Equal(t, int64(73), id)
				case <-time.After(time.Second):
					t.Fatal("默认行为未触发自动探测")
				}
			} else {
				select {
				case <-repo.called:
					t.Fatal("关闭配置仍触发了自动探测")
				case <-time.After(50 * time.Millisecond):
				}
			}
		})
	}
}
