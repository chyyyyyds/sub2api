//go:build unit

package service

import (
	"context"
	"errors"
	"testing"

	"github.com/Wei-Shaw/sub2api/internal/config"
	"github.com/stretchr/testify/require"
	"golang.org/x/crypto/bcrypt"
)

type legacyLoginRepo struct {
	UserRepository
	user          *User
	emailErr      error
	usernameCalls int
}

func (r *legacyLoginRepo) GetByEmail(_ context.Context, email string) (*User, error) {
	if r.emailErr != nil {
		return nil, r.emailErr
	}
	if email == r.user.Email {
		return r.user, nil
	}
	return nil, ErrUserNotFound
}

func (r *legacyLoginRepo) GetByLoginUsername(_ context.Context, username string) (*User, error) {
	r.usernameCalls++
	if username == "原用户名" {
		return r.user, nil
	}
	return nil, ErrUserNotFound
}

func TestLegacyUsernameLoginPreservesEmailPasswordAndStatusChecks(t *testing.T) {
	hash, err := bcrypt.GenerateFromPassword([]byte("original-password"), bcrypt.MinCost)
	require.NoError(t, err)
	repo := &legacyLoginRepo{user: &User{ID: 7, Email: "original@example.com", Username: "已修改的展示昵称", PasswordHash: string(hash), Status: StatusActive, Role: RoleUser}}
	svc := &AuthService{userRepo: repo, cfg: &config.Config{JWT: config.JWTConfig{Secret: "fixture-secret-is-only-for-tests", ExpireHour: 1}}}
	for _, identifier := range []string{"original@example.com", " 原用户名 "} {
		token, user, err := svc.Login(context.Background(), identifier, "original-password")
		require.NoError(t, err)
		require.NotEmpty(t, token)
		require.Equal(t, repo.user.ID, user.ID)
	}
	for _, identifier := range []string{"不存在的用户名", "已修改的展示昵称", "原用户名"} {
		_, _, err := svc.Login(context.Background(), identifier, "wrong-password")
		require.ErrorIs(t, err, ErrInvalidCredentials)
	}
	repo.user.Status = StatusDisabled
	_, _, err = svc.Login(context.Background(), "原用户名", "original-password")
	require.ErrorIs(t, err, ErrUserNotActive)
}

func TestLegacyUsernameLoginDoesNotFallbackOnDatabaseFailure(t *testing.T) {
	repo := &legacyLoginRepo{emailErr: errors.New("database unavailable")}
	svc := &AuthService{userRepo: repo}
	_, _, err := svc.Login(context.Background(), "原用户名", "password")
	require.ErrorIs(t, err, ErrServiceUnavailable)
	require.Zero(t, repo.usernameCalls)
}
