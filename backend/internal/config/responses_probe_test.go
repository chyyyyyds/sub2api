package config

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestLoadDisableOpenAIResponsesProbe(t *testing.T) {
	for _, tc := range []struct {
		name  string
		value string
		want  bool
	}{
		{name: "默认保留原行为"},
		{name: "隔离实例可关闭", value: "true", want: true},
		{name: "显式恢复自动探测", value: "false"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			resetViperWithJWTSecret(t)
			t.Setenv("GATEWAY_DISABLE_OPENAI_RESPONSES_PROBE", tc.value)
			cfg, err := Load()
			require.NoError(t, err)
			require.Equal(t, tc.want, cfg.Gateway.DisableOpenAIResponsesProbe)
		})
	}
}
