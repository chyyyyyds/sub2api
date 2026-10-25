//go:build unit

package service

import (
	"testing"

	"github.com/stretchr/testify/require"
)

// 只验证项目实际映射的计量字段；所有数据均为合成协议快照。
func TestStage8FinalUsageCompatibility(t *testing.T) {
	for _, tc := range []struct {
		name, payload                               string
		trusted                                     bool
		input, output, cacheRead, cacheWrite, image int
	}{
		{"chat_minimal", `{"usage":{"prompt_tokens":10,"completion_tokens":3}}`, true, 10, 3, 0, 0, 0},
		{"responses_minimal", `{"response":{"usage":{"input_tokens":10,"output_tokens":3}}}`, true, 10, 3, 0, 0, 0},
		{"wrapped_chat", `{"data":{"usage":{"prompt_tokens":10,"completion_tokens":3}}}`, true, 10, 3, 0, 0, 0},
		{"wrapped_responses", `{"data":{"response":{"usage":{"input_tokens":10,"output_tokens":3}}}}`, true, 10, 3, 0, 0, 0},
		{"chat_cache", `{"usage":{"prompt_tokens":10,"completion_tokens":3,"prompt_tokens_details":{"cached_tokens":4,"cache_write_tokens":2}}}`, true, 10, 3, 4, 2, 0},
		{"responses_cache", `{"response":{"usage":{"input_tokens":10,"output_tokens":3,"input_tokens_details":{"cached_tokens":4,"cache_creation_tokens":2}}}}`, true, 10, 3, 4, 2, 0},
		{"cache_aliases", `{"usage":{"input_tokens":10,"output_tokens":3,"cache_read_input_tokens":4,"cache_creation_input_tokens":2}}`, true, 10, 3, 4, 2, 0},
		{"nullable_optional_details", `{"usage":{"prompt_tokens":10,"completion_tokens":3,"prompt_tokens_details":null,"completion_tokens_details":null}}`, true, 10, 3, 0, 0, 0},
		{"empty_optional_details", `{"usage":{"input_tokens":10,"output_tokens":3,"input_tokens_details":{},"output_tokens_details":{}}}`, true, 10, 3, 0, 0, 0},
		{"unmapped_metadata", `{"usage":{"input_tokens":10,"output_tokens":3,"tokens_source":"synthetic"}}`, true, 10, 3, 0, 0, 0},
		{"hosted_image", `{"response":{"usage":{"input_tokens":10,"output_tokens":3},"tool_usage":{"image_gen":{"output_tokens_details":{"image_tokens":2}}}}}`, true, 10, 3, 0, 0, 2},
		{"hosted_image_string_ignored", `{"usage":{"input_tokens":10,"output_tokens":3},"tool_usage":{"image_gen":{"output_tokens_details":{"image_tokens":"2"}}}}`, true, 10, 3, 0, 0, 0},
		{"hosted_image_fraction_ignored", `{"usage":{"input_tokens":10,"output_tokens":3},"tool_usage":{"image_gen":{"input_tokens_details":{"image_tokens":2.5}}}}`, true, 10, 3, 0, 0, 0},
		{"incomplete", `{"usage":{"input_tokens":10}}`, false, 0, 0, 0, 0, 0},
		{"negative", `{"usage":{"input_tokens":-1,"output_tokens":3}}`, false, 0, 0, 0, 0, 0},
		{"string", `{"usage":{"input_tokens":"10","output_tokens":3}}`, false, 0, 0, 0, 0, 0},
		{"fraction", `{"usage":{"input_tokens":10.1,"output_tokens":3}}`, false, 0, 0, 0, 0, 0},
		{"overflow", `{"usage":{"input_tokens":9223372036854775808,"output_tokens":3}}`, false, 0, 0, 0, 0, 0},
		{"optional_overflow", `{"usage":{"input_tokens":10,"output_tokens":3,"input_tokens_details":{"cached_tokens":9223372036854775808}}}`, false, 0, 0, 0, 0, 0},
		{"optional_string", `{"usage":{"input_tokens":10,"output_tokens":3,"input_tokens_details":{"cached_tokens":"4"}}}`, false, 0, 0, 0, 0, 0},
		{"optional_null_counter", `{"usage":{"input_tokens":10,"output_tokens":3,"input_tokens_details":{"cached_tokens":null}}}`, false, 0, 0, 0, 0, 0},
		{"malformed_details", `{"usage":{"input_tokens":10,"output_tokens":3,"input_tokens_details":[]}}`, false, 0, 0, 0, 0, 0},
		{"invalid_total", `{"usage":{"input_tokens":10,"output_tokens":3,"total_tokens":-1}}`, false, 0, 0, 0, 0, 0},
		{"mapped_reasoning_overflow", `{"usage":{"input_tokens":9223372036854775807,"output_tokens":9223372036854775807,"total_tokens":1,"output_tokens_details":{"reasoning_tokens":1}}}`, false, 0, 0, 0, 0, 0},
		{"null_chunk", `{"usage":null}`, false, 0, 0, 0, 0, 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			u, ok := trustedOpenAIStreamUsage([]byte(tc.payload))
			require.Equal(t, tc.trusted, ok)
			if ok {
				require.Equal(t, tc.input, u.InputTokens)
				require.Equal(t, tc.output, u.OutputTokens)
				require.Equal(t, tc.cacheRead, u.CacheReadInputTokens)
				require.Equal(t, tc.cacheWrite, u.CacheCreationInputTokens)
				require.Equal(t, tc.image, u.ImageOutputTokens)
			}
		})
	}
}
