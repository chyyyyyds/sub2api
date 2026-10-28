import { describe, expect, test } from "bun:test";

import { generationLogStorageKey, isGenerationLogStorageKeyForScope } from "./generation-log-storage";

describe("generation log storage scope", () => {
    test("isolates embedded New API users", () => {
        const firstUserKey = generationLogStorageKey("user-1", "log-1");
        const secondUserKey = generationLogStorageKey("user-2", "log-1");

        expect(firstUserKey).not.toBe(secondUserKey);
        expect(isGenerationLogStorageKeyForScope(firstUserKey, "user-1")).toBe(true);
        expect(isGenerationLogStorageKeyForScope(firstUserKey, "user-2")).toBe(false);
    });

    test("keeps legacy unscoped records available only in standalone mode", () => {
        expect(generationLogStorageKey("standalone", "legacy-log")).toBe("legacy-log");
        expect(isGenerationLogStorageKeyForScope("legacy-log", "standalone")).toBe(true);
        expect(isGenerationLogStorageKeyForScope("legacy-log", "user-1")).toBe(false);
    });
});
