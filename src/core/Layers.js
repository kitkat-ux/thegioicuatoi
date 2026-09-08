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
    REALM: 1525, // Bí Cảnh (Secret Realms) portal selector overlay
    SHOP: 1540, // Cửa Hàng Hoa Viên (Garden Shop) modal
    CODEX: 1550,
    FISHING: 1575, // fishing pier modal and its presentation-only mock motion
    BEAST: 1580, // spirit beast sanctuary modal (Vườn Linh Thú)

    /* ---- MODAL DEPTH CONTRACT (HUD punch-through fix) ----
       Game HUD entry buttons (Hoa Các, Bí Cảnh, Linh Thú, Luyện Đan, Câu Cá)
       sit at 2000 — above every world layer but far below every modal. The
       three modal tiers then stack strictly above them:
         9000  full-screen dark blocker backdrops (interactive — a click can
               never fall through to the HUD buttons underneath)
         9500  modal windows (panels and all their widgets)
         9999  modal close buttons (always visible, always on top)
       Nothing between 2000 and 9000 may own the stage while a modal is up. */
    HUD_BUTTONS: 2000, // game HUD entry buttons — below every modal overlay
    MODAL_BLOCKER: 9000, // modal dark blocker backdrops (interactive)
    MODAL_WINDOW: 9500, // modal windows (panels + widgets)
    MODAL_CLOSE: 9999, // modal close buttons
    TOAST: 9600, // notices / celebration toasts — above modal windows, below close buttons
};

export default LAYERS;
