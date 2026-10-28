import { createBrowserRouter, Outlet } from "react-router-dom";

import { AnalyticsTracker } from "@/components/layout/analytics-tracker";
import UserLayout from "@/layouts/user-layout";
import AssetsPage from "@/pages/assets";
import CanvasPage from "@/pages/canvas";
import CanvasProjectPage from "@/pages/canvas/project";
import ConfigPage from "@/pages/config";
import HomePage from "@/pages/home";
import ImagePage from "@/pages/image";
import NotFound from "@/pages/not-found";
import PromptsPage from "@/pages/prompts";
import VideoPage from "@/pages/video";

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
                { path: "/assets", element: <AssetsPage /> },
                { path: "/canvas", element: <CanvasPage /> },
                { path: "/canvas/:id", element: <CanvasProjectPage /> },
            ] : [
                { path: "/", element: <HomePage /> },
                { path: "/image", element: <ImagePage /> },
                { path: "/video", element: <VideoPage /> },
                { path: "/assets", element: <AssetsPage /> },
                { path: "/prompts", element: <PromptsPage /> },
                { path: "/canvas", element: <CanvasPage /> },
                { path: "/canvas/:id", element: <CanvasProjectPage /> },
                { path: "/config", element: <ConfigPage /> },
            ],
        },
        { path: "*", element: <NotFound /> },
    ],
    {
        basename: getBasename(),
    },
);
