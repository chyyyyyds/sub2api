package handler

import (
	"strconv"

	"github.com/Wei-Shaw/sub2api/internal/handler/dto"
	"github.com/Wei-Shaw/sub2api/internal/pkg/pagination"
	"github.com/Wei-Shaw/sub2api/internal/pkg/response"
	middleware2 "github.com/Wei-Shaw/sub2api/internal/server/middleware"
	"github.com/Wei-Shaw/sub2api/internal/service"

	"github.com/gin-gonic/gin"
)

// RedeemHandler handles redeem code-related requests
type RedeemHandler struct {
	redeemService *service.RedeemService
}

// NewRedeemHandler creates a new RedeemHandler
func NewRedeemHandler(redeemService *service.RedeemService) *RedeemHandler {
	return &RedeemHandler{
		redeemService: redeemService,
	}
}

// RedeemRequest represents the redeem code request payload
type RedeemRequest struct {
	// Code 余额兑换码，由服务端校验类型和状态。
	Code string `json:"code" binding:"required" example:"BALANCE-CODE"`
}

// Redeem handles redeeming a code
// POST /api/v1/redeem
// @Summary 普通用户兑换余额
// @Description 仅接受余额兑换码，返回实际兑换记录；账户余额从用户资料接口刷新。
// @Tags Redeem
// @Accept json
// @Produce json
// @Param request body RedeemRequest true "余额兑换请求"
// @Success 200 {object} dto.RedeemCode "兑换成功记录"
// @Failure 400 {object} response.Response "非余额兑换码或请求无效"
// @Security BearerAuth
// @Router /redeem [post]
func (h *RedeemHandler) Redeem(c *gin.Context) {
	subject, ok := middleware2.GetAuthSubjectFromContext(c)
	if !ok {
		response.Unauthorized(c, "User not authenticated")
		return
	}

	var req RedeemRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, "Invalid request: "+err.Error())
		return
	}

	result, err := h.redeemService.Redeem(c.Request.Context(), subject.UserID, req.Code)
	if err != nil {
		response.ErrorFrom(c, err)
		return
	}

	response.Success(c, dto.RedeemCodeFromService(result).Localized(c.GetHeader("Accept-Language")))
}

// GetHistory returns the user's redemption history
// GET /api/v1/redeem/history
func (h *RedeemHandler) GetHistory(c *gin.Context) {
	subject, ok := middleware2.GetAuthSubjectFromContext(c)
	if !ok {
		response.Unauthorized(c, "User not authenticated")
		return
	}

	// Keep the legacy array response for clients that do not request pagination.
	if c.Request.URL.Query().Has("page") || c.Request.URL.Query().Has("page_size") {
		page, pageSize := 1, 20
		for name, target := range map[string]*int{"page": &page, "page_size": &pageSize} {
			if raw, exists := c.GetQuery(name); exists {
				value, err := strconv.Atoi(raw)
				if err != nil || value < 1 {
					response.BadRequest(c, "Invalid "+name)
					return
				}
				*target = value
			}
		}
		if pageSize > 100 {
			pageSize = 100
		}
		if page-1 > int(^uint(0)>>1)/pageSize {
			response.BadRequest(c, "Invalid page")
			return
		}
		codes, result, err := h.redeemService.GetUserHistoryPaginated(c.Request.Context(), subject.UserID, pagination.PaginationParams{Page: page, PageSize: pageSize})
		if err != nil {
			response.ErrorFrom(c, err)
			return
		}
		out := make([]dto.RedeemCode, 0, len(codes))
		for i := range codes {
			out = append(out, *dto.RedeemCodeFromService(&codes[i]).Localized(c.GetHeader("Accept-Language")))
		}
		response.Paginated(c, out, result.Total, page, pageSize)
		return
	}

	// Default limit is 25
	limit := 25

	codes, err := h.redeemService.GetUserHistory(c.Request.Context(), subject.UserID, limit)
	if err != nil {
		response.ErrorFrom(c, err)
		return
	}

	out := make([]dto.RedeemCode, 0, len(codes))
	for i := range codes {
		out = append(out, *dto.RedeemCodeFromService(&codes[i]).Localized(c.GetHeader("Accept-Language")))
	}
	response.Success(c, out)
}
