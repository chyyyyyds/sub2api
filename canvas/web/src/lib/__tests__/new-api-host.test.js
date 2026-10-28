import { describe, expect, test } from "bun:test";

globalThis.localStorage = {
    length: 0,
    clear: () => undefined,
    getItem: () => null,
    key: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
};

const { parseNewApiCanvasConfig } = await import("../new-api-host");
const { kokoVideoModelConfig } = await import("../video-model-config");
const { createModelChannel, defaultConfig, modelOptionName, selectableModelsByCapability, useConfigStore, withModelChannels } = await import("@/stores/use-config-store");

const stableHostConfig = {
    type: "new-api:canvas-config",
    version: 1,
    baseUrl: "https://new-api.example.com",
    apiKey: "sk-stable-video",
    channelName: "视频生成（稳定版）",
    historyScope: "user-42",
    studio: "video",
    preferredModel: "pp-sd25-stable",
    videoSeconds: "30",
    videoResolution: "720",
    videoSize: "16:9",
};

describe("new-api 视频工作台配置", () => {
    test("接受稳定版使用的比例尺寸配置", () => {
        expect(parseNewApiCanvasConfig(stableHostConfig, "https://new-api.example.com")).toEqual(stableHostConfig);
    });

    test("只暴露当前宿主管理渠道的模型并应用对应默认参数", () => {
        const legacyChannel = createModelChannel({
            id: "legacy",
            name: "seedance视频生成",
            baseUrl: "https://new-api.example.com",
            apiKey: "sk-legacy-video",
            models: [{ name: "seedance-2.0-fast-720p-c5", capability: "video" }],
        });
        const managedChannel = createModelChannel({
            id: "managed",
            name: "视频生成（稳定版）",
            baseUrl: "https://new-api.example.com",
            apiKey: "sk-stable-video",
            managedByHost: true,
        });
        useConfigStore.setState({ config: withModelChannels(defaultConfig, [legacyChannel, managedChannel]) });

        useConfigStore.getState().updateChannelModels("managed", ["minimax-h3-933", "oo-sd25-1080p", "mm-h3-768-stable", "pp-sd25-stable"], stableHostConfig);

        const config = useConfigStore.getState().config;
        expect(selectableModelsByCapability(config, "video").map(modelOptionName)).toEqual(["minimax-h3-933", "oo-sd25-1080p", "mm-h3-768-stable", "pp-sd25-stable"]);
        expect(modelOptionName(config.videoModel)).toBe("pp-sd25-stable");
        expect(config.vquality).toBe("720");
        expect(config.size).toBe("16:9");
        expect(config.videoSeconds).toBe("30");
    });

    test("识别四个新视频模型、移除旧模型并保留真实时长", () => {
        expect(kokoVideoModelConfig("seedance-2.0")).toBeNull();
        expect(kokoVideoModelConfig("seedance-2.5")).toBeNull();
        expect(kokoVideoModelConfig("minimaxh3")).toBeNull();
        expect(kokoVideoModelConfig("minimax-h3-933")).toMatchObject({ resolution: "1K", durations: [15], requiresImage: true });
        expect(kokoVideoModelConfig("mm-h3-768-stable")).toMatchObject({ resolution: "720p", durations: [15, 30] });
        expect(kokoVideoModelConfig("oo-sd25-1080p")).toMatchObject({ resolution: "720p", durations: [30] });
        expect(kokoVideoModelConfig("pp-sd25-stable")).toMatchObject({ resolution: "720p", durations: [30] });
    });
});
