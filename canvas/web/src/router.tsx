import { createBrowserRouter, Outlet } from "react-router-dom";

import { AnalyticsTracker } from "@/components/layout/analytics-tracker";
import UserLayout from "@/layouts/user-layout";
import ImagePage from "@/pages/image";
import NotFound from "@/pages/not-found";

const getBasename = () => {
    const base = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
    if (base) return base;
    if (typeof window !== "undefined" && window.location.pathname.startsWith("/canvas")) {
        return "/canvas";
    }
    return undefined;
};

import { IS_SUB2API_HOST } from "@/lib/sub2api-context";

export const router = createBrowserRouter(
    [
        {
            element: (
                <UserLayout>
                    <AnalyticsTracker />
                    <Outlet />
                </UserLayout>
            ),
            children: IS_SUB2API_HOST ? [
                { path: "/", element: <ImagePage /> },
                { path: "/image", element: <ImagePage /> },
                // 图片页首屏不加载画布编辑器、视频和文档渲染等重型依赖。
                { path: "/assets", lazy: async () => ({ Component: (await import("@/pages/assets")).default }) },
                { path: "/canvas", lazy: async () => ({ Component: (await import("@/pages/canvas")).default }) },
                { path: "/canvas/:id", lazy: async () => ({ Component: (await import("@/pages/canvas/project")).default }) },
            ] : [
                { path: "/", lazy: async () => ({ Component: (await import("@/pages/home")).default }) },
                { path: "/image", element: <ImagePage /> },
                { path: "/video", lazy: async () => ({ Component: (await import("@/pages/video")).default }) },
                { path: "/assets", lazy: async () => ({ Component: (await import("@/pages/assets")).default }) },
                { path: "/prompts", lazy: async () => ({ Component: (await import("@/pages/prompts")).default }) },
                { path: "/canvas", lazy: async () => ({ Component: (await import("@/pages/canvas")).default }) },
                { path: "/canvas/:id", lazy: async () => ({ Component: (await import("@/pages/canvas/project")).default }) },
                { path: "/config", lazy: async () => ({ Component: (await import("@/pages/config")).default }) },
            ],
        },
        { path: "*", element: <NotFound /> },
    ],
    {
        basename: getBasename(),
    },
);
