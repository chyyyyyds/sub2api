import { describe, expect, test } from "bun:test";

globalThis.localStorage = {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
};

const { defaultConfig, guessCapability, upsertChannelCredentials } = await import("../stores/use-config-store");

describe("New API managed channel", () => {
    test("uses the selected API key name and locks the same-origin OpenAI channel", () => {
        const result = upsertChannelCredentials(defaultConfig, {
            baseUrl: "https://api.openai.com",
            apiKey: "sk-image-key",
            channelName: "图图",
            managedByHost: true,
        });

        expect(result.config.channels[0]).toMatchObject({
            name: "图图",
            baseUrl: "https://api.openai.com",
            apiKey: "sk-image-key",
            apiFormat: "openai",
            managedByHost: true,
        });
    });

    test("recognizes Seedance models as video models", () => {
        expect(guessCapability("seedance-2.0-fast-720p-c5")).toBe("video");
    });
});
