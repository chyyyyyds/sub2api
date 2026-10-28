/** @description 宿主 IndexedDB 故障状态，不包含作品内容、凭证或底层错误。 */
let warning = "";
let readFailed = false;
const listeners = new Set<() => void>();
export const getHostStorageWarning = () => warning;
export const subscribeHostStorageWarning = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
/** @description 标记读取或写入失败，统一脱敏并保护未读取的历史。 */
export function reportHostStorageFailure(read: boolean): never {
    if (read) readFailed = true;
    warning = "浏览器本地存储不可用或空间不足，作品可能尚未保存。请先下载重要图片；读取失败时已阻止覆盖历史，恢复存储后请刷新重试。";
    listeners.forEach(listener => listener());
    const error = new Error(warning);
    error.name = "HostStorageError";
    throw error;
}
/** @description 统一保护宿主存储，读取异常后禁止覆盖可能仍存在的历史。 */
export function guardHostStorage<T extends object>(target: T): T {
    return new Proxy(target, {
        get(store, key) {
            const member = Reflect.get(store, key);
            if (typeof member !== "function") return member;
            if (!["ready", "getItem", "setItem", "removeItem", "clear", "keys", "iterate", "length"].includes(String(key))) return member.bind(store);
            return async (...args: unknown[]) => {
                try {
                    if (readFailed && ["setItem", "removeItem", "clear"].includes(String(key))) throw new Error("storage-read-failed");
                    return await member.apply(store, args);
                } catch {
                    reportHostStorageFailure(["ready", "getItem", "keys", "iterate", "length"].includes(String(key)));
                }
            };
        },
    });
}
