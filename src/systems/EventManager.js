/**
 * EventManager — the single event bus every system talks through.
 *
 * WHY: GardenScene used to poke at each subsystem directly (economy → dialog →
 * VFX), which makes new systems hard to add and impossible to test in isolation.
 * Systems now publish *facts* ("a flower bloomed", "the rain started") and
 * subscribe to the facts they care about. Nobody imports anybody's internals.
 *
 *   GardenScene ──publish──▶ EVENTS.FLOWER_BLOOMED ──subscribe──▶ CodexManager
 *   WeatherView ──publish──▶ EVENTS.RAIN_STARTED   ──subscribe──▶ GardenScene
 *   CodexManager ─publish──▶ EVENTS.CODEX_MILESTONE ──subscribe──▶ GardenScene
 *
 * Design notes:
 *  - No Phaser / DOM dependency → unit-testable in plain Node.
 *  - Namespace wildcards: `on('weather:*', fn)` receives every `weather:*` event.
 *  - Handler exceptions are contained (logged, never rethrown) so one broken
 *    listener can never stall the game loop or the other subscribers.
 *  - `owner` grouping + `offOwner()` lets a UI widget or system tear all of its
 *    listeners down at once (used on scene shutdown).
 *  - `history` (bounded) records the last emitted events: handy for debugging
 *    and asserted by the test suite.
 */

/** Every event name published anywhere in the game. Keep it in one place. */
export const EVENTS = {
    /* garden / grid lifecycle */
    TILE_PLANTED: 'garden:tile-planted',
    TILE_WATERED: 'garden:tile-watered',
    FLOWER_BLOOMED: 'garden:flower-bloomed',
    FLOWER_HARVESTED: 'garden:flower-harvested',
    GARDEN_MOSAIC: 'garden:full-mosaic',

    /* economy */
    QUEST_COMPLETED: 'economy:quest-completed',
    CURRENCY_CHANGED: 'economy:currency-changed',
    REWARD_GRANTED: 'economy:reward-granted',

    /* system 8 — Thiên Thời Tứ Thời */
    WEATHER_PHASE_CHANGED: 'weather:phase-changed',
    WEATHER_CHANGED: 'weather:condition-changed',
    /** eased 0..1 lantern/radiance level driven by the ambient wash */
    WEATHER_LAMP_LEVEL: 'weather:lamp-level',
    RAIN_STARTED: 'weather:rain-started',
    RAIN_ENDED: 'weather:rain-ended',
    /** the buff: rain irrigates every unwatered plot (scene owns the tiles) */
    RAIN_IRRIGATE: 'weather:rain-irrigate',

    /* system 9 — Vạn Hoa Đồ Giám */
    CODEX_SPECIES_DISCOVERED: 'codex:species-discovered',
    CODEX_ENTRY_UPDATED: 'codex:entry-updated',
    CODEX_MILESTONE: 'codex:milestone-unlocked',
    CODEX_BUFFS_CHANGED: 'codex:buffs-changed',

    /* system 4 — Linh Hoa Dị Biến */
    BREEDING_SUCCESS: 'BREEDING_SUCCESS',

    /* UI */
    CODEX_OPEN_REQUEST: 'ui:codex-open-request',
    CODEX_OPENED: 'ui:codex-opened',
    CODEX_CLOSED: 'ui:codex-closed',
    DIALOG_OPENED: 'ui:dialog-opened',
    DIALOG_CLOSED: 'ui:dialog-closed',
    DRAWER_OPENED: 'ui:drawer-opened',
    DRAWER_CLOSED: 'ui:drawer-closed',
};

/**
 * A tiny wildcard-capable emitter.
 *
 * @example
 *   const bus = new EventManager({ label: 'floral-manor' });
 *   const stop = bus.on(EVENTS.FLOWER_HARVESTED, (p) => console.log(p.seedId));
 *   bus.emit(EVENTS.FLOWER_HARVESTED, { seedId: 'flower_cyan_orchid' });
 *   stop();
 */
export class EventManager {
    constructor({ label = 'EventManager', historySize = 40, onError = null } = {}) {
        this.label = label;
        this.historySize = Math.max(0, historySize | 0);
        this.onError = typeof onError === 'function' ? onError : null;
        this._listeners = new Map(); // event -> Set<record>
        this._patterns = new Set(); // records with a wildcard event
        this.history = [];
        this.emitCount = 0;
        this.errorCount = 0;
        this._suspended = false;
    }

    /**
     * Subscribe.
     * @param {string} event  exact name, or a `prefix:*` wildcard
     * @param {Function} handler
     * @param {object} [opts] `{ owner, once }`
     * @returns {() => void} unsubscribe handle (also usable as a disposer)
     */
    on(event, handler, { owner = null, once = false } = {}) {
        if (typeof event !== 'string' || !event) throw new TypeError('[EventManager] on() needs an event name');
        if (typeof handler !== 'function') throw new TypeError('[EventManager] on() needs a handler function');

        const record = { event, handler, owner, once, alive: true };
        if (!this._listeners.has(event)) this._listeners.set(event, new Set());
        this._listeners.get(event).add(record);
        if (event.endsWith(':*') || event === '*') this._patterns.add(record);
        return () => this._remove(record);
    }

    /** Subscribe for exactly one delivery. */
    once(event, handler, opts = {}) {
        return this.on(event, handler, { ...opts, once: true });
    }

    /** Remove one listener (by function) or every listener for an event. */
    off(event, handler = null) {
        const set = this._listeners.get(event);
        if (!set) return 0;
        let removed = 0;
        for (const record of [...set]) {
            if (handler && record.handler !== handler) continue;
            this._remove(record);
            removed++;
        }
        return removed;
    }

    /** Remove every listener registered by an owner (system / widget teardown). */
    offOwner(owner) {
        let removed = 0;
        for (const set of this._listeners.values()) {
            for (const record of [...set]) {
                if (record.owner !== owner) continue;
                this._remove(record);
                removed++;
            }
        }
        return removed;
    }

    _remove(record) {
        if (!record || !record.alive) return;
        record.alive = false;
        const set = this._listeners.get(record.event);
        if (set) {
            set.delete(record);
            if (!set.size) this._listeners.delete(record.event);
        }
        this._patterns.delete(record);
    }

    /** Number of live listeners for an event (wildcards included). */
    listenerCount(event) {
        let n = 0;
        const set = this._listeners.get(event);
        if (set) for (const r of set) if (r.alive) n++;
        for (const r of this._patterns) {
            if (r.alive && matchesPattern(r.event, event)) n++;
        }
        return n;
    }

    /** Suspend delivery (e.g. while a modal animates); emits are dropped. */
    setSuspended(suspended) {
        this._suspended = !!suspended;
    }

    /**
     * Publish an event. Handler exceptions are contained.
     * @returns {number} how many listeners were called
     */
    emit(event, payload = {}) {
        if (this._suspended) return 0;
        this.emitCount++;
        if (this.historySize) {
            this.history.push({ event, at: Date.now(), payload });
            while (this.history.length > this.historySize) this.history.shift();
        }
        const targets = [];
        const set = this._listeners.get(event);
        if (set) for (const r of set) if (r.alive) targets.push(r);
        for (const r of this._patterns) {
            if (r.alive && r.event !== event && matchesPattern(r.event, event)) targets.push(r);
        }
        for (const record of targets) {
            if (!record.alive) continue; // removed by an earlier handler
            if (record.once) this._remove(record);
            try {
                record.handler(payload, event, this);
            } catch (err) {
                this.errorCount++;
                const msg = `[EventManager] handler for "${event}" threw: ${err && err.message ? err.message : err}`;
                if (this.onError) this.onError(err, event);
                // eslint-disable-next-line no-console
                console.error(msg);
            }
        }
        return targets.length;
    }

    /** True if `event` was emitted at least once (optionally matching a payload key). */
    wasEmitted(event, predicate = null) {
        return this.history.some((h) => h.event === event && (!predicate || predicate(h.payload)));
    }

    /** Forget all listeners and history (scene shutdown). */
    clear() {
        for (const set of this._listeners.values()) for (const r of set) r.alive = false;
        this._listeners.clear();
        this._patterns.clear();
        this.history.length = 0;
    }

    destroy() {
        this.clear();
    }
}

/** `weather:*` matches `weather:phase-changed`; `*` matches everything. */
function matchesPattern(pattern, event) {
    if (pattern === '*') return true;
    if (!pattern.endsWith(':*')) return false;
    const prefix = pattern.slice(0, -1); // keep the trailing colon
    return event.startsWith(prefix);
}

/** Shared app-wide bus (scenes may create their own for tests). */
export const gameBus = new EventManager({ label: 'floral-manor' });

export default EventManager;
