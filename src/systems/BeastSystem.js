/**
 * BeastSystem — System 3/6: NGỰ THÚ TIÊN VIÊN (Spirit Beast Sanctuary).
 *
 * Pure data + rules module (no Phaser, no DOM) so it is unit-testable in
 * plain Node, exactly like AlchemyManager / CodexManager / WeatherSystem.
 *
 * What it does
 *  - Owns the four sanctuary beasts (Cửu Vĩ Bạch Hồ, Ngọc Thỏ, Thanh Loan,
 *    Huyền Quy) and their affinity / last-fed clocks.
 *  - Listens for FISH_CAUGHT on the bus (Câu Cá → Linh Ngư) and holds the
 *    Linh Ngư stock used by the feeding loop.
 *  - "Cho Ăn": consume 1 Linh Ngư → +20 Thân Mật, publish BEAST_FED, persist.
 *  - Serialises to LocalStorage through a tiny StateStore so a reload keeps
 *    affinity, cooldowns and the fish bag.
 *
 * Presentation lives in ui/BeastModal.js. The scene never pokes at beast
 * internals — it publishes fishing facts and reads getBeasts() / getBuffs().
 */
import { EVENTS } from './EventManager.js';
import { BEAST_ASSETS } from '../data/BeastAssetManifest.js';

export const BEAST_STORAGE_KEY = 'hoa-vien:beast-state';

export const BEAST_DEFAULTS = Object.freeze({
    affinityMax: 100,
    feedAffinity: 20,       // +20 Thân Mật per Linh Ngư
    petAffinity: 2,
    feedCooldownMs: 5000,
    petCooldownMs: 3000,
    starterLinhNgu: 0,
});

/**
 * Tiny JSON key/value wrapper over LocalStorage (or any Storage-like object).
 * Injected in tests as an in-memory Map so Node can run without a window.
 */
export class StateStore {
    /**
     * @param {string} [key]
     * @param {{getItem:(k:string)=>?string,setItem:(k:string,v:string)=>void,removeItem?:(k:string)=>void}|null} [storage]
     */
    constructor(key = BEAST_STORAGE_KEY, storage = null) {
        this.key = key;
        this.storage = storage ?? getLocalStorage();
    }

    read() {
        if (!this.storage) return null;
        try {
            const raw = this.storage.getItem(this.key);
            if (!raw) return null;
            return JSON.parse(raw);
        } catch {
            return null;
        }
    }

    write(data) {
        if (!this.storage) return false;
        try {
            this.storage.setItem(this.key, JSON.stringify(data));
            return true;
        } catch {
            return false;
        }
    }

    clear() {
        try { this.storage?.removeItem?.(this.key); } catch { /* ignore quota / missing */ }
        return this;
    }
}

function getLocalStorage() {
    try {
        if (typeof globalThis !== 'undefined' && globalThis.localStorage) return globalThis.localStorage;
    } catch { /* sandboxed / disabled */ }
    try {
        if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
    } catch { /* jsdom / iframe */ }
    return null;
}

/**
 * Canonical sanctuary roster. `affinity` here is the fresh-save starting
 * value; runtime copies live on BeastSystem.beasts.
 */
export const BEAST_CATALOG = Object.freeze([
    {
        id: 'fox_01',
        assetId: 'spirit_fox',
        assetKey: BEAST_ASSETS.spirit_fox.key,
        name: 'Cửu Vĩ Bạch Hồ',
        shortName: 'Bạch Hồ',
        rarity: 'legendary',
        affinity: 72,
        affinityMax: BEAST_DEFAULTS.affinityMax,
        buffs: Object.freeze([{ label: '+10% tốc độ thu hoạch', value: 0.10, type: 'harvest_speed' }]),
    },
    {
        id: 'rabbit_01',
        assetId: 'jade_rabbit',
        assetKey: BEAST_ASSETS.jade_rabbit.key,
        name: 'Ngọc Thỏ',
        shortName: 'Ngọc Thỏ',
        rarity: 'rare',
        affinity: 35,
        affinityMax: BEAST_DEFAULTS.affinityMax,
        buffs: Object.freeze([{ label: '+5% may mắn gieo trồng', value: 0.05, type: 'plant_luck' }]),
    },
    {
        id: 'qingluan_01',
        assetId: 'qingluan',
        assetKey: BEAST_ASSETS.qingluan.key,
        name: 'Thanh Loan',
        shortName: 'Thanh Loan',
        rarity: 'legendary',
        affinity: 48,
        affinityMax: BEAST_DEFAULTS.affinityMax,
        buffs: Object.freeze([{ label: '+15% tốc độ cây lớn', value: 0.15, type: 'growth_speed' }]),
    },
    {
        id: 'xuanwu_01',
        assetId: 'xuanwu',
        assetKey: BEAST_ASSETS.xuanwu.key,
        name: 'Huyền Quy',
        shortName: 'Huyền Quy',
        rarity: 'legendary',
        affinity: 40,
        affinityMax: BEAST_DEFAULTS.affinityMax,
        buffs: Object.freeze([{ label: '+20% tỷ lệ đan dược cao cấp', value: 0.20, type: 'alchemy_tier' }]),
    },
]);

/** Clone the catalog into mutable runtime records (lastFed / lastPet clocks). */
export function createBeastRuntimeState(now = Date.now()) {
    return BEAST_CATALOG.map((b) => ({
        ...b,
        buffs: b.buffs.map((buff) => ({ ...buff })),
        lastFed: now - 3600_000,
        lastPet: now - 1800_000,
    }));
}

export class BeastSystem {
    /**
     * @param {object} [opts]
     * @param {import('./EventManager.js').EventManager} [opts.bus]
     * @param {() => number} [opts.now]
     * @param {StateStore|null} [opts.store]
     * @param {{getItem:Function,setItem:Function}|null} [opts.storage]
     * @param {boolean} [opts.persist=true]
     */
    constructor({ bus = null, now = null, store = null, storage = null, persist = true } = {}) {
        this.bus = bus;
        this.nowFn = typeof now === 'function' ? now : null;
        this.persistEnabled = persist !== false;
        this.store = store ?? new StateStore(BEAST_STORAGE_KEY, storage);
        this._disposers = [];
        this.init();
    }

    _now() {
        return this.nowFn ? this.nowFn() : Date.now();
    }

    init() {
        const t = this._now();
        this.beasts = createBeastRuntimeState(t);
        this.linhNgu = BEAST_DEFAULTS.starterLinhNgu;
        this.stats = { totalFed: 0, totalPetted: 0, totalCaught: 0 };
    }

    /* ----------------------------- bus wiring ----------------------------- */

    bind(bus) {
        this.unbind();
        if (!bus) return this;
        this.bus = bus;
        this._disposers.push(
            bus.on(EVENTS.FISH_CAUGHT, (p) => this.recordCatch(p), { owner: 'beasts' }),
        );
        return this;
    }

    unbind() {
        if (this.bus) for (const off of this._disposers) off();
        this._disposers = [];
        this.bus = null;
        return this;
    }

    _publish(event, payload) {
        if (this.bus && typeof this.bus.emit === 'function') this.bus.emit(event, payload);
    }

    /* ------------------------------ queries ------------------------------- */

    getBeasts() {
        return this.beasts;
    }

    getBeast(id) {
        return this.beasts.find((b) => b.id === id) ?? null;
    }

    getLinhNgu() {
        return this.linhNgu;
    }

    /**
     * Aggregated passive buffs for GardenScene (same composition style as
     * alchemy / codex). `growthMult < 1` means faster bloom cascades.
     */
    getBuffs() {
        const buffs = { growthMult: 1, harvestSpeed: 0, plantLuck: 0, alchemyTierBonus: 0, active: [] };
        for (const beast of this.beasts) {
            for (const b of beast.buffs ?? []) {
                buffs.active.push({ beastId: beast.id, ...b });
                if (b.type === 'growth_speed' && b.value) {
                    buffs.growthMult = Math.min(buffs.growthMult, 1 / (1 + b.value));
                }
                if (b.type === 'harvest_speed') buffs.harvestSpeed = Math.max(buffs.harvestSpeed, b.value ?? 0);
                if (b.type === 'plant_luck') buffs.plantLuck = Math.max(buffs.plantLuck, b.value ?? 0);
                if (b.type === 'alchemy_tier') buffs.alchemyTierBonus = Math.max(buffs.alchemyTierBonus, b.value ?? 0);
            }
        }
        return buffs;
    }

    /* --------------------------- fishing → bag ---------------------------- */

    /**
     * FISH_CAUGHT bookkeeping. Any koi from the pier counts as Linh Ngư for
     * the feeding loop (Câu Cá → Nuôi Thú).
     * @returns {{itemId:string, amount:number, linhNgu:number}}
     */
    recordCatch({ itemId = 'linh_ngu', amount = 1 } = {}) {
        const n = Math.max(0, amount | 0);
        if (!n) return { itemId: itemId || 'linh_ngu', amount: 0, linhNgu: this.linhNgu };
        this.linhNgu += n;
        this.stats.totalCaught += n;
        this.save();
        const payload = { itemId: itemId || 'linh_ngu', amount: n, linhNgu: this.linhNgu };
        this._publish(EVENTS.BEAST_STATE_CHANGED, this.serialize());
        return payload;
    }

    /** Grant Linh Ngư (tests, rewards). */
    grantLinhNgu(n = 1) {
        this.linhNgu = Math.max(0, this.linhNgu + (n | 0));
        return this;
    }

    /* ------------------------------- feed -------------------------------- */

    /**
     * Consume 1 Linh Ngư and add +20 Thân Mật.
     * @returns {{success:boolean, reason?:string, beast?:object, linhNgu?:number, gained?:number}}
     */
    feed(beastId, { now = null } = {}) {
        const t = now ?? this._now();
        const beast = this.getBeast(beastId);
        if (!beast) return { success: false, reason: 'UNKNOWN_BEAST' };
        const since = t - (beast.lastFed ?? 0);
        if (since < BEAST_DEFAULTS.feedCooldownMs) {
            return { success: false, reason: 'COOLDOWN', remainingMs: BEAST_DEFAULTS.feedCooldownMs - since };
        }
        if (this.linhNgu < 1) return { success: false, reason: 'NO_FISH', linhNgu: 0 };

        this.linhNgu -= 1;
        const before = beast.affinity;
        beast.affinity = Math.min(beast.affinityMax, beast.affinity + BEAST_DEFAULTS.feedAffinity);
        beast.lastFed = t;
        this.stats.totalFed++;
        this.save();

        const payload = {
            beastId: beast.id,
            beast: snapshotBeast(beast),
            linhNgu: this.linhNgu,
            gained: beast.affinity - before,
            at: t,
        };
        this._publish(EVENTS.BEAST_FED, payload);
        this._publish(EVENTS.BEAST_AFFINITY_CHANGED, payload);
        this._publish(EVENTS.BEAST_STATE_CHANGED, this.serialize());
        return { success: true, ...payload };
    }

    /**
     * Pet ("Xoa Đầu"): +2 Thân Mật, no fish cost.
     * @returns {{success:boolean, reason?:string, beast?:object, gained?:number}}
     */
    pet(beastId, { now = null } = {}) {
        const t = now ?? this._now();
        const beast = this.getBeast(beastId);
        if (!beast) return { success: false, reason: 'UNKNOWN_BEAST' };
        const since = t - (beast.lastPet ?? 0);
        if (since < BEAST_DEFAULTS.petCooldownMs) {
            return { success: false, reason: 'COOLDOWN', remainingMs: BEAST_DEFAULTS.petCooldownMs - since };
        }
        const before = beast.affinity;
        beast.affinity = Math.min(beast.affinityMax, beast.affinity + BEAST_DEFAULTS.petAffinity);
        beast.lastPet = t;
        this.stats.totalPetted++;
        this.save();
        const payload = {
            beastId: beast.id,
            beast: snapshotBeast(beast),
            gained: beast.affinity - before,
            at: t,
        };
        this._publish(EVENTS.BEAST_PETTED, payload);
        this._publish(EVENTS.BEAST_AFFINITY_CHANGED, payload);
        this._publish(EVENTS.BEAST_STATE_CHANGED, this.serialize());
        return { success: true, ...payload };
    }

    /* ----------------------------- persistence ----------------------------- */

    serialize() {
        return {
            linhNgu: this.linhNgu,
            beasts: this.beasts.map((b) => ({
                id: b.id,
                affinity: b.affinity,
                affinityMax: b.affinityMax,
                lastFed: b.lastFed,
                lastPet: b.lastPet,
            })),
            stats: { ...this.stats },
        };
    }

    deserialize(data) {
        this.init();
        if (!data) return this;
        this.linhNgu = Math.max(0, data.linhNgu ?? this.linhNgu);
        this.stats = { ...this.stats, ...(data.stats ?? {}) };
        const byId = new Map((data.beasts ?? []).map((b) => [b.id, b]));
        for (const beast of this.beasts) {
            const saved = byId.get(beast.id);
            if (!saved) continue;
            if (Number.isFinite(saved.affinity)) {
                beast.affinity = Math.max(0, Math.min(beast.affinityMax, saved.affinity));
            }
            if (Number.isFinite(saved.lastFed)) beast.lastFed = saved.lastFed;
            if (Number.isFinite(saved.lastPet)) beast.lastPet = saved.lastPet;
        }
        return this;
    }

    /** Write current state to LocalStorage / the injected StateStore. */
    save() {
        if (!this.persistEnabled) return false;
        return this.store.write(this.serialize());
    }

    /** Hydrate from LocalStorage. No-op when the store is empty. */
    load() {
        const data = this.store.read();
        if (data) this.deserialize(data);
        return this;
    }

    destroy() {
        this.unbind();
    }
}

function snapshotBeast(beast) {
    return {
        id: beast.id,
        name: beast.name,
        rarity: beast.rarity,
        affinity: beast.affinity,
        affinityMax: beast.affinityMax,
        lastFed: beast.lastFed,
        lastPet: beast.lastPet,
        buffs: (beast.buffs ?? []).map((b) => ({ ...b })),
    };
}

export default BeastSystem;
