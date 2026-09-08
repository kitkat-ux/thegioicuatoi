/**
 * Soil types — Stage 1 plot upgrades (Linh Thổ).
 *
 * Pure data + pure helpers (no Phaser import) so the multipliers can be unit
 * tested in plain Node. The scene consumes:
 *   · textureKey / texturePath        → preload + sprite swap
 *   · growthMult                      → bloom timer scaling (< 1 = faster)
 *   · waterDrainMult                  → dry-out speed (0 = never dries)
 *   · alwaysWatered                   → plot stays 100% watered
 *   · yieldMult / coldYieldBonus      → harvest drops
 *   · instantMatureChance             → chance a fresh planting blooms at once
 *   · upgradeCost                     → Đá Linh Khí (diamond) price
 *
 * Existing saves that carry no `soilType` (or an unknown one) resolve to
 * HOANG_THO via resolveSoil() — never throw on legacy plots.
 */

export const DEFAULT_SOIL_ID = 'HOANG_THO';

/** Seeds counted as "cold" herbs for the Hàn Ngọc Thổ yield bonus. */
export const COLD_HERB_SEEDS = new Set(['flower_cyan_orchid', 'flower_rare_nguyet_cuc']);

export const SOIL_TYPES = {
    HOANG_THO: {
        id: 'HOANG_THO',
        name: 'Hoàng Thổ',
        english: 'Common Loam',
        description: 'Đất vườn thường — nền tảng của mọi linh điền.',
        textureKey: 'tile_soil',
        texturePath: './assets/images/tile_soil.png',
        tint: 0xffffff,
        glow: 0xd8a24e,
        growthMult: 1,
        waterDrainMult: 1,
        alwaysWatered: false,
        yieldMult: 1,
        coldYieldBonus: 0,
        instantMatureChance: 0,
        upgradeCost: 0,
        tier: 0,
    },
    HAN_NGOC_THO: {
        id: 'HAN_NGOC_THO',
        name: 'Hàn Ngọc Thổ',
        english: 'Frost Jade Soil',
        description: 'Băng ngọc vĩnh cửu — đất luôn ẩm 100%, không bao giờ khô. Thảo dược hàn tính +10% sản lượng.',
        textureKey: 'soil_han_ngoc',
        texturePath: './assets/tiles/soil_han_ngoc.png',
        tint: 0xffffff,
        glow: 0x7ff7ff,
        growthMult: 1,
        waterDrainMult: 0,
        alwaysWatered: true,
        yieldMult: 1,
        coldYieldBonus: 0.10,
        instantMatureChance: 0,
        upgradeCost: 20,
        tier: 1,
    },
    XICH_VIEM_THO: {
        id: 'XICH_VIEM_THO',
        name: 'Xích Viêm Thổ',
        english: 'Crimson Flame Soil',
        description: 'Địa hỏa nung nấu — cây lớn nhanh +40%, nhưng nước bốc hơi gấp đôi.',
        textureKey: 'soil_xich_viem',
        texturePath: './assets/tiles/soil_xich_viem.png',
        tint: 0xffffff,
        glow: 0xff6a3a,
        growthMult: 1 / 1.4,
        waterDrainMult: 2,
        alwaysWatered: false,
        yieldMult: 1,
        coldYieldBonus: 0,
        instantMatureChance: 0,
        upgradeCost: 30,
        tier: 2,
    },
    TUC_NHUONG: {
        id: 'TUC_NHUONG',
        name: 'Tức Nhưỡng',
        english: 'Primordial Celestial Earth',
        description: 'Đất trời sinh tự trưởng — thu hoạch gấp đôi, 10% cơ hội hạt vừa gieo lập tức trưởng thành.',
        textureKey: 'soil_tuc_nhuong',
        texturePath: './assets/tiles/soil_tuc_nhuong.png',
        tint: 0xffffff,
        glow: 0xffe3a0,
        growthMult: 1,
        waterDrainMult: 1,
        alwaysWatered: false,
        yieldMult: 2,
        coldYieldBonus: 0,
        instantMatureChance: 0.10,
        upgradeCost: 50,
        tier: 3,
    },
};

export const SOIL_ORDER = ['HOANG_THO', 'HAN_NGOC_THO', 'XICH_VIEM_THO', 'TUC_NHUONG'];

/** Premium soils that a plot can be upgraded to (everything but the default). */
export const UPGRADEABLE_SOILS = SOIL_ORDER.filter((id) => id !== DEFAULT_SOIL_ID).map((id) => SOIL_TYPES[id]);

/** Textures the scene must preload beyond the base tile_soil. */
export const SOIL_TEXTURES = UPGRADEABLE_SOILS.map((s) => ({ key: s.textureKey, path: s.texturePath }));

/** Resolve any saved / runtime soil id to a definition — legacy plots fall back to HOANG_THO. */
export function resolveSoil(soilType) {
    return SOIL_TYPES[soilType] ?? SOIL_TYPES[DEFAULT_SOIL_ID];
}

/** Bloom duration for a seed on a soil (ms). Faster soils shorten it; never below 1ms. */
export function soilGrowthMs(baseMs, soilType) {
    const soil = resolveSoil(soilType);
    return Math.max(1, Math.round(baseMs * soil.growthMult));
}

/** Water drained per tick on this soil; 0 on always-watered soils. */
export function soilWaterDrain(baseDrain, soilType) {
    const soil = resolveSoil(soilType);
    if (soil.alwaysWatered) return 0;
    return baseDrain * soil.waterDrainMult;
}

/** Whether a plot on this soil counts as watered regardless of its own flag. */
export function soilIsWatered(watered, soilType) {
    return !!(resolveSoil(soilType).alwaysWatered || watered);
}

/**
 * Harvest yield multiplier for a seed on a soil.
 * TUC_NHUONG → 2x; HAN_NGOC_THO → +10% on cold herbs (rounded up so a 1-stone
 * common still feels the bonus at least sometimes via the fractional carry).
 */
export function soilYieldMult(soilType, seedId) {
    const soil = resolveSoil(soilType);
    const cold = COLD_HERB_SEEDS.has(seedId) ? soil.coldYieldBonus : 0;
    return soil.yieldMult * (1 + cold);
}

/** Apply the yield multiplier to an integer drop count (never below the base when mult ≥ 1). */
export function applySoilYield(baseCount, soilType, seedId) {
    const mult = soilYieldMult(soilType, seedId);
    return Math.max(0, Math.round(baseCount * mult));
}

/** Roll the instant-mature chance. `rng` is injectable for deterministic tests. */
export function rollInstantMature(soilType, rng = Math.random) {
    const chance = resolveSoil(soilType).instantMatureChance;
    return chance > 0 && rng() < chance;
}

/** Upgrade cost in diamonds, or null when the target is not a valid upgrade from `fromSoil`. */
export function soilUpgradeCost(fromSoil, toSoil) {
    const from = resolveSoil(fromSoil);
    const to = SOIL_TYPES[toSoil];
    if (!to || to.id === from.id || to.upgradeCost <= 0) return null;
    return to.upgradeCost;
}

/**
 * Normalise a saved plot record: unknown/missing soilType → HOANG_THO,
 * missing watered flag → false. Returns a NEW object; never mutates the save.
 */
export function normalizePlotData(plot = {}) {
    return {
        ...plot,
        soilType: resolveSoil(plot.soilType).id,
        watered: !!plot.watered,
    };
}
