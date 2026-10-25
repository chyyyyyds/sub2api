import { describe, expect, it } from 'vitest'
import {
  CC_SWITCH_USAGE_SCRIPT,
  GROK_CC_SWITCH_MODEL,
  OPENAI_CC_SWITCH_CODEX_MODEL,
  buildCcSwitchImportDeeplink
} from '@/utils/ccswitchImport'
import type { GroupPlatform } from '@/types'

function paramsFromDeeplink(deeplink: string): URLSearchParams {
  const query = deeplink.split('?')[1] || ''
  return new URLSearchParams(query)
}

interface UsagePlan {
  planName?: string
  isValid?: boolean
  invalidMessage?: string
  remaining?: number
  used?: number
  total?: number
  unit?: string
  extra?: string
}

// 按 CCS 的顺序替换占位符并执行脚本，验证实际导入的代码而非另写一份解析逻辑。
function evaluateUsageScript(baseUrl = 'https://api.example.com', code = CC_SWITCH_USAGE_SCRIPT) {
  const script = code.split('{{baseUrl}}').join(baseUrl).split('{{apiKey}}').join('sk-test')
  // eslint-disable-next-line no-new-func
  return new Function(`return ${script}`)() as {
    request: { url: string; method: string; headers: Record<string, string> }
    extractor: (response: unknown) => UsagePlan[]
  }
}

describe('ccswitchImport utils', () => {
  it('defaults OpenAI CC Switch imports to the current Codex model', () => {
    expect(OPENAI_CC_SWITCH_CODEX_MODEL).toBe('gpt-5.5')
  })

  it('defaults Grok Build imports to the current Grok model', () => {
    expect(GROK_CC_SWITCH_MODEL).toBe('grok-4.5')
  })

  const baseInput = {
    baseUrl: 'https://api.example.com',
    providerName: 'Sub2API',
    apiKey: 'sk-test',
    usageScript: 'return true'
  }

  it.each([
    ['https://api.example.com', 'https://api.example.com'],
    ['https://api.example.com/', 'https://api.example.com'],
    ['https://api.example.com/v1', 'https://api.example.com/v1'],
    ['https://api.example.com/v1/', 'https://api.example.com/v1']
  ])('keeps Codex imports on the configured endpoint for base URL %s', (baseUrl, endpoint) => {
    const params = paramsFromDeeplink(
      buildCcSwitchImportDeeplink({
        ...baseInput,
        baseUrl,
        platform: 'openai',
        clientType: 'claude'
      })
    )

    expect(params.get('resource')).toBe('provider')
    expect(params.get('app')).toBe('codex')
    expect(params.get('endpoint')).toBe(endpoint)
    expect(params.get('model')).toBe(OPENAI_CC_SWITCH_CODEX_MODEL)
    expect(atob(params.get('usageScript') || '')).toBe(baseInput.usageScript)
  })

  it.each([
    'https://api.example.com',
    'https://api.example.com/',
    'https://api.example.com/v1',
    'https://api.example.com/v1/'
  ])('imports Grok Build with one /v1 suffix for base URL %s', (baseUrl) => {
    const params = paramsFromDeeplink(
      buildCcSwitchImportDeeplink({
        ...baseInput,
        baseUrl,
        platform: 'grok',
        clientType: 'claude'
      })
    )

    expect(params.get('app')).toBe('grokbuild')
    expect(params.get('endpoint')).toBe('https://api.example.com/v1')
    expect(params.get('model')).toBe(GROK_CC_SWITCH_MODEL)
  })

  it.each([
    { platform: 'anthropic' as GroupPlatform, clientType: 'claude' as const, app: 'claude' },
    { platform: 'gemini' as GroupPlatform, clientType: 'gemini' as const, app: 'gemini' }
  ])('does not add a model parameter for $platform imports', ({ platform, clientType, app }) => {
    const params = paramsFromDeeplink(
      buildCcSwitchImportDeeplink({
        ...baseInput,
        platform,
        clientType
      })
    )

    expect(params.get('app')).toBe(app)
    expect(params.get('endpoint')).toBe(baseInput.baseUrl)
    expect(params.has('model')).toBe(false)
  })

  it('keeps Antigravity imports on the selected client endpoint without a model parameter', () => {
    const params = paramsFromDeeplink(
      buildCcSwitchImportDeeplink({
        ...baseInput,
        platform: 'antigravity',
        clientType: 'gemini'
      })
    )

    expect(params.get('app')).toBe('gemini')
    expect(params.get('endpoint')).toBe(`${baseInput.baseUrl}/antigravity`)
    expect(params.has('model')).toBe(false)
  })
})

describe('CC Switch usage script', () => {
  function usageUrlFor(baseUrl: string): string {
    return evaluateUsageScript(baseUrl).request.url
  }

  it.each([
    'https://api.example.com',
    'https://api.example.com/',
    'https://api.example.com/v1',
    'https://api.example.com/v1/',
    'https://api.example.com/antigravity',
    'https://api.example.com/antigravity/'
  ])('queries exactly one /v1/usage for base URL %s', (baseUrl) => {
    expect(usageUrlFor(baseUrl)).toBe('https://api.example.com/v1/usage')
  })

  it('works against the endpoint every platform import stores', () => {
    for (const platform of ['anthropic', 'openai', 'grok', 'gemini', 'antigravity'] as GroupPlatform[]) {
      const endpoint = paramsFromDeeplink(
        buildCcSwitchImportDeeplink({
          baseUrl: 'https://api.example.com',
          platform,
          clientType: platform === 'gemini' ? 'gemini' : 'claude',
          providerName: 'Sub2API',
          apiKey: 'sk-test',
          usageScript: CC_SWITCH_USAGE_SCRIPT
        })
      ).get('endpoint') as string
      expect(usageUrlFor(endpoint)).toBe('https://api.example.com/v1/usage')
    }
  })

  it('imports the Chinese usage script as UTF-8 Base64 and enables automatic queries', () => {
    const params = paramsFromDeeplink(buildCcSwitchImportDeeplink({
      baseUrl: 'https://api.example.com',
      platform: 'openai',
      clientType: 'claude',
      providerName: '天启星',
      apiKey: 'sk-test',
      usageScript: CC_SWITCH_USAGE_SCRIPT
    }))
    const decoded = new TextDecoder().decode(Uint8Array.from(atob(params.get('usageScript')!), c => c.charCodeAt(0)))
    expect(decoded).toBe(CC_SWITCH_USAGE_SCRIPT)
    expect(params.get('usageEnabled')).toBe('true')
    expect(params.get('usageAutoInterval')).toBe('30')
    const config = evaluateUsageScript('https://api.example.com', decoded)
    expect(config.request.headers.Authorization).toBe('Bearer sk-test')
    expect(config.extractor({ remaining: 10, usage: { today: { actual_cost: 0 } } })).toHaveLength(2)
  })

  it('returns three wallet plans with actual charges, including zero usage', () => {
    expect(evaluateUsageScript().extractor({
      isValid: true, planName: '钱包余额', remaining: 10, unit: 'USD',
      usage: {
        today: { actual_cost: 0, cost: 2, requests: 0, total_tokens: 0 },
        total: { actual_cost: 0.38, cost: 3, requests: 5, total_tokens: 1200 }
      }
    })).toEqual([
      { planName: '当前可用额度', isValid: true, remaining: 10, unit: 'USD', extra: '钱包余额' },
      { planName: '今日 Key 消耗', isValid: true, used: 0, unit: 'USD', extra: '0 次请求 / 0 Token' },
      { planName: 'Key 累计消耗', isValid: true, used: 0.38, unit: 'USD', extra: '5 次请求 / 1200 Token' }
    ])
  })

  it('uses legacy quota and cost fields without inventing missing statistics', () => {
    expect(evaluateUsageScript().extractor({
      quota: { limit: 20, used: 8, remaining: 12, unit: 'USD' },
      usage: { total: { cost: 8 } }
    })).toEqual([
      { planName: '当前可用额度', isValid: true, remaining: 12, total: 20, used: 8, unit: 'USD', extra: '' },
      { planName: 'Key 累计消耗', isValid: true, used: 8, unit: 'USD' }
    ])
    expect(evaluateUsageScript().extractor({ balance: 0 })).toEqual([
      { planName: '当前可用额度', isValid: true, remaining: 0, unit: 'USD', extra: '' }
    ])
  })

  it('returns configured subscription windows and clamps exhausted quota to zero', () => {
    expect(evaluateUsageScript().extractor({
      remaining: 0, planName: '专业套餐',
      subscription: {
        daily_limit_usd: 5, daily_usage_usd: 6,
        weekly_limit_usd: 20, weekly_usage_usd: 8,
        monthly_limit_usd: null, monthly_usage_usd: 8
      }
    })).toEqual([
      { planName: '当前可用额度', isValid: true, remaining: 0, unit: 'USD', extra: '专业套餐' },
      { planName: '订阅每日额度', isValid: true, used: 6, total: 5, remaining: 0, unit: 'USD' },
      { planName: '订阅每周额度', isValid: true, used: 8, total: 20, remaining: 12, unit: 'USD' }
    ])
  })

  it('shows rate-only keys without requiring a wallet balance or total quota', () => {
    expect(evaluateUsageScript().extractor({
      mode: 'quota_limited', isValid: true,
      rate_limits: [
        { window: '5h', limit: 10, used: 2 },
        { window: '1d', limit: 20, used: 0 },
        { window: '7d', limit: 30, used: 31 }
      ]
    })).toEqual([
      { planName: 'Key 5 小时额度', isValid: true, used: 2, total: 10, remaining: 8, unit: 'USD' },
      { planName: 'Key 每日额度', isValid: true, used: 0, total: 20, remaining: 20, unit: 'USD' },
      { planName: 'Key 每周额度', isValid: true, used: 31, total: 30, remaining: 0, unit: 'USD' }
    ])
  })

  it('does not display the unlimited sentinel as a negative balance', () => {
    expect(evaluateUsageScript().extractor({ remaining: -1, planName: '不限额订阅' })[0]).toEqual({
      planName: '当前可用额度', isValid: true, unit: 'USD', extra: '不限额'
    })
  })

  it.each([
    null,
    {},
    { error: { message: '密钥无效' } },
    { isValid: false, remaining: 10, status: 'disabled' },
    { is_active: false, balance: 10 },
    { usage: { today: { actual_cost: null }, total: { cost: -2 } } },
    { remaining: Number.NaN, quota: { limit: Number.POSITIVE_INFINITY } }
  ])('does not turn invalid or unavailable usage into a successful zero balance: %j', response => {
    expect(evaluateUsageScript().extractor(response)).toEqual([
      expect.objectContaining({ isValid: false, invalidMessage: expect.any(String) })
    ])
  })
})
