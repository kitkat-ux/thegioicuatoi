/**
 * Linh Hoa Dị Biến — cross-breeding and inheritance rules.
 *
 * This module deliberately has no Phaser or scene dependency. A scene can feed
 * it the two neighbouring tile records it already owns, while UI and other
 * systems observe the result through EventManager.
 */
import { EVENTS } from './EventManager.js';

export const BREEDING_DEFAULTS = Object.freeze({
    baseMutationChance: 0.15,
    /** Spiritual soil adds ten percentage points, capped at certainty. */
    spiritualSoilBonus: 0.10,
});

// IDs are intentionally data, rather than scene-specific objects. Aliases make
// the table usable by both the current catalogue and the lore names in the GDD.
export const BREEDING_RECIPES = Object.freeze([
    {
        parents: ['u_dam', 'huyet_ke'],
        parentNames: ['U Đàm', 'Huyết Kế'],
        result: { seedId: 'tu_diep_linh_lan', name: 'Tử Diệp Linh Lan', tier: 2, rarity: 'rare' },
    },
    {
        parents: ['flower_cyan_orchid', 'flower_purple_wisteria'],
        parentNames: ['Tinh Trạch U Đàm', 'Hồng Hà Tiên Chi'],
        result: { seedId: 'tu_diep_linh_lan', name: 'Tử Diệp Linh Lan', tier: 2, rarity: 'rare' },
    },
    {
        parents: ['flower_emerald_bamboo', 'flower_golden_amber'],
        parentNames: ['Trúc Bích Thanh Hoa', 'Đới Ngọc Kim Huyên'],
        result: { seedId: 'kim_bich_tien_diep', name: 'Kim Bích Tiên Điệp', tier: 2, rarity: 'rare' },
    },
]);

const canonical = (value) => String(value ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/[ _-]+/g, '');
const idOf = (flower) => canonical(flower?.seedId ?? flower?.id ?? flower?.type ?? flower?.name);
const positionOf = (flower) => ({
    x: flower?.gridX ?? flower?.x ?? flower?.col ?? flower?.column,
    y: flower?.gridY ?? flower?.y ?? flower?.row,
});
const mature = (flower) => flower?.isMature === true || flower?.mature === true || flower?.matured === true ||
    flower?.growthState === 'mature' || flower?.state === 'mature' || flower?.stage === 'mature';
const adjacent = (a, b) => {
    const pa = positionOf(a); const pb = positionOf(b);
    return Number.isFinite(pa.x) && Number.isFinite(pa.y) && Number.isFinite(pb.x) && Number.isFinite(pb.y) &&
        Math.abs(pa.x - pb.x) + Math.abs(pa.y - pb.y) === 1;
};
const pairMatches = (recipe, a, b) => {
    const ids = [idOf(a), idOf(b)];
    const parentIds = recipe.parents.map(canonical);
    return parentIds.every((id) => ids.includes(id)) && ids[0] !== ids[1];
};

export class BreedingManager {
    constructor({ bus = null, random = Math.random, baseMutationChance = BREEDING_DEFAULTS.baseMutationChance,
        spiritualSoilBonus = BREEDING_DEFAULTS.spiritualSoilBonus, recipes = BREEDING_RECIPES,
        mutationBonusProvider = null } = {}) {
        this.bus = bus;
        this.random = random;
        this.baseMutationChance = baseMutationChance;
        this.spiritualSoilBonus = spiritualSoilBonus;
        this.recipes = recipes;
        this.discoveredSeeds = new Set();
        // Optional live bonus (System 5 — Tẩy Tủy Đan): a zero-arg function the
        // wiring point feeds with alchemy.getBuffs().mutationBonus. Keeping it a
        // provider means this module never imports the AlchemyManager.
        this.mutationBonusProvider = typeof mutationBonusProvider === 'function' ? mutationBonusProvider : null;
    }

    calculateMutationChance({ spiritualSoil = false, soil = null } = {}) {
        const enriched = spiritualSoil === true || soil === 'spiritual' || soil?.spiritual === true || soil?.isSpiritual === true;
        const alchemyBonus = this.mutationBonusProvider ? Math.max(0, this.mutationBonusProvider() || 0) : 0;
        return Math.min(1, Math.max(0, this.baseMutationChance + alchemyBonus + (enriched ? this.spiritualSoilBonus : 0)));
    }

    findRecipe(parentA, parentB) {
        return this.recipes.find((recipe) => pairMatches(recipe, parentA, parentB)) ?? null;
    }

    /** Attempt a pollination. `random` is injectable, making this deterministic in tests. */
    crossPollinate(parentA, parentB, { spiritualSoil = false, soil = null, force = false } = {}) {
        const parents = [parentA, parentB];
        const chance = this.calculateMutationChance({ spiritualSoil, soil });
        const fail = (reason, extra = {}) => ({ success: false, reason, chance, parents, ...extra });
        if (!parentA || !parentB || parentA === parentB) return fail('TWO_PARENTS_REQUIRED');
        if (!mature(parentA) || !mature(parentB)) return fail('PARENTS_NOT_MATURE');
        if (!adjacent(parentA, parentB)) return fail('PARENTS_NOT_ADJACENT');
        const recipe = this.findRecipe(parentA, parentB);
        if (!recipe) return fail('NO_INHERITANCE_RECIPE');
        const roll = force ? 0 : this.random();
        if (!force && roll >= chance) return fail('MUTATION_DID_NOT_OCCUR', { roll, recipe });

        const result = { ...recipe.result };
        this.discoveredSeeds.add(result.seedId);
        const data = {
            success: true, parents, parentIds: parents.map(idOf), result, seed: result,
            seedId: result.seedId, chance, roll, recipe,
        };
        // BREEDING_SUCCESS is a stable public event name; no scene import needed.
        this.bus?.emit(EVENTS.BREEDING_SUCCESS, data);
        return data;
    }

    /** Friendly aliases for callers that describe the action as breeding. */
    breed(parentA, parentB, options = {}) { return this.crossPollinate(parentA, parentB, options); }
    attemptBreeding(parentA, parentB, options = {}) { return this.crossPollinate(parentA, parentB, options); }

    /** Return only mature inventory entries, optionally filtered by text. */
    getMatureFlowers(inventory = [], query = '') {
        const needle = canonical(query);
        return inventory.filter((flower) => {
            if (!mature(flower)) return false;
            if (!needle) return true;
            return [flower.name, flower.seedId, flower.id, flower.english].filter(Boolean)
                .map(canonical).join('').includes(needle);
        });
    }

    serialize() { return { discoveredSeeds: [...this.discoveredSeeds] }; }
    deserialize(state = {}) { this.discoveredSeeds = new Set(state.discoveredSeeds ?? []); return this; }
}

export { adjacent as areAdjacent, mature as isMatureFlower };
export default BreedingManager;
