package admin

import (
	"bytes"
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func TestStage7R2ERedeemLengthBinding(t *testing.T) {
	for _, n := range []int{3, 31, 32, 33, 128, 129} {
		t.Run(strings.Repeat("x", n), func(t *testing.T) {
			data, err := json.Marshal(map[string]any{"code": strings.Repeat("x", n), "value": 1, "user_id": 1})
			require.NoError(t, err)
			c, _ := gin.CreateTestContext(httptest.NewRecorder())
			c.Request = httptest.NewRequest("POST", "/", bytes.NewReader(data))
			c.Request.Header.Set("Content-Type", "application/json")
			var req CreateAndRedeemCodeRequest
			err = c.ShouldBindJSON(&req)
			if n <= 32 {
				require.NoError(t, err)
			} else {
				require.Error(t, err)
			}
		})
	}
}

func TestStage7R2ERedeemRejectsBeforeService(t *testing.T) {
	for _, code := range []string{strings.Repeat("x", 33), strings.Repeat("中", 11)} {
		// 不允许通过 panic 冒充校验通过；超长输入必须在接触仓储前返回 400。
		require.Equal(t, 400, postCreateAndRedeemValidation(t, newCreateAndRedeemHandler(), map[string]any{"code": code, "value": 1, "user_id": 1}))
	}
}
