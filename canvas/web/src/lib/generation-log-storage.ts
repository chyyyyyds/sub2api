const STANDALONE_SCOPE = "standalone";
const SCOPE_SEPARATOR = "::";

export function generationLogStorageKey(scope: string, logId: string) {
    return scope === STANDALONE_SCOPE ? logId : `${scope}${SCOPE_SEPARATOR}${logId}`;
}

export function isGenerationLogStorageKeyForScope(key: string, scope: string) {
    if (scope === STANDALONE_SCOPE) return !key.includes(SCOPE_SEPARATOR);
    return key.startsWith(`${scope}${SCOPE_SEPARATOR}`);
}
