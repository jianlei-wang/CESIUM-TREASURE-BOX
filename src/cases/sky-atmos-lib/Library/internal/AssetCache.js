// Keep original bytes for the page lifetime, independently of instance/GPU ownership.
const entries = new Map();
const DOWNLOAD_IDLE_TIMEOUT_MS = 60_000;

function absoluteUrl(url) {
    const base = globalThis.document?.baseURI ?? globalThis.location?.href;
    return base ? new URL(url, base).href : String(url);
}

export function invalidateAssetBuffer(url, buffer) {
    const key = absoluteUrl(url);
    // A late decoder failure must not evict a newer download of the same URL.
    if (entries.get(key)?.buffer === buffer) entries.delete(key);
}

export function loadAssetBuffer(url, onProgress, { requestHeader, withCredentials = false } = {}) {
    const key = absoluteUrl(url);
    let entry = entries.get(key);
    if (!entry) {
        entry = { listeners: new Set() };
        entries.set(key, entry);
        entry.promise = (async () => {
            let timeout;
            try {
                const controller = new AbortController();
                const resetTimeout = () => {
                    clearTimeout(timeout);
                    // Bound stalled headers/body reads without rejecting a slow download
                    // that is still making progress. All consumers share this deadline.
                    timeout = setTimeout(() => controller.abort(new Error(
                        `Asset download timed out after ${DOWNLOAD_IDLE_TIMEOUT_MS} ms without progress.`
                    )), DOWNLOAD_IDLE_TIMEOUT_MS);
                };
                resetTimeout();
                const response = await fetch(key, {
                    headers: requestHeader,
                    credentials: withCredentials ? "include" : "same-origin",
                    signal: controller.signal,
                });
                if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
                resetTimeout();
                let buffer;
                if (response.body?.getReader) {
                    const reader = response.body.getReader();
                    const chunks = [];
                    const total = Number(response.headers.get("Content-Length")) || 0;
                    let loaded = 0;
                    try {
                        for (;;) {
                            const { done, value } = await reader.read();
                            if (done) break;
                            if (value.byteLength > 0) resetTimeout();
                            chunks.push(value);
                            loaded += value.byteLength;
                            for (const listener of entry.listeners) {
                                try { listener({ lengthComputable: total > 0, loaded, total }); }
                                catch (error) { console.error(error); }
                            }
                        }
                    } finally {
                        reader.releaseLock();
                    }
                    const bytes = new Uint8Array(loaded);
                    let offset = 0;
                    for (const chunk of chunks) {
                        bytes.set(chunk, offset);
                        offset += chunk.byteLength;
                    }
                    buffer = bytes.buffer;
                } else {
                    buffer = await response.arrayBuffer();
                }
                entry.buffer = buffer;
                return buffer;
            } catch (cause) {
                if (entries.get(key) === entry) entries.delete(key);
                throw new Error(`[SkyAtmos] Failed to download asset: ${key}`, { cause });
            } finally {
                clearTimeout(timeout);
                entry.listeners.clear();
            }
        })();
    }
    if (onProgress && !entry.buffer) entry.listeners.add(onProgress);
    return entry.promise;
}
