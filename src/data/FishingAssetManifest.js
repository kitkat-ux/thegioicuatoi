/**
 * Fishing art contract.
 *
 * This file is deliberately presentation-only: it describes where the fishing
 * textures live, how many frames they contain, and the stage coordinates a UI
 * renderer can use as a sensible first layout. Fishing rules, catch chances,
 * inventory and tension state do not belong in this manifest.
 */

const stage = { width: 1080, height: 1920 };

const textures = {
        pier_background: {
            key: 'fishing_pier_background',
            path: './assets/fishing/pier_background.png',
            frames: 1,
            frameWidth: 768,
            frameHeight: 1376,
            suggestedUi: {
                x: 540,
                y: 850,
                width: 900,
                height: 750,
                origin: { x: 0.5, y: 0.5 },
                role: 'scene background',
            },
        },
        fishing_rod: {
            key: 'fishing_rod',
            path: './assets/fishing/fishing_rod.png',
            frames: 1,
            frameWidth: 408,
            frameHeight: 1173,
            suggestedUi: {
                x: 148,
                y: 895,
                width: 176,
                height: 576,
                origin: { x: 0.5, y: 0.5 },
                role: 'hero prop',
            },
        },
        bobber: {
            key: 'fishing_bobber',
            path: './assets/fishing/bobber.png',
            frames: 1,
            frameWidth: 422,
            frameHeight: 641,
            suggestedUi: {
                x: 650,
                y: 1110,
                width: 108,
                height: 108,
                origin: { x: 0.5, y: 0.5 },
                role: 'water focus',
            },
        },
        fish_koi_gold: {
            key: 'fishing_koi_gold',
            path: './assets/fishing/fish_koi_gold.png',
            frames: 1,
            frameWidth: 1171,
            frameHeight: 552,
            suggestedUi: {
                x: 710,
                y: 1078,
                width: 280,
                height: 187,
                origin: { x: 0.5, y: 0.5 },
                role: 'catch preview',
            },
        },
        fish_koi_blue: {
            key: 'fishing_koi_blue',
            path: './assets/fishing/fish_koi_blue.png',
            frames: 1,
            frameWidth: 1090,
            frameHeight: 525,
            suggestedUi: {
                x: 710,
                y: 1078,
                width: 280,
                height: 187,
                origin: { x: 0.5, y: 0.5 },
                role: 'catch preview',
            },
        },
        gauge_ring: {
            key: 'fishing_gauge_ring',
            path: './assets/fishing/gauge_ring.png',
            frames: 1,
            frameWidth: 943,
            frameHeight: 942,
            suggestedUi: {
                x: 540,
                y: 1332,
                width: 260,
                height: 260,
                origin: { x: 0.5, y: 0.5 },
                role: 'tension gauge',
            },
        },
};

// The nested form is canonical for preloaders; the direct aliases make the
// contract convenient for small UI consumers and asset inspection tools.
export const FISHING_ASSET_MANIFEST = { stage, textures, ...textures };
export const FISHING_TEXTURES = textures;
export const FISHING_STAGE = stage;

export default FISHING_ASSET_MANIFEST;
