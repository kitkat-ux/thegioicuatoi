/**
 * EconomySystem — Spirit Stones, inventory, seed purchasing, quests.
 *
 * Pure data/logic module (no Phaser dependency) so it is unit-testable.
 *
 * Spirit Stones (Đá Linh Khí) are the premium currency earned from harvesting
 * bloomed flowers. They can be spent to purchase rare seeds from the catalog.
 *
 * Inventory tracks owned seed counts (how many of each seed the player has).
 * Quests are simple milestone objectives that unlock when conditions are met.
 */

/* ---- Default economy tuning ---- */
export const ECONOMY_DEFAULTS = {
    /** Spirit Stones earned per harvest by seed rarity tier */
    harvestYield: {
        common: 1,    // cyan orchid, emerald bamboo
        uncommon: 2,  // purple wisteria
        rare: 3,      // golden amber
        legendary: 5, // nguyệt cúc thiên hà
    },
    /** Harmony earned per harvest */
    harmonyPerHarvest: 2,
    /** Seed purchase costs (in Spirit Stones) */
    seedCosts: {
        flower_cyan_orchid: 0,       // free / starter
        flower_emerald_bamboo: 0,    // free / starter
        flower_purple_wisteria: 5,
        flower_golden_amber: 10,
        flower_rare_nguyet_cuc: 25,
    },
    /**
     * Quick-watering (fast-forward growth) is a premium action: it costs
     * Đá Linh Khí. Small batches cost `quickWaterCost`, a big batch (more
     * than `quickWaterBigBatch` plots) costs `quickWaterCostBig`. Rain, the
     * Vạn Thọ elixir and the rewarded ad stay free — only the instant tap pays.
     */
    quickWaterCost: 1,
    quickWaterCostBig: 2,
    quickWaterBigBatch: 12,
};

/**
 * Rarity tiers for each seed id.
 */
export const SEED_RARITY = {
    flower_cyan_orchid: 'common',
    flower_emerald_bamboo: 'common',
    flower_purple_wisteria: 'uncommon',
    flower_golden_amber: 'rare',
    flower_rare_nguyet_cuc: 'legendary',
};

/**
 * Quest definitions — each quest has an id, description, condition function,
 * and a reward (Spirit Stones).
 */
export const QUESTS = [
    {
        id: 'first_bloom',
        name: 'Bông Hoa Đầu Tiên',
        description: 'Gieo hạt và tưới nước để nở bông hoa đầu tiên.',
        condition: (stats) => stats.totalBlooms >= 1,
        reward: 3,
    },
    {
        id: 'green_thumb',
        name: 'Bàn Tay Xanh',
        description: 'Nở 10 bông hoa bất kỳ.',
        condition: (stats) => stats.totalBlooms >= 10,
        reward: 8,
    },
    {
        id: 'full_garden',
        name: 'Hoa Viên Đại Thành',
        description: 'Nở cùng lúc 36 bông hoa trên toàn bộ hoa viên.',
        condition: (stats) => stats.maxSimultaneousBlooms >= 36,
        reward: 20,
    },
    {
        id: 'stone_collector',
        name: 'Người Thu Nhập Đá',
        description: 'Tích lũy 50 Đá Linh Khí.',
        condition: (stats) => stats.totalStonesEarned >= 50,
        reward: 10,
    },
    {
        id: 'rare_bloom',
        name: 'Nguyệt Cúc Thiên Hà',
        description: 'Trồng và nở hoa Nguyệt Cúc Thiên Hà quý hiếm.',
        condition: (stats) => stats.rareBlooms >= 1,
        reward: 15,
    },
    {
        id: 'harvest_master',
        name: 'Bậc Thầy Thu Hoạch',
        description: 'Thu hoạch 50 bông hoa.',
        condition: (stats) => stats.totalHarvests >= 50,
        reward: 12,
    },
];

/**
 * EconomySystem — manages Spirit Stones, inventory, and quest progress.
 *
 * @example
 *   const eco = new EconomySystem();
 *   eco.init();
 *   const reward = eco.harvestFlower('flower_cyan_orchid');
 *   // reward = { harmony: 2, spiritStones: 1 }
 */
export class EconomySystem {
    constructor(config = ECONOMY_DEFAULTS) {
        this.config = config;
        this.bus = null;          // optional EventManager — DIAMONDS_CHANGED etc.
        this.spiritStones = 0;
        this.harmony = 0;
        this.inventory = {};      // { seedId: count }
        this.completedQuests = new Set();
        this.stats = {
            totalBlooms: 0,
            totalHarvests: 0,
            totalStonesEarned: 0,
            maxSimultaneousBlooms: 0,
            currentBlooms: 0,
            rareBlooms: 0,
        };
    }

    /**
     * Attach an EventManager. Every Đá Linh Khí movement is then announced as
     * `economy:diamonds-changed` so the HUD (and anything else) can re-read
     * the balance without the scene poking at badges by hand.
     */
    bind(bus) {
        this.bus = bus ?? null;
        return this;
    }

    unbind() {
        this.bus = null;
        return this;
    }

    /** Publish a diamond balance change (no-op without a bus). */
    _emitDiamonds(delta, reason) {
        if (!this.bus || typeof this.bus.emit !== 'function') return;
        this.bus.emit('economy:diamonds-changed', {
            diamonds: this.spiritStones,
            spiritStones: this.spiritStones,
            harmony: this.harmony,
            delta,
            reason,
        });
    }

    /* ---- Đá Linh Khí (diamond) helpers ---- */

    /** Current diamond balance (alias for spiritStones). */
    getDiamonds() {
        return this.spiritStones;
    }

    canAfford(cost) {
        return this.spiritStones >= Math.max(0, cost | 0);
    }

    /** Credit diamonds (quest reward, rewarded ad…) and announce it. */
    addDiamonds(amount, reason = 'grant') {
        const n = Math.max(0, amount | 0);
        if (!n) return this.spiritStones;
        this.spiritStones += n;
        this.stats.totalStonesEarned += n;
        this._emitDiamonds(n, reason);
        return this.spiritStones;
    }

    /**
     * Debit diamonds. Refuses (and reports) when the balance is short so the
     * caller can show a notice instead of silently granting the action.
     * @returns {{ success: boolean, cost: number, have: number, message: string }}
     */
    spendDiamonds(cost, reason = 'spend') {
        const n = Math.max(0, cost | 0);
        if (!n) return { success: true, cost: 0, have: this.spiritStones, message: '' };
        if (this.spiritStones < n) {
            const result = {
                success: false,
                cost: n,
                have: this.spiritStones,
                message: `Không đủ Đá Linh Khí! Cần ${n} 💎, hiện có ${this.spiritStones} 💎.`,
            };
            this.bus?.emit?.('economy:diamonds-insufficient', { ...result, reason });
            return result;
        }
        this.spiritStones -= n;
        this._emitDiamonds(-n, reason);
        return { success: true, cost: n, have: this.spiritStones, message: `-${n} 💎 Đá Linh Khí` };
    }

    /**
     * Cost (in diamonds) of an instant quick-water for `plotCount` plots:
     * 1 💎 for a small batch, 2 💎 for a big one. Never free.
     */
    getQuickWaterCost(plotCount = 1) {
        const small = Math.max(1, this.config.quickWaterCost ?? 1);
        const big = Math.max(small, this.config.quickWaterCostBig ?? 2);
        const threshold = this.config.quickWaterBigBatch ?? 12;
        return plotCount > threshold ? big : small;
    }

    /**
     * Pay for a quick-water. Returns the spend result + the cost that applied.
     */
    payQuickWater(plotCount = 1) {
        const cost = this.getQuickWaterCost(plotCount);
        return { ...this.spendDiamonds(cost, 'quick-water'), cost };
    }

    /** Initialize with starting resources */
    init() {
        this.spiritStones = 10;
        this.harmony = 0;
        this.inventory = {
            flower_cyan_orchid: 5,
            flower_emerald_bamboo: 5,
        };
        this.completedQuests = new Set();
        this.stats = {
            totalBlooms: 0,
            totalHarvests: 0,
            totalStonesEarned: 0,
            maxSimultaneousBlooms: 0,
            currentBlooms: 0,
            rareBlooms: 0,
        };
    }

    /**
     * Harvest a bloomed flower — yields Harmony + Spirit Stones.
     *
     * `modifiers` lets other systems (System 8 weather, System 9 codex)
     * contribute to a harvest without knowing about each other. The scene
     * aggregates them and passes one object through:
     *   { harmonyBonus, stoneBonus, harmonyMult }
     *
     * @param {string} seedId
     * @param {{harmonyBonus?:number, stoneBonus?:number, harmonyMult?:number}} [modifiers]
     * @returns {{ harmony: number, spiritStones: number, harmonyBonus: number, stoneBonus: number }}
     */
    harvestFlower(seedId, modifiers = {}) {
        const rarity = SEED_RARITY[seedId] || 'common';
        const yieldConfig = this.config.harvestYield;
        const baseStones = yieldConfig[rarity] ?? 1;
        const baseHarmony = this.config.harmonyPerHarvest;

        const harmonyBonus = Math.max(0, modifiers.harmonyBonus | 0);
        const stoneBonus = Math.max(0, modifiers.stoneBonus | 0);
        const harmonyMult = Number.isFinite(modifiers.harmonyMult) && modifiers.harmonyMult > 0
            ? modifiers.harmonyMult
            : 1;

        // Soil yield multiplier (Stage 1 Linh Thổ): Tức Nhưỡng ×2, Hàn Ngọc
        // +10% on cold herbs. Fractional stones are resolved by a weighted coin
        // flip (injectable `rng`) so a +10% bonus on a 1-stone bloom still pays
        // out one time in ten instead of being rounded away forever.
        const yieldMult = Number.isFinite(modifiers.yieldMult) && modifiers.yieldMult > 0
            ? modifiers.yieldMult
            : 1;
        const rng = typeof modifiers.rng === 'function' ? modifiers.rng : Math.random;
        const harmony = Math.round((baseHarmony + harmonyBonus) * harmonyMult);
        const rawStones = (baseStones + stoneBonus) * yieldMult;
        const stones = Math.floor(rawStones) + (rng() < rawStones - Math.floor(rawStones) ? 1 : 0);

        this.spiritStones += stones;
        this.harmony += harmony;
        this.stats.totalHarvests++;
        this.stats.totalStonesEarned += stones;
        this.stats.currentBlooms--;

        if (rarity === 'rare' || rarity === 'legendary') {
            this.stats.rareBlooms++;
        }
        this._emitDiamonds(stones, 'harvest');

        return { harmony, spiritStones: stones, harmonyBonus, stoneBonus, harmonyMult, yieldMult };
    }

    /** Record a bloom event (called when a flower reaches blooming state) */
    recordBloom(seedId) {
        this.stats.totalBlooms++;
        this.stats.currentBlooms++;
        if (this.stats.currentBlooms > this.stats.maxSimultaneousBlooms) {
            this.stats.maxSimultaneousBlooms = this.stats.currentBlooms;
        }
    }

    /** Record a plot reset (after harvest) */
    recordPlotReset() {
        // currentBlooms already decremented in harvestFlower
    }

    /**
     * Attempt to purchase a seed.
     * @param {string} seedId
     * @returns {{ success: boolean, cost: number, message: string }}
     */
    purchaseSeed(seedId) {
        const cost = this.config.seedCosts[seedId] ?? 0;
        if (cost === 0) {
            // Free seed — just add to inventory
            this.inventory[seedId] = (this.inventory[seedId] || 0) + 1;
            this.bus?.emit?.('economy:seed-purchased', { seedId, cost: 0, owned: this.inventory[seedId] });
            return { success: true, cost: 0, owned: this.inventory[seedId], message: 'Nhận hạt giống miễn phí!' };
        }
        if (this.spiritStones < cost) {
            const result = {
                success: false,
                cost,
                have: this.spiritStones,
                owned: this.inventory[seedId] || 0,
                message: `Không đủ Đá Linh Khí! Cần ${cost}, hiện có ${this.spiritStones}.`,
            };
            this.bus?.emit?.('economy:diamonds-insufficient', { ...result, reason: 'seed-purchase', seedId });
            return result;
        }
        // Premium seed: the diamonds are deducted HERE and announced on the bus
        // so the HUD badge always mirrors the real balance.
        this.spiritStones -= cost;
        this.inventory[seedId] = (this.inventory[seedId] || 0) + 1;
        this._emitDiamonds(-cost, 'seed-purchase');
        this.bus?.emit?.('economy:seed-purchased', { seedId, cost, owned: this.inventory[seedId] });
        return { success: true, cost, owned: this.inventory[seedId], message: `Mua thành công! (-${cost} Đá Linh Khí)` };
    }

    /** True when a seed never costs diamonds (starter seeds are unlimited). */
    isFreeSeed(seedId) {
        return (this.config.seedCosts[seedId] ?? 0) === 0;
    }

    /**
     * Take one seed out of the inventory for planting.
     * Free seeds are unlimited (count never drops below 0 matters not);
     * premium seeds must be owned — returns false when the packet is empty
     * so the scene can offer a purchase instead of planting for free.
     */
    consumeSeed(seedId) {
        if (this.isFreeSeed(seedId)) {
            if ((this.inventory[seedId] || 0) > 0) this.inventory[seedId]--;
            return true;
        }
        if ((this.inventory[seedId] || 0) <= 0) return false;
        this.inventory[seedId]--;
        return true;
    }

    /**
     * Check all quests and return newly completed ones.
     * @returns {Array<{ id: string, name: string, reward: number }>}
     */
    checkQuests() {
        const newlyCompleted = [];
        for (const quest of QUESTS) {
            if (this.completedQuests.has(quest.id)) continue;
            if (quest.condition(this.stats)) {
                this.completedQuests.add(quest.id);
                this.spiritStones += quest.reward;
                this.stats.totalStonesEarned += quest.reward;
                this._emitDiamonds(quest.reward, `quest:${quest.id}`);
                newlyCompleted.push({ id: quest.id, name: quest.name, reward: quest.reward });
            }
        }
        return newlyCompleted;
    }

    /** Get inventory count for a seed */
    getInventoryCount(seedId) {
        return this.inventory[seedId] || 0;
    }

    /** Get seed cost in Spirit Stones */
    getSeedCost(seedId) {
        return this.config.seedCosts[seedId] ?? 0;
    }

    /** Get the rarity tier for a seed */
    getSeedRarity(seedId) {
        return SEED_RARITY[seedId] || 'common';
    }

    /** Serialize state for saving */
    serialize() {
        return {
            spiritStones: this.spiritStones,
            harmony: this.harmony,
            inventory: { ...this.inventory },
            completedQuests: [...this.completedQuests],
            stats: { ...this.stats },
        };
    }

    /** Deserialize state from save data */
    deserialize(data) {
        if (!data) return;
        this.spiritStones = data.spiritStones ?? 0;
        this.harmony = data.harmony ?? 0;
        this.inventory = data.inventory ?? {};
        this.completedQuests = new Set(data.completedQuests ?? []);
        this.stats = data.stats ?? this.stats;
    }
}
