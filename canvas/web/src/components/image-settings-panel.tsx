import { type ReactNode, useState, useEffect } from "react";
import { ConfigProvider, Switch, theme as antTheme } from "antd";
import { useTranslation } from "react-i18next";

import i18n from "@/i18n";
import { canvasThemes, type CanvasTheme } from "@/lib/canvas-theme";
import { computeMediaSize, inferMediaRatio, inferMediaScale, mediaRatioOptions, mediaScaleOptions, readMediaDimensions } from "@/lib/media-size";
import type { AiConfig } from "@/stores/use-config-store";
import { hostImageCapability } from "@/lib/host-image-capabilities";
import { modelOptionName, useEffectiveConfig } from "@/stores/use-config-store";
import { IS_SUB2API_HOST } from "@/lib/sub2api-context";

const qualityOptions = [
    { value: "auto", labelKey: "auto" },
    { value: "high", labelKey: "high" },
    { value: "medium", labelKey: "medium" },
    { value: "low", labelKey: "low" },
];
const DIMENSION_STEP = 16;

export const imageQualityOptions = qualityOptions.map((item) => ({ value: item.value, get label() { return i18n.t(`settingsPanels.common.${item.labelKey}`); } }));
export const imageAspectOptions = mediaRatioOptions.map((item) => ({ value: item.value, label: item.value === "auto" ? i18n.t("settingsPanels.common.auto") : item.value }));
export const imageScaleOptions = mediaScaleOptions.map((value) => ({ value, label: value === "auto" ? i18n.t("settingsPanels.common.auto") : value }));

type ImageSettingsPanelProps = {
    config: AiConfig;
    onConfigChange: (key: "quality" | "size" | "count" | "background", value: string) => void;
    theme: CanvasTheme;
    showTitle?: boolean;
    className?: string;
    maxCount?: number;
    quickCount?: number;
};

export function ImageSettingsPanel({ config, onConfigChange, theme, showTitle = true, className = "w-[320px] space-y-4 rounded-2xl px-1 py-0.5", maxCount = 15, quickCount = 10 }: ImageSettingsPanelProps) {
    const { t } = useTranslation();
    const [snapDimensionToStep, setSnapDimensionToStep] = useState(true);
    // 宿主首屏优先展示 V5 的画质和比例，完整参数通过展开保留。
    const [advancedOpen, setAdvancedOpen] = useState(false);
    const quality = config.quality || "auto";
    const count = Math.max(1, Math.min(maxCount, Math.floor(Math.abs(Number(config.count)) || 1)));
    const activeSize = config.size || "auto";
    const transparentBackground = config.background === "transparent";
    const selectedScale = inferMediaScale(activeSize);
    const selectedRatio = inferMediaRatio(activeSize);
    const dimensions = readMediaDimensions(activeSize, selectedScale, selectedRatio);
    const applySize = (scale: string, ratio: string) => onConfigChange("size", computeMediaSize(scale, ratio));
    const selectScale = (scale: string) => applySize(scale, selectedRatio === "auto" ? "1:1" : selectedRatio);
    const selectRatio = (ratio: string) => applySize(selectedScale, ratio);
    const updateDimension = (key: "width" | "height", value: number | null) => {
        const next = Math.max(1, Math.floor(value || dimensions[key] || 1024));
        const width = key === "width" ? next : dimensions.width;
        const height = key === "height" ? next : dimensions.height;
        onConfigChange("size", `${alignDimension(width, snapDimensionToStep)}x${alignDimension(height, snapDimensionToStep)}`);
    };

    if (IS_SUB2API_HOST) return <HostImageSettings config={config} onConfigChange={onConfigChange} theme={theme} />;

    return (
        <ImageSettingsTheme theme={theme}>
            <div
                className={`${className}${IS_SUB2API_HOST ? " host-compact-settings" : ""}`}
                data-advanced={advancedOpen}
                style={{ color: theme.node.text }}
                onMouseDown={(event) => {
                    event.stopPropagation();
                    if (event.target instanceof HTMLInputElement) return;
                    if (document.activeElement instanceof HTMLInputElement && event.currentTarget.contains(document.activeElement)) document.activeElement.blur();
                }}
            >
                {showTitle ? <div className="text-lg font-semibold">{t("settingsPanels.image.title")}</div> : null}
                <div className="space-y-2.5" data-setting="quality">
                    <SettingTitle color={theme.node.muted}>{t("settingsPanels.image.quality")}</SettingTitle>
                    <div className="grid grid-cols-4 gap-2.5">
                        {qualityOptions.map((item) => (
                            <OptionPill key={item.value} selected={quality === item.value} theme={theme} onClick={() => onConfigChange("quality", item.value)}>
                                {t(`settingsPanels.common.${item.labelKey}`)}
                            </OptionPill>
                        ))}
                    </div>
                </div>
                <div className="space-y-2.5" data-setting="size">
                    <div className="flex items-center justify-between gap-3">
                        <SettingTitle color={theme.node.muted}>{t("settingsPanels.image.size")}</SettingTitle>
                        <div className="flex items-center gap-2">
                            <span className="text-xs font-medium" style={{ color: theme.node.muted }}>
                                {t("settingsPanels.image.align16")}
                            </span>
                            <span title={t("settingsPanels.image.align16Hint")} onMouseDown={(event) => event.stopPropagation()}>
                                <Switch size="small" checked={snapDimensionToStep} onChange={setSnapDimensionToStep} />
                            </span>
                        </div>
                    </div>
                    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2.5">
                        <DimensionInput prefix="W" value={dimensions.width} disabled={selectedRatio === "auto"} theme={theme} alignToStep={snapDimensionToStep} onChange={(value) => updateDimension("width", value)} />
                        <span className="text-lg opacity-45">↔</span>
                        <DimensionInput prefix="H" value={dimensions.height} disabled={selectedRatio === "auto"} theme={theme} alignToStep={snapDimensionToStep} onChange={(value) => updateDimension("height", value)} />
                    </div>
                </div>
                <div className="space-y-2.5" data-setting="scale">
                    <SettingTitle color={theme.node.muted}>{t("settingsPanels.image.resolution")}</SettingTitle>
                    <div className="grid grid-cols-4 gap-2.5">
                        {mediaScaleOptions.map((value) => (
                            <OptionPill key={value} selected={selectedScale === value} theme={theme} onClick={() => selectScale(value)}>
                                {value === "auto" ? t("settingsPanels.common.auto") : value}
                            </OptionPill>
                        ))}
                    </div>
                </div>
                <div className="space-y-2.5" data-setting="ratio">
                    <SettingTitle color={theme.node.muted}>{t("settingsPanels.image.aspectRatio")}</SettingTitle>
                    <div className="grid grid-cols-4 gap-2.5">
                        {mediaRatioOptions.filter(item => !IS_SUB2API_HOST || advancedOpen || ["16:9", "9:16", "1:1", "4:3", selectedRatio].includes(item.value)).map((item) => (
                            <button
                                key={item.value}
                                type="button"
                                aria-pressed={selectedRatio === item.value}
                                className="flex h-[72px] cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border bg-transparent text-sm transition hover:opacity-80"
                                style={{ borderColor: selectedRatio === item.value ? theme.node.text : theme.node.stroke, background: "transparent", color: theme.node.text }}
                                onMouseDown={(event) => event.stopPropagation()}
                                onClick={() => selectRatio(item.value)}
                            >
                                <AspectIcon width={item.width} height={item.height} color={theme.node.text} />
                                <span>{item.value === "auto" ? t("settingsPanels.common.auto") : item.value}</span>
                            </button>
                        ))}
                    </div>
                </div>
                <div className="flex items-center justify-between gap-3" data-setting="background">
                    <div className="space-y-0.5">
                        <SettingTitle color={theme.node.muted}>{t("settingsPanels.image.transparent")}</SettingTitle>
                        <div className="text-xs" style={{ color: theme.node.muted, opacity: 0.75 }}>
                            {t("settingsPanels.image.transparentHint")}
                        </div>
                    </div>
                    <span onMouseDown={(event) => event.stopPropagation()}>
                        <Switch size="small" checked={transparentBackground} onChange={(checked) => onConfigChange("background", checked ? "transparent" : "")} />
                    </span>
                </div>
                <div className="space-y-2.5" data-setting="count">
                    <SettingTitle color={theme.node.muted}>{t("settingsPanels.image.count")}</SettingTitle>
                    <div className="grid grid-cols-4 gap-2.5">
                        {Array.from({ length: quickCount }, (_, index) => index + 1).map((value) => (
                            <OptionPill key={value} selected={count === value} theme={theme} onClick={() => onConfigChange("count", String(value))}>
                                {t("settingsPanels.image.images", { count: value })}
                            </OptionPill>
                        ))}
                        <CountInput value={count} max={maxCount} theme={theme} onChange={(value) => onConfigChange("count", String(value || 1))} />
                    </div>
                </div>
                {IS_SUB2API_HOST && <button className="host-advanced-toggle" type="button" aria-expanded={advancedOpen} onClick={() => setAdvancedOpen(value => !value)}>{advancedOpen ? "−" : "+"} {t("settingsPanels.image.size")} / {t("settingsPanels.image.resolution")} / {t("settingsPanels.image.count")}</button>}
            </div>
        </ImageSettingsTheme>
    );
}

export function ImageSettingsTheme({ theme, children }: { theme: CanvasTheme; children: ReactNode }) {
    return (
        <ConfigProvider
            theme={{
                token: { colorBgContainer: theme.toolbar.panel, colorBgElevated: theme.toolbar.panel, colorBorder: theme.node.stroke, colorPrimary: theme.node.activeStroke, colorText: theme.node.text, colorTextLightSolid: theme.node.panel },
                components: {
                    Button: { defaultBg: theme.toolbar.panel, defaultBorderColor: theme.node.stroke, defaultColor: theme.node.text },
                    Slider: { railBg: theme.node.stroke, railHoverBg: theme.node.stroke, trackBg: theme.node.activeStroke, handleColor: theme.node.text, handleActiveColor: theme.node.text },
                },
            }}
        >
            {children}
        </ConfigProvider>
    );
}

export function imageQualityLabel(value: string) {
    return (["auto", "high", "medium", "low"].includes(value) ? i18n.t(`settingsPanels.common.${value}`) : value);
}

export function imageSizeLabel(size: string) {
    const scale = inferMediaScale(size);
    const ratio = inferMediaRatio(size);
    if (ratio === "auto" || size === "auto") return i18n.t("settingsPanels.common.auto");
    if (scale === "auto") return ratio;
    return `${scale} · ${ratio}`;
}

function OptionPill({ selected, theme, onClick, children }: { selected: boolean; theme: CanvasTheme; onClick: () => void; children: ReactNode }) {
    return (
        <button
            type="button"
            aria-pressed={selected}
            className="h-9 cursor-pointer rounded-full border px-2 text-sm transition hover:opacity-80"
            style={{ background: "transparent", borderColor: selected ? theme.node.text : theme.node.stroke, color: theme.node.text }}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={onClick}
        >
            {children}
        </button>
    );
}

function DimensionInput({ prefix, value, disabled, theme, alignToStep, onChange }: { prefix: string; value: number; disabled: boolean; theme: CanvasTheme; alignToStep: boolean; onChange: (value: number | null) => void }) {
    const commit = (input: HTMLInputElement) => {
        const next = alignDimension(Math.max(1, Math.floor(Number(input.value) || value || 1024)), alignToStep);
        input.value = String(next);
        onChange(next);
    };

    return (
        <label className="flex h-9 overflow-hidden rounded-xl text-sm" style={{ background: theme.node.fill, color: theme.node.text, opacity: disabled ? 0.55 : 1 }}>
            <span className="grid w-9 place-items-center" style={{ color: theme.node.muted }}>
                {prefix}
            </span>
            <input
                type="number"
                min={1}
                disabled={disabled}
                className="min-w-0 flex-1 bg-transparent px-2 outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                defaultValue={value || ""}
                key={`${prefix}-${value}`}
                onBlur={(event) => commit(event.currentTarget)}
                onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur();
                }}
                onMouseDown={(event) => event.stopPropagation()}
            />
        </label>
    );
}

function CountInput({ value, max, theme, onChange }: { value: number; max: number; theme: CanvasTheme; onChange: (value: number | null) => void }) {
    return (
        <label className="col-span-2 flex h-9 overflow-hidden rounded-full border text-sm" style={{ borderColor: theme.node.stroke, color: theme.node.text }}>
            <input
                type="number"
                min={1}
                max={max}
                className="min-w-0 flex-1 bg-transparent px-3 text-center outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                style={{ color: theme.node.text, WebkitTextFillColor: theme.node.text }}
                value={value || ""}
                onChange={(event) => onChange(Number(event.target.value) || null)}
                onMouseDown={(event) => event.stopPropagation()}
            />
        </label>
    );
}

function AspectIcon({ width, height, color }: { width: number; height: number; color: string }) {
    if (!width || !height) return null;
    const ratio = width / height;
    const boxWidth = ratio >= 1 ? 24 : Math.max(10, 24 * ratio);
    const boxHeight = ratio >= 1 ? Math.max(10, 24 / ratio) : 24;
    return (
        <span className="grid h-7 w-9 place-items-center">
            <span className="border-2" style={{ width: boxWidth, height: boxHeight, borderColor: color }} />
        </span>
    );
}

function SettingTitle({ children, color }: { children: string; color: string }) {
    return (
        <div className="text-xs font-medium" style={{ color }}>
            {children}
        </div>
    );
}

function alignDimension(value: number, enabled: boolean) {
    return enabled ? Math.ceil(value / DIMENSION_STEP) * DIMENSION_STEP : value;
}

/** @description 宿主使用已核对能力展示参数，不把质量当作分辨率。 */
function HostImageSettings({ config, onConfigChange }: Pick<ImageSettingsPanelProps, "config" | "onConfigChange" | "theme">) {
    const theme = canvasThemes.dark;
    const { token } = antTheme.useToken();
    const effective = useEffectiveConfig();
    const model = modelOptionName(effective.imageModel || effective.model);
    const capability = hostImageCapability(model);
    const [adjusted, setAdjusted] = useState(false);
    useEffect(() => {
        // 切换模型只重置不兼容参数，画布与生成历史保持不变。
        let changed = false;
        for (const [key, value] of Object.entries({ quality: capability.qualities.includes(config.quality) ? config.quality : "auto", size: capability.flexibleSize || capability.sizes.includes(config.size) ? config.size : "auto", background: capability.transparent ? config.background : "" })) {
            if (config[key as "quality" | "size" | "background"] !== value) { onConfigChange(key as "quality" | "size" | "background", value); changed = true; }
        }
        setAdjusted(changed);
        // 参数编辑在提交前校验；仅切换模型时自动调整。
    }, [model]);
    const style = { minHeight: 36, padding: "4px 8px", color: token.colorText, background: token.colorBgContainer, borderColor: token.colorBorder };
    return <div className="space-y-3" style={{ color: theme.node.text }}>
        {!capability.verified && <p role="alert">图片能力未验证，暂不能生成。请选择已验证模型；别名需先核对网关映射。</p>}
        {adjusted && <p role="status">已将不兼容参数恢复为自动，画布和历史已保留。</p>}
        <label className="flex items-center justify-between gap-2">质量<select aria-label="质量" style={style} value={config.quality} disabled={!capability.verified} onChange={event => onConfigChange("quality", event.target.value)}>{capability.qualities.map(value => <option key={value} value={value}>{({ auto: "自动", low: "低", medium: "中", high: "高", xhigh: "超高", max: "极致" } as Record<string, string>)[value]}</option>)}</select></label>
        <label className="flex items-center justify-between gap-2">尺寸 / 宽高比<select aria-label="尺寸 / 宽高比" style={style} disabled={!capability.verified} value={capability.sizes.includes(config.size) ? config.size : "custom"} onChange={event => onConfigChange("size", event.target.value === "custom" ? "1024x1024" : event.target.value)}>{capability.sizes.map(value => <option key={value} value={value}>{value === "auto" ? "自动" : value}</option>)}{capability.flexibleSize && <option value="custom">自定义尺寸 / 分辨率</option>}</select></label>
        {capability.flexibleSize && <label className="flex items-center justify-between gap-2">自定义像素<input aria-label="自定义像素" className="w-36 border px-2 py-1" style={style} value={config.size} onChange={event => onConfigChange("size", event.target.value)} /></label>}
        {capability.flexibleSize && <p className="text-xs" style={{ color: theme.node.muted }}>尺寸使用像素宽×高，如 2048x1152（16:9）。边长须为 16 的倍数、最长 3840、比例不超过 3:1、总像素 655360～8294400。</p>}
        <label className="flex items-center justify-between gap-2">透明背景<input aria-label="透明背景" type="checkbox" disabled={!capability.transparent} checked={config.background === "transparent"} onChange={event => onConfigChange("background", event.target.checked ? "transparent" : "")} /></label>
        {!capability.transparent && <p className="text-xs" style={{ color: theme.node.muted }}>当前模型未验证透明背景，已禁用。</p>}
        <label className="flex items-center justify-between gap-2">生成张数<input aria-label="生成张数" type="number" min={1} max={10} className="w-16 border px-2 py-1" style={style} value={config.count} disabled={!capability.verified} onChange={event => onConfigChange("count", event.target.value)} /></label>
        <p className="text-xs" style={{ color: theme.node.muted }}>每张独立请求和计费；参考图通过图片编辑接口提交。取消、超时或下载失败的费用以用量记录为准。</p>
    </div>;
}
