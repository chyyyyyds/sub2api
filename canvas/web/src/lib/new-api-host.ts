import { KOKO_VIDEO_RATIOS } from "@/lib/video-model-config";

export const NEW_API_CANVAS_READY = "new-api:canvas-ready";
export const NEW_API_CANVAS_CONFIG = "new-api:canvas-config";
export const NEW_API_CANVAS_CONFIGURED = "new-api:canvas-configured";

export type NewApiCanvasConfig = {
    type: typeof NEW_API_CANVAS_CONFIG;
    version: 1;
    baseUrl: string;
    apiKey: string;
    channelName: string;
    historyScope: string;
    studio?: "image" | "video";
    preferredModel?: string;
    videoSeconds?: string;
    videoResolution?: string;
    videoSize?: string;
};

export function parseNewApiCanvasConfig(data: unknown, expectedOrigin: string): NewApiCanvasConfig | null {
    if (!data || typeof data !== "object") return null;
    const candidate = data as Record<string, unknown>;
    if (candidate.type !== NEW_API_CANVAS_CONFIG || candidate.version !== 1 || typeof candidate.baseUrl !== "string" || typeof candidate.apiKey !== "string" || typeof candidate.channelName !== "string" || typeof candidate.historyScope !== "string")
        return null;

    const apiKey = candidate.apiKey.trim();
    const channelName = candidate.channelName.trim();
    const historyScope = candidate.historyScope.trim();
    if (!apiKey.startsWith("sk-") || apiKey.length <= 3) return null;
    if (!channelName || channelName.length > 100) return null;
    if (!/^user-[1-9]\d{0,19}$/.test(historyScope)) return null;

    const studio = candidate.studio;
    if (studio !== undefined && studio !== "image" && studio !== "video") return null;
    const preferredModel = typeof candidate.preferredModel === "string" ? candidate.preferredModel.trim() : undefined;
    if (preferredModel !== undefined && (!preferredModel || preferredModel.length > 200)) return null;
    const videoSeconds = typeof candidate.videoSeconds === "string" ? candidate.videoSeconds : undefined;
    if (videoSeconds !== undefined && !/^([4-9]|[12]\d|30)$/.test(videoSeconds)) return null;
    const videoResolution = typeof candidate.videoResolution === "string" ? candidate.videoResolution : undefined;
    if (videoResolution !== undefined && !["480", "720", "1080"].includes(videoResolution)) return null;
    const videoSize = typeof candidate.videoSize === "string" ? candidate.videoSize : undefined;
    if (videoSize !== undefined && !/^\d{2,5}x\d{2,5}$/.test(videoSize) && !KOKO_VIDEO_RATIOS.includes(videoSize as (typeof KOKO_VIDEO_RATIOS)[number])) return null;

    try {
        const baseUrl = new URL(candidate.baseUrl.trim());
        if (baseUrl.origin !== expectedOrigin) return null;
        return {
            type: NEW_API_CANVAS_CONFIG,
            version: 1,
            baseUrl: baseUrl.origin,
            apiKey,
            channelName,
            historyScope,
            ...(studio ? { studio } : {}),
            ...(preferredModel ? { preferredModel } : {}),
            ...(videoSeconds ? { videoSeconds } : {}),
            ...(videoResolution ? { videoResolution } : {}),
            ...(videoSize ? { videoSize } : {}),
        };
    } catch {
        return null;
    }
}
