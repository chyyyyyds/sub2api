import { describe, expect, test } from "bun:test";

globalThis.localStorage = {
    length: 0,
    clear: () => undefined,
    getItem: () => null,
    key: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
} as Storage;

const { defaultConfig } = await import("@/stores/use-config-store");
const { buildKokoVideoRequest, buildSeedanceVideoRequest } = await import("./video");

describe("Seedance per-task request", () => {
    test("uses the documented JSON fields and fixes the cheapest model to 10 seconds", () => {
        expect(
            buildSeedanceVideoRequest({ ...defaultConfig, videoSeconds: "6", size: "1280x720" }, "seedance-2.0-fast-720p-c5", "海边日落", [
                { id: "1", name: "reference", type: "image/png", dataUrl: "data:image/png;base64,abc", url: "https://cdn.example.com/reference.png" },
            ]),
        ).toEqual({
            model: "seedance-2.0-fast-720p-c5",
            prompt: "海边日落",
            duration: 10,
            aspect_ratio: "16:9",
            image_url: "https://cdn.example.com/reference.png",
        });
    });

    test("rejects local-only reference media", () => {
        expect(() => buildSeedanceVideoRequest({ ...defaultConfig, videoSeconds: "10", size: "16:9" }, "seedance-2.0-fast-720p-c5", "测试", [{ id: "1", name: "local", type: "image/png", dataUrl: "data:image/png;base64,abc" }])).toThrow();
    });
});

describe("KOKO video request", () => {
    test.each([
        ["minimax-h3-933", "6", 15, "1K"],
        ["mm-h3-768-stable", "30", 30, "720p"],
        ["oo-sd25-1080p", "30", 30, "720p"],
        ["pp-sd25-stable", "14", 30, "720p"],
    ] as const)("normalizes %s to its supported duration and fixed resolution", (model: string, requested: string, duration: number, resolution: string) => {
        expect(buildKokoVideoRequest({ ...defaultConfig, videoSeconds: requested, size: "16:9" }, model, "测试视频", model === "minimax-h3-933" ? [{ id: "i", name: "ref", type: "image/png", dataUrl: "", url: "https://example.com/ref.png" }] : [])).toEqual({
            model,
            prompt: "测试视频",
            duration,
            ratio: "16:9",
            resolution,
            mode: model === "minimax-h3-933" ? "reference" : "text-to-video",
            ...(model === "minimax-h3-933" ? { reference_images: [{ url: "https://example.com/ref.png" }] } : {}),
            count: 1,
        });
    });

    test("使用参考模式提交图片，避免把旧首帧模式发给新模型", () => {
        expect(
            buildKokoVideoRequest({ ...defaultConfig, videoSeconds: "14", size: "9:16", videoMode: "frames" }, "pp-sd25-stable", "人物转身", [{ id: "1", name: "reference", type: "image/png", dataUrl: "", url: "https://cdn.example.com/reference.png" }]),
        ).toEqual({
            model: "pp-sd25-stable",
            prompt: "人物转身",
            duration: 30,
            ratio: "9:16",
            resolution: "720p",
            mode: "reference",
            count: 1,
            reference_images: [{ url: "https://cdn.example.com/reference.png" }],
        });
    });
});


describe("KOKO参考素材与旧模型保护", () => {
    test("支持本地图片和音频base64并保留参考模式", () => {
        const body = buildKokoVideoRequest({ ...defaultConfig, videoSeconds: "15", size: "16:9" }, "mm-h3-768-stable", "测试", [{ id: "1", name: "ref", type: "image/png", dataUrl: "data:image/png;base64,YQ==" }], { audios: [{ id: "a", name: "ref.wav", type: "audio/wav", url: "data:audio/wav;base64,YQ==" }] });
        expect(body.reference_images).toEqual([{ url: "data:image/png;base64,YQ==" }]);
        expect(body.audio_urls).toEqual(["data:audio/wav;base64,YQ=="]);
        expect(body.mode).toBe("reference");
    });
    test("拒绝旧模型、参考视频和超过三段的音频", () => {
        expect(() => buildKokoVideoRequest(defaultConfig, "seedance-2.5", "测试")).toThrow();
        expect(() => buildKokoVideoRequest(defaultConfig, "pp-sd25-stable", "测试", [], { videos: [{ id: "v", name: "v", type: "video/mp4", url: "https://example.com/v.mp4" }] })).toThrow();
        expect(() => buildKokoVideoRequest(defaultConfig, "pp-sd25-stable", "测试", [], { audios: Array.from({length: 4}, (_, i) => ({id: String(i), name: "a", type: "audio/wav", url: "https://example.com/a.wav"})) })).toThrow();
    });
});
