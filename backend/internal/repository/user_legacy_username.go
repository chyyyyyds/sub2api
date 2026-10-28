package repository

import (
	"context"

	"github.com/Wei-Shaw/sub2api/internal/service"
)

// GetByLoginUsername 按区分大小写的旧用户名定位账号，不使用用户可编辑的展示昵称。
func (r *userRepository) GetByLoginUsername(ctx context.Context, username string) (*service.User, error) {
	rows, err := r.sql.QueryContext(ctx,
		"SELECT user_id FROM legacy_login_usernames WHERE username = $1", username)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	if !rows.Next() {
		if err := rows.Err(); err != nil {
			return nil, err
		}
		return nil, service.ErrUserNotFound
	}
	var userID int64
	if err := rows.Scan(&userID); err != nil {
		return nil, err
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}
	// 复用原有查询，保持软删除过滤、状态和分组权限装载一致。
	return r.GetByID(ctx, userID)
}
