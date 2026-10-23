import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getHistory, redeem } from '../redeem'

const { get, post } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }))
vi.mock('../client', () => ({ apiClient: { get, post } }))

describe('redemption history pagination', () => {
  beforeEach(() => vi.clearAllMocks())

  it('兑换保持 Handler 的真实记录结构，不假定包含新余额或 message', async () => {
    const record = { id: 17, type: 'balance', value: 25, status: 'used', used_by: 2, used_at: '2026-10-23T02:00:00Z', code: 'CODE', group_id: null, group: null }
    post.mockResolvedValue({ data: record })
    expect(await redeem('CODE')).toEqual(record)
    expect(post).toHaveBeenCalledWith('/redeem', { code: 'CODE' })
  })

  it.each([[undefined, undefined, 1, 20], [3, 50, 3, 50], [2, 100, 2, 100]])(
    'sends page %s and size %s to the server', async (page, size, expectedPage, expectedSize) => {
      const response = { items: [], total: 105, page: expectedPage, page_size: expectedSize, pages: 6 }
      get.mockResolvedValue({ data: response })
      expect(await getHistory(page, size)).toEqual(response)
      expect(get).toHaveBeenCalledWith('/redeem/history', {
        params: { page: expectedPage, page_size: expectedSize }
      })
    }
  )
})
