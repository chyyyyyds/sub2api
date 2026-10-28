/** @description 已核对网关适配的图片能力；未知名称和别名不推断为已支持。 */
export interface HostImageCapability {
    /** @description 仅用于能力判断的实际模型；请求仍保留用户选择的模型名。 */
    capabilityModel: string;
    /** @description 是否有经过核对的能力配置。 */
    verified: boolean;
    /** @description 是否支持参考图编辑。 */
    edit: boolean;
    /** @description 是否允许透明背景。 */
    transparent: boolean;
    /** @description 是否支持网关现有的自定义尺寸约束。 */
    flexibleSize: boolean;
    /** @description 明确支持的尺寸；auto 表示省略该字段。 */
    sizes: string[];
    /** @description 明确支持的质量；auto 表示省略该字段。 */
    qualities: string[];
    /** @description 模型与网关支持的图片输出格式。 */
    formats: string[];
}
const legacySizes = ["auto", "1024x1024", "1536x1024", "1024x1536"];
export function hostImageCapability(model: string): HostImageCapability {
    // 当前账号已由 Sub2API 将展示名映射到 Flare；此处只选能力，不改写请求模型。
    const capabilityModel = model === "gpt-image-2.5" ? "gpt-image-2.5-flare" : model;
    // 使用精确名称，未来版本和自定义别名须单独核对，不能仅凭前缀宣称能力。
    const legacy = ["gpt-image-1", "gpt-image-1-mini", "gpt-image-1.5"].includes(model);
    const current = ["gpt-image-2", "gpt-image-2-2026-04-21"].includes(model);
    const flare = ["gpt-image-2.5-flare", "gpt-image-2.5-flare-2026-09-08"].includes(capabilityModel);
    const verified = legacy || current || flare;
    return { capabilityModel, verified, edit: verified, transparent: legacy,
        flexibleSize: current || flare, sizes: legacySizes,
        qualities: flare ? ["auto", "low", "medium", "high", "xhigh", "max"] : verified ? ["auto", "low", "medium", "high"] : ["auto"],
        formats: verified ? ["png", "jpeg", "webp"] : [] };
}

/** @description 只构造宿主同源 Images 接口已验证的参数；不自动重试收费请求。 */
export function hostImageParams(config: {
    /** @description 用户端模型名，由网关执行映射与计费归属。 */
    model: string;
    /** @description 自动尺寸或最终像素宽高，不接受分辨率档位。 */
    size: string;
    /** @description 当前模型支持的质量档位。 */
    quality: string;
    /** @description 透明背景；空值表示模型默认背景。 */
    background?: string;
    /** @description 批量意图；工作台快照逐张请求时固定为 1。 */
    count: string;
    /** @description 图片输出格式，不影响用户模型名。 */
    imageOutputFormat?: string;
    /** @description JPEG/WebP 压缩率，范围为 0～100。 */
    imageOutputCompression?: string;
}, references = 0) {
    const capability = hostImageCapability(config.model);
    if (!capability.verified) throw new Error("该模型的图片协议与参数尚未验证，请选择已验证模型；自定义别名需先核对网关映射。");
    if (references && !capability.edit) throw new Error("当前模型未验证参考图编辑能力。");
    if (references > 16) throw new Error("当前已验证模型最多支持 16 张参考图，请移除多余图片。");
    const count = config.count === "" ? NaN : Number(config.count || "1");
    // 保持原有批量上限；工作台逐张发送，每张请求独立进入网关计费。
    if (!Number.isInteger(count) || count < 1 || count > 10) throw new Error("生成数量必须为 1 到 10 的整数。");
    const quality = config.quality || "auto";
    if (!capability.qualities.includes(quality)) throw new Error("当前模型不支持所选质量，请重新选择。");
    const size = config.size || "auto";
    if (!capability.sizes.includes(size)) {
        const match = /^(\d+)x(\d+)$/.exec(size);
        const w = Number(match?.[1]), h = Number(match?.[2]);
        if (!capability.flexibleSize || !match || !w || !h || w % 16 || h % 16 || Math.max(w, h) > 3840 || Math.max(w, h) / Math.min(w, h) > 3 || w * h < 655360 || w * h > 8294400) {
            throw new Error("当前模型不支持此尺寸，请选择已列出的尺寸或符合约束的自定义尺寸。");
        }
    }
    const format = config.imageOutputFormat || "png";
    if (!capability.formats.includes(format)) throw new Error("当前模型不支持所选图片格式。");
    if (config.background && (config.background !== "transparent" || !capability.transparent || format === "jpeg")) throw new Error("当前模型或图片格式未验证透明背景支持，请关闭透明背景。");
    const compressed = format === "jpeg" || format === "webp";
    const compressionValue = config.imageOutputCompression ?? "85";
    const compression = Number(compressionValue);
    if (compressed && (!/^\d+$/.test(compressionValue) || !Number.isInteger(compression) || compression < 0 || compression > 100)) throw new Error("输出压缩率必须为 0 到 100 的整数。");
    return { model: config.model, n: count, ...(quality !== "auto" ? { quality } : {}), ...(size !== "auto" ? { size } : {}),
        ...(config.imageOutputFormat || config.background ? { output_format: format } : {}),
        ...(compressed ? { output_compression: compression } : {}),
        ...(config.background ? { background: config.background } : {}) };
}
