/** Tracks resource outcomes independently from Cesium stage.ready.
 * Readiness promises always settle; callers inspect status/errors for failed assets.
 */
export default class AssetManager {
    constructor({ onError } = {}) {
        this._entries = new Map();
        this._listeners = new Set();
        this._disposed = false;
        this._onError = onError;
        this._ready = Promise.resolve();
    }

    add({ id, url, required = true, load }) {
        if (!this._disposed && !this._entries.has(id)) {
            this._entries.set(id, { id, url, required, load, status: "idle" });
        }
    }

    get status() { return this.getState().status; }

    get errors() {
        return this.getState().errors;
    }

    get ready() { return this._ready; }

    get success() {
        return this._ready.then(() => {
            if (this._disposed) throw Object.assign(new Error("[SkyAtmos] Asset manager is disposed."), { name: "AbortError" });
        });
    }

    _outcome(entry, status = entry?.status ?? "idle") {
        const errors = status === "error"
            ? [Object.freeze({ id: entry.id, url: entry.url, required: entry.required, error: entry.error })] : [];
        return Object.freeze({ status, errors: Object.freeze(errors) });
    }

    _snapshot(outcomes) {
        const states = outcomes.map(outcome => outcome.status);
        const status = states.includes("disposed") ? "disposed"
            : states.includes("loading") ? "loading" : states.includes("error") ? "error"
                : states.length === 0 || states.includes("idle") ? "idle" : "ready";
        return Object.freeze({ status, errors: Object.freeze(outcomes.flatMap(outcome => outcome.errors)) });
    }

    // A selected scope can include tasks not registered yet; observing it must not start them.
    getState(ids = [...this._entries.keys()]) {
        if (this._disposed) return this._outcome(undefined, "disposed");
        return this._snapshot(ids.map(id => this._outcome(this._entries.get(id))));
    }

    capture(ids, { start = false, retry = false } = {}) {
        if (this._disposed) return Promise.reject(Object.assign(new Error("[SkyAtmos] Asset manager is disposed."), { name: "AbortError" }));
        // `retryAssets()` also starts newly enabled scopes that have not had a
        // first request. Success items and in-flight requests remain untouched.
        const requested = new Set();
        if (start) {
            for (const id of ids) {
                if ((this._entries.get(id)?.status ?? "idle") === "idle") requested.add(id);
            }
        }
        if (retry) {
            for (const id of ids) {
                const status = this._entries.get(id)?.status ?? "idle";
                if (status === "idle" || status === "error") requested.add(id);
            }
        }
        if (requested.size) this.start(requested);
        // Capture each run's immutable outcome now. A later retry must not replace
        // the failure observed by an earlier waiter before that waiter resumes.
        const outcomes = ids.map(id => {
            const entry = this._entries.get(id);
            return entry?.status === "loading" ? entry.done : this._outcome(entry);
        });
        return Promise.all(outcomes).then(results => this._snapshot(results));
    }

    subscribe(listener) {
        if (this._disposed) return () => {};
        this._listeners.add(listener);
        return () => this._listeners.delete(listener);
    }

    _notify() {
        const snapshot = this.getState();
        for (const listener of this._listeners) {
            // Observer failures cannot turn successful resource loads into failures.
            try { listener(snapshot); } catch (error) { console.error(error); }
        }
    }

    start(ids = [...this._entries.keys()]) {
        if (this._disposed) return Promise.resolve();
        for (const id of ids) {
            const entry = this._entries.get(id);
            if (!entry || entry.status === "ready" || entry.status === "loading") continue;
            entry.status = "loading";
            entry.error = undefined;
            entry.done = new Promise((resolve, reject) => {
                entry.resolve = resolve;
                entry.reject = reject;
            });
            // Invoke synchronously to preserve the current request scheduling behavior.
            let source;
            try { source = entry.load(); }
            catch (error) { source = Promise.reject(error); }
            Promise.resolve(source).then(() => this._finish(entry, true), error => this._finish(entry, false, error));
            entry.done.catch(() => {});
        }
            this._ready = Promise.all([...this._entries.values()]
            .filter(entry => entry.required && entry.status === "loading")
            .map(entry => entry.done)).then(() => undefined);
        this._notify();
        return this._ready;
    }

    _finish(entry, succeeded, error) {
        if (this._disposed || entry.status !== "loading") return;
        entry.status = succeeded ? "ready" : "error";
        entry.error = error;
        entry.resolve(this._outcome(entry));
        entry.resolve = undefined;
        entry.reject = undefined;
        if (!succeeded && this._onError) {
            try { this._onError(Object.freeze({ id: entry.id, url: entry.url, required: entry.required, error })); }
            catch (observerError) { console.error(observerError); }
        }
        this._notify();
    }

    retry() {
        const ids = [...this._entries.values()]
            .filter(entry => entry.status === "error").map(entry => entry.id);
        this.start(ids);
        return Promise.all(ids.map(id => this._entries.get(id).done)).then(() => undefined);
    }

    dispose() {
        if (this._disposed) return;
        this._disposed = true;
        for (const entry of this._entries.values()) {
            entry.resolve?.(this._outcome(entry, "disposed"));
            entry.resolve = undefined;
            entry.reject = undefined;
        }
        this._notify();
        this._listeners.clear();
        this._ready = Promise.resolve();
    }
}
