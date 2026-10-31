/** Records host values and SDK writes in one place. Legacy restoration stays the default.
 * The explicit if-unchanged policy is available for future host-controlled integration.
 */
export default class SceneStateLease {
    constructor({ restore = "always" } = {}) {
        if (restore !== "always" && restore !== "if-unchanged") throw new TypeError("Unknown scene restore policy");
        this._restorePolicy = restore;
        this._entries = [];
    }

    write(target, key, value) {
        if (!target) return;
        let entry = this._entries.find(entry => entry.target === target && entry.key === key);
        if (!entry) {
            entry = { target, key, original: target[key], written: value };
            this._entries.push(entry);
        }
        entry.written = value;
        target[key] = value;
    }

    restore() {
        const entries = this._entries;
        this._entries = [];
        const errors = [];
        for (const { target, key, original, written } of entries) {
            try {
                if (this._restorePolicy === "always" || target[key] === written) target[key] = original;
            } catch (error) { errors.push(error); }
        }
        if (errors.length) throw new AggregateError(errors, "Failed to restore scene settings");
    }
}
