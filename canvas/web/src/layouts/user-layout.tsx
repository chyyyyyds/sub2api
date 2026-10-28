import type { ReactNode } from "react";

import { AgentPanel } from "@/components/agent/agent-panel";
import { AppTopNav } from "@/components/layout/app-top-nav";

import { IS_SUB2API_HOST } from "@/lib/sub2api-context";

export default function UserLayout({ children }: { children: ReactNode }) {
    return (
        <div className="flex h-dvh overflow-hidden bg-background text-foreground">
            <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
                {!IS_SUB2API_HOST && <AppTopNav />}
                <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
            </div>
            {!IS_SUB2API_HOST && <AgentPanel />}
        </div>
    );
}
