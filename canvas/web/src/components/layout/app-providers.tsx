import type { ReactNode } from "react";
import { useEffect, useSyncExternalStore } from "react";
import { ProConfigProvider } from "@ant-design/pro-components";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App, ConfigProvider } from "antd";
import enUS from "antd/es/locale/en_US";
import zhCN from "antd/es/locale/zh_CN";
import dayjs from "dayjs";
import "dayjs/locale/zh-cn";
import { useTranslation } from "react-i18next";

import { ClientRootInit } from "@/components/layout/client-root-init";
import type { AppLocale } from "@/i18n";
import { getAntThemeConfig } from "@/lib/app-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import { IS_SUB2API_HOST } from "@/lib/sub2api-context";
import { getHostStorageWarning, subscribeHostStorageWarning } from "@/lib/host-storage-status";

const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            staleTime: 30_000,
            retry: false,
            refetchOnWindowFocus: false,
        },
    },
});

export function AppProviders({ children }: { children: ReactNode }) {
    const storageWarning = useSyncExternalStore(subscribeHostStorageWarning, getHostStorageWarning);
    const { i18n, t } = useTranslation();
    const theme = useThemeStore((state) => state.theme);
    // 嵌入模式跟随 Midnight HUD 深色，不改写用户在独立 Canvas 保存的主题偏好。
    const dark = IS_SUB2API_HOST || theme === "dark";
    const antTheme = getAntThemeConfig(dark);
    if (IS_SUB2API_HOST) {
        antTheme.token = { ...antTheme.token, colorPrimary: "#28e1d5", colorTextLightSolid: "#031c20", colorBgContainer: "#0c1723", colorBgElevated: "#101e2a", colorBorder: "#284152", colorText: "#e5edf5", colorTextSecondary: "#8295a7", fontSize: 13 };
    }
    const locale = i18n.resolvedLanguage as AppLocale;

    useEffect(() => {
        document.documentElement.classList.toggle("dark", dark);
        document.documentElement.style.colorScheme = dark ? "dark" : "light";
    }, [dark, theme]);

    useEffect(() => {
        document.documentElement.lang = locale;
        document.title = t("meta.title");
        document.querySelector('meta[name="description"]')?.setAttribute("content", t("meta.description"));
        dayjs.locale(locale === "zh-CN" ? "zh-cn" : "en");
    }, [locale, t]);

    return (
        <ConfigProvider locale={locale === "zh-CN" ? zhCN : enUS} theme={antTheme}>
            <ProConfigProvider dark={dark}>
                <App>
                    {IS_SUB2API_HOST && storageWarning && <div role="alert" style={{ position: "fixed", top: 0, left: 0, right: 0, zIndex: 9999, padding: 12, background: antTheme.token?.colorBgElevated, color: antTheme.token?.colorText }}>{storageWarning}</div>}
                    <QueryClientProvider client={queryClient}>
                        <ClientRootInit>{children}</ClientRootInit>
                    </QueryClientProvider>
                </App>
            </ProConfigProvider>
        </ConfigProvider>
    );
}
