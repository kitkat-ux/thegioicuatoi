import assert from 'node:assert/strict';
import test from 'node:test';
import {
    AlchemyManager, ALCHEMY_RECIPES, ALCHEMY_DEFAULTS, HERBS, HERB_BY_SEED, ELIXIRS,
} from '../src/systems/AlchemyManager.js';
import { BreedingManager } from '../src/systems/BreedingManager.js';
import { EventManager, EVENTS } from '../src/systems/EventManager.js';

const MINUTE = 60_000;
const T0 = 1_700_000_000_000;

/** Deterministic clock the tests advance by hand. */
const makeClock = (start = T0) => {
    let now = start;
    return {
        get: () => now,
        set: (v) => { now = v; },
        advance: (ms) => { now += ms; },
    };
};

test('recipe table matches the Phase-2 spec', () => {
    const byId = Object.fromEntries(ALCHEMY_RECIPES.map((r) => [r.id, r]));
    assert.equal(ALCHEMY_RECIPES.length, 3);

    // Tụ Khí Đan: 3× U Đàm + 1 Linh Dịch → +20% bloom speed for 10 minutes
    assert.deepEqual(byId.tu_khi_dan.ingredients, { u_dam: 3, linh_dich: 1 });
    assert.equal(byId.tu_khi_dan.buff.growthBoost, 0.2);
    assert.equal(byId.tu_khi_dan.buff.durationMs, 10 * MINUTE);

    // Tẩy Tủy Đan: 2× Huyết Kế + 2× U Đàm → +15% breeding mutation chance
    assert.deepEqual(byId.tay_tui_dan.ingredients, { huyet_ke: 2, u_dam: 2 });
    assert.equal(byId.tay_tui_dan.buff.mutationBonus, 0.15);

    // Vạn Thọ Linh Dịch: instant whole-garden watering
    assert.equal(byId.van_tho_linh_dich.buff.type, 'auto_water');
    assert.equal(byId.van_tho_linh_dich.buff.durationMs, 0);

    for (const r of ALCHEMY_RECIPES) {
        assert.equal(r.successRate > 0 && r.successRate <= 1, true, `${r.id} successRate in (0,1]`);
        assert.equal(r.durationMs > 0, true, `${r.id} has a crafting timer`);
        assert.equal(ELIXIRS.some((e) => e.id === r.elixirId), true, `${r.id} maps to a shelf entry`);
    }
});

test('harvest → herb mapping and Linh Dịch dew sources', () => {
    const clock = makeClock();
    const manager = new AlchemyManager({ now: clock.get });
    assert.equal(manager.getHerb('u_dam'), ALCHEMY_DEFAULTS.starterHerbs.u_dam);
    assert.equal(manager.getHerb('linh_dich'), ALCHEMY_DEFAULTS.starterHerbs.linh_dich);

    // a plain harvest drops the mapped petal-herb
    const drop = manager.recordHarvest({ seedId: 'flower_cyan_orchid' });
    assert.deepEqual(drop.herb, { id: 'u_dam', amount: 1 });
    assert.equal(manager.getHerb('u_dam'), ALCHEMY_DEFAULTS.starterHerbs.u_dam + 1);

    // a rain-watered harvest carries extra Linh Dịch
    const dew = manager.recordHarvest({ seedId: 'flower_purple_wisteria', rainWatered: true });
    assert.equal(dew.dew, 1);
    assert.equal(drop.herb.id, HERB_BY_SEED.flower_cyan_orchid);
    assert.equal(HERB_BY_SEED.flower_purple_wisteria, 'huyet_ke');

    // every N watered tiles condense one more Linh Dịch
    const base = manager.getHerb('linh_dich');
    assert.equal(manager.recordWateredTile(), null);
    assert.equal(manager.recordWateredTile(), null);
    assert.equal(manager.recordWateredTile(), null);
    const drop4 = manager.recordWateredTile();
    assert.deepEqual(drop4, { id: 'linh_dich', amount: 1 });
    assert.equal(manager.getHerb('linh_dich'), base + 1);
});

test('recipe verification: canCraft and craft() guards', () => {
    const clock = makeClock();
    const manager = new AlchemyManager({ now: clock.get, random: () => 0 });

    assert.equal(manager.canCraft('nope'), false, 'unknown recipe is not craftable');
    assert.equal(manager.canCraft('tay_tui_dan'), false, 'starter kit lacks Huyết Kế');
    manager.grant({ huyet_ke: 2, u_dam: 1 });
    assert.equal(manager.canCraft('tay_tui_dan'), true);

    const started = manager.craft('tay_tui_dan', { now: T0 });
    // starter 2 u_dam + granted 1 = 3, recipe takes 2 u_dam + 2 huyet_ke
    assert.equal(started.success, true);
    assert.equal(manager.getHerb('huyet_ke'), 0);
    assert.equal(manager.getHerb('u_dam'), ALCHEMY_DEFAULTS.starterHerbs.u_dam + 1 - 2);

    const busy = manager.craft('tu_khi_dan', { now: T0 });
    assert.equal(busy.success, false);
    assert.equal(busy.reason, 'FURNACE_BUSY');

    // furnace resolves, then an under-stocked craft is rejected
    manager.tick(16, T0 + 60_001);
    assert.equal(manager.getCrafting(), null);
    const poor = manager.craft('tay_tui_dan', { now: T0 + 60_001 });
    assert.equal(poor.success, false);
    assert.equal(poor.reason, 'MISSING_INGREDIENTS');
});

test('crafting timer: success lands the elixir and emits ALCHEMY_CRAFT_SUCCESS', () => {
    const clock = makeClock();
    const bus = new EventManager();
    const seen = [];
    bus.on(EVENTS.ALCHEMY_CRAFT_STARTED, (p) => seen.push(['started', p.recipe.id]), { owner: 't' });
    bus.on(EVENTS.ALCHEMY_CRAFT_SUCCESS, (p) => seen.push(['success', p.elixirId]), { owner: 't' });

    const manager = new AlchemyManager({ bus, now: clock.get, random: () => 0.1 }); // roll 0.1 < 0.85
    manager.grant({ u_dam: 1 }); // starter kit holds 2 U Đàm — one more completes the recipe
    const start = manager.craft('tu_khi_dan', { now: T0 });
    assert.equal(start.success, true);
    assert.equal(manager.getHerb('u_dam'), 0, '3 U Đàm deducted (starter 2 + granted 1)');
    assert.equal(manager.getHerb('linh_dich'), 0, '1 Linh Dịch deducted');

    // before the 45s timer elapses: still cooking, progress counting down
    clock.set(T0 + 10_000);
    manager.tick(16);
    const mid = manager.getCraftProgress();
    assert.ok(manager.getCrafting(), 'furnace still mid-run at t+10s');
    assert.equal(mid.remainingMs, 35_000);
    assert.equal(seen.length, 1);
    assert.equal(seen[0][0], 'started');

    // at the deadline the dice resolve (roll stored at craft time)
    clock.set(T0 + 45_000);
    const changes = manager.tick(16);
    assert.equal(changes.craftResolved?.success, true);
    assert.equal(manager.getElixir('tu_khi_dan'), 1);
    assert.deepEqual(seen[1], ['success', 'tu_khi_dan']);
    assert.equal(manager.getCraftProgress(), null);
});

test('a failed transmutation consumes the ingredients and emits ALCHEMY_CRAFT_FAILED', () => {
    const clock = makeClock();
    const bus = new EventManager();
    let failed = null;
    bus.on(EVENTS.ALCHEMY_CRAFT_FAILED, (p) => { failed = p; }, { owner: 't' });

    const manager = new AlchemyManager({ bus, now: clock.get, random: () => 0.99 }); // roll ≥ 0.85
    manager.grant({ u_dam: 1 });
    manager.craft('tu_khi_dan', { now: T0 });
    clock.set(T0 + 45_001);
    const changes = manager.tick(16);
    assert.equal(changes.craftResolved?.success, false);
    assert.equal(manager.getElixir('tu_khi_dan'), 0);
    assert.equal(manager.stats.totalFailed, 1);
    assert.equal(failed?.recipeId, 'tu_khi_dan');
});

test('consume publishes ELIXIR_CONSUMED with the active buffData', () => {
    const clock = makeClock();
    const bus = new EventManager();
    let consumed = null;
    bus.on(EVENTS.ELIXIR_CONSUMED, (p) => { consumed = p; }, { owner: 't' });

    const manager = new AlchemyManager({ bus, now: clock.get });
    const none = manager.consume('tu_khi_dan', { now: T0 });
    assert.equal(none.success, false);
    assert.equal(none.reason, 'NO_ELIXIR');

    manager.grantElixir('tu_khi_dan', 1);
    clock.set(T0 + 1000);
    const result = manager.consume('tu_khi_dan', { now: T0 + 1000 });
    assert.equal(result.success, true);
    assert.equal(manager.getElixir('tu_khi_dan'), 0);

    assert.equal(consumed.elixirId, 'tu_khi_dan');
    assert.equal(consumed.buff.type, 'growth_speed');
    assert.equal(consumed.buff.growthBoost, 0.2);
    assert.equal(consumed.buff.durationMs, 10 * MINUTE);
    assert.equal(consumed.buff.expiresAt, T0 + 1000 + 10 * MINUTE);
    assert.equal(consumed.active.length, 1);
    assert.equal(consumed.active[0].remainingMs, 10 * MINUTE);

    const buffs = manager.getBuffs(T0 + 1000);
    assert.ok(Math.abs(buffs.growthMult - 1 / 1.2) < 1e-12, '+20% speed ⇔ delay × 1/1.2');
});

test('buff timers expire after 10 minutes and re-consume refreshes (no stacking)', () => {
    const clock = makeClock();
    const bus = new EventManager();
    const expired = [];
    bus.on(EVENTS.ALCHEMY_BUFF_EXPIRED, (p) => expired.push(p.label), { owner: 't' });

    const manager = new AlchemyManager({ bus, now: clock.get });
    manager.grantElixir('tu_khi_dan', 2);

    clock.set(T0);
    manager.consume('tu_khi_dan', { now: T0 });
    const b1 = manager.getBuffs(T0);
    assert.equal(b1.active.length, 1);

    // nine minutes in: still active
    manager.tick(16, T0 + 9 * MINUTE);
    assert.equal(manager.getBuffs(T0 + 9 * MINUTE).active.length, 1);

    // just past ten: expired + published
    manager.tick(16, T0 + 10 * MINUTE + 1);
    assert.equal(manager.getBuffs(T0 + 10 * MINUTE + 1).active.length, 0);
    assert.equal(manager.getBuffs().growthMult, 1);
    assert.deepEqual(expired, ['Tụ Khí']);

    // a second dose refreshes the clock instead of stacking
    manager.grantElixir('tu_khi_dan', 1);
    clock.set(T0 + 20 * MINUTE);
    manager.consume('tu_khi_dan', { now: T0 + 20 * MINUTE });
    const b2 = manager.getBuffs(T0 + 20 * MINUTE);
    assert.equal(b2.active.length, 1);
    assert.ok(Math.abs(b2.growthMult - 1 / 1.2) < 1e-12);
    assert.equal(manager.getActiveBuffs(T0 + 20 * MINUTE)[0].remainingMs, 10 * MINUTE);
});

test('Tẩy Tủy Đan feeds the breeding mutation chance through a provider', () => {
    const clock = makeClock();
    const manager = new AlchemyManager({ now: clock.get });
    manager.grantElixir('tay_tui_dan', 1);

    // wiring point: the provider reads the alchemy buffs — no import needed
    const breeding = new BreedingManager({
        mutationBonusProvider: () => manager.getBuffs(clock.get()).mutationBonus,
    });
    assert.equal(breeding.calculateMutationChance(), 0.15, 'base chance without the elixir');

    clock.set(T0);
    manager.consume('tay_tui_dan', { now: T0 });
    assert.equal(manager.getBuffs(T0).mutationBonus, 0.15);
    assert.equal(breeding.calculateMutationChance(), 0.3, 'base + 15% Tẩy Tủy');

    // still additive with spiritual soil, still capped at 1
    assert.equal(breeding.calculateMutationChance({ spiritualSoil: true }), 0.4);

    // expiry returns breeding to the base chance
    manager.tick(16, T0 + 10 * MINUTE + 1);
    assert.equal(breeding.calculateMutationChance(), 0.15);
});

test('Vạn Thọ Linh Dịch is an instant auto-water buff', () => {
    const clock = makeClock();
    const bus = new EventManager();
    let consumed = null;
    bus.on(EVENTS.ELIXIR_CONSUMED, (p) => { consumed = p; }, { owner: 't' });

    const manager = new AlchemyManager({ bus, now: clock.get });
    manager.grantElixir('van_tho_linh_dich', 1);
    clock.set(T0);
    const result = manager.consume('van_tho_linh_dich', { now: T0 });
    assert.equal(result.success, true);
    assert.equal(consumed.buff.type, 'auto_water');
    assert.equal(consumed.buff.expiresAt, null, 'one-shot: nothing lingers on the clock');
    assert.equal(manager.getActiveBuffs(T0).length, 0, 'no timed buff is registered');
    assert.deepEqual(manager.getBuffs(T0).active, []);

    // long after, the one-shot still has no lasting timed footprint
    assert.equal(manager.getBuffs(T0 + 2 * MINUTE).active.length, 0);
});

test('bound to the bus: gameplay facts flow in without scene imports', () => {
    const clock = makeClock();
    const bus = new EventManager();
    const manager = new AlchemyManager({ now: clock.get }).bind(bus);

    bus.emit(EVENTS.FLOWER_HARVESTED, { seedId: 'flower_cyan_orchid' });
    bus.emit(EVENTS.FLOWER_HARVESTED, { seedId: 'flower_golden_amber', rainWatered: true });
    bus.emit(EVENTS.TILE_WATERED, { row: 0, col: 0, source: 'watering-can' });
    bus.emit(EVENTS.TILE_WATERED, { row: 0, col: 1, source: 'watering-can' });
    bus.emit(EVENTS.TILE_WATERED, { row: 0, col: 2, source: 'watering-can' });
    bus.emit(EVENTS.TILE_WATERED, { row: 0, col: 3, source: 'watering-can' });

    assert.equal(manager.getHerb('u_dam'), ALCHEMY_DEFAULTS.starterHerbs.u_dam + 1);
    assert.equal(manager.getHerb('kim_huyen'), 1);
    // starter 1 + 1 rain dew + 1 from 4 watered tiles
    assert.equal(manager.getHerb('linh_dich'), ALCHEMY_DEFAULTS.starterHerbs.linh_dich + 2);
    assert.ok(bus.wasEmitted(EVENTS.ALCHEMY_INGREDIENT_GAINED));
});

test('state survives a serialize/deserialize round trip', () => {
    const clock = makeClock();
    const manager = new AlchemyManager({ now: clock.get, random: () => 0.42 });
    manager.grant({ u_dam: 1 });
    manager.grantElixir('tu_khi_dan', 1);
    manager.craft('tu_khi_dan', { now: T0 });        // furnace mid-run
    manager.grantElixir('van_tho_linh_dich', 2);
    clock.set(T0 + 5_000);
    manager.consume('tu_khi_dan', { now: T0 + 5_000 }); // timed buff live for 10 min

    const snapshot = JSON.parse(JSON.stringify(manager.serialize()));
    const restored = new AlchemyManager({ now: clock.get }).deserialize(snapshot);

    assert.equal(restored.getHerb('u_dam'), manager.getHerb('u_dam'));
    assert.equal(restored.getElixir('van_tho_linh_dich'), 2);
    assert.equal(restored.getElixir('tu_khi_dan'), 0, 'the single dose was consumed');

    // the buff clock restored relative to "now"
    const before = manager.getActiveBuffs(clock.get());
    const after = restored.getActiveBuffs(clock.get());
    assert.equal(after.length, before.length);
    assert.ok(Math.abs(after[0].remainingMs - before[0].remainingMs) <= 1);

    // the half-finished furnace run kept its remaining time
    const mine = manager.getCraftProgress(clock.get());
    const theirs = restored.getCraftProgress(clock.get());
    assert.ok(theirs && Math.abs(theirs.remainingMs - mine.remainingMs) <= 1);
    assert.equal(theirs.recipeId, 'tu_khi_dan');

    // and it still resolves on the restored instance
    clock.advance(45_000);
    const changes = restored.tick(16);
    assert.equal(changes.craftResolved?.success, true); // roll 0.42 < 0.85
    assert.equal(restored.getElixir('tu_khi_dan'), 1); // consumed 1, craft returned 1
});

test('getCraftProgress counts down to zero and the furnace is reusable', () => {
    const clock = makeClock();
    const manager = new AlchemyManager({ now: clock.get, random: () => 0 });
    manager.grant({ linh_dich: 1, truc_bich: 1 }); // starter kit holds 1 Linh Dịch
    assert.equal(manager.canCraft('van_tho_linh_dich'), true);
    manager.craft('van_tho_linh_dich', { now: T0 });

    assert.equal(manager.getCraftProgress(T0).remainingMs, 30_000);
    assert.equal(manager.getCraftProgress(T0 + 29_999).remainingMs, 1);
    assert.equal(manager.getCraftProgress(T0 + 30_000).remainingMs, 0);

    clock.set(T0 + 30_000);
    manager.tick(16);
    assert.equal(manager.getCrafting(), null);
    assert.equal(manager.getElixir('van_tho_linh_dich'), 1);

    // furnace free again
    manager.grant({ linh_dich: 2, truc_bich: 1 });
    assert.equal(manager.canCraft('van_tho_linh_dich'), true);
});
