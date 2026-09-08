/**
 * RealmsData — Bí Cảnh (Secret Realms) expedition system.
 *
 * Each realm is a self-contained garden environment with its own background,
 * tile textures, exclusive seeds, and independently persisted plot states.
 *
 * The active realm is tracked by `activeRealmId` in GardenScene. Plot data
 * is saved per-realm in LocalStorage so switching realms preserves each
 * garden's growth timers, soil upgrades, and bloom states independently.
 *
 * Pure data + pure helpers (no Phaser import) so the realm logic can be
 * unit tested in plain Node.
 */

/* ------------------------- Realm definitions ------------------------- */

export const REALM_IDS = {
    DEFAULT_GARDEN: 'DEFAULT_GARDEN',
    FROST_REALM: 'FROST_REALM',
    NETHER_REALM: 'NETHER_REALM',
    FLAME_REALM: 'FLAME_REALM',
    CELESTIAL_REALM: 'CELESTIAL_REALM',
};

export const REALMS = {
    DEFAULT_GARDEN: {
        id: 'DEFAULT_GARDEN',
        name: 'Linh Đảo Phù Vân',
        english: 'Floating Spirit Isle',
        description: 'Hoa viên tiên cảnh trên linh đảo bồng bềnh giữa mây trời — nơi vạn hoa khoe sắc.',
        lore: 'Linh Đảo Phù Vân nổi giữa Thiên Hà, được Tiên Giới ban phúc từ thuở hồng hoang. Đất đai màu mỡ, linh khí dồi dào, là nơi mọi thảo dược tiên giới đều có thể sinh trưởng.',
        backgroundKey: 'bg_manor_isometric',
        backgroundPath: './assets/images/bg_manor_isometric.png',
        tileTextureKey: null, // null = use per-plot soil type (default behavior)
        exclusiveSeeds: [],   // empty = all standard seeds available
        unlocked: true,       // always unlocked (starting realm)
        unlockCost: 0,
        icon: '✿',
        tint: 0x8f7ae0,
        /* Bí Cảnh (Secret Realms) guardian NPC sprite + aura budget */
        npc: {
            name: 'Tiên Nữ Hoa Giang',
            spriteKey: 'npc_tien_nu',
            spritePath: './assets/images/npc_tien_nu.png',
            title: 'Người trấn giữ cầu kiều · Linh Đảo Phù Vân',
            auraTint: 0xc9b2ff,
        },
    },
    FROST_REALM: {
        id: 'FROST_REALM',
        name: 'Băng Phong Hàn Cốc',
        english: 'Frozen Celestial Valley',
        description: 'Bí cảnh băng giá vĩnh cửu — nơi chỉ thảo dược hàn tính mới sinh tồn được.',
        lore: 'Hàn Cốc ẩn mình sâu trong Băng Phong Sơn, nơi tuyết phủ ngàn năm và cực quang cyan chiếu rọi. Chỉ những linh hoa băng hàn như Băng Liên hay Tuyết Chi mới hấp thụ được linh khí nơi đây.',
        backgroundKey: 'bg_frost_realm',
        backgroundPath: './assets/realms/bg_frost_realm.png',
        tileTextureKey: 'tile_frost_soil',
        tileTexturePath: './assets/realms/tile_frost_soil.png',
        exclusiveSeeds: ['flower_bang_lien', 'flower_tuyet_chi', 'flower_bach_tuong'],
        unlocked: true,
        unlockCost: 0,
        icon: '❄',
        tint: 0x7ff7ff,
        npc: {
            name: 'Băng Băng Tiên Tử',
            spriteKey: 'npc_frost_fairy',
            spritePath: './assets/npc/npc_frost_fairy.png',
            title: 'Người canh giữ Băng Phong Hàn Cốc',
            auraTint: 0x9fd8ff,
        },
    },
    NETHER_REALM: {
        id: 'NETHER_REALM',
        name: 'U Minh Dạ Trạch',
        english: 'Nether Moonlit Swamp',
        description: 'Bí cảnh ao hắc ảo ảnh — nơi thảo dược dạ quang sinh trưởng giữa sương mờ bệnh aan.',
        lore: 'U Minh nằm sâu trong vùng đất hắc ám, giữa những đầm nước tối tăm Reflecting ánh trăng mờ. Những loài hoa dạ quang như Dạ Dạ Cúc chỉ nở về đêm, thu hút linh khí từ những vật thể vô tri.',
        backgroundKey: 'bg_nether_realm',
        backgroundPath: './assets/realms/bg_nether_realm.png',
        tileTextureKey: 'tile_nether_soil',
        tileTexturePath: './assets/realms/tile_nether_soil.png',
        exclusiveSeeds: ['flower_dacuc_daxa', 'flower_huyen_phi'],
        unlocked: true,
        unlockCost: 0,
        icon: '🌙',
        tint: 0x9a7fff,
        npc: {
            name: 'U Linh Ma Nữ',
            spriteKey: 'npc_nether',
            spritePath: './assets/npc/npc_nether.png',
            title: 'Người chinh phục bóng tối U Minh',
            auraTint: 0x9a7fff,
        },
    },
    FLAME_REALM: {
        id: 'FLAME_REALM',
        name: 'Xích Viêm Hỏa Sơn',
        english: 'Flame Peak Ruins',
        description: 'Bí cảnh núi lửa hư không — nơi linh hoa chịu lửa sinh sôi giữa tro tàn.',
        lore: 'Hỏa Sơn là nơi lưu giữ cổ ley lines của thế giới. Nhiệt độ cao và tro tàn giàu khoáng chất tạo nên môi trường độc nhất cho các loài hoa chịu lửa như Hỏa Long Quả.',
        backgroundKey: 'bg_flame_realm',
        backgroundPath: './assets/realms/bg_flame_realm.png',
        tileTextureKey: 'tile_flame_soil',
        tileTexturePath: './assets/realms/tile_flame_soil.png',
        exclusiveSeeds: ['flower_huolong_qua', 'flower_huoyan_hong'],
        unlocked: true,
        unlockCost: 0,
        icon: '🔥',
        tint: 0xff6b35,
        npc: {
            name: 'Hỏa Vân Kiếm Tiên',
            spriteKey: 'npc_flame',
            spritePath: './assets/npc/npc_flame.png',
            title: 'Chiến binh canh giữ Hỏa Sơn',
            auraTint: 0xff6b35,
        },
    },
    CELESTIAL_REALM: {
        id: 'CELESTIAL_REALM',
        name: 'Bồng Lai Thần Cảnh',
        english: 'Penglai Divine Island',
        description: 'Bí cảnh thiên đài — nơi hoa phẩm cấp Thần sinh trưởng trong vỏ của sự hanh thông.',
        lore: 'Bồng Lai là cội nguồn của tiên giới, nơi tha kỳ gặp nhau và hòa hợp thành đạo. Đất trời tại đây troã nắng vàng, giàu linh khí nhất vũ trụ, tìm trưởng tất cả các loài hoa phẩm cao cấp.',
        backgroundKey: 'bg_celestial_realm',
        backgroundPath: './assets/realms/bg_celestial_realm.png',
        tileTextureKey: 'tile_celestial_soil',
        tileTexturePath: './assets/realms/tile_celestial_soil.png',
        exclusiveSeeds: ['flower_thien_huyen', 'flower_bang_la_thien', 'flower_thien_dao'],
        unlocked: true,
        unlockCost: 0,
        icon: '☀',
        tint: 0xffd97a,
        npc: {
            name: 'Bồng Lai Tiên Tử',
            spriteKey: 'npc_celestial',
            spritePath: './assets/npc/npc_celestial.png',
            title: 'Tiên thần trấn giữ Bồng Lai',
            auraTint: 0xffd97a,
        },
    },
};

export const REALM_ORDER = [
    'DEFAULT_GARDEN',
    'FROST_REALM',
    'NETHER_REALM',
    'FLAME_REALM',
    'CELESTIAL_REALM',
];

/* ------------------------- Realm-exclusive seed catalog ------------------------- */

/**
 * Seeds that can ONLY be planted inside their home realm. These extend the
 * standard seedCatalog with realm-scoped entries.
 */
export const REALM_SEEDS = [
    // Frost Realm
    {
        id: 'flower_bang_lien',
        sprite_key: 'flower_bang_lien',
        name: 'Băng Liên',
        english: 'Divine Ice Lotus',
        colorName: 'Băng · Ice',
        color_hex: '#7FF7FF',
        petals: 0x7ff7ff,
        growthMs: 20000,
        rarity: 'rare',
        realmId: 'FROST_REALM',
        search_keywords: ['bang', 'lien', 'ice', 'lotus', 'frost', 'lạnh', 'băng', '莲', '冰'],
    },
    {
        id: 'flower_tuyet_chi',
        sprite_key: 'flower_bang_lien', // reuses ice lotus sprite for now
        name: 'Tuyết Chi',
        english: 'Snow Spirit Branch',
        colorName: 'Tuyết · Snow',
        color_hex: '#E0F0FF',
        petals: 0xe0f0ff,
        growthMs: 25000,
        rarity: 'epic',
        realmId: 'FROST_REALM',
        search_keywords: ['tuyet', 'chi', 'snow', 'branch', 'tuyết', '雪', '枝'],
    },
    // Frost Realm — third exclusive seed (reaches 10 total across 5 realms)
    {
        id: 'flower_bach_tuong',
        sprite_key: 'seed_bach_tuong', // keyed sprite art (public/assets/plants/)
        name: 'Bạch Tượng',
        english: 'Ice Statue Bloom',
        colorName: 'Băng · Ice',
        color_hex: '#B0E0E6',
        petals: 0xb0e0e6,
        growthMs: 26000,
        rarity: 'epic',
        realmId: 'FROST_REALM',
        search_keywords: ['bach', 'tuong', 'ice', 'statue', 'bạch', 'tượng', '冰', '像'],
    },
    // Nether Realm
    {
        id: 'flower_dacuc_daxa',
        sprite_key: 'seed_da_da_cuc', // keyed sprite art (public/assets/plants/)
        name: 'Dạ Dạ Cúc',
        english: 'Night Crocus',
        colorName: 'Đêm · Night',
        color_hex: '#9a7fff',
        petals: 0x9a7fff,
        growthMs: 18000,
        rarity: 'rare',
        realmId: 'NETHER_REALM',
        search_keywords: ['dacuc', 'daxa', 'night', 'crocus', ' đêm', 'đêm', 'tối', ' 紫', '夜'],
    },
    {
        id: 'flower_huyen_phi',
        sprite_key: 'seed_huyen_phi_hoa', // keyed sprite art (public/assets/plants/)
        name: 'Huyền Phi Hoa',
        english: 'Underworld Fairy Flower',
        colorName: 'Huyền · Underworld',
        color_hex: '#6a0dad',
        petals: 0x6a0dad,
        growthMs: 22000,
        rarity: 'epic',
        realmId: 'NETHER_REALM',
        search_keywords: ['huyen', 'phi', 'underworld', 'fairy', 'huyền', '巫', '鬼'],
    },
    // Flame Realm
    {
        id: 'flower_huolong_qua',
        sprite_key: 'flower_huolong_qua',
        name: 'Hỏa Long Quả',
        english: 'Flame Dragon Fruit',
        colorName: 'Lửa · Fire',
        color_hex: '#ff3300',
        petals: 0xff3300,
        growthMs: 20000,
        rarity: 'rare',
        realmId: 'FLAME_REALM',
        search_keywords: ['huolong', 'qua', 'dragon', 'fruit', 'lửa', '火', '龙', '果'],
    },
    {
        id: 'flower_huoyan_hong',
        sprite_key: 'flower_huoyan_hong',
        name: 'Huyền Hồng',
        english: 'Hellfire Bloom',
        colorName: 'Huyền Lửa · Hellfire',
        color_hex: '#ff4500',
        petals: 0xff4500,
        growthMs: 28000,
        rarity: 'epic',
        realmId: 'FLAME_REALM',
        search_keywords: ['huoyan', 'hong', 'hellfire', 'bloom', 'hover', '火', '焰', '红'],
    },
    // Celestial Realm — third exclusive seed (reaches 10 total across 5 realms)
    {
        id: 'flower_thien_dao',
        sprite_key: 'flower_thien_dao',
        name: 'Thiên Đao',
        english: 'Celestial Dao Flower',
        colorName: 'Thiên · Heavenly',
        color_hex: '#F5E6CC',
        petals: 0xf5e6cc,
        growthMs: 28000,
        rarity: 'legendary',
        realmId: 'CELESTIAL_REALM',
        search_keywords: ['thien', 'dao', 'celestial', 'dao', 'thiên', 'đạo', '花', '道'],
    },
    // Celestial Realm
    {
        id: 'flower_thien_huyen',
        sprite_key: 'flower_thien_huyen',
        name: 'Thiên Huyền',
        english: 'Celestial Mystery Flower',
        colorName: 'Thiên · Heavenly',
        color_hex: '#ffd700',
        petals: 0xffd700,
        growthMs: 24000,
        rarity: 'legendary',
        realmId: 'CELESTIAL_REALM',
        search_keywords: ['thien', 'huyen', 'celestial', 'mystery', 'thiên', '天', '花'],
    },
    {
        id: 'flower_bang_la_thien',
        sprite_key: 'flower_bang_la_thien',
        name: 'Bồng Lai Thiên',
        english: 'Penglai Celestial Bloom',
        colorName: 'Bồng Lai · Penglai',
        color_hex: '#ffe4b5',
        petals: 0xffe4b5,
        growthMs: 32000,
        rarity: 'legendary',
        realmId: 'CELESTIAL_REALM',
        search_keywords: ['bang', 'la', 'thien', 'penglai', 'celestial', 'phượng', 'bồng', 'lai'],
    },
];

/** Lookup by seed id for realm-exclusive seeds. */
export const REALM_SEED_BY_ID = Object.fromEntries(REALM_SEEDS.map((s) => [s.id, s]));

/**
 * Return the full seed list available in a given realm:
 * standard seeds + realm-exclusive seeds for that realm.
 */
export function getSeedsForRealm(realmId) {
    const realm = REALMS[realmId];
    if (!realm) return [];
    if (realm.exclusiveSeeds.length === 0) {
        // Default garden: all standard seeds (from seedCatalog)
        return [];
    }
    // Return only the realm-exclusive seeds
    return realm.exclusiveSeeds
        .map((id) => REALM_SEED_BY_ID[id])
        .filter(Boolean);
}

/**
 * Check whether a seed can be planted in a given realm.
 * Standard seeds work in DEFAULT_GARDEN; realm-exclusive seeds only in their realm.
 */
export function canPlantInRealm(seedId, realmId) {
    const realmSeed = REALM_SEED_BY_ID[seedId];
    if (realmSeed) {
        // This is a realm-exclusive seed — only plantable in its home realm
        return realmSeed.realmId === realmId;
    }
    // Standard seed — only plantable in the default garden
    return realmId === REALM_IDS.DEFAULT_GARDEN;
}

/** True if the realm uses a single uniform tile texture for all plots. */
export function realmHasUniformTile(realmId) {
    const realm = REALMS[realmId];
    return realm?.tileTextureKey != null;
}

/* ------------------------- LocalStorage persistence ------------------------- */

const STORAGE_PREFIX = 'thegioicuatoi:realm:';
const ACTIVE_REALM_KEY = 'thegioicuatoi:activeRealm';

/** Save plot grid for a specific realm. */
export function saveRealmPlots(realmId, plots) {
    try {
        const key = STORAGE_PREFIX + realmId;
        localStorage.setItem(key, JSON.stringify(plots));
    } catch (e) {
        console.warn(`[RealmsData] Failed to save plots for ${realmId}:`, e);
    }
}

/** Load plot grid for a specific realm. Returns null if no save exists. */
export function loadRealmPlots(realmId) {
    try {
        const key = STORAGE_PREFIX + realmId;
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : null;
    } catch (e) {
        console.warn(`[RealmsData] Failed to load plots for ${realmId}:`, e);
        return null;
    }
}

/** Save the currently active realm id. */
export function saveActiveRealm(realmId) {
    try {
        localStorage.setItem(ACTIVE_REALM_KEY, realmId);
    } catch (e) {
        console.warn(`[RealmsData] Failed to save active realm:`, e);
    }
}

/** Load the currently active realm id. Falls back to DEFAULT_GARDEN. */
export function loadActiveRealm() {
    try {
        const raw = localStorage.getItem(ACTIVE_REALM_KEY);
        if (raw && REALMS[raw]) return raw;
    } catch (e) {
        // ignore
    }
    return REALM_IDS.DEFAULT_GARDEN;
}

/** Get realm definition by id (safe: returns DEFAULT_GARDEN for unknown ids). */
export function resolveRealm(realmId) {
    return REALMS[realmId] ?? REALMS[REALM_IDS.DEFAULT_GARDEN];
}

/** Get all unlocked realms in order. */
export function getUnlockedRealms() {
    return REALM_ORDER.map((id) => REALMS[id]).filter((r) => r.unlocked);
}
