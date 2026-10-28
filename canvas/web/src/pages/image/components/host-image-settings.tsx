import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { hostImageCapability, hostImageParams } from "@/lib/host-image-capabilities";
import { imageSizePresets, inferMediaRatio, inferMediaScale, mediaRatioOptions } from "@/lib/media-size";
import { modelOptionName, type AiConfig } from "@/stores/use-config-store";
import styles from "../image-editor.module.css";

type HostImageSettingsProps = {
    /** @description 当前工作台的有效图片参数。 */
    config: AiConfig;
    /** @description 更新现有配置，复用原有请求和历史存储。 */
    onConfigChange: (key: "quality" | "size" | "count" | "background" | "imageSizeMode" | "imageOutputFormat" | "imageOutputCompression", value: string) => void;
};

const qualityLabels: Record<string, string> = { auto: "自动", low: "低", medium: "中", high: "高", xhigh: "超高", max: "极致" };
const sizeModeOf = (size: string) => size === "auto" ? "auto" : Object.values(imageSizePresets).some(sizes => Object.values(sizes).includes(size)) ? "preset" : "custom";

/** @description 复用真实请求的参数校验，返回可直接展示的中文错误；有效时返回空字符串。 */
export function imageSettingsError(config: AiConfig, references = 0): string {
    try {
        hostImageParams({ ...config, model: modelOptionName(config.imageModel || config.model) }, references);
        return "";
    } catch (error) {
        return error instanceof Error ? error.message : "请检查图片参数。";
    }
}

/** @description 仅用于 Sub2API 生图工作台的参数面板，不影响独立画布设置。 */
export function HostImageSettings({ config, onConfigChange }: HostImageSettingsProps) {
    const model = modelOptionName(config.imageModel || config.model);
    const capability = hostImageCapability(model);
    // 模式仅决定编辑器展示，宽高、比例和档位始终从同一个 size 推导。
    const sizeMode = config.imageSizeMode || sizeModeOf(config.size);
    const [align, setAlign] = useState(true);
    const [moreCount, setMoreCount] = useState(Number(config.count) > 4);
    const [adjusted, setAdjusted] = useState(false);
    const format = config.imageOutputFormat || "png";
    const compressed = format === "jpeg" || format === "webp";
    const scale = inferMediaScale(config.size) === "auto" ? "1k" : inferMediaScale(config.size);
    const ratio = inferMediaRatio(config.size);
    const [width = "1024", height = "1024"] = config.size === "auto" ? [] : config.size.split("x");
    const sizeError = imageSettingsError({ ...config, quality: "auto", count: "1", background: "", imageOutputFormat: "png" });

    useEffect(() => {
        // 切换模型时仅恢复不兼容参数，不触碰提示词、参考图和历史。
        const next = {
            quality: capability.qualities.includes(config.quality) ? config.quality : "auto",
            size: capability.flexibleSize || capability.sizes.includes(config.size) ? config.size : "auto",
            background: capability.transparent && format !== "jpeg" ? config.background : "",
            imageOutputFormat: capability.formats.includes(format) ? format : "png",
        };
        let changed = false;
        for (const key of ["quality", "size", "background", "imageOutputFormat"] as const) {
            if (config[key] !== next[key]) { onConfigChange(key, next[key]); changed = true; }
        }
        setAdjusted(changed);
        if (next.size !== config.size) onConfigChange("imageSizeMode", sizeModeOf(next.size));
    }, [model]);

    const selectPreset = (nextScale: string, nextRatio: string) => {
        onConfigChange("size", nextRatio === "auto" ? "auto" : imageSizePresets[nextScale][nextRatio]);
    };
    const updateDimension = (axis: "width" | "height", value: string) => {
        onConfigChange("size", axis === "width" ? `${value}x${height}` : `${width}x${value}`);
    };
    const alignDimensions = () => {
        if (!align) return;
        // 对齐仅用于手动输入；预设沿用已有尺寸表，不改变模型约束。
        const values = [width, height].map(Number);
        if (values.every(value => Number.isFinite(value) && value > 0)) {
            onConfigChange("size", values.map(value => Math.ceil(value / 16) * 16).join("x"));
        }
    };

    return <div className={styles.settings}>
        {adjusted && <p className={styles.note} role="status">已将不兼容参数恢复为自动。</p>}
        <fieldset className={styles.group} disabled={!capability.verified}>
            <legend>生成质量</legend>
            <span className={styles.legendHint}>{capability.qualities.length} 档可选</span>
            <div className={styles.segments} style={{ gridTemplateColumns: `repeat(${capability.qualities.length}, minmax(0, 1fr))` }}>
                {capability.qualities.map(value => <button key={value} type="button" aria-pressed={config.quality === value} onClick={() => onConfigChange("quality", value)}>{qualityLabels[value] || value}</button>)}
            </div>
            <p className={styles.note}>优先选择「自动」，由模型决定输出画质。</p>
        </fieldset>

        <fieldset className={styles.group} disabled={!capability.verified}>
            <legend>画布尺寸</legend>
            {capability.flexibleSize ? <>
                <div className={styles.segments}>
                    {[["auto", "自动"], ["preset", "预设"], ["custom", "自定义"]].map(([value, label]) => <button key={value} type="button" aria-pressed={sizeMode === value} onClick={() => {
                        onConfigChange("imageSizeMode", value);
                        if (value === "auto") onConfigChange("size", "auto");
                        else if (value === "preset") selectPreset(scale, ratio === "auto" ? "1:1" : ratio);
                        else if (config.size === "auto") onConfigChange("size", "1024x1024");
                    }}>{label}</button>)}
                </div>
                {sizeMode === "preset" && <>
                    <p className={styles.subheading}>分辨率档位 <span>· 便捷预设</span></p>
                    <div className={`${styles.segments} ${styles.fourColumns}`}>
                        {["1k", "2k", "4k"].map(value => <button key={value} type="button" aria-pressed={config.size !== "auto" && scale === value} onClick={() => selectPreset(value, ratio === "auto" ? "1:1" : ratio)}>{value.toUpperCase()}</button>)}
                        <button type="button" aria-pressed={config.size === "auto"} onClick={() => onConfigChange("size", "auto")}>自动</button>
                    </div>
                    <p className={styles.subheading}>宽高比</p>
                    <div className={styles.ratios}>
                        {mediaRatioOptions.map(item => <button key={item.value} type="button" aria-pressed={ratio === item.value} onClick={() => selectPreset(scale, item.value)}>
                            {item.value === "auto" ? <Sparkles size={22} aria-hidden="true" /> : <span className={styles.ratioIcon} style={{ width: item.width >= item.height ? 27 : 27 * item.width / item.height, height: item.height >= item.width ? 27 : 27 * item.height / item.width }} />}
                            <span>{item.value === "auto" ? "自动" : item.value}</span>
                        </button>)}
                    </div>
                </>}
                {sizeMode === "custom" && <>
                    <p className={styles.subheading}>宽度 × 高度（像素）</p>
                    <div className={styles.dimensions}>
                        <label><span>宽度</span><input aria-label="图片宽度" type="number" min={1} step={align ? 16 : 1} value={width} onChange={event => updateDimension("width", event.target.value)} onBlur={alignDimensions} /></label>
                        <span aria-hidden="true">×</span>
                        <label><span>高度</span><input aria-label="图片高度" type="number" min={1} step={align ? 16 : 1} value={height} onChange={event => updateDimension("height", event.target.value)} onBlur={alignDimensions} /></label>
                    </div>
                    <label className={styles.toggleLine}><span>自动对齐 16 的倍数</span><input type="checkbox" role="switch" checked={align} onChange={event => setAlign(event.target.checked)} /></label>
                </>}
            </> : <div className={styles.standardSizes}>
                {capability.sizes.map(value => <button key={value} type="button" aria-pressed={config.size === value} onClick={() => onConfigChange("size", value)}>{value === "auto" ? "自动" : value.replace("x", " × ")}</button>)}
            </div>}
            <div className={styles.sizePreview} aria-live="polite"><div><span>实际发送尺寸</span><strong>{config.size === "auto" ? "模型自动" : config.size.replace("x", " × ")}</strong></div><span>{config.size === "auto" ? "自动选择" : "像素"}</span></div>
            <p className={sizeError ? styles.error : styles.note} role={sizeError ? "alert" : undefined}>{sizeError || (capability.flexibleSize ? "边长须为 16 的倍数，最长 3840；比例不超过 3:1，总像素 655,360～8,294,400。" : "当前模型支持自动尺寸和以上标准尺寸。")}</p>
        </fieldset>

        <fieldset className={styles.group} disabled={!capability.verified}>
            <legend>输出设置</legend>
            <div className={styles.outputGrid}>
                <div className={styles.optionBox}><span className={styles.optionTitle}>图片格式</span>
                    <div className={`${styles.segments} ${styles.formatOptions}`}>{capability.formats.map(value => <button key={value} type="button" aria-pressed={format === value} onClick={() => {
                        onConfigChange("imageOutputFormat", value);
                        if (value === "jpeg" && config.background) onConfigChange("background", "");
                    }}>{value.toUpperCase()}</button>)}</div>
                    {compressed ? <label className={styles.compression}>输出压缩率 <strong>{config.imageOutputCompression ?? "85"}%</strong><input aria-label="输出压缩率" type="range" min={0} max={100} value={config.imageOutputCompression ?? "85"} onChange={event => onConfigChange("imageOutputCompression", event.target.value)} /></label> : <p className={styles.note}>PNG 无损输出</p>}
                </div>
                <div className={styles.optionBox}><label className={styles.toggleLine}><span className={styles.optionTitle}>透明背景</span><input aria-label="透明背景" type="checkbox" role="switch" disabled={!capability.transparent || format === "jpeg"} checked={config.background === "transparent"} onChange={event => onConfigChange("background", event.target.checked ? "transparent" : "")} /></label><p className={styles.note}>{format === "jpeg" ? "JPEG 不支持透明背景" : capability.transparent ? "适用于 PNG / WebP" : "当前模型尚未验证，暂不开放"}</p></div>
            </div>
        </fieldset>

        <fieldset className={styles.group} disabled={!capability.verified}>
            <legend>生成张数</legend><span className={styles.legendHint}>每张单独计费</span>
            <div className={`${styles.segments} ${styles.fourColumns}`}>
                {[1, 2, 3, 4].map(value => <button key={value} type="button" aria-pressed={Number(config.count) === value} onClick={() => { setMoreCount(false); onConfigChange("count", String(value)); }}>{value} 张</button>)}
                <button className={styles.fullWidth} type="button" aria-pressed={moreCount || Number(config.count) > 4} onClick={() => { setMoreCount(true); if (Number(config.count) <= 4) onConfigChange("count", "5"); }}>更多 · 5～10 张</button>
            </div>
            {(moreCount || Number(config.count) > 4) && <label className={styles.moreCount}>生成张数<input aria-label="生成张数" type="number" min={5} max={10} value={config.count} onChange={event => onConfigChange("count", event.target.value)} /></label>}
            <p className={styles.note}>批量生成逐张独立请求，实际费用以使用记录为准。</p>
        </fieldset>
    </div>;
}
