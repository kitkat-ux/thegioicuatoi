import assert from 'node:assert/strict';
import test from 'node:test';
import {
    BeastSystem, BEAST_CATALOG, BEAST_DEFAULTS, StateStore, createBeastRuntimeState,
} from '../src/systems/BeastSystem.js';
import { EventManager, EVENTS } from '../src/systems/EventManager.js';

const T0 = 1_700_000_000_000;

const makeClock = (start = T0) => {
    let now = start;
    return {
        get: () => now,
        set: (v) => { now = v; },
        advance: (ms) => { now += ms; },
    };
};

const memoryStorage = () => {
    const map = new Map();
    return {
        getItem: (k) => (map.has(k) ? map.get(k) : null),
        setItem: (k, v) => { map.set(k, String(v)); },
        removeItem: (k) => { map.delete(k); },
    };
};

test('sanctuary catalog lists all four beasts with their buffs', () => {
    assert.equal(BEAST_CATALOG.length, 4);
    const byId = Object.fromEntries(BEAST_CATALOG.map((b) => [b.id, b]));
    assert.equal(byId.fox_01.name, 'Cửu Vĩ Bạch Hồ');
    assert.equal(byId.rabbit_01.name, 'Ngọc Thỏ');
    assert.equal(byId.qingluan_01.name, 'Thanh Loan');
    assert.equal(byId.xuanwu_01.name, 'Huyền Quy');
    assert.equal(byId.qingluan_01.buffs[0].label, '+15% tốc độ cây lớn');
    assert.equal(byId.xuanwu_01.buffs[0].label, '+20% tỷ lệ đan dược cao cấp');
    assert.equal(byId.qingluan_01.assetKey, 'beast_qingluan');
    assert.equal(byId.xuanwu_01.assetKey, 'beast_xuanwu');
    const runtime = createBeastRuntimeState(T0);
    assert.equal(runtime.length, 4);
    assert.equal(runtime[0].lastFed, T0 - 3600_000);
});

test('Cho Ăn consumes 1 Linh Ngư and adds +20 Thân Mật', () => {
    const clock = makeClock();
    const bus = new EventManager();
    const fed = [];
    bus.on(EVENTS.BEAST_FED, (p) => fed.push(p));
    const sys = new BeastSystem({ bus, now: clock.get, storage: memoryStorage(), persist: true });

    const dry = sys.feed('fox_01');
    assert.equal(dry.success, false);
    assert.equal(dry.reason, 'NO_FISH');

    sys.grantLinhNgu(2);
    const fox = sys.getBeast('fox_01');
    const before = fox.affinity;
    const ok = sys.feed('fox_01');
    assert.equal(ok.success, true);
    assert.equal(sys.getLinhNgu(), 1);
    assert.equal(fox.affinity, Math.min(fox.affinityMax, before + BEAST_DEFAULTS.feedAffinity));
    assert.equal(ok.gained, fox.affinity - before);
    assert.equal(fed.length, 1);
    assert.equal(fed[0].beastId, 'fox_01');

    const again = sys.feed('fox_01');
    assert.equal(again.success, false);
    assert.equal(again.reason, 'COOLDOWN');
});

test('FISH_CAUGHT on the bus stocks Linh Ngư for the feeding loop', () => {
    const bus = new EventManager();
    const sys = new BeastSystem({ bus, storage: memoryStorage() }).bind(bus);
    bus.emit(EVENTS.FISH_CAUGHT, { itemId: 'linh_ngu', name: 'Linh Ngư', amount: 1 });
    bus.emit(EVENTS.FISH_CAUGHT, { itemId: 'linh_ngu', amount: 2 });
    assert.equal(sys.getLinhNgu(), 3);
    assert.equal(sys.stats.totalCaught, 3);

    const fox = sys.getBeast('fox_01');
    const before = fox.affinity;
    const fed = sys.feed('fox_01');
    assert.equal(fed.success, true);
    assert.equal(sys.getLinhNgu(), 2);
    assert.equal(fox.affinity, before + 20);
});

test('state round-trips through StateStore / LocalStorage', () => {
    const storage = memoryStorage();
    const clock = makeClock();
    const a = new BeastSystem({ now: clock.get, storage });
    a.grantLinhNgu(4);
    a.feed('qingluan_01');
    a.save();

    const b = new BeastSystem({ now: clock.get, storage });
    b.load();
    assert.equal(b.getLinhNgu(), 3);
    assert.equal(b.getBeast('qingluan_01').affinity, a.getBeast('qingluan_01').affinity);
    assert.equal(b.getBeast('fox_01').affinity, a.getBeast('fox_01').affinity);

    const snap = JSON.parse(JSON.stringify(a.serialize()));
    const c = new BeastSystem({ now: clock.get, storage: memoryStorage() }).deserialize(snap);
    assert.equal(c.getLinhNgu(), 3);
    assert.equal(c.getBeast('xuanwu_01').name, 'Huyền Quy');
});

test('Thanh Loan and Huyền Quy buffs surface on getBuffs()', () => {
    const sys = new BeastSystem({ storage: memoryStorage(), persist: false });
    const buffs = sys.getBuffs();
    assert.ok(buffs.active.some((b) => b.type === 'growth_speed' && b.value === 0.15));
    assert.ok(buffs.active.some((b) => b.type === 'alchemy_tier' && b.value === 0.20));
    assert.ok(Math.abs(buffs.growthMult - 1 / 1.15) < 1e-12);
    assert.equal(buffs.alchemyTierBonus, 0.20);
});

test('StateStore read/write/clear', () => {
    const storage = memoryStorage();
    const store = new StateStore('test:beasts', storage);
    assert.equal(store.read(), null);
    store.write({ linhNgu: 5 });
    assert.equal(store.read().linhNgu, 5);
    store.clear();
    assert.equal(store.read(), null);
});
