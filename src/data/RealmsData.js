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
        exclusiveSeeds: ['flower_bang_lien', 'flower_tuyet_chi'],
        unlocked: true,
        unlockCost: 0,
        icon: '❄',
        tint: 0x7ff7ff,
    },
};

export const REALM_ORDER = ['DEFAULT_GARDEN', 'FROST_REALM'];

/* ------------------------- Realm-exclusive seed catalog ------------------------- */

/**
 * Seeds that can ONLY be planted inside their home realm. These extend the
 * standard seedCatalog with realm-scoped entries. The scene merges these
 * into the drawer when the active realm has exclusive seeds.
 */
export const REALM_SEEDS = [
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

/** Save plot grid for a specific realm. `plots` is a 2D array of serialized plot data. */
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
