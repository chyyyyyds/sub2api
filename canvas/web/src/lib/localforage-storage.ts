import localforage from "@/lib/scoped-localforage";
import { IS_SUB2API_HOST } from "@/lib/sub2api-context";
import type { StateStorage } from "zustand/middleware";

localforage.config({
    name: "infinite-canvas",
    storeName: "app_state",
});

export const localForageStorage: StateStorage = {
    getItem: async (name) => {
        if (typeof window === "undefined") return null;
        try {
            return (await localforage.getItem<string>(name)) || null;
        } catch (error) {
            if (IS_SUB2API_HOST && error instanceof Error && error.name === "HostStorageError") throw error;
            if (IS_SUB2API_HOST) throw new Error("无法读取当前用户的本地作品存储");
            return window.localStorage.getItem(name);
        }
    },
    setItem: async (name, value) => {
        if (typeof window === "undefined") return;
        try {
            await localforage.setItem(name, value);
        } catch (error) {
            if (IS_SUB2API_HOST && error instanceof Error && error.name === "HostStorageError") throw error;
            if (IS_SUB2API_HOST) throw new Error("无法保存当前用户的本地作品");
            window.localStorage.setItem(name, value);
        }
    },
    removeItem: async (name) => {
        if (typeof window === "undefined") return;
        try {
            await localforage.removeItem(name);
        } catch (error) {
            if (IS_SUB2API_HOST && error instanceof Error && error.name === "HostStorageError") throw error;
            if (IS_SUB2API_HOST) throw new Error("无法删除当前用户的本地作品");
            window.localStorage.removeItem(name);
        }
    },
};
