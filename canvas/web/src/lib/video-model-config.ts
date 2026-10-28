/** KOKO 视频模型能力，字段对应 GET /models 的实时约束。 */
export type VideoModelConfig = {
    /** @description 请求分辨率；供应商展示名称可能与实际允许值不同 */
    resolution: "720p" | "1K";
    /** @description 允许的视频时长，单位秒 */
    durations: readonly number[];
    /** @description 初始选择的视频时长，单位秒 */
    defaultDuration: number;
    /** @description 支持的画面比例 */
    ratios: readonly string[];
    /** @description 提示词最大字符数 */
    maxPromptLength: number;
    /** @description 是否至少需要一张参考图片 */
    requiresImage?: boolean;
};

export const KOKO_VIDEO_RATIOS = ["9:16", "1:1", "3:4", "4:3", "16:9"] as const;

// 新任务仅提供当前四个模型；历史任务和生成记录保持可查。
const kokoVideoModels: Record<string, VideoModelConfig> = {
    "minimax-h3-933": { resolution: "1K", durations: [15], defaultDuration: 15, ratios: KOKO_VIDEO_RATIOS, maxPromptLength: 10000, requiresImage: true },
    "oo-sd25-1080p": { resolution: "720p", durations: [30], defaultDuration: 30, ratios: KOKO_VIDEO_RATIOS, maxPromptLength: 8000 },
    "mm-h3-768-stable": { resolution: "720p", durations: [15, 30], defaultDuration: 15, ratios: KOKO_VIDEO_RATIOS, maxPromptLength: 15000 },
    "pp-sd25-stable": { resolution: "720p", durations: [30], defaultDuration: 30, ratios: KOKO_VIDEO_RATIOS, maxPromptLength: 15000 },
};

/** 返回 KOKO 模型参数范围；其他供应商继续沿用通用视频配置。 */
export function kokoVideoModelConfig(model: string): VideoModelConfig | null {
    return kokoVideoModels[model.trim().toLowerCase()] || null;
}

export function videoResolutionPixels(resolution: VideoModelConfig["resolution"]): string {
    return resolution === "1K" ? "1024" : "720";
}

export function normalizeKokoVideoDuration(model: string, value: string): string {
    const config = kokoVideoModelConfig(model);
    if (!config) return value;
    const duration = Math.round(Number(value));
    return String(config.durations.includes(duration) ? duration : config.defaultDuration);
}
