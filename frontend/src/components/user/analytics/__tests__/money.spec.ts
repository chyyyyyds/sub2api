import { describe, expect, it } from 'vitest'
import { money } from '../analytics'

describe('Stage7R2E 小额账务显示', () => {
  it.each([
    [0, '$0.0000'], [0.00001284, '$0.00001284'],
    [0.00000001, '$0.00000001'], [-0.00000001, '$-0.00000001'],
    [1.23456, '$1.2346'], [0.000000001, '<$0.00000001'],
  ])('金额 %s 保留有效账务精度', (value, expected) => expect(money(value)).toBe(expected))
  it('无效金额仍保持未知', () => {
    expect(money(null)).toBe('—')
    expect(money(Number.NaN)).toBe('—')
  })
})
