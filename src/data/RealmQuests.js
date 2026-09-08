/**
 * RealmQuests — Bí Cảnh realm-specific daily quest definitions.
 *
 * Each of the 5 sacred realms has 2 thematic daily quests that the realm
 * guardian NPC offers. Tapping the NPC shows "Nhận Nhiệm Vụ Bí Cảnh" / "Ghé Thăm Hoa Các".
 *
 * Quest rewards: Hòa Hợp (harmony), Đá Linh Khí (spirit stones), and realm-exclusive
 * seed packets for the gardener to grow.
 *
 * Pure data module — no Phaser dependency, testable in plain Node.
 */

/* ------------------------- Quest definitions ------------------------- */

/**
 * All realm-specific quests, keyed by realm id.
 * Each quest: { id, name, description, condition, reward, realmReward }
 * realmReward includes harmony, spiritStones, and a realm-exclusive seed grant.
 */
export const REALM_QUESTS = {
    // ─── Linh Đảo Phù Vân (Floating Spirit Isle) ───
    DEFAULT_GARDEN: [
        {
            id: 'phuvan_harvest_cymbidium',
            name: 'Thu hoạch 10 đóa U Đàm',
            description: 'Thu hoạch 10 bông hoa U Đàm (hoa lam cyan) trong vườn.',
            condition: (stats) => stats.totalHarvests >= 10,
            reward: {
                harmony: 6,
                spiritStones: 3,
                seedGrant: null,
            },
        },
        {
            id: 'phuvan_water_queue',
            name: 'Tưới nước 5 lần',
            description: 'Tưới nước cho 5 ô đất trồng hoa khác nhau.',
            condition: (stats) => stats.totalWaterings >= 5,
            reward: {
                harmony: 4,
                spiritStones: 2,
                seedGrant: null,
            },
        },
    ],

    // ─── Băng Phong Hàn Cốc (Frozen Celestial Valley) ───
    FROST_REALM: [
        {
            id: 'frost_plant_ice_lotus',
            name: 'Trồng 5 đóa Băng Liên',
            description: 'Gieo và trồng 5 hạt giống Băng Liên (Divine Ice Lotus) trong Hàn Cốc.',
            condition: (stats) => stats.totalPlants >= 5,
            reward: {
                harmony: 8,
                spiritStones: 5,
                seedGrant: 'flower_bang_lien',
            },
        },
        {
            id: 'frost_feed_frost_beast',
            name: 'Nuôi Linh Thú 2 lần bằng Hàn Băng Ngư',
            description: 'Cho 2 con Linh Thú ăn Hàn Băng Ngư (Frost Fish) trong Vườn Linh Thú.',
            condition: (stats) => stats.beastFeedings >= 2,
            reward: {
                harmony: 10,
                spiritStones: 4,
                seedGrant: null,
            },
        },
    ],

    // ─── U Minh Dạ Trạch (Nether Moonlit Swamp) ───
    NETHER_REALM: [
        {
            id: 'nether_harvest_night_crocus',
            name: 'Thu hoạch 8 Dạ Dạ Cúc trong đêm',
            description: 'Thu hoạch 8 bông Dạ Dạ Cúc (Night Crocus) khi thiên thạch đang đêm.',
            condition: (stats) => stats.nightHarvests >= 8,
            reward: {
                harmony: 12,
                spiritStones: 6,
                seedGrant: 'flower_dacuc_daxa',
            },
        },
        {
            id: 'nether_alchemy_elixir',
            name: 'Luyện 1 Tẩy Tỷ Đan',
            description: 'Pha chế thành công 1 viên Tẩy Tỷ Đan (Purification Elixir) trong Lò Luyện Đan.',
            condition: (stats) => stats.elixirsCrafted >= 1,
            reward: {
                harmony: 15,
                spiritStones: 8,
                seedGrant: null,
            },
        },
    ],

    // ─── Xích Viêm Hỏa Sơn (Flame Peak Ruins) ───
    FLAME_REALM: [
        {
            id: 'flame_plant_flame_fruit',
            name: 'Trồng 5 Hỏa Long Quả',
            description: 'Gieo và trồng 5 hạt giống Hỏa Long Quả (Flame Dragon Fruit) trên Hỏa Sơn.',
            condition: (stats) => stats.totalPlants >= 5,
            reward: {
                harmony: 10,
                spiritStones: 6,
                seedGrant: 'flower_huolong_qua',
            },
        },
        {
            id: 'flame_upgrade_soil',
            name: 'Nâng cấp 1 ô Xích Viêm Thổ',
            description: 'Nâng cấp 1 ô đất trống lên đất Xích Viêm (volcanic premium soil).',
            condition: (stats) => stats.soilUpgrades >= 1,
            reward: {
                harmony: 8,
                spiritStones: 4,
                seedGrant: null,
            },
        },
    ],

    // ─── Bồng Lai Thần Cảnh (Penglai Divine Island) ───
    CELESTIAL_REALM: [
        {
            id: 'celestial_harvest_divine_grade',
            name: 'Thu hoạch hoa phẩm cấp Thần',
            description: 'Thu hoạch 1 bông hoa phẩm cấp Thần (divine-grade bloom — rare or legendary tier).',
            condition: (stats) => stats.rareBlooms >= 1,
            reward: {
                harmony: 25,
                spiritStones: 15,
                seedGrant: 'flower_thien_huyen',
            },
        },
        {
            id: 'celestial_harmony_500',
            name: 'Tích lũy 500 Hòa Hợp',
            description: 'Tích lũy tổng cộng 500 Hòa Hợp (harmony) từ thu hoạch và hoàn thành nhiệm vụ.',
            condition: (stats) => stats.totalHarmonyEarned >= 500,
            reward: {
                harmony: 50,
                spiritStones: 20,
                seedGrant: null,
            },
        },
    ],
};

/* ------------------------- Quest id registry ------------------------- */

/**
 * Flat list of all quest ids for quick lookup / completion tracking.
 */
export const ALL_REALM_QUEST_IDS = Object.values(REALM_QUESTS).flatMap((quests) =>
    quests.map((q) => q.id)
);

/**
 * Find a quest by id across all realms.
 */
export function findRealmQuest(questId) {
    for (const realmQuests of Object.values(REALM_QUESTS)) {
        const found = realmQuests.find((q) => q.id === questId);
        if (found) return found;
    }
    return null;
}

/**
 * Get all quests for a specific realm.
 */
export function getQuestsForRealm(realmId) {
    return REALM_QUESTS[realmId] ?? [];
}

/* ------------------------- Helpers ------------------------- */

/**
 * Check a single quest's condition against current stats.
 */
export function checkRealmQuestCondition(quest, stats) {
    if (!quest.condition) return false;
    return quest.condition(stats);
}

/**
 * Get quest reward breakdown.
 */
export function getQuestReward(quest) {
    return {
        harmony: quest.reward.harmony ?? 0,
        spiritStones: quest.reward.spiritStones ?? 0,
        seedGrant: quest.reward.seedGrant ?? null,
    };
}

/**
 * Format quest description in a friendly way for display.
 */
export function formatQuestName(questId) {
    const quest = findRealmQuest(questId);
    return quest ? quest.name : questId;
}

/**
 * Format quest description in a friendly way for display.
 */
export function formatQuestDescription(questId) {
    const quest = findRealmQuest(questId);
    return quest ? quest.description : '';
}
