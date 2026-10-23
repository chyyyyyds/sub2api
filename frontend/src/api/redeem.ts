/**
 * Redeem code API endpoints
 * Handles redeem code redemption for users
 */

import { apiClient } from './client'
import type { PaginatedResponse, RedeemCodeRequest } from '@/types'

export interface RedeemHistoryItem {
  /** @description 兑换活动记录 ID。 */
  id: number
  /** @description 敏感兑换码，钱包禁止展示。 */
  code: string
  /** @description 真实资产活动类型。 */
  type: string
  /** @description 资产变化值，单位由类型决定。 */
  value: number
  /** @description 兑换码状态。 */
  status: string
  /** @description 资产变更时间，未使用时为空。 */
  used_at: string | null
  /** @description 创建时间。 */
  created_at: string
  /** @description 管理员资产调整的公开说明。 */
  notes?: string | null
  /** @description 订阅分组 ID。 */
  group_id?: number | null
  /** @description 订阅变动天数，负数表示扣减。 */
  validity_days?: number
  /** @description 订阅分组信息。 */
  group?: {
    /** @description 分组 ID。 */
    id: number
    /** @description 分组名称。 */
    name: string
  } | null
}

/** Handler 实际返回兑换记录，账户余额另从认证接口刷新。 */
export interface WalletRedeemResult extends RedeemHistoryItem {
  /** @description 兼容旧版可选提示字段。 */
  message?: string
}

/**
 * Redeem a code
 * @param code - 普通用户余额兑换码。
 * @returns 服务端实际兑换记录，账户资料必须单独刷新。
 */
export async function redeem(code: string): Promise<WalletRedeemResult> {
  const payload: RedeemCodeRequest = { code }

  const { data } = await apiClient.post<WalletRedeemResult>('/redeem', payload)

  return data
}

/**
 * Get user's redemption history
 * @param page - 从 1 开始的服务端页码。
 * @param pageSize - 每页记录数，服务端最多返回 100 条。
 * @returns 请求页的活动及真实总数。
 */
export async function getHistory(page = 1, pageSize = 20): Promise<PaginatedResponse<RedeemHistoryItem>> {
  const { data } = await apiClient.get<PaginatedResponse<RedeemHistoryItem>>('/redeem/history', {
    params: { page, page_size: pageSize }
  })
  return data
}

export const redeemAPI = {
  redeem,
  getHistory
}

export default redeemAPI
