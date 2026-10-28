/** 宿主配置仅驻留当前 iframe 内存，必须在加载任何业务 store 前确定。 */
export const IS_SUB2API_HOST = import.meta.env?.VITE_SUB2API_HOST === "true";
export type HostConfig = {
    /** @description 消息类型，复用原画布协议 */
    type: "new-api:canvas-config";
    /** @description 协议版本 */
    version: 1;
    /** @description 同源网关地址 */
    baseUrl: string;
    /** @description 当前用户自己的 API Key，仅驻留内存 */
    apiKey: string;
    /** @description 用户令牌显示名 */
    channelName: string;
    /** @description 用户 Key ID，仅用于生成记录归属，不是凭证。 */
    keyId?: number;
    /** @description 用户本地存储命名空间 */
    historyScope: string;
    /** @description 画布实例标识 */
    frameId: string;
    /** @description 宿主会话标识 */
    sessionId: string;
    /** @description 用户当前可用模型 */
    models: string[];
    /** @description 当前图片模型，必须属于可用列表 */
    preferredModel: string;
    /** @description 本轮只允许图片工作台 */
    studio: "image";
};
let host: HostConfig | null = null;
export function getHostConfig() { return host; }
export function setHostConfig(value: HostConfig | null) { host = value; }
export function parseHostConfig(data: unknown, origin: string, frameId: string): HostConfig | null {
    if (!data || typeof data !== "object") return null;
    const c = data as HostConfig;
    if (c.type !== "new-api:canvas-config" || c.version !== 1 || c.frameId !== frameId || c.studio !== "image") return null;
    if (c.baseUrl !== origin || typeof c.apiKey !== "string" || !c.apiKey.trim() || /[\r\n]/.test(c.apiKey)) return null;
    if (typeof c.historyScope !== "string" || !/^sub2api-user-[1-9]\d*$/.test(c.historyScope) || typeof c.sessionId !== "string" || !c.sessionId) return null;
    if (typeof c.channelName !== "string" || !Array.isArray(c.models) || !c.models.every(m => typeof m === "string" && m.trim())) return null;
    if (!c.models.includes(c.preferredModel)) return null;
    return c;
}
