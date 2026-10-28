declare module "bun:test" {
    interface Matchers {
        toBe(expected: unknown): void;
        toEqual(expected: unknown): void;
        toThrow(expected?: unknown): void;
    }

    interface TestFunction {
        (name: string, callback: () => void | Promise<void>): void;
        each<T extends readonly unknown[]>(cases: readonly T[]): (name: string, callback: (...args: [...T]) => void | Promise<void>) => void;
    }

    export const describe: (name: string, callback: () => void) => void;
    export const expect: (actual: unknown) => Matchers;
    export const test: TestFunction;
}
