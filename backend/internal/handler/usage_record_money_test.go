package handler

import (
	"context"
	"sync/atomic"
	"testing"
	"time"

	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/stretchr/testify/require"
)

func TestStage7R2EConfirmedTokensNeverDropOnOverflow(t *testing.T) {
	for name, usage := range map[string]service.OpenAIUsage{
		"普通输入": {InputTokens: 43}, "输出": {OutputTokens: 16}, "缓存读取": {CacheReadInputTokens: 100}, "缓存写入": {CacheCreationInputTokens: 100},
	} {
		t.Run(name, func(t *testing.T) {
			pool := service.NewUsageRecordWorkerPoolWithOptions(service.UsageRecordWorkerPoolOptions{WorkerCount: 1, QueueSize: 1, TaskTimeout: time.Second, OverflowPolicy: "drop", AutoScaleEnabled: false})
			t.Cleanup(pool.Stop)
			started := make(chan struct{})
			release := make(chan struct{})
			pool.Submit(func(context.Context) { close(started); <-release })
			<-started
			defer close(release)
			pool.Submit(func(context.Context) {})
			var calls atomic.Int32
			h := &OpenAIGatewayHandler{usageRecordWorkerPool: pool}
			h.submitOpenAIUsageRecordTask(context.Background(), &service.OpenAIForwardResult{Usage: usage}, func(context.Context) { calls.Add(1) })
			require.EqualValues(t, 1, calls.Load(), "已确认真实 Token 的账务任务在满队列时必须同步执行一次")
		})
	}
}
