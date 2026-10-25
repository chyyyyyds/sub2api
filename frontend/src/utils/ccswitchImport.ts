import type { GroupPlatform } from '@/types'

export const OPENAI_CC_SWITCH_CODEX_MODEL = 'gpt-5.5'
export const GROK_CC_SWITCH_MODEL = 'grok-4.5'

export type CcSwitchClientType = 'claude' | 'gemini'

export interface CcSwitchImportConfig {
  app: string
  endpoint: string
  model?: string
}

export interface CcSwitchImportDeeplinkInput {
  baseUrl: string
  platform?: GroupPlatform | null
  clientType: CcSwitchClientType
  providerName: string
  apiKey: string
  usageScript: string
}

/**
 * CCS 用量查询脚本：将 /v1/usage 的响应转换为多行套餐用量。
 * @param response 接口响应，包含余额、Key 额度、周期限额及 usage.today/total 统计。
 * @returns CCS 套餐数组；每行使用 planName、remaining、used、total、unit、extra 等字段。
 */
export const CC_SWITCH_USAGE_SCRIPT = `({
    request: {
      // 去掉客户端专用后缀，统一查询无需计费校验的用量接口。
      url: "{{baseUrl}}".replace(/\\/+$/, "").replace(/\\/antigravity$/, "").replace(/\\/v1$/, "") + "/v1/usage",
      method: "GET",
      headers: { "Authorization": "Bearer {{apiKey}}" }
    },
    extractor: function(response) {
      if (!response || response.error || response.isValid === false || response.is_active === false) {
        return [{
          planName: "套餐用量",
          isValid: false,
          invalidMessage: response?.error?.message || response?.message || response?.status || "用量查询失败"
        }];
      }
      const quota = response.quota || {};
      const unit = response.unit || quota.unit || "USD";
      const isAmount = function(value) {
        return typeof value === "number" && Number.isFinite(value) && value >= 0;
      };
      const remaining = response.remaining ?? quota.remaining ?? response.balance;
      const plans = [];

      // 当前额度与 Key 消耗分别展示，避免把钱包余额误当成 Key 总额度。
      if (isAmount(remaining) || remaining === -1 || isAmount(quota.limit)) {
        const available = { planName: "当前可用额度", isValid: true, unit: unit };
        if (isAmount(remaining)) available.remaining = remaining;
        if (isAmount(quota.limit) && quota.limit > 0) {
          available.total = quota.limit;
          if (isAmount(quota.used)) available.used = quota.used;
        }
        available.extra = remaining === -1 ? "不限额" : (response.planName || "");
        plans.push(available);
      }

      // actual_cost 是实际扣费；保留旧接口仅返回 cost 时的兼容回退。
      [["today", "今日 Key 消耗"], ["total", "Key 累计消耗"]].forEach(function(entry) {
        const stats = response.usage?.[entry[0]];
        const cost = stats?.actual_cost ?? stats?.cost;
        if (!isAmount(cost)) return;
        const plan = { planName: entry[1], isValid: true, used: cost, unit: "USD" };
        const details = [];
        if (isAmount(stats.requests)) details.push(stats.requests + " 次请求");
        if (isAmount(stats.total_tokens)) details.push(stats.total_tokens + " Token");
        if (details.length) plan.extra = details.join(" / ");
        plans.push(plan);
      });

      // 有限额的订阅和 Key 滚动窗口返回真实的 used/total，供 CCS 绘制进度条。
      const addLimit = function(name, used, limit) {
        if (!isAmount(limit) || limit <= 0 || !isAmount(used)) return;
        plans.push({
          planName: name, isValid: true, used: used, total: limit,
          remaining: Math.max(0, limit - used), unit: "USD"
        });
      };
      const subscription = response.subscription;
      if (subscription) {
        [["daily", "订阅每日额度"], ["weekly", "订阅每周额度"], ["monthly", "订阅每月额度"]].forEach(function(entry) {
          addLimit(entry[1], subscription[entry[0] + "_usage_usd"], subscription[entry[0] + "_limit_usd"]);
        });
      }
      if (Array.isArray(response.rate_limits)) {
        const names = { "5h": "Key 5 小时额度", "1d": "Key 每日额度", "7d": "Key 每周额度" };
        response.rate_limits.forEach(function(limit) {
          if (limit) addLimit(names[limit.window] || ("Key " + limit.window + " 额度"), limit.used, limit.limit);
        });
      }
      return plans.length ? plans : [{ isValid: false, invalidMessage: "暂无可用的用量数据" }];
    }
  })`

function withV1Endpoint(baseUrl: string): string {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, '')
  return normalizedBaseUrl.endsWith('/v1') ? normalizedBaseUrl : `${normalizedBaseUrl}/v1`
}

function withoutTrailingSlashes(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '')
}

export function resolveCcSwitchImportConfig(
  platform: GroupPlatform | undefined | null,
  clientType: CcSwitchClientType,
  baseUrl: string
): CcSwitchImportConfig {
  switch (platform || 'anthropic') {
    case 'antigravity':
      return {
        app: clientType === 'gemini' ? 'gemini' : 'claude',
        endpoint: `${baseUrl.replace(/\/+$/, '')}/antigravity`
      }
    case 'openai':
      return {
        app: 'codex',
        // CC Switch's Codex provider appends the OpenAI-compatible path itself.
        // Passing /v1 here can make the client request /v1/v1/....
        endpoint: withoutTrailingSlashes(baseUrl),
        model: OPENAI_CC_SWITCH_CODEX_MODEL
      }
    case 'gemini':
      return {
        app: 'gemini',
        endpoint: baseUrl
      }
    case 'grok':
      return {
        app: 'grokbuild',
        endpoint: withV1Endpoint(baseUrl),
        model: GROK_CC_SWITCH_MODEL
      }
    default:
      return {
        app: 'claude',
        endpoint: baseUrl
      }
  }
}

export function buildCcSwitchImportDeeplink(input: CcSwitchImportDeeplinkInput): string {
  const config = resolveCcSwitchImportConfig(input.platform, input.clientType, input.baseUrl)
  const entries: [string, string][] = [
    ['resource', 'provider'],
    ['app', config.app],
    ['name', input.providerName],
    ['homepage', input.baseUrl],
    ['endpoint', config.endpoint],
    ['apiKey', input.apiKey],
    ['configFormat', 'json'],
    ['usageEnabled', 'true'],
    // CCS 按 UTF-8 解码 Base64，直接 btoa 中文脚本会抛出异常。
    ['usageScript', btoa(Array.from(new TextEncoder().encode(input.usageScript), (byte) => String.fromCharCode(byte)).join(''))],
    ['usageAutoInterval', '30']
  ]

  if (config.model) {
    entries.splice(2, 0, ['model', config.model])
  }

  return `ccswitch://v1/import?${new URLSearchParams(entries).toString()}`
}
