/** @description 仅表示客户端入站协议；不代表上游账号、权限或计费能力。 */
export type ChatProtocol = 'chat' | 'messages' | 'responses'
/** @description 经部署人员核对的精确协议规则；禁止放入渠道详情、地址或凭证。 */
export interface ChatProtocolRule {
  /** @description 登录用户 ID，避免规则跨用户套用。 */
  userId: number
  /** @description 已授权的用户 Key ID。 */
  keyId: number
  /** @description 精确匹配的客户端模型名，不支持通配符。 */
  model: string
  /** @description 已核对的网关入站协议。 */
  protocol: ChatProtocol
}
/** @description 协议及依据，未知别名必须展示兼容性待验证。 */
export interface ChatCapability {
  /** @description 本次使用的协议。 */
  protocol: ChatProtocol
  /** @description 部署配置、标准模型默认入口或未知兼容入口。 */
  source: 'configured' | 'standard' | 'compatibility'
}

/** @description 构建配置只能由部署者修改；不读取管理员接口，不进行任何能力探测请求。 */
export function chatCapability(model: string, userId = 0, keyId = 0, rules?: readonly ChatProtocolRule[]): ChatCapability {
  if (!rules) {
    try { rules = JSON.parse(import.meta.env.VITE_CREATION_CHAT_PROTOCOLS || '[]') }
    catch { throw new Error('configuration') }
  }
  if (!Array.isArray(rules) || rules.some(rule => !rule || !Number.isSafeInteger(rule.userId) || rule.userId <= 0 ||
    !Number.isSafeInteger(rule.keyId) || rule.keyId <= 0 || typeof rule.model !== 'string' || !rule.model.trim() ||
    !['chat', 'messages', 'responses'].includes(rule.protocol))) throw new Error('configuration')
  const matches = rules.filter(rule => rule.model === model && rule.userId === userId && rule.keyId === keyId)
  if (matches.length > 1) throw new Error('configuration')
  if (matches[0]) return { protocol: matches[0].protocol, source: 'configured' }
  // 仅保留标准家族的既有入口；名称中间碰巧含有 Claude/Codex 的私有别名不继承能力。
  if (/^claude-(?:sonnet|opus|haiku|instant|[1-4])(?:[-.]|$)/i.test(model)) return { protocol: 'messages', source: 'standard' }
  if (/^(?:gpt-(?:[\d.]+-)?codex(?:[-.]|$)|codex-mini-latest$)/i.test(model)) return { protocol: 'responses', source: 'standard' }
  if (/^(?:gpt-[\d]|o[134](?:[-.]|$)|chatgpt-|deepseek-|gemini-|grok-)/i.test(model)) return { protocol: 'chat', source: 'standard' }
  return { protocol: 'chat', source: 'compatibility' }
}
