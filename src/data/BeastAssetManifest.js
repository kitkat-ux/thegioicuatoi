/**
 * Beast Asset Manifest — Vườn Linh Thú / Spirit Beast Sanctuary.
 *
 * Central contract for all beast-related sprite textures, image paths,
 * dimensions, and anchor origins. GardenScene / TextureFactory consume this
 * manifest to preload textures; UI modules reference the same keys to keep
 * naming consistent across the codebase.
 */

export const BEAST_ASSETS = {
    spirit_fox: {
        key: 'beast_spirit_fox',
        path: 'assets/beasts/beast_spirit_fox.png',
        width: 256,
        height: 256,
        origin: { x: 0.5, y: 0.5 },
        description: 'Cửu Vĩ Bạch Hồ — Hồ ly chín đuôi lông trắng tuyết',
        rarity: 'legendary',
    },
    jade_rabbit: {
        key: 'beast_jade_rabbit',
        path: 'assets/beasts/beast_jade_rabbit.png',
        width: 192,
        height: 192,
        origin: { x: 0.5, y: 0.5 },
        description: 'Ngọc Thỏ — Thỏ ngọc ôm đóa sen lưu ly',
        rarity: 'rare',
    },
    nest_platform: {
        key: 'nest_platform',
        path: 'assets/beasts/nest_platform.png',
        width: 320,
        height: 160,
        origin: { x: 0.5, y: 0.75 },
        description: 'Đệm mây đài sen ngọc bích ngự linh thú',
        rarity: 'common',
    },
    feed_berry: {
        key: 'feed_berry',
        path: 'assets/beasts/feed_berry.png',
        width: 96,
        height: 96,
        origin: { x: 0.5, y: 0.5 },
        description: 'Cửu Chuyển Linh Quả — Trái cây tiên giới thuần dưỡng',
        rarity: 'uncommon',
    },
    affinity_heart: {
        key: 'affinity_heart',
        path: 'assets/beasts/affinity_heart.png',
        width: 80,
        height: 80,
        origin: { x: 0.5, y: 0.5 },
        description: 'Ngọc tâm linh hồ — Biểu tượng độ hảo cảm / thân mật',
        rarity: 'common',
    },
};

/** Preload helper for TextureFactory / GardenScene */
export function getBeastPreloadList() {
    return Object.values(BEAST_ASSETS).map(({ key, path }) => ({ key, path }));
}

/** Lookup by texture key */
export function getBeastAsset(key) {
    return BEAST_ASSETS[key] ?? null;
}

/** All unique file paths for Phaser.loader.preload */
export const BEAST_ASSET_PATHS = Object.values(BEAST_ASSETS).map((a) => a.path);

export default BEAST_ASSETS;
