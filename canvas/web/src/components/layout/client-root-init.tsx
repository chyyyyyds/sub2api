import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import { App } from "antd";
import { useTranslation } from "react-i18next";

import { NEW_API_CANVAS_CONFIGURED, NEW_API_CANVAS_READY, parseNewApiCanvasConfig } from "@/lib/new-api-host";
import { fetchChannelModels } from "@/services/api/image";
import { useConfigStore } from "@/stores/use-config-store";
import { usePromptSourceScheduler } from "@/hooks/use-prompt-source-scheduler";

import { IS_SUB2API_HOST } from "@/lib/sub2api-context";

export function ClientRootInit({ children }: { children: ReactNode }) {
    if (IS_SUB2API_HOST) return <>{children}</>;
    return <StandaloneRootInit>{children}</StandaloneRootInit>;
}

function StandaloneRootInit({ children }: { children: ReactNode }) {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const handledConfigParams = useRef(false);
    const managedChannelRequest = useRef(0);
    const importChannelCredentials = useConfigStore((state) => state.importChannelCredentials);
    const updateChannelModels = useConfigStore((state) => state.updateChannelModels);
    const setHistoryScope = useConfigStore((state) => state.setHistoryScope);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);

    usePromptSourceScheduler();

    useEffect(() => {
        if (handledConfigParams.current) return;
        const searchParams = new URLSearchParams(window.location.search);
        const baseUrl = searchParams.get("baseUrl") || searchParams.get("baseurl");
        const apiKey = searchParams.get("apiKey") || searchParams.get("apikey");
        if (!baseUrl && !apiKey) return;
        handledConfigParams.current = true;
        searchParams.delete("baseUrl");
        searchParams.delete("baseurl");
        searchParams.delete("apiKey");
        searchParams.delete("apikey");
        window.history.replaceState(null, "", `${window.location.pathname}${searchParams.size ? `?${searchParams}` : ""}${window.location.hash}`);
        const result = importChannelCredentials({ baseUrl, apiKey });
        openConfigDialog(false, "channels");
        if (result.status === "created") message.success(t("config.importedChannelCreated", { name: result.channelName }));
        else if (result.status === "updated") message.success(t("config.importedChannelUpdated", { name: result.channelName }));
        else if (result.status === "missing-base-url") message.error(t("config.importedChannelBaseUrlRequired"));
        else message.error(t("config.importedChannelBaseUrlInvalid"));
    }, [importChannelCredentials, message, openConfigDialog, t]);

    useEffect(() => {
        if (window.parent === window) return;

        const parentOrigin = window.location.origin;
        const handleMessage = async (event: MessageEvent) => {
            // 仅接受同源父窗口发送的配置，避免第三方页面注入或窃取 API Key。
            if (event.origin !== parentOrigin || event.source !== window.parent) return;
            const config = parseNewApiCanvasConfig(event.data, parentOrigin);
            if (!config) return;

            const requestId = ++managedChannelRequest.current;
            setHistoryScope(config.historyScope);
            const result = importChannelCredentials({ ...config, managedByHost: true });
            const channel = useConfigStore.getState().config.channels.find((item) => item.id === result.channelId);
            if (!channel) return;

            try {
                const models = await fetchChannelModels(channel);
                if (requestId !== managedChannelRequest.current) return;
                updateChannelModels(channel.id, models, config);
                window.parent.postMessage({ type: NEW_API_CANVAS_CONFIGURED, version: 1 }, parentOrigin);
                message.success(t("config.modelSelect.fetched", { count: models.length }));
            } catch (error) {
                if (requestId !== managedChannelRequest.current) return;
                message.error(error instanceof Error ? error.message : t("config.modelSelect.fetchFailed"));
            }
        };

        window.addEventListener("message", handleMessage);
        window.parent.postMessage({ type: NEW_API_CANVAS_READY, version: 1 }, parentOrigin);
        return () => window.removeEventListener("message", handleMessage);
    }, [importChannelCredentials, message, setHistoryScope, t, updateChannelModels]);

    return <>{children}</>;
}
