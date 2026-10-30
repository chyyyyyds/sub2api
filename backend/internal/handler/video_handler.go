package handler

import (
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/Wei-Shaw/sub2api/internal/pkg/response"
	"github.com/Wei-Shaw/sub2api/internal/server/middleware"
	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/gin-gonic/gin"
)

type VideoHandler struct{ Service *service.VideoService }

func NewVideoHandler(s *service.VideoService) *VideoHandler { return &VideoHandler{Service: s} }

// VideoListResponse 为公开任务列表。
type VideoListResponse struct {
	// Data 当前用户原 Key 的视频任务。
	Data []service.VideoTask `json:"data"`
	// NextCursor 下一页游标；空表示本页没有更多记录。
	NextCursor string `json:"next_cursor,omitempty"`
}

// VideoErrorDetail 为受控错误，不透传上游凭据和原始错误体。
type VideoErrorDetail struct {
	// Code 可用于判断重试或核对的安全错误码。
	Code string `json:"code"`
	// Message 面向用户的错误说明。
	Message string `json:"message"`
}

// VideoErrorResponse 为公开视频接口错误响应。
type VideoErrorResponse struct {
	// Error 错误详情。
	Error VideoErrorDetail `json:"error"`
}

// VideoActionResult 为管理操作结果。
type VideoActionResult struct {
	// Success 原任务或原账务操作是否成功受理。
	Success bool `json:"success"`
}

// VideoModelListResponse 为公开授权目录。
type VideoModelListResponse struct {
	// Data 当前用户 Key 有权使用的视频模型。
	Data []service.VideoPublicModel `json:"data"`
}

// KokoAdminAccountResponse 仅管理员可读的上游状态与关联。
type KokoAdminAccountResponse struct {
	// Account 上游状态和积分余额。
	Account *service.KokoAccountStatus `json:"account"`
	// Models 完整实时目录，包含维护和停用项。
	Models []service.KokoVideoModel `json:"models"`
	// GroupIDs 账号当前关联的现有分组。
	GroupIDs []int64 `json:"group_ids"`
}

// VideoGateRequest 为管理员收费开关配置。
type VideoGateRequest struct {
	// Enabled 是否允许新任务；生产真实收费验证完成前保持 false。
	Enabled bool `json:"enabled"`
}

// VideoQuoteParams 为只读报价参数。
type VideoQuoteParams struct {
	// Model 请求模型。
	Model string `form:"model" binding:"required"`
	// Duration 视频秒数。
	Duration int `form:"duration" binding:"required"`
	// Resolution 分辨率原值。
	Resolution string `form:"resolution" binding:"required"`
	// Mode 已核实的生成模式。
	Mode string `form:"mode"`
}

// VideoReconcileRequest 用于管理员核对已有任务，不能触发重新生成。
type VideoReconcileRequest struct {
	// UpstreamID 待验证的原上游任务编号。
	UpstreamID string `json:"upstream_id"`
	// Reason 核对依据或恢复原因，必填。
	Reason string `json:"reason" binding:"required"`
}

func videoHTTPError(c *gin.Context, e error) {
	status := http.StatusBadRequest
	code := "VIDEO_REQUEST_REJECTED"
	if errors.Is(e, sql.ErrNoRows) {
		status = 404
		code = "VIDEO_NOT_FOUND"
	} else if e != nil {
		for _, prefix := range []string{"VIDEO_", "KOKO_", "INVALID_", "REFERENCE_"} {
			if strings.HasPrefix(e.Error(), prefix) && len(e.Error()) < 100 {
				code = e.Error()
				break
			}
		}
	}
	if code == "VIDEO_NOT_READY" {
		status = 409
	}
	if code == "VIDEO_EXPIRED" {
		status = 410
	}
	if code == "VIDEO_IDEMPOTENCY_CONFLICT" {
		status = 409
	}
	c.JSON(status, VideoErrorResponse{Error: VideoErrorDetail{Code: code, Message: "视频请求暂不可用，请检查权限、能力配置或任务状态"}})
}
func videoKey(c *gin.Context) *service.APIKey {
	key, ok := middleware.GetAPIKeyFromContext(c)
	if !ok || key == nil || key.GroupID == nil {
		c.AbortWithStatus(401)
		return nil
	}
	return key
}

// Models godoc
// @Summary 获取当前 Key 的视频模型能力
// @Produce json
// @Success 200 {object} VideoModelListResponse
// @Router /v1/video-models [get]
func (h *VideoHandler) Models(c *gin.Context) {
	key := videoKey(c)
	if key == nil {
		return
	}
	models, e := h.Service.Catalog(c.Request.Context(), key)
	if e != nil {
		videoHTTPError(c, e)
		return
	}
	c.JSON(200, VideoModelListResponse{Data: models})
}

// Quote godoc
// @Summary 获取视频正式配置报价，不冻结资金
// @Param model query string true "模型"
// @Param duration query int true "秒数"
// @Param resolution query string true "分辨率"
// @Param mode query string false "生成模式"
// @Success 200 {object} service.VideoQuote
// @Router /v1/video-quote [get]
func (h *VideoHandler) Quote(c *gin.Context) {
	key := videoKey(c)
	if key == nil {
		return
	}
	var params VideoQuoteParams
	if c.ShouldBindQuery(&params) != nil {
		c.AbortWithStatus(400)
		return
	}
	out, e := h.Service.Quote(c.Request.Context(), key, service.VideoCreateRequest{Model: params.Model, Duration: params.Duration, Resolution: params.Resolution, Mode: params.Mode})
	if e != nil {
		videoHTTPError(c, e)
		return
	}
	c.JSON(200, out)
}

// Create godoc
// @Summary 创建持久视频任务并冻结费用
// @Description 返回本地任务编号；重复幂等键不会重复冻结或生成
// @Accept json
// @Produce json
// @Param Idempotency-Key header string true "稳定幂等键"
// @Param request body service.VideoCreateRequest true "视频参数"
// @Success 202 {object} service.VideoTask
// @Router /v1/videos [post]
func (h *VideoHandler) Create(c *gin.Context) {
	key := videoKey(c)
	if key == nil {
		return
	}
	var req service.VideoCreateRequest
	decoder := json.NewDecoder(c.Request.Body)
	decoder.DisallowUnknownFields()
	if decoder.Decode(&req) != nil {
		c.AbortWithStatus(400)
		return
	}
	var extra any
	if decoder.Decode(&extra) != io.EOF {
		c.AbortWithStatus(400)
		return
	}
	task, e := h.Service.Create(c.Request.Context(), key, req, c.GetHeader("Idempotency-Key"))
	if e != nil {
		videoHTTPError(c, e)
		return
	}
	c.Header("Location", "/v1/videos/"+task.ID)
	c.JSON(202, task)
}

// List godoc
// @Summary 查询当前 Key 的视频任务
// @Success 200 {object} VideoListResponse
// @Router /v1/videos [get]
func (h *VideoHandler) List(c *gin.Context) {
	key := videoKey(c)
	if key == nil {
		return
	}
	if idempotency := c.Query("idempotency_key"); idempotency != "" {
		task, e := h.Service.Repo.Replay(c.Request.Context(), key.UserID, key.ID, *key.GroupID, idempotency, "")
		if e != nil {
			videoHTTPError(c, e)
			return
		}
		tasks := []service.VideoTask{}
		if task != nil {
			tasks = append(tasks, *task)
		}
		c.JSON(200, videoListResponse(tasks))
		return
	}
	tasks, e := h.Service.Repo.ListPage(c.Request.Context(), key.UserID, key.ID, *key.GroupID, c.Query("before"))
	if e != nil {
		videoHTTPError(c, e)
		return
	}
	c.JSON(200, videoListResponse(tasks))
}

// Get godoc
// @Summary 查询原 Key 归属的视频任务
// @Param request_id path string true "本地任务编号"
// @Success 200 {object} service.VideoTask
// @Router /v1/videos/{request_id} [get]
func (h *VideoHandler) Get(c *gin.Context) {
	key := videoKey(c)
	if key == nil {
		return
	}
	task, e := h.Service.Repo.Get(c.Request.Context(), c.Param("request_id"), key.UserID, key.ID, *key.GroupID)
	if e != nil {
		videoHTTPError(c, e)
		return
	}
	c.JSON(200, task)
}

// Content godoc
// @Summary 流式下载视频原文件
// @Param request_id path string true "本地任务编号"
// @Param Range header string false "单段字节范围"
// @Success 200 {file} binary
// @Success 206 {file} binary
// @Router /v1/videos/{request_id}/content [get]
// @Router /v1/videos/{request_id}/content [head]
func (h *VideoHandler) Content(c *gin.Context) {
	key := videoKey(c)
	if key == nil {
		return
	}
	res, e := h.Service.OpenContent(c.Request.Context(), c.Param("request_id"), key.UserID, key.ID, *key.GroupID, c.Request.Method, c.GetHeader("Range"), c.GetHeader("If-Range"))
	if e != nil {
		videoHTTPError(c, e)
		return
	}
	_ = service.StreamVideoContent(c.Writer, res, c.Param("request_id"), c.Request.Method)
}

// UserList godoc
// @Summary 登录用户查看本人所有 Key 的视频历史
// @Success 200 {object} VideoListResponse
// @Router /api/v1/user/video-tasks [get]
func (h *VideoHandler) UserList(c *gin.Context) {
	subject, ok := middleware.GetAuthSubjectFromContext(c)
	if !ok {
		c.AbortWithStatus(401)
		return
	}
	tasks, e := h.Service.Repo.ListPage(c.Request.Context(), subject.UserID, 0, 0, c.Query("before"))
	if e != nil {
		videoHTTPError(c, e)
		return
	}
	response.Success(c, videoListResponse(tasks))
}

// UserGet godoc
// @Summary 登录用户查看自己的原任务详情
// @Param id path string true "本地任务编号"
// @Success 200 {object} service.VideoTask
// @Router /api/v1/user/video-tasks/{id} [get]
func (h *VideoHandler) UserGet(c *gin.Context) {
	subject, ok := middleware.GetAuthSubjectFromContext(c)
	if !ok {
		c.AbortWithStatus(401)
		return
	}
	task, e := h.Service.Repo.Get(c.Request.Context(), c.Param("id"), subject.UserID, 0, 0)
	if e != nil {
		videoHTTPError(c, e)
		return
	}
	response.Success(c, task)
}

// AdminGet godoc
// @Summary 管理员查看原任务详情
// @Param id path string true "本地任务编号"
// @Success 200 {object} service.VideoTask
// @Router /api/v1/admin/video-tasks/{id} [get]
func (h *VideoHandler) AdminGet(c *gin.Context) {
	task, e := h.Service.Repo.Get(c.Request.Context(), c.Param("id"), 0, 0, 0)
	if e != nil {
		videoHTTPError(c, e)
		return
	}
	response.Success(c, task)
}

// AdminRefresh godoc
// @Summary 只读检测 KOKO 账号并刷新实时目录
// @Param id path int true "现有 Account ID"
// @Success 200 {object} KokoAdminAccountResponse
// @Router /api/v1/admin/accounts/{id}/koko/refresh [post]
func (h *VideoHandler) AdminRefresh(c *gin.Context) {
	id, _ := strconv.ParseInt(c.Param("id"), 10, 64)
	account, models, e := h.Service.RefreshAccount(c.Request.Context(), id)
	if e != nil {
		videoHTTPError(c, e)
		return
	}
	a, e := h.Service.Accounts.GetByID(c.Request.Context(), id)
	if e != nil {
		videoHTTPError(c, e)
		return
	}
	response.Success(c, KokoAdminAccountResponse{Account: account, Models: models, GroupIDs: a.GroupIDs})
}

// Initialize godoc
// @Summary 幂等初始化现有 KOKO 分组渠道账号及按次价格关联
// @Param request body service.VideoInitializeRequest true "初始化目标"
// @Success 200 {object} service.VideoInitializeResult
// @Router /api/v1/admin/koko-video/initialize [post]
func (h *VideoHandler) Initialize(c *gin.Context) {
	var req service.VideoInitializeRequest
	if c.ShouldBindJSON(&req) != nil {
		c.AbortWithStatus(400)
		return
	}
	out, e := h.Service.Initialize(c.Request.Context(), req)
	if e != nil {
		videoHTTPError(c, e)
		return
	}
	response.Success(c, out)
}

// AdminList godoc
// @Summary 管理员查询视频任务
// @Success 200 {object} VideoListResponse
// @Router /api/v1/admin/video-tasks [get]
func (h *VideoHandler) AdminList(c *gin.Context) {
	tasks, e := h.Service.Repo.ListPage(c.Request.Context(), 0, 0, 0, c.Query("before"))
	if e != nil {
		videoHTTPError(c, e)
		return
	}
	response.Success(c, videoListResponse(tasks))
}

// AdminAudit godoc
// @Summary 查看视频任务账务及状态审计
// @Param id path string true "本地任务编号"
// @Success 200 {object} service.VideoAuditRecord
// @Router /api/v1/admin/video-tasks/{id}/audit [get]
func (h *VideoHandler) AdminAudit(c *gin.Context) {
	out, e := h.Service.Repo.Audit(c.Request.Context(), c.Param("id"))
	if e != nil {
		videoHTTPError(c, e)
		return
	}
	var record service.VideoAuditRecord
	if e = json.Unmarshal(out, &record); e != nil {
		videoHTTPError(c, e)
		return
	}
	response.Success(c, record)
}

// Reconcile godoc
// @Summary 核对并绑定已有原上游任务
// @Param id path string true "本地任务编号"
// @Param request body VideoReconcileRequest true "原任务证据"
// @Success 200 {object} VideoActionResult
// @Router /api/v1/admin/video-tasks/{id}/reconcile [post]
func (h *VideoHandler) Reconcile(c *gin.Context) {
	subject, ok := middleware.GetAuthSubjectFromContext(c)
	if !ok {
		c.AbortWithStatus(401)
		return
	}
	var req VideoReconcileRequest
	if c.ShouldBindJSON(&req) != nil {
		c.AbortWithStatus(400)
		return
	}
	if e := h.Service.Reconcile(c.Request.Context(), c.Param("id"), req.UpstreamID, subject.UserID, req.Reason); e != nil {
		videoHTTPError(c, e)
		return
	}
	response.Success(c, VideoActionResult{Success: true})
}

// RetryBilling godoc
// @Summary 恢复原账务事件，不创建新视频或新收费意图
// @Param id path string true "本地任务编号"
// @Param request body VideoReconcileRequest true "财务恢复原因"
// @Success 200 {object} VideoActionResult
// @Router /api/v1/admin/video-tasks/{id}/retry-billing [post]
func (h *VideoHandler) RetryBilling(c *gin.Context) {
	subject, ok := middleware.GetAuthSubjectFromContext(c)
	if !ok {
		c.AbortWithStatus(401)
		return
	}
	var req VideoReconcileRequest
	if c.ShouldBindJSON(&req) != nil {
		c.AbortWithStatus(400)
		return
	}
	if e := h.Service.Repo.RetryBilling(c.Request.Context(), c.Param("id"), subject.UserID, req.Reason); e != nil {
		videoHTTPError(c, e)
		return
	}
	response.Success(c, VideoActionResult{Success: true})
}

// Gate godoc
// @Summary 配置分组视频创建开关
// @Param id path int true "现有分组 ID"
// @Param request body VideoGateRequest true "开关值"
// @Success 200 {object} VideoGateRequest
// @Router /api/v1/admin/groups/{id}/koko-video [put]
func (h *VideoHandler) Gate(c *gin.Context) {
	id, _ := strconv.ParseInt(c.Param("id"), 10, 64)
	var req VideoGateRequest
	if c.Request.Method == "GET" {
		enabled, e := h.Service.Repo.GetGate(c.Request.Context(), id)
		if e != nil {
			videoHTTPError(c, e)
			return
		}
		response.Success(c, VideoGateRequest{Enabled: enabled})
		return
	}
	if c.ShouldBindJSON(&req) != nil {
		c.AbortWithStatus(400)
		return
	}
	if e := h.Service.Repo.SetGate(c.Request.Context(), id, req.Enabled); e != nil {
		videoHTTPError(c, e)
		return
	}
	response.Success(c, req)
}

func videoListResponse(tasks []service.VideoTask) VideoListResponse {
	out := VideoListResponse{Data: tasks}
	if len(tasks) == 100 {
		out.NextCursor = tasks[len(tasks)-1].ID
	}
	return out
}
