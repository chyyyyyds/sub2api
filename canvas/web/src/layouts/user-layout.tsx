import { lazy, Suspense, type ReactNode } from "react";

import { IS_SUB2API_HOST } from "@/lib/sub2api-context";

// 宿主图片工作台没有独立导航与 Agent 面板，不让其依赖占用首屏下载。
const AppTopNav = lazy(() => import("@/components/layout/app-top-nav").then(module => ({ default: module.AppTopNav })));
const AgentPanel = lazy(() => import("@/components/agent/agent-panel").then(module => ({ default: module.AgentPanel })));

export default function UserLayout({ children }: { children: ReactNode }) {
    return (
        <div className="flex h-dvh overflow-hidden bg-background text-foreground">
            <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
                {!IS_SUB2API_HOST && <Suspense fallback={null}><AppTopNav /></Suspense>}
                <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
            </div>
            {!IS_SUB2API_HOST && <Suspense fallback={null}><AgentPanel /></Suspense>}
        </div>
    );
}
