//go:build unit

package repository

import (
	"context"
	"database/sql"
	"errors"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/stretchr/testify/require"
)

// 先断言正式仓储具备原子接口；修改前稳定失败，不用替身冒充资金事务。
type stage7R2AtomicBilling interface {
	ApplyWithUsage(context.Context, *service.UsageBillingCommand, *service.UsageLog) (*service.UsageBillingApplyResult, error)
}

func TestStage7R2AtomicBilling(t *testing.T) {
	for _, tc := range []string{"成功一起提交", "余额更新失败全部回滚", "日志写入失败全部回滚", "重复事件不再扣费", "提交失败返回错误"} {
		t.Run(tc, func(t *testing.T) {
			db, mock, err := sqlmock.New()
			require.NoError(t, err)
			defer db.Close()
			repo, ok := NewUsageBillingRepository(nil, db).(stage7R2AtomicBilling)
			require.True(t, ok, "资金和usage必须在同一事务提交")
			cmd := &service.UsageBillingCommand{RequestID: "r2-atomic", UserID: 1, APIKeyID: 2, AccountID: 3, BalanceCost: 0.25, Model: "gpt-6-sol"}
			cmd.Normalize()
			row := &service.UsageLog{RequestID: cmd.RequestID, UserID: 1, APIKeyID: 2, AccountID: 3, Model: cmd.Model, ActualCost: 0.25, RateMultiplier: 1}
			mock.ExpectBegin()
			claim := mock.ExpectQuery("INSERT INTO usage_billing_dedup").WithArgs(cmd.RequestID, cmd.APIKeyID, cmd.RequestFingerprint)
			if tc == "重复事件不再扣费" {
				claim.WillReturnError(sql.ErrNoRows)
				mock.ExpectQuery("SELECT request_fingerprint").WillReturnRows(sqlmock.NewRows([]string{"request_fingerprint"}).AddRow(cmd.RequestFingerprint))
				mock.ExpectRollback()
			} else {
				claim.WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(10))
				mock.ExpectQuery("SELECT request_fingerprint").WillReturnError(sql.ErrNoRows)
				balance := mock.ExpectQuery(conditionalBalanceDeductSQL).WithArgs(0.25, int64(1))
				if tc == "余额更新失败全部回滚" {
					balance.WillReturnError(errors.New("隔离余额故障"))
					mock.ExpectRollback()
				} else {
					balance.WillReturnRows(sqlmock.NewRows([]string{"balance"}).AddRow(9.75))
					insert := mock.ExpectQuery("INSERT INTO usage_logs")
					if tc == "日志写入失败全部回滚" {
						insert.WillReturnError(errors.New("隔离usage故障"))
						mock.ExpectRollback()
					} else {
						insert.WillReturnRows(sqlmock.NewRows([]string{"id", "created_at"}).AddRow(11, time.Now()))
						if tc == "提交失败返回错误" {
							mock.ExpectCommit().WillReturnError(errors.New("隔离提交故障"))
						} else {
							mock.ExpectCommit()
						}
					}
				}
			}
			res, err := repo.ApplyWithUsage(context.Background(), cmd, row)
			if tc == "成功一起提交" || tc == "重复事件不再扣费" {
				require.NoError(t, err)
				require.Equal(t, tc == "成功一起提交", res.Applied)
			} else {
				require.Error(t, err)
			}
			require.NoError(t, mock.ExpectationsWereMet())
		})
	}
}
