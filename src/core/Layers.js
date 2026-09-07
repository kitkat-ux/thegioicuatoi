/**
 * Layers — the single depth plan for the whole garden, shared by GardenScene
 * and every UI/VFX module so nothing has to guess where it sits.
 *
 * Two rules the Phase-1 systems rely on:
 *  1. Everything in the WORLD (island, soil, blooms, weather FX) renders BELOW
 *     `LAYERS.AMBIENT`, so the day/dusk/night wash tints it.
 *  2. Every UI element (HUD, action bar, hints, drawer, modals) renders ABOVE
 *     `LAYERS.AMBIENT`, so ambient light never dims a button or a scroll.
 */
export const LAYERS = {
    BG: -100,
    MOON: -96, // night sky layer (behind the world, above the painting)
    ISLAND_SHADOW: -70,
    PLATFORM: -60,
    ISLAND_AURA: -59,
    MIST: 70,
    NPC: 200,
    TILES: 910, // + (row + col) * 7 per tile; sprites ride tile.depth + 2..9
    PETALS: 1080,
    WATER_FX: 1088, // lake ripples from the spring rain
    RAIN: 1092, // rain curtain (tinted by the ambient wash → reads as weather)
    AMBIENT: 1100, // ★ day/dusk/night tint divider: world below, UI above
    HINT: 1125,
    CHIP: 1128,
    HUD: 1130,
    BAR: 1140,
    DRAWER: 1200,
    DIALOG: 1400,
    MODAL: 1500,
    CODEX: 1550,
    TOAST: 1600,
};

export default LAYERS;
