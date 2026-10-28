package service

import (
	"context"
	"errors"
	"strings"
)

// legacyUsernameLoginRepository 仅开放已确认的迁移用户名，避免把可重复昵称当作登录标识。
type legacyUsernameLoginRepository interface {
	GetByLoginUsername(ctx context.Context, username string) (*User, error)
}

func (s *AuthService) findUserForPasswordLogin(ctx context.Context, identifier string) (*User, error) {
	identifier = strings.TrimSpace(identifier)
	if identifier == "" || len(identifier) > 255 {
		return nil, ErrUserNotFound
	}
	// 保留原有邮箱查找规则；找不到邮箱时才查询独立、唯一的旧用户名映射。
	user, err := s.userRepo.GetByEmail(ctx, identifier)
	if !errors.Is(err, ErrUserNotFound) {
		return user, err
	}
	if repository, ok := s.userRepo.(legacyUsernameLoginRepository); ok {
		return repository.GetByLoginUsername(ctx, identifier)
	}
	return nil, ErrUserNotFound
}
