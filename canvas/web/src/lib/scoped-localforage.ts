import localforage from "localforage";
import { getHostConfig, IS_SUB2API_HOST } from "@/lib/sub2api-context";
import { guardHostStorage } from "./host-storage-status";

// 每个 iframe 的用户空间在启动时固定；旧异步任务不会写入新用户数据库。
const scope = getHostConfig()?.historyScope;
if (IS_SUB2API_HOST && !scope) throw new Error("画布尚未完成用户握手");
const options = (value: LocalForageOptions = {}) => ({ ...value, driver: localforage.INDEXEDDB, name: `sub2api-canvas:${scope}:${value.name || "infinite-canvas"}` });
const instance = IS_SUB2API_HOST ? guardHostStorage(localforage.createInstance(options())) : localforage;
const storage = new Proxy(instance, {
    get(target, key) {
        if (IS_SUB2API_HOST && key === "createInstance") return (value: LocalForageOptions) => guardHostStorage(localforage.createInstance(options(value)));
        if (IS_SUB2API_HOST && key === "config") return (value?: LocalForageOptions) => value ? target.config(options(value)) : target.config();
        const member = Reflect.get(target, key);
        return typeof member === "function" ? member.bind(target) : member;
    },
});
export default storage;
