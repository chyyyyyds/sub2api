import { describe, expect, test } from "bun:test";

globalThis.localStorage = {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
} as unknown as Storage;

const { normalizeThemeName } = await import("./use-theme-store");

describe("theme store persistence", () => {
    test("falls back to dark for legacy or malformed persisted themes", () => {
        expect(normalizeThemeName("system")).toBe("dark");
        expect(normalizeThemeName(undefined)).toBe("dark");
        expect(normalizeThemeName({})).toBe("dark");
    });

    test("keeps supported persisted themes", () => {
        expect(normalizeThemeName("light")).toBe("light");
        expect(normalizeThemeName("dark")).toBe("dark");
    });
});
