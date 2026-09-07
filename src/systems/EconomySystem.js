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
     * @param {string} seedId
     * @returns {{ harmony: number, spiritStones: number }}
     */
    harvestFlower(seedId) {
        const rarity = SEED_RARITY[seedId] || 'common';
        const yieldConfig = this.config.harvestYield;
        const stones = yieldConfig[rarity] ?? 1;
        const harmony = this.config.harmonyPerHarvest;

        this.spiritStones += stones;
        this.harmony += harmony;
        this.stats.totalHarvests++;
        this.stats.totalStonesEarned += stones;
        this.stats.currentBlooms--;

        if (rarity === 'rare' || rarity === 'legendary') {
            this.stats.rareBlooms++;
        }

        return { harmony, spiritStones: stones };
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
            return { success: true, cost: 0, message: 'Nhận hạt giống miễn phí!' };
        }
        if (this.spiritStones < cost) {
            return {
                success: false,
                cost,
                message: `Không đủ Đá Linh Khí! Cần ${cost}, hiện có ${this.spiritStones}.`,
            };
        }
        this.spiritStones -= cost;
        this.inventory[seedId] = (this.inventory[seedId] || 0) + 1;
        return { success: true, cost, message: `Mua thành công! (-${cost} Đá Linh Khí)` };
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
