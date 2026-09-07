/**
 * AlchemyManager — System 5: LÒ LUYỆN ĐAN (Alchemy Cauldron / Cửu Chuyển Đan Lôi).
 *
 * Pure data + rules module (no Phaser, no DOM) so it is unit-testable in plain
 * Node, exactly like BreedingManager / CodexManager / WeatherSystem.
 *
 * What it does
 *  - Collects ingredients from gameplay FACTS published on the bus:
 *      · every FLOWER_HARVESTED drops one petal-herb of the harvested species
 *        (U Đàm ← Tinh Trạch U Đàm, Huyết Kế ← Hồng Hà Tiên Chi, ...);
 *      · a harvest of a rain-watered bloom carries extra Linh Dịch
 *        (linh sương the spring rain leaves behind);
 *      · every N watered plots (TILE_WATERED) condense one Linh Dịch.
 *  - Crafts elixirs in a single bronze furnace with a real-time countdown,
 *    a per-recipe success rate (injectable random ⇒ deterministic tests) and
 *    an elixir shelf inventory.
 *  - Consumes elixirs and publishes the active buff as `ELIXIR_CONSUMED` —
 *    the scene (or any other system) applies the effect. This module never
 *    touches tiles, flowers or breeding; everything rides the EventManager.
 *
 * Recipe table (per the Phase-2 task sheet, roadmap §5):
 *  · Tụ Khí Đan      3× U Đàm + 1× Linh Dịch — +20% bloom speed, 10 minutes.
 *  · Tẩy Tủy Đan     2× Huyết Kế + 2× U Đàm — +15% breeding mutation chance.
 *  · Vạn Thọ Linh Dịch 2× Linh Dịch + 1× Trúc Bích — auto-waters the whole garden.
 *
 * Time model: the furnace and buff timers run on the wall clock
 * (`Date.now()` by default, injectable for tests). `tick(delta, now)`
 * resolves whatever is due — one call per frame from GardenScene.update.
 */
import { EVENTS } from './EventManager.js';

export const ALCHEMY_DEFAULTS = Object.freeze({
    /** Every N watered plots condense one Linh Dịch. */
    dewPerTiles: 4,
    /** Starter kit so the first furnace run is one harvest away. */
    starterHerbs: { u_dam: 2, linh_dich: 1 },
});

/**
 * Herb (thảo dược) catalogue. The five petal-herbs map 1:1 onto the seed
 * catalog; Linh Dịch is the distilled spirit water. Tints mirror the flower
 * palette (07_VISUAL_ASSET_CATALOG) so the UI can render clean chips.
 */
export const HERBS = Object.freeze([
    { id: 'u_dam', name: 'U Đàm', seedId: 'flower_cyan_orchid', tint: 0x7ff7ff },
    { id: 'huyet_ke', name: 'Huyết Kế', seedId: 'flower_purple_wisteria', tint: 0xc98bff },
    { id: 'kim_huyen', name: 'Kim Huyên', seedId: 'flower_golden_amber', tint: 0xffe08a },
    { id: 'truc_bich', name: 'Trúc Bích', seedId: 'flower_emerald_bamboo', tint: 0x7dffb6 },
    { id: 'nguyet_cuc', name: 'Nguyệt Cúc', seedId: 'flower_rare_nguyet_cuc', tint: 0xe8b4ff },
    { id: 'linh_dich', name: 'Linh Dịch', seedId: null, tint: 0x36c5e8, water: true },
]);

/** seedId → herbId (harvest bookkeeping). */
export const HERB_BY_SEED = Object.freeze(
    Object.fromEntries(HERBS.filter((h) => h.seedId).map((h) => [h.seedId, h.id])),
);

/** Elixir shelf entries (the crafted goods). */
export const ELIXIRS = Object.freeze([
    { id: 'tu_khi_dan', name: 'Tụ Khí Đan', tint: 0xffd97a },
    { id: 'tay_tui_dan', name: 'Tẩy Tủy Đan', tint: 0xc98bff },
    { id: 'van_tho_linh_dich', name: 'Vạn Thọ Linh Dịch', tint: 0x36c5e8 },
]);

const MINUTE = 60_000;

/**
 * The recipe table. `buff` is the payload descriptor published on
 * ELIXIR_CONSUMED — `growthBoost`/`mutationBonus` are additive percentages,
 * `durationMs` 0 means an instant one-shot effect.
 */
export const ALCHEMY_RECIPES = Object.freeze([
    {
        id: 'tu_khi_dan',
        name: 'Tụ Khí Đan',
        description: 'Tăng 20% tốc độ hoa nở trong 10 phút',
        ingredients: { u_dam: 3, linh_dich: 1 },
        durationMs: 45_000,
        successRate: 0.85,
        elixirId: 'tu_khi_dan',
        buff: Object.freeze({ type: 'growth_speed', label: 'Tụ Khí', growthBoost: 0.2, durationMs: 10 * MINUTE }),
    },
    {
        id: 'tay_tui_dan',
        name: 'Tẩy Tủy Đan',
        description: 'Tăng 15% tỷ lệ đột biến lai tạo giống',
        ingredients: { huyet_ke: 2, u_dam: 2 },
        durationMs: 60_000,
        successRate: 0.7,
        elixirId: 'tay_tui_dan',
        buff: Object.freeze({ type: 'mutation_boost', label: 'Tẩy Tủy', mutationBonus: 0.15, durationMs: 10 * MINUTE }),
    },
    {
        id: 'van_tho_linh_dich',
        name: 'Vạn Thọ Linh Dịch',
        description: 'Tự động tưới nước toàn vườn',
        ingredients: { linh_dich: 2, truc_bich: 1 },
        durationMs: 30_000,
        successRate: 0.95,
        elixirId: 'van_tho_linh_dich',
        buff: Object.freeze({ type: 'auto_water', label: 'Vạn Thọ', durationMs: 0 }),
    },
]);

export class AlchemyManager {
    /**
     * @param {object} [opts]
     * @param {import('./EventManager.js').EventManager} [opts.bus]
     * @param {() => number} [opts.random]      injectable dice (tests)
     * @param {Array} [opts.recipes]            override the recipe table (tests)
     * @param {() => number} [opts.now]         injectable clock (tests)
     * @param {number} [opts.dewPerTiles]
     */
    constructor({ bus = null, random = Math.random, recipes = ALCHEMY_RECIPES, now = null, dewPerTiles = ALCHEMY_DEFAULTS.dewPerTiles } = {}) {
        this.bus = bus;
        this.random = random;
        this.recipes = recipes;
        this.nowFn = typeof now === 'function' ? now : null;
        this.dewPerTiles = Math.max(1, dewPerTiles | 0);
        this._disposers = [];
        this.init();
    }

    /** Wall clock (or the injected one). */
    _now() {
        return this.nowFn ? this.nowFn() : Date.now();
    }

    init() {
        this.herbs = Object.fromEntries(HERBS.map((h) => [h.id, 0]));
        this.elixirs = Object.fromEntries(ELIXIRS.map((e) => [e.id, 0]));
        for (const [id, n] of Object.entries(ALCHEMY_DEFAULTS.starterHerbs)) this.herbs[id] = n;
        this.activeBuffs = []; // { elixirId, type, label, growthBoost, mutationBonus, durationMs, startedAt, expiresAt }
        this.crafting = null;  // { recipeId, name, startedAt, endsAt, roll, successRate }
        this.stats = { totalCrafts: 0, totalSuccess: 0, totalFailed: 0, totalConsumed: 0 };
        this.dewProgress = 0;
    }

    /* ----------------------------- bus wiring ----------------------------- */

    /** Listen for the gameplay facts that feed the furnace. */
    bind(bus) {
        this.unbind();
        if (!bus) return this;
        this.bus = bus;
        this._disposers.push(
            bus.on(EVENTS.FLOWER_HARVESTED, (p) => this.recordHarvest(p), { owner: 'alchemy' }),
            bus.on(EVENTS.TILE_WATERED, () => this.recordWateredTile(), { owner: 'alchemy' }),
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

    /* --------------------------- ingredient flow --------------------------- */

    /**
     * FLOWER_HARVESTED bookkeeping: one petal-herb for the species, plus a
     * Linh Dịch dew when the bloom was raised by the spring rain.
     * @returns {{herb: ?{id:string,amount:number}, dew: number}}
     */
    recordHarvest({ seedId, rainWatered = false } = {}) {
        const herbId = HERB_BY_SEED[seedId];
        const herb = herbId ? { id: herbId, amount: 1 } : null;
        if (herb) this.herbs[herb.id] += herb.amount;
        const dew = rainWatered ? 1 : 0;
        if (dew) this.herbs.linh_dich += dew;
        if (herb || dew) {
            this._publish(EVENTS.ALCHEMY_INGREDIENT_GAINED, { source: 'harvest', seedId, herb, dew });
        }
        return { herb, dew };
    }

    /**
     * TILE_WATERED bookkeeping: every N watered plots condense one Linh Dịch.
     * @returns {?{id:string,amount:number}} the drop, when it triggered
     */
    recordWateredTile() {
        this.dewProgress++;
        if (this.dewProgress < this.dewPerTiles) return null;
        this.dewProgress = 0;
        this.herbs.linh_dich += 1;
        this._publish(EVENTS.ALCHEMY_INGREDIENT_GAINED, { source: 'watering', dew: 1 });
        return { id: 'linh_dich', amount: 1 };
    }

    /* ------------------------------- crafting ------------------------------ */

    getRecipe(id) {
        return this.recipes.find((r) => r.id === id) ?? null;
    }

    /** True when the given ingredient bag covers the recipe. */
    canCraft(recipeId, herbs = this.herbs) {
        const recipe = this.getRecipe(recipeId);
        if (!recipe) return false;
        return Object.entries(recipe.ingredients)
            .every(([id, n]) => (herbs[id] ?? 0) >= n);
    }

    getCrafting() {
        return this.crafting ? { ...this.crafting } : null;
    }

    /**
     * Start a furnace run. Ingredients are deducted up-front (a failed
     * transmutation consumes them — the essence is lost to the smoke).
     * @returns {{success:boolean, reason?:string, recipe?:object}}
     */
    craft(recipeId, { now = null } = {}) {
        const t = now ?? this._now();
        const recipe = this.getRecipe(recipeId);
        if (!recipe) return { success: false, reason: 'UNKNOWN_RECIPE' };
        if (this.crafting) return { success: false, reason: 'FURNACE_BUSY', recipe };
        if (!this.canCraft(recipeId)) return { success: false, reason: 'MISSING_INGREDIENTS', recipe };

        for (const [id, n] of Object.entries(recipe.ingredients)) {
            this.herbs[id] = Math.max(0, (this.herbs[id] ?? 0) - n);
        }
        this.crafting = {
            recipeId: recipe.id,
            name: recipe.name,
            startedAt: t,
            endsAt: t + recipe.durationMs,
            roll: this.random(),
            successRate: recipe.successRate,
        };
        this.stats.totalCrafts++;
        this._publish(EVENTS.ALCHEMY_CRAFT_STARTED, {
            recipe: { id: recipe.id, name: recipe.name, description: recipe.description },
            startedAt: this.crafting.startedAt,
            endsAt: this.crafting.endsAt,
        });
        return { success: true, recipe, ...this.crafting };
    }

    /** Countdown snapshot for the UI (null while the furnace rests). */
    getCraftProgress(now = null) {
        if (!this.crafting) return null;
        const t = now ?? this._now();
        const durationMs = this.crafting.endsAt - this.crafting.startedAt;
        const remainingMs = Math.max(0, this.crafting.endsAt - t);
        return {
            recipeId: this.crafting.recipeId,
            name: this.crafting.name,
            remainingMs,
            durationMs,
            percent: durationMs > 0 ? 1 - remainingMs / durationMs : 1,
        };
    }

    /**
     * Advance the furnace + buff timers. Call once per frame (GardenScene
     * does this); `now` is injectable so tests can jump the clock.
     * @returns {{craftResolved: ?object, expired: Array<object>}}
     */
    tick(delta = 0, now = null) {
        const t = now ?? this._now();
        const changes = { craftResolved: null, expired: [] };

        // Buff timers expire lazily on tick (or on read, via getActiveBuffs).
        for (const buff of [...this.activeBuffs]) {
            if (buff.durationMs <= 0 || t < buff.expiresAt) continue;
            this.activeBuffs = this.activeBuffs.filter((b) => b !== buff);
            changes.expired.push({ elixirId: buff.elixirId, type: buff.type, label: buff.label });
            this._publish(EVENTS.ALCHEMY_BUFF_EXPIRED, {
                elixirId: buff.elixirId,
                type: buff.type,
                label: buff.label,
                active: this.getActiveBuffs(t),
            });
        }

        if (this.crafting && t >= this.crafting.endsAt) {
            changes.craftResolved = this._resolveCraft(t);
        }
        return changes;
    }

    /** Roll the dice stored at craft time. */
    _resolveCraft(t) {
        const run = this.crafting;
        this.crafting = null;
        const recipe = this.getRecipe(run.recipeId);
        const success = run.roll < run.successRate;
        if (success) {
            this.elixirs[recipe.elixirId] += 1;
            this.stats.totalSuccess++;
            this._publish(EVENTS.ALCHEMY_CRAFT_SUCCESS, {
                elixirId: recipe.elixirId,
                recipe: { id: recipe.id, name: recipe.name },
                roll: run.roll,
                successRate: run.successRate,
                at: t,
            });
        } else {
            this.stats.totalFailed++;
            this._publish(EVENTS.ALCHEMY_CRAFT_FAILED, {
                recipeId: recipe.id,
                recipeName: recipe.name,
                roll: run.roll,
                successRate: run.successRate,
                at: t,
            });
        }
        return { success, recipeId: recipe.id, elixirId: recipe.elixirId, roll: run.roll, successRate: run.successRate };
    }

    /* ------------------------------- elixirs ------------------------------- */

    getElixir(id) {
        return this.elixirs[id] ?? 0;
    }

    /**
     * Consume one elixir: activate its buff and publish the public
     * `ELIXIR_CONSUMED` event carrying the full buffData. Timed buffs of the
     * same type refresh their duration (no stacking).
     * @returns {{success:boolean, reason?:string, buff?:object, active?:Array}}
     */
    consume(elixirId, { now = null } = {}) {
        const t = now ?? this._now();
        const recipe = this.recipes.find((r) => r.elixirId === elixirId);
        if (!recipe || (this.elixirs[elixirId] ?? 0) <= 0) {
            return { success: false, reason: 'NO_ELIXIR', elixirId };
        }
        this.elixirs[elixirId] -= 1;
        this.stats.totalConsumed++;

        const base = recipe.buff || {};
        if (base.durationMs > 0) {
            const existing = this.activeBuffs.find((b) => b.type === base.type);
            if (existing) {
                existing.startedAt = t;
                existing.expiresAt = t + base.durationMs;
            } else {
                this.activeBuffs.push({
                    elixirId,
                    type: base.type,
                    label: base.label,
                    growthBoost: base.growthBoost ?? 0,
                    mutationBonus: base.mutationBonus ?? 0,
                    durationMs: base.durationMs,
                    startedAt: t,
                    expiresAt: t + base.durationMs,
                });
            }
        }

        const buffData = {
            elixirId,
            recipe: { id: recipe.id, name: recipe.name, description: recipe.description },
            buff: {
                type: base.type,
                label: base.label,
                growthBoost: base.growthBoost ?? 0,
                mutationBonus: base.mutationBonus ?? 0,
                durationMs: base.durationMs,
                expiresAt: base.durationMs > 0 ? t + base.durationMs : null,
            },
            active: this.getActiveBuffs(t),
        };
        // The spec's public channel: active buffs ride ELIXIR_CONSUMED.
        this._publish(EVENTS.ELIXIR_CONSUMED, buffData);
        return { success: true, ...buffData };
    }

    /* -------------------------------- queries ------------------------------- */

    /** Live buff list (expired ones filtered, remainingMs included). */
    getActiveBuffs(now = null) {
        const t = now ?? this._now();
        return this.activeBuffs
            .filter((b) => b.durationMs <= 0 || t < b.expiresAt)
            .map((b) => ({ ...b, remainingMs: b.durationMs > 0 ? Math.max(0, b.expiresAt - t) : 0 }));
    }

    /**
     * Aggregated modifiers for GardenScene (the same shape the codex/weather
     * buffs use): `growthMult < 1` means faster bloom cascades,
     * `mutationBonus` is added to the breeding base chance. The instant
     * Vạn Thọ watering is a one-shot — it rides ELIXIR_CONSUMED, not the
     * timed-buff aggregate.
     */
    getBuffs(now = null) {
        const t = now ?? this._now();
        const buffs = { growthMult: 1, mutationBonus: 0, active: [] };
        for (const b of this.activeBuffs) {
            if (b.durationMs > 0 && t >= b.expiresAt) continue;
            buffs.active.push({ ...b, remainingMs: b.durationMs > 0 ? Math.max(0, b.expiresAt - t) : 0 });
            if (b.growthBoost) buffs.growthMult = Math.min(buffs.growthMult, 1 / (1 + b.growthBoost));
            buffs.mutationBonus = Math.max(buffs.mutationBonus, b.mutationBonus ?? 0);
        }
        return buffs;
    }

    /** Herb + elixir counts for the UI (a fresh copy — safe to render). */
    getInventory() {
        return { herbs: { ...this.herbs }, elixirs: { ...this.elixirs } };
    }

    getHerb(id) {
        return this.herbs[id] ?? 0;
    }

    /* --------------------------- test/dev helpers -------------------------- */

    /** Grant herbs (tests, dev tools, future rewards). */
    grant(ingredients = {}) {
        for (const [id, n] of Object.entries(ingredients)) {
            if (this.herbs[id] !== undefined) this.herbs[id] = Math.max(0, this.herbs[id] + n);
        }
        return this;
    }

    /** Place an elixir directly on the shelf (tests, future rewards). */
    grantElixir(id, n = 1) {
        if (this.elixirs[id] !== undefined) this.elixirs[id] = Math.max(0, this.elixirs[id] + n);
        return this;
    }

    /* ----------------------------- persistence ----------------------------- */

    serialize() {
        const t = this._now();
        return {
            herbs: { ...this.herbs },
            elixirs: { ...this.elixirs },
            dewProgress: this.dewProgress,
            activeBuffs: this.activeBuffs.map((b) => ({ ...b, remainingMs: Math.max(0, b.expiresAt - t) })),
            crafting: this.crafting
                ? { recipeId: this.crafting.recipeId, remainingMs: Math.max(0, this.crafting.endsAt - t), roll: this.crafting.roll, successRate: this.crafting.successRate }
                : null,
            stats: { ...this.stats },
        };
    }

    deserialize(data) {
        if (!data) return this;
        this.init();
        this.herbs = { ...this.herbs, ...(data.herbs ?? {}) };
        this.elixirs = { ...this.elixirs, ...(data.elixirs ?? {}) };
        this.dewProgress = Math.max(0, data.dewProgress ?? 0);
        this.stats = { ...this.stats, ...(data.stats ?? {}) };
        const t = this._now();
        this.activeBuffs = (data.activeBuffs ?? [])
            .filter((b) => b.durationMs <= 0 || (b.remainingMs ?? 0) > 0)
            .map((b) => ({
                elixirId: b.elixirId,
                type: b.type,
                label: b.label,
                growthBoost: b.growthBoost ?? 0,
                mutationBonus: b.mutationBonus ?? 0,
                durationMs: b.durationMs,
                startedAt: t - (b.durationMs - (b.remainingMs ?? 0)),
                expiresAt: b.durationMs > 0 ? t + (b.remainingMs ?? 0) : null,
            }));
        if (data.crafting) {
            const recipe = this.getRecipe(data.crafting.recipeId);
            if (recipe && (data.crafting.remainingMs ?? 0) > 0) {
                this.crafting = {
                    recipeId: recipe.id,
                    name: recipe.name,
                    startedAt: t - (recipe.durationMs - data.crafting.remainingMs),
                    endsAt: t + data.crafting.remainingMs,
                    roll: data.crafting.roll ?? this.random(),
                    successRate: data.crafting.successRate ?? recipe.successRate,
                };
            }
        }
        return this;
    }

    destroy() {
        this.unbind();
    }
}

export default AlchemyManager;
