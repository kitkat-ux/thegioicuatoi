/**
 * Alchemy Asset Manifest — Lò Luyện Đan / System 5 art contract.
 *
 * Central contract for all alchemy-related sprite textures (the Bagua furnace
 * and the elixir pill tiers), mirroring BeastAssetManifest: image paths,
 * display dimensions and anchor origins. Presentation-only — recipes, timers
 * and success rules stay in systems/AlchemyManager.js.
 */

export const ALCHEMY_ASSETS = {
    furnace_bagua: {
        key: 'alchemy_furnace_bagua',
        path: 'assets/alchemy/furnace_bagua.png',
        width: 420,
        height: 448,
        origin: { x: 0.5, y: 0.55 },
        description: 'Bát Quái Lô — lò luyện đan cổ phong bằng đồng và ngọc, khói tiên lượn quanh',
        rarity: 'legendary',
    },
    pill_tier1: {
        key: 'alchemy_pill_tier1',
        path: 'assets/alchemy/pill_tier1.png',
        width: 96,
        height: 78,
        origin: { x: 0.5, y: 0.5 },
        description: 'Trúc Cơ Đan — viên đan phát sáng thanh lam',
        tier: 1,
        rarity: 'rare',
    },
    pill_tier3: {
        key: 'alchemy_pill_tier3',
        path: 'assets/alchemy/pill_tier3.png',
        width: 96,
        height: 96,
        origin: { x: 0.5, y: 0.5 },
        description: 'Cửu Chuyển Thần Đan — viên đan kim sắc tỏa hào quang',
        tier: 3,
        rarity: 'legendary',
    },
};

/** Preload helper for TextureFactory / GardenScene */
export function getAlchemyPreloadList() {
    return Object.values(ALCHEMY_ASSETS).map(({ key, path }) => ({ key, path }));
}

/** Lookup by texture key */
export function getAlchemyAsset(key) {
    return ALCHEMY_ASSETS[key] ?? null;
}

/** All unique file paths for Phaser.loader.preload */
export const ALCHEMY_ASSET_PATHS = Object.values(ALCHEMY_ASSETS).map((a) => a.path);

export default ALCHEMY_ASSETS;
