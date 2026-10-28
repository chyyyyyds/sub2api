import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ThemeName = "light" | "dark";

type ThemeStore = {
    theme: ThemeName;
    setTheme: (theme: ThemeName) => void;
};

export function normalizeThemeName(theme: unknown): ThemeName {
    return theme === "light" ? "light" : "dark";
}

export const useThemeStore = create<ThemeStore>()(
    persist(
        (set) => ({
            theme: "dark",
            setTheme: (theme) => set({ theme: normalizeThemeName(theme) }),
        }),
        {
            name: "infinite-canvas:theme_store",
            merge: (persisted, current) => {
                const persistedState = (persisted || {}) as Partial<ThemeStore>;
                // 兼容旧版本或损坏的本地主题值，避免工作台首次渲染时整页黑屏。
                return { ...current, theme: normalizeThemeName(persistedState.theme) };
            },
        },
    ),
);
