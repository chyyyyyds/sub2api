import { expect, test } from "bun:test";
import { getHostStorageWarning, guardHostStorage } from "./host-storage-status";
test("写入失败有持久提示；读取失败后保护历史不被覆盖", async () => {
    let writes = 0;
    const store = guardHostStorage({
        async getItem() { throw new Error("含敏感路径的底层错误"); },
        async setItem() { writes++; throw new Error("quota"); },
    });
    try { await store.setItem(); throw new Error("应当失败"); } catch (error) { expect((error as Error).message.includes("作品可能尚未保存")).toBe(true); }
    expect(getHostStorageWarning().includes("quota")).toBe(false);
    try { await store.getItem(); throw new Error("应当失败"); } catch (error) { expect((error as Error).message.includes("阻止覆盖历史")).toBe(true); }
    try { await store.setItem(); throw new Error("应当失败"); } catch (error) { expect((error as Error).message.includes("阻止覆盖历史")).toBe(true); }
    expect(writes).toBe(1);
});
