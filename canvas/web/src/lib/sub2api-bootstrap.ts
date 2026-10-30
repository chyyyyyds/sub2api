import axios from "axios";
import { getHostConfig, parseHostConfig, setHostConfig } from "./sub2api-context";

/** 在任何业务 store 初始化前验证父窗口，隔离用户数据库与凭证生命周期。 */
export function startHostCanvas() {
    const root = document.getElementById("root")!;
    if (window.parent === window || !/^\/canvas\/(image|assets|canvas(?:\/[^/]+)?)\/?$/.test(location.pathname)) {
        root.textContent = "请从 Sub2API 的 AI 创作页面打开图片工作台";
        return;
    }
    // 嵌入页面等待宿主配置和应用资源期间，明确展示加载状态。
    const loading = document.createElement("div");
    loading.setAttribute("role", "status");
    loading.style.cssText = "display:grid;place-items:center;min-height:100vh;font-size:14px";
    loading.textContent = "图片工作台加载中…";
    root.replaceChildren(loading);
    const frameId = crypto.randomUUID();
    let requests = new AbortController();
    let ownerScope = "";
    let started = false;
    let appMounted = false;
    let retired = false;

    function ownerIsCurrent() {
        try {
            const config = getHostConfig();
            return Boolean(config && localStorage.getItem("auth_token") && `sub2api-user-${JSON.parse(localStorage.getItem("auth_user") || "null")?.id}` === config.historyScope);
        } catch { return false; }
    }

    function retire() {
        if (retired) return;
        retired = true;
        requests.abort();
        setHostConfig(null);
        // 销毁整个文档，使 React 内存、对象 URL 和旧异步回调不再跨账户存活。
        location.replace("/canvas/image");
    }

    window.addEventListener("storage", event => {
        if (started && ["auth_token", "auth_user", null].includes(event.key) && !ownerIsCurrent()) retire();
    });
    window.addEventListener("unhandledrejection", event => {
        // 本地存储故障已通过持久提示展示，不把底层错误和路径泄露到界面。
        if (event.reason?.name === "HostStorageError") event.preventDefault();
    });
    window.addEventListener("pagehide", () => { requests.abort(); setHostConfig(null); });
    window.addEventListener("pageshow", event => { if (event.persisted) location.reload(); });

    // 凭证只用于同源图片网关，不允许模型脚本或配置改写把它发往其他地址。
    axios.interceptors.request.use(request => {
        const host = getHostConfig();
        if (retired || !host || !ownerIsCurrent()) throw new axios.CanceledError("画布会话已失效");
        const target = new URL(request.url || "", request.baseURL || location.origin);
        if (target.origin === location.origin && /^\/v1\/(models|images\/(generations|edits))$/.test(target.pathname)) {
            if (request.headers.get("Authorization") !== `Bearer ${host.apiKey}`) throw new axios.CanceledError("图片配置已切换，请重新生成");
            (request as typeof request & { hostSessionId: string }).hostSessionId = host.sessionId;
            request.headers.set("Authorization", `Bearer ${host.apiKey}`);
            const signal = request.signal as AbortSignal | undefined;
            request.signal = signal ? AbortSignal.any([requests.signal, signal]) : requests.signal;
        } else {
            // 允许读取生成图片的 HTTPS 地址，但不能携带用户凭证或提交其他业务请求。
            request.headers.delete("Authorization");
            if (request.method !== "get" || target.protocol !== "https:") throw new axios.CanceledError("仅开放图片创作接口");
        }
        return request;
    });
    axios.interceptors.response.use(response => {
        if (retired || !ownerIsCurrent() || ((response.config as typeof response.config & { hostSessionId?: string }).hostSessionId && (response.config as typeof response.config & { hostSessionId?: string }).hostSessionId !== getHostConfig()?.sessionId)) throw new axios.CanceledError("图片配置已切换或会话已失效");
        return response;
    });

    window.addEventListener("message", async event => {
        if (retired || event.origin !== location.origin || event.source !== window.parent) return;
        if (event.data?.type === "new-api:canvas-suspend" && event.data.version === 1 && event.data.frameId === frameId && event.data.sessionId === getHostConfig()?.sessionId) {
            requests.abort();
            requests = new AbortController();
            setHostConfig(null);
            return;
        }
        const config = parseHostConfig(event.data, location.origin, frameId);
        if (!config) return;
        if (ownerScope && ownerScope !== config.historyScope) return;
        requests.abort();
        requests = new AbortController();
        setHostConfig(config);
        if (!ownerIsCurrent()) { setHostConfig(null); return; }
        started = true;
        ownerScope = config.historyScope;
        try {
            const { defaultConfig, useConfigStore, encodeChannelModel } = await import("@/stores/use-config-store");
            if (retired || getHostConfig()?.sessionId !== config.sessionId) return;
            if (!appMounted) useConfigStore.setState({ config: { ...defaultConfig, size: "auto", channels: [], proxyEnabled: false }, historyScope: config.historyScope });
            const imported = useConfigStore.getState().importChannelCredentials({ ...config, managedByHost: true });
            useConfigStore.getState().updateChannelModels(imported.channelId!, config.models);
            // 自定义图片模型别名由用户在宿主选择，不改变服务端模型权限。
            const state = useConfigStore.getState();
            const channels = state.config.channels.map(channel => ({ ...channel, models: channel.models.map(model => ({ ...model, script: "", capability: "image" as const })) }));
            const selected = encodeChannelModel(imported.channelId!, config.preferredModel);
            useConfigStore.setState({ config: { ...state.config, channels, model: selected, imageModel: selected, proxyEnabled: false } });
            if (retired || !ownerIsCurrent()) return;
            // 保留加载提示，直到 React 首次渲染接管根节点，避免下载应用资源时出现空白。
            if (!appMounted) { appMounted = true; await import("../app"); }
            if (retired || getHostConfig()?.sessionId !== config.sessionId) return;
            window.parent.postMessage({ type: "new-api:canvas-configured", version: 1, frameId, sessionId: config.sessionId }, location.origin);
        } catch {
            requests.abort();
            setHostConfig(null);
            root.textContent = "画布加载失败，请返回主站重新连接";
        }
    });
    window.parent.postMessage({ type: "new-api:canvas-ready", version: 1, frameId }, location.origin);
}
