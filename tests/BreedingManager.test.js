import assert from 'node:assert/strict';
import test from 'node:test';
import { BreedingManager } from '../src/systems/BreedingManager.js';
import { EventManager, EVENTS } from '../src/systems/EventManager.js';

const flower = (id, x, y, extra = {}) => ({ seedId: id, gridX: x, gridY: y, isMature: true, ...extra });

test('uses the 15 percent base mutation chance', () => {
    const manager = new BreedingManager({ random: () => .14 });
    assert.equal(manager.calculateMutationChance(), .15);
    assert.equal(manager.crossPollinate(flower('u_dam', 1, 1), flower('huyet_ke', 2, 1)).success, true);
});

test('spiritual soil boosts chance by ten percentage points', () => {
    const manager = new BreedingManager({ random: () => 0 });
    assert.equal(manager.calculateMutationChance({ spiritualSoil: true }), .25);
    assert.equal(manager.crossPollinate(flower('u_dam', 0, 0), flower('huyet_ke', 1, 0), { spiritualSoil: true }).success, true);
});

test('requires mature adjacent parents and rejects unknown recipes', () => {
    const manager = new BreedingManager({ random: () => 0 });
    assert.equal(manager.crossPollinate(flower('u_dam', 0, 0, { isMature: false }), flower('huyet_ke', 1, 0)).reason, 'PARENTS_NOT_MATURE');
    assert.equal(manager.crossPollinate(flower('u_dam', 0, 0), flower('huyet_ke', 2, 0)).reason, 'PARENTS_NOT_ADJACENT');
    assert.equal(manager.crossPollinate(flower('u_dam', 0, 0), flower('unknown', 1, 0)).reason, 'NO_INHERITANCE_RECIPE');
});

test('emits a discovery event and records the new seed', () => {
    const bus = new EventManager(); let received;
    bus.on(EVENTS.BREEDING_SUCCESS, (data) => { received = data; });
    const manager = new BreedingManager({ bus, random: () => 0 });
    const result = manager.crossPollinate(flower('U Đàm', 2, 2), flower('Huyết Kế', 3, 2));
    assert.equal(result.seedId, 'tu_diep_linh_lan');
    assert.equal(received.seedId, result.seedId);
    assert.deepEqual(manager.serialize().discoveredSeeds, ['tu_diep_linh_lan']);
});

test('filters inventory to mature flowers', () => {
    const manager = new BreedingManager();
    const result = manager.getMatureFlowers([
        { id: 'a', name: 'U Đàm', isMature: true },
        { id: 'b', name: 'Huyết Kế', growthState: 'seedling' },
    ], 'dam');
    assert.deepEqual(result.map((f) => f.id), ['a']);
});
