package service

import (
	"context"
	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/require"
	"sync"
	"testing"
	"time"
)

func TestKokoRequestBudgetSharedAcrossInstances(t *testing.T) {
	server := miniredis.RunT(t)
	client := redis.NewClient(&redis.Options{Addr: server.Addr()})
	defer client.Close()
	budget1, budget2 := newKokoRequestBudget(client), newKokoRequestBudget(client)
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	var wg sync.WaitGroup
	results := make(chan error, 2)
	for _, budget := range []func(context.Context, string) error{budget1, budget2} {
		wg.Add(1)
		go func(wait func(context.Context, string) error) {
			defer wg.Done()
			results <- wait(ctx, "same-upstream-identity")
		}(budget)
	}
	wg.Wait()
	close(results)
	success := 0
	for err := range results {
		if err == nil {
			success++
		} else {
			require.ErrorIs(t, err, context.DeadlineExceeded)
		}
	}
	require.Equal(t, 1, success)
	require.NoError(t, budget2(context.Background(), "another-identity"))
	server.FastForward(time.Second)
	require.NoError(t, budget2(context.Background(), "same-upstream-identity"))
	expired, cancelExpired := context.WithCancel(context.Background())
	cancelExpired()
	require.Error(t, budget1(expired, "same-upstream-identity"))
}
