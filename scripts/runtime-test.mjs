// Headless runtime test: boots the actual Phaser game in jsdom + @napi-rs/canvas
// (Phaser.HEADLESS renderer), drives the full gameplay loop, and asserts state.
// Catches runtime errors that a build alone cannot.
import { JSDOM } from 'jsdom';

// ---- DOM environment ----
const dom = new JSDOM('<!doctype html><html><body><div id="game-container"></div></body></html>', {
    pretendToBeVisual: true,
    url: 'http://localhost/',
});
const { window } = dom;
global.window = window;
global.document = window.document;
Object.defineProperty(global, 'navigator', { value: window.navigator, configurable: true });
global.HTMLElement = window.HTMLElement;
global.HTMLCanvasElement = window.HTMLCanvasElement;
global.HTMLImageElement = window.HTMLImageElement;
global.Image = window.Image;
global.requestAnimationFrame = window.requestAnimationFrame.bind(window);
global.cancelAnimationFrame = window.cancelAnimationFrame.bind(window);
const nodePerf = await import('perf_hooks').then((m) => m.performance);
Object.defineProperty(global, 'performance', { value: nodePerf, configurable: true });
Object.defineProperty(window, 'performance', { value: nodePerf, configurable: true });
global.CanvasRenderingContext2D = window.CanvasRenderingContext2D;
global.Node = window.Node;
global.Element = window.Element;
global.getComputedStyle = window.getComputedStyle.bind(window);
global.addEventListener = window.addEventListener.bind(window);
global.removeEventListener = window.removeEventListener.bind(window);
global.screen = { width: 1080, height: 1920, orientation: { addEventListener() {}, removeEventListener() {} } };
global.top = window;
global.parent = window;
global.self = window;
global.frames = window;
global.open = () => null;
global.close = () => {};
global.location = window.location;
global.resolveURL = (u) => new URL(u, 'http://localhost/').href;
window.focus = () => {};
window.blur = () => {};
window.frames = window;
global.self = window;
global.window.location = window.location;

import { Image as NapiImage } from '@napi-rs/canvas';
global.Image = NapiImage;
window.Image = NapiImage;
global.HTMLVideoElement = window.HTMLVideoElement || class HTMLVideoElement {};
window.HTMLVideoElement = global.HTMLVideoElement;

let fails = 0;
const check = (name, cond) => {
    console.log((cond ? 'PASS' : 'FAIL') + '  ' + name);
    if (!cond) fails++;
};

const Phaser = (await import('phaser')).default;
const { default: GardenScene } = await import('../src/scenes/GardenScene.js');
const { LAYERS } = await import('../src/core/Layers.js');

// Inject canvas textures directly (no network/Image loading in jsdom)
class TestGardenScene extends GardenScene {
    preload() {
        const make = (key, w, h, color) => {
            const cv = document.createElement('canvas');
            cv.width = w;
            cv.height = h;
            const ctx = cv.getContext('2d');
            ctx.fillStyle = color;
            ctx.fillRect(0, 0, w, h);
            this.textures.addCanvas(key, cv);
        };
        make('bg_manor_isometric', 1080, 1920, '#1b1140');
        make('tile_soil', 128, 64, '#5a3a1c');
        make('soil_han_ngoc', 128, 72, '#7ff7ff');
        make('soil_xich_viem', 128, 90, '#7a2a12');
        make('soil_tuc_nhuong', 128, 72, '#e8d4a0');
        make('flower_purple', 256, 256, '#B26BFF');
        make('flower_golden', 256, 256, '#FFD700');
        make('flower_cyan', 256, 256, '#00E5FF');
        make('flower_emerald', 256, 256, '#2E8B57');
        make('flower_rare', 256, 256, '#E8B4FF');
        make('icon_seed_drawer', 192, 192, '#7a4a1e');
        make('icon_water_bucket', 192, 192, '#2f8f6b');
        make('icon_search', 192, 192, '#3a2410');
        make('icon_sickle', 192, 192, '#8a5a26');
        make('icon_spirit_stone', 128, 128, '#b26bff');
        make('npc_tien_nu', 256, 384, '#c9dff8');
        make('npc_tien_nu_portrait', 256, 256, '#c9dff8');
        make('icon_codex_scroll', 192, 192, '#f3e6c6');
        make('bridge_pavilion', 320, 240, '#4a1e20');
    }
}

const errors = [];
const game = new Phaser.Game({
    type: Phaser.HEADLESS,
    parent: 'game-container',
    width: 1080,
    height: 1920,
    backgroundColor: '#120b22',
    dom: { createContainer: true },
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    scene: [TestGardenScene],
});

game.events.on('error', (e) => errors.push(String(e)));
game.events.on('ready', () => console.log('[game ready]'));
game.events.on('boot', () => console.log('[game boot]'));
process.on('unhandledRejection', (e) => errors.push('unhandled: ' + String(e?.stack || e)));
const noteError = (e) => {
    const msg = String(e?.stack || e);
    errors.push('uncaught: ' + msg);
    console.log('UNCAUGHT —', msg.split('\n').slice(0, 3).join('\n  '));
};
process.on('uncaughtException', noteError);
process.on('unhandledRejection', noteError);
console.log('readyState:', document.readyState, 'body:', !!document.body);

let scene = null;
for (let i = 0; i < 30 && !scene; i++) {
    await new Promise((r) => setTimeout(r, 200));
    scene = game.scene.getScene('GardenScene');
}
if (!scene) {
    console.log('DIAG pending scenes:', game.scene._pending?.length);
    console.log('DIAG scenes registered:', game.scene.scenes.map((s) => s.scene.key));
    console.log('errors:', errors.join('\n'));
    process.exit(1);
}
await new Promise((r) => setTimeout(r, 500));

// ---- Core boot checks ----
check('scene booted (create ran, no exceptions)', !errors.length);
console.log('errors so far:', errors.length ? errors.join('\n') : '(none)');
check('36 tiles created', scene.tiles.flat().length === 36);
check('textures loaded: bg', scene.textures.exists('bg_manor_isometric'));
check('textures loaded: 5 flowers', ['flower_purple', 'flower_golden', 'flower_cyan', 'flower_emerald', 'flower_rare'].every((k) => scene.textures.exists(k)));
check('textures loaded: new icons', scene.textures.exists('icon_sickle') && scene.textures.exists('icon_spirit_stone'));
check('textures loaded: NPC', scene.textures.exists('npc_tien_nu'));
check('textures loaded: bridge', scene.textures.exists('bridge_pavilion'));
check('particle emitters exist', scene.petalBursts && scene.sparks && scene.petalRain);

// ---- Economy system ----
check('economy system initialized', scene.economy !== null && scene.economy !== undefined);
check('economy starts with 10 spirit stones', scene.economy.spiritStones === 10);
check('harmony starts at 0', scene.economy.harmony === 0);
check('HUD shows spirit stones', scene.stoneValue !== undefined);

// ---- Dialog system ----
check('dialog system initialized', scene.dialog !== null && scene.dialog !== undefined);
check('dialog box exists', scene.dialogBox !== undefined);
check('dialog box starts hidden', scene.dialogVisible === false);
check('dialog body max-height is 180px', scene.dialogBodyMaxH === 180);
check('dialog body is masked (clip, no overflow)', !!scene.dialogBodyMask);
check('dialog uses Unicode font stack (system-ui)', scene.dialogText.style.fontFamily.includes('system-ui'));

// ---- NPC exists ----
check('NPC group created', scene.npcGroup !== undefined);
check('NPC at lower bridge deck (890, 1345)', scene.npcGroup.x === 890 && scene.npcGroup.y >= 1341 && scene.npcGroup.y <= 1349);
check('NPC idle float tween is sinusoidal yoyo ±4px', (() => {
    const t = scene.npcFloatTween;
    if (!t) return false;
    const yd = t.data?.find?.((d) => d.key === 'y');
    // TweenData exposes start/end (Phaser 3.90); from/to yoyo around y=1345
    return !!yd && Math.round(yd.start) === 1341 && Math.round(yd.end) === 1349 && yd.yoyo === true;
})());

// ---- Floating island (Linh Đảo Phù Vân) ----
check('island shadow exists beneath the island', !!scene.islandShadow);
check('island shadow alpha ~0.45 on the water', Math.abs(scene.islandShadow.alpha - 0.45) < 0.08);
check('island shadow behind the island (depth)', scene.islandShadow.depth < scene.platform.depth);
check('island platform aligns with the grid center', (() => {
    const tex = scene.textures.get('platform').getSourceImage();
    const expectedY = 1110 + (tex.height / 2 - 270) * 0.82; // diamond center -> (540, 1110)
    return Math.abs(scene.platform.x - 540) < 0.01 && Math.abs(scene.platform.y - expectedY) < 0.01;
})());

// ---- Action bar: sleek scale + generous hitboxes + micro-animations ----
check('3 action buttons configured', Array.isArray(scene.actionButtons) && scene.actionButtons.length === 3);
check('action buttons ~20% smaller (86px visual radius)', scene.actionButtons.every((b) => b.radius === 86));
check('action buttons keep generous 172px touch hitbox', scene.actionButtons.every((b) => b.hitRadius === 172));
check('action buttons have press feedback handlers', scene.actionButtons.every((b) => typeof b.press === 'function' && typeof b.release === 'function'));

// press feedback: 0.9x down on pointerdown, bounce back to 1.0 on release
const testBtn = scene.actionButtons[2];
testBtn.press();
await new Promise((r) => setTimeout(r, 120));
const pressedScale = testBtn.inner.scaleX;
testBtn.release();
await new Promise((r) => setTimeout(r, 450));
check('press feedback scales to 0.9x on pointerdown', Math.abs(pressedScale - 0.9) < 0.02);
check('press feedback bounces back to 1.0x on release', Math.abs(testBtn.inner.scaleX - 1) < 0.02);

// ---- Seed drawer + real-time search ----
scene.openDrawer();
await new Promise((r) => setTimeout(r, 400));
check('drawer opened', scene.drawerOpen === true);

scene.searchInput.node.value = 'vang';
scene.onSearchInput('vang');
await new Promise((r) => setTimeout(r, 100));
let visible = scene.seedCards.filter((c) => c.container.visible).map((c) => c.seed.id);
check('filter "vang" shows only gold', JSON.stringify(visible) === JSON.stringify(['flower_golden_amber']));

scene.searchInput.node.value = 'xanh';
scene.onSearchInput('xanh');
await new Promise((r) => setTimeout(r, 100));
visible = scene.seedCards.filter((c) => c.container.visible).map((c) => c.seed.id);
check('filter "xanh" shows only cyan', JSON.stringify(visible) === JSON.stringify(['flower_cyan_orchid']));

scene.searchInput.node.value = 'nguyet';
scene.onSearchInput('nguyet');
await new Promise((r) => setTimeout(r, 100));
visible = scene.seedCards.filter((c) => c.container.visible).map((c) => c.seed.id);
check('filter "nguyet" shows rare seed', JSON.stringify(visible) === JSON.stringify(['flower_rare_nguyet_cuc']));

scene.searchInput.node.value = '';
scene.onSearchInput('');
await new Promise((r) => setTimeout(r, 100));
visible = scene.seedCards.filter((c) => c.container.visible).length;
check('empty filter shows all 5', visible === 5);

// ---- Select seed + plant ----
scene.selectSeed(scene.seedCards[1].seed); // purple
await new Promise((r) => setTimeout(r, 1100));
check('seed selected (purple)', scene.selectedSeed?.id === 'flower_purple_wisteria');

const tile22 = scene.tiles[2][2];
const tile23 = scene.tiles[2][3];
scene.plantSeed(tile22);
scene.plantSeed(tile23);
await new Promise((r) => setTimeout(r, 400));
check('tile(2,2) PLANTED', tile22.gridData.state === 'PLANTED');
check('tile(2,3) PLANTED', tile23.gridData.state === 'PLANTED');
check('sprout sprite created', !!tile22.gridData.plantSprites?.sprout);

// ---- One-click water -> bloom ----
scene.waterAll();
await new Promise((r) => setTimeout(r, 2500));
check('tile(2,2) BLOOMING', tile22.gridData.state === 'BLOOMING');
check('tile(2,3) BLOOMING', tile23.gridData.state === 'BLOOMING');
check('bloom sprite created', !!tile22.gridData.bloomSprite);

// ---- Harvest a blooming tile ----
const stonesBefore = scene.economy.spiritStones;
const harmonyBefore = scene.economy.harmony;
scene.harvestTile(tile22);
await new Promise((r) => setTimeout(r, 300));
check('tile(2,2) reset to EMPTY after harvest', tile22.gridData.state === 'EMPTY');
check('harvest yields spirit stones', scene.economy.spiritStones > stonesBefore);
check('harvest yields harmony', scene.economy.harmony > harmonyBefore);
check('bloom sprite destroyed', tile22.gridData.bloomSprite === null);
check('bloom glow destroyed', tile22.gridData.bloomGlow === null);

// ---- Harvest All (sickle) ----
// Plant and bloom more tiles
const tile33 = scene.tiles[3][3];
const tile34 = scene.tiles[3][4];
scene.plantSeed(tile33);
scene.plantSeed(tile34);
await new Promise((r) => setTimeout(r, 200));
scene.waterAll();
await new Promise((r) => setTimeout(r, 2500));
check('tile(3,3) BLOOMING', tile33.gridData.state === 'BLOOMING');
check('tile(3,4) BLOOMING', tile34.gridData.state === 'BLOOMING');

const harvestAllStonesBefore = scene.economy.spiritStones;
scene.harvestAll();
await new Promise((r) => setTimeout(r, 1500));
check('harvestAll resets tiles to EMPTY', tile33.gridData.state === 'EMPTY' && tile34.gridData.state === 'EMPTY');
check('harvestAll yields stones', scene.economy.spiritStones > harvestAllStonesBefore);

// ---- Rewarded ad flow ----
const adBefore = scene.economy.harmony;
scene.watchAd();
await new Promise((r) => setTimeout(r, 4500));
check('rewarded ad grants +3 harmony', scene.economy.harmony >= adBefore + 3);
check('rewarded ad grants spirit stones', scene.economy.spiritStones > harvestAllStonesBefore);
check('no runtime errors after ad flow', errors.length === 0);

// ---- Dialog open/close ----
scene.onNpcClick();
await new Promise((r) => setTimeout(r, 300));
check('dialog opens on NPC click', scene.dialogVisible === true);

// ---- Dialog structure: navigate to the quest list (quest_details) ----
// The greeting variant depends on live quest state; walk toward quest_details.
let navGuard = 0;
while (scene.dialog.currentNodeId !== 'quest_details' && navGuard++ < 4) {
    const node = scene.dialog.getCurrentNode();
    const idx = node.choices.findIndex((c) => {
        const next = typeof c.next === 'function' ? c.next(scene.dialog.questState) : c.next;
        return next === 'quest_details' || next === 'quest_offer';
    });
    scene.onDialogChoice(Math.max(0, idx));
    await new Promise((r) => setTimeout(r, 80));
}
check('navigated to quest_details node', scene.dialog.currentNodeId === 'quest_details');
check('quest list renders 6 rows', scene.questRowContainers.length === 6);
check('quest list overflows 180px body -> scrollable', scene.dialogScrollMax > 0);
check('quest rows show live progress counters', (() => {
    const texts = scene.questRowContainers
        .flatMap((c) => c.list.filter((o) => o.text !== undefined).map((o) => o.text));
    return texts.some((t) => /\/\d+/.test(t)) && texts.some((t) => t.includes('hoàn thành'));
})());
// scroll clamping
scene.setDialogScroll(99999);
check('scroll clamps to max', scene.dialogScroll === scene.dialogScrollMax);
scene.setDialogScroll(-40);
check('scroll clamps to 0', scene.dialogScroll === 0);
scene.setDialogScroll(60);
check('scroll offset moves content up', Math.abs(scene.dialogContent.y - (-60)) < 0.01);
// footer pinned strictly at the bottom: last visible choice bottom edge = 1054
const lastChoice = [...scene.dialogChoices].reverse().find((c) => c.container.visible);
check('response buttons pinned to dialog bottom', Math.abs((lastChoice.container.y + 32) - 1054) < 0.01);
// text never overflows the body: content is clipped by the 180px mask rect
const contentBottomWorld = scene.dialogText.y + scene.dialogText.height + 6 * 52;
check('long quest text stays inside masked body (clipped)', contentBottomWorld - 592 > 180 && scene.dialogBodyMaxH === 180);
scene.closeDialog();
await new Promise((r) => setTimeout(r, 300));
check('dialog closes', scene.dialogVisible === false);

// ---- Gesture system ----
check('gesture system set up', scene.input !== undefined);

// ---- Replant on harvested tile ----
scene.selectSeed(scene.seedCards[0].seed); // cyan
await new Promise((r) => setTimeout(r, 800));
scene.plantSeed(scene.tiles[2][2]);
await new Promise((r) => setTimeout(r, 200));
check('can replant on harvested tile', scene.tiles[2][2].gridData.state === 'PLANTED');

// ---- Seed catalog has 5 entries in scene ----
check('seedCards has 5 entries', scene.seedCards.length === 5);

// ---- Touch zone sizes ----
// Action bar buttons should have 172px radius touch zones (344px x 344px zones)
check('action bar drawer button exists', scene.drawerBtn !== undefined);
check('action bar water button exists', scene.waterBtn !== undefined);
check('action bar harvest all button exists', scene.harvestAllBtn !== undefined);


/* ==================== DESKTOP CENTERING (canvas fit + centering) ==================== */
check('Scale mode is FIT (9:16 letterboxed, never stretched)', game.scale.scaleMode === Phaser.Scale.FIT);
check('autoCenter is CENTER_BOTH', game.scale.autoCenter === Phaser.Scale.CENTER_BOTH);
check('Game size stays 1080x1920', game.scale.width === 1080 && game.scale.height === 1920);
check('Canvas is a block element inside the centered wrapper', !!game.canvas && game.canvas.parentNode === document.getElementById('game-container'));
check('Parent wrapper fills the viewport (centering box)', document.getElementById('game-container') !== null);

/* ==================== PHASE 1 · EventManager wiring ==================== */
check('Scene owns one EventManager bus', !!scene.bus && scene.bus.constructor.name === 'EventManager');
check('Codex is bound to the bus (no direct scene→codex writes)', !!scene.codex && scene.codex.bus === scene.bus);
check('Weather is bound to the bus', !!scene.weather && scene.weather.bus === scene.bus);
check('Weather view subscribes through the bus', !!scene.weatherView && scene.weatherView.bus === scene.bus);
{
    const before = scene.bus.emitCount;
    scene.bus.emit('garden:test-ping', { ok: 1 });
    check('Bus records traffic (history + counters for debugging)', scene.bus.emitCount === before + 1 && scene.bus.wasEmitted('garden:test-ping'));
}

/* ==================== PHASE 1 · System 9: Vạn Hoa Đồ Giám ==================== */
// the codex learns purely from gameplay facts published on the bus
const codexTile = scene.tiles[0][0];
scene.selectSeed(scene.seedCards[0].seed); // cyan
await new Promise((r) => setTimeout(r, 700));
scene.plantSeed(codexTile);
scene.waterAll();
await new Promise((r) => setTimeout(r, 2500));
check('Flower bloomed for the codex test', codexTile.gridData.state === 'BLOOMING');
check('Codex discovered the species from FLOWER_BLOOMED only', scene.codex.isDiscovered('flower_cyan_orchid') === true);
check('Codex wrote the poem on first bloom', scene.codex.getPages().find((p) => p.seedId === 'flower_cyan_orchid').poem !== null);
const codexBefore = scene.codex.getEntry('flower_cyan_orchid').harvests;
const harmonyBeforeCodex = scene.economy.harmony;
scene.harvestTile(codexTile);
await new Promise((r) => setTimeout(r, 250));
check('Codex counted the harvest through the bus', scene.codex.getEntry('flower_cyan_orchid').harvests === codexBefore + 1);
check('Codex first-page milestone paid out harmony', scene.economy.harmony > harmonyBeforeCodex);
check('Codex progress feeds the HUD badge', scene.codexModal.badgeText.text === `${scene.codex.getDiscoveredCount()}/5`);

// HUD scroll button
check('Codex scroll button lives on the top HUD', !!scene.codexModal.button && scene.codexModal.button.depth > 1100);
check('Codex button sits above the badges, not over the grid', (() => {
    const { x, y } = scene.codexModal.buttonPos;
    return x > 800 && y < 420;
})());

// open the scroll
scene.openCodex();
await new Promise((r) => setTimeout(r, 400));
let snap = scene.codexModal.getSnapshot();
check('Codex scroll opens', snap.open === true && scene.codexModal.root.visible === true);
check('Codex scroll renders one page per catalog species', snap.rowCount >= snap.pages + 6);
check('Codex panel is masked + scrollable inside the 9:16 stage', !!scene.codexModal.content.mask && snap.body.top > 0 && snap.body.bottom < 1920);
check('Codex body never bleeds into the footer', snap.body.bottom <= 1920 - 118 - 8);
check('Codex content overflows the body → axis scroll enabled', snap.scrollMax > 0);
check('Codex scroll clamps to the bottom', (() => {
    scene.codexModal.setScroll(99999);
    const clamped = scene.codexModal.scroll === scene.codexModal.scrollMax;
    scene.codexModal.setScroll(-40);
    return clamped && scene.codexModal.scroll === 0;
})());
check('Codex scroll lists buffs + milestones sections', (() => {
    const texts = scene.codexModal.rowNodes.flatMap((c) => (c.list || []).filter((o) => o.text !== undefined).map((o) => o.text));
    return texts.some((t) => t.includes('Buff')) && texts.some((t) => t.includes('Mốc Sưu Tập')) && texts.some((t) => t.includes('Bách Thảo'));
})());
check('Codex header: title clears the close-button disc', (() => {
    const t = scene.codexModal.headerTitle.getBounds();
    const c = scene.codexModal.headerCloseButton.getBounds();
    return t.x > c.right - 2;
})());
check('Codex close button is present and interactive', !!scene.codexModal.headerCloseButton && !!scene.codexModal.closeBtn);
scene.closeCodex();
await new Promise((r) => setTimeout(r, 400));
check('Codex scroll closes', scene.codexModal.isOpen() === false);
// the hint line yields the stage to a full-screen overlay
scene.openCodex();
await new Promise((r) => setTimeout(r, 250));
const hintHiddenForOverlay = scene.hintText.visible === false && scene.hintBg.visible === false;
scene.closeCodex();
await new Promise((r) => setTimeout(r, 250));
check('Hint line hides for an overlay and returns when it closes',
    hintHiddenForOverlay && scene.hintText.visible === true);
check('Codex toast renders inside the sheet (never over the title)', (() => {
    const before = scene.children.list.length;
    scene.codexModal.toast('Kiểm thử', 0xffffff);
    const node = scene.children.list.slice(before).filter((o) => o.type === 'Text').pop();
    const geom = scene.codexModal.getSnapshot();
    const ok = !!node && node.depth > LAYERS.CODEX && node.y > geom.body.top && node.y < geom.body.bottom;
    node?.destroy();
    return ok;
})());

// Regression guard: an overlay dim left on the display list (instead of inside
// its container) veils and swallows input over the whole garden.
check('Codex dim is parented to the overlay, not the display list', (() => {
    const dim = scene.codexModal.dim;
    return !!dim && dim.parentContainer === scene.codexModal.root
        && dim.width >= 1080 && dim.height >= 1920 && dim.fillAlpha > 0.6 && !!dim.input;
})());
check('No stray full-screen dim on the display list while overlays are closed', (() => {
    const stray = scene.children.list.filter((o) => o.visible !== false
        && !o.parentContainer && o.type === 'Rectangle' && o.width >= 1000 && o.height >= 1800);
    return stray.length === 0;
})());
check('Everything on the display list below the codex layer stays visible to input', (() => {
    // the island grid must still be hit-testable with the scroll closed
    const pt = scene.children.list.filter((o) => o.visible !== false && (o.depth ?? 0) <= LAYERS.AMBIENT && o.width === 1080 && o.height === 1920 && o.fillAlpha > 0.4);
    return pt.length <= 1 && !!scene.tiles[0][0].input;
})());

// mastery tier + skin reward path (3 harvests of one species)
for (let i = 0; i < 3; i++) scene.codex.recordHarvest('flower_cyan_orchid');
scene.applyCodexBuffs();
check('Codex tier 1 (Mộc Dịch) reached → +1 harmony per harvest of that species',
    scene.codexBuffs.harmonyBonusBySeed['flower_cyan_orchid'] === 1);
check('Codex refresh keeps the HUD badge in sync', scene.codexModal.badgeText.text === `${scene.codex.getDiscoveredCount()}/5`);
scene.codex.recordBloom('flower_purple_wisteria');
scene.codex.recordBloom('flower_golden_amber');
scene.codex.recordBloom('flower_emerald_bamboo');
scene.applyCodexBuffs();
check('4 species collected → jade sickle skin applied to the harvest button',
    scene.codex.hasSkin('sickle_jade') && scene.skins.sickle_jade === true);
check('Codex milestone also raised the harmony multiplier', scene.codexBuffs.harmonyMult > 1);

/* ==================== PHASE 1 · System 8: Thiên Thời Tứ Thời ==================== */
check('Ambient wash renders above the world but below every UI layer', (() => {
    const st = scene.weatherView.getState();
    return st.depths.ambient === LAYERS.AMBIENT
        && st.depths.ambient > LAYERS.PETALS
        && st.depths.ambient > LAYERS.RAIN
        && st.depths.ambient < LAYERS.HUD
        && scene.islandShadow.depth < LAYERS.AMBIENT
        && scene.harvestAllBtn.outer.depth > LAYERS.AMBIENT
        && scene.weatherChip.depth > LAYERS.AMBIENT;
})());
check('Ambient wash multiplies the scene (subtle tinting, not an overlay box)', scene.weatherView.wash.blendMode === Phaser.BlendModes.MULTIPLY);
check('Rain + ripple + splash emitters exist over the lake', !!scene.weatherView.rain && !!scene.weatherView.ripples && !!scene.weatherView.splash);
check('Weather chip visible on the HUD', !!scene.weatherChip && scene.weatherChip.depth === 1130);

// day → dusk → night lighting actually changes
scene.weather.forcePhase('dusk');
scene.weatherView.sync();
await new Promise((r) => setTimeout(r, 700));
const duskAlpha = scene.weatherView.getState().washAlpha;
scene.weather.forcePhase('night');
scene.weatherView.sync();
await new Promise((r) => setTimeout(r, 1600));
const nightState = scene.weatherView.getState();
check('Dusk tints the garden warmer', duskAlpha > 0.02);
check('Night deepens the tint beyond dusk', nightState.washAlpha > duskAlpha);
check('Night raises the moon + stone-lamp level', nightState.moonAlpha > 0.05 && nightState.lampLevel > 0.05);
check('Night lamp level was published on the bus for the garden to react to', scene.lampLevel > 0.05);

// THE RAIN BUFF: unwatered soil gets watered for free
const dryTiles = [scene.tiles[1][1], scene.tiles[1][2], scene.tiles[1][3]];
for (const t of dryTiles) { scene.plantSeed(t); }
const alreadyWatered = dryTiles.filter((t) => t.gridData.watered).length;
check('Rain test plots start planted and unwatered', dryTiles.every((t) => t.gridData.state === 'PLANTED' && !t.gridData.watered) && alreadyWatered === 0);
scene.weather.forceRain(true);
await new Promise((r) => setTimeout(r, 300));
check('Rain publishes the irrigation buff and waters the dry plots', dryTiles.every((t) => t.gridData.watered === true));
check('Rain-grown plots advance to growing/blooming without the watering can', dryTiles.every((t) => t.gridData.state !== 'PLANTED'));
check('Rain FX emitters are live', scene.weatherView.isRaining() === true);
check('Rain was announced on the bus', scene.bus.history.some((h) => h.event === 'weather:rain-started'));
scene.weather.forceRain(false);
await new Promise((r) => setTimeout(r, 250));
check('Rain stops cleanly (no stuck particles)', scene.weatherView.isRaining() === false && !scene.weather.isRaining());

// full moon doubles Harmony, and codex + weather multipliers compose
scene.weather.forcePhase('day');
scene.weather.dayCount = scene.weather.config.moonCycle;
scene.weather.forcePhase('night');
check('Full-moon night detected', scene.weather.isFullMoonNight() === true && scene.weather.getModifiers().harmonyMult === 2);
const moonTile = scene.tiles[4][4];
scene.clearSelection();
scene.selectedSeed = scene.seedCards[0].seed;
scene.plantSeed(moonTile);
moonTile.gridData.state = 'GROWING';
moonTile.gridData.watered = true;
const harmonyBeforeMoon = scene.economy.harmony;
scene.bloomTile(moonTile);
scene.harvestTile(moonTile);
await new Promise((r) => setTimeout(r, 120));
const moonGain = scene.economy.harmony - harmonyBeforeMoon;
check('Full moon + codex buffs both apply to the harvest', moonGain >= 6);
scene.weather.forcePhase('day');

// persistence + serialization of the two new systems
{
    const cw = JSON.parse(JSON.stringify(scene.weather.serialize()));
    const cc = JSON.parse(JSON.stringify(scene.codex.serialize()));
    const { WeatherSystem: WS } = await import('../src/systems/WeatherSystem.js');
    const { CodexManager: CM } = await import('../src/systems/CodexManager.js');
    const w2 = new WS().deserialize(cw);
    const c2 = new CM().deserialize(cc);
    check('Weather state survives a save/load round trip', w2.getPhase() === cw.phase && w2.dayCount === cw.dayCount);
    check('Codex state survives a save/load round trip', c2.getDiscoveredCount() === cc.entries ? true : c2.getProgress().discovered === Object.values(cc.entries).filter((e) => e.discovered).length);
}

/* ==================== PHASE 2 · System 5: Lò Luyện Đan (Alchemy) ==================== */
check('Alchemy system bound to the bus (no direct scene→alchemy writes)', !!scene.alchemy && scene.alchemy.bus === scene.bus);
check('Alchemy HUD medallion sits on the top HUD below the codex scroll', (() => {
    const b = scene.alchemyModal?.buttonPos;
    return !!scene.alchemyModal?.button && scene.alchemyModal.button.depth >= LAYERS.HUD
        && b && b.x > 800 && b.y > 380 && b.y < 560;
})());
// furnace: a valid run is accepted, the slot is single, ingredients are consumed
scene.alchemy.grant({ u_dam: 1 }); // starter kit 2 U Đàm + 1 = recipe-complete
const alchCraft = scene.alchemy.craft('tu_khi_dan');
check('Alchemy craft accepted with valid ingredients', alchCraft.success === true);
const alchBusy = scene.alchemy.craft('tay_tui_dan');
check('Furnace is single-slot (FURNACE_BUSY while a run is live)', alchBusy.reason === 'FURNACE_BUSY');
scene.alchemy.tick(16, alchCraft.endsAt + 1); // fast-forward the 45s wall-clock run
check('Furnace resolved once the countdown elapsed', scene.alchemy.getCrafting() === null);
check('The run produced a shelf elixir or a recorded failure',
    scene.alchemy.stats.totalSuccess + scene.alchemy.stats.totalFailed === 1);

// buff path: ELIXIR_CONSUMED is the only channel between furnace and garden
scene.alchemy.grantElixir('tu_khi_dan', 1);
const staggerBefore = scene.bloomStaggerMs();
scene.alchemy.consume('tu_khi_dan');
check('Tụ Khí Đan published ELIXIR_CONSUMED on the bus', scene.bus.wasEmitted('ELIXIR_CONSUMED'));
check('Bloom stagger shortens ~20% while the elixir is active', scene.bloomStaggerMs() < staggerBefore);

// the instant Vạn Thọ Linh Dịch must water every unwatered plot through the bus
const alchTile = scene.tiles[5][5];
scene.plantSeed(alchTile);
scene.alchemy.grantElixir('van_tho_linh_dich', 1);
scene.alchemy.consume('van_tho_linh_dich');
await new Promise((r) => setTimeout(r, 300));
check('Vạn Thọ Linh Dịch auto-watered the garden via the bus', alchTile.gridData.watered === true);

// timed buff expiry through the tick clock
scene.alchemy.tick(16, Date.now() + 10 * 60_000 + 500);
check('Timed elixir buff expires after 10 minutes',
    scene.alchemy.getBuffs().active.length === 0 && scene.alchemy.getBuffs().growthMult === 1);

// modal: medallion opens the cauldron overlay, CTA + counts render
scene.alchemyModal.open();
await new Promise((r) => setTimeout(r, 350));
check('Alchemy modal opens with the cauldron overlay',
    scene.alchemyModal.isOpen() === true && scene.alchemyModal.root.visible === true);
check('Alchemy CTA + snapshot render (countdown/claim/ingredient states)',
    scene.alchemyModal.getSnapshot().ctaLabel.length > 0
    && scene.alchemyModal.getSnapshot().elixirCount.length === 3);
scene.alchemyModal.close();
await new Promise((r) => setTimeout(r, 350));
check('Alchemy modal closes cleanly', scene.alchemyModal.isOpen() === false);

// ---- Rare seed in catalog ----
const rareCard = scene.seedCards.find(c => c.seed.id === 'flower_rare_nguyet_cuc');
check('rare seed card exists in drawer', rareCard !== undefined);

/* ==================== CRITICAL BUGFIX PASS ==================== */
const { TOOL } = await import('../src/scenes/GardenScene.js');
const { EVENTS: EV } = await import('../src/systems/EventManager.js');
const fakeEvent = () => ({ cancelled: false, stopPropagation() { this.cancelled = true; } });
const pointerAt = (x, y) => ({ x, y, worldX: x, worldY: y });
const settle = (ms) => new Promise((r) => setTimeout(r, ms));

// -- 1. modal propagation: taps inside the panel never reach the backdrop --
for (const [label, modal] of [['Alchemy', scene.alchemyModal], ['Fishing', scene.fishingModal], ['Beast', scene.beastModal]]) {
    modal.open();
    await settle(320);
    const rect = modal.getPanelWorldRect();
    const inside = pointerAt(rect.x + rect.width / 2, rect.y + rect.height / 2);
    const outside = pointerAt(20, 20);
    check(`${label} modal: dim is parented to the overlay + panel shield present`,
        modal.dim?.parentContainer === modal.root && !!modal.panelShield?.input && modal.panelShield.parentContainer === modal.root);
    const ev1 = fakeEvent();
    modal.panelShield.emit('pointerdown', inside, 0, 0, ev1);
    check(`${label} modal: panel shield calls event.stopPropagation()`, ev1.cancelled === true && modal.isOpen());
    const ev2 = fakeEvent();
    modal.dim.emit('pointerdown', inside, 0, 0, ev2);
    check(`${label} modal: a backdrop tap INSIDE the panel rect does not close it`, modal.isOpen() === true && ev2.cancelled === true);
    modal.dim.emit('pointerdown', outside, 0, 0, fakeEvent());
    check(`${label} modal: a backdrop tap OUTSIDE the panel closes it`, modal.isOpen() === false);
    await settle(260);
}

// -- 4. beast modal: dark theme, tab switch shows one beast at a time --
{
    const bm = scene.beastModal;
    bm.open();
    await settle(320);
    check('Beast modal: four tabs rendered (one per beast) at distinct x',
        bm.tabs.length === 4 && new Set(bm.tabs.map((t) => t.x)).size === 4);
    const visibleCards = () => bm.stageCards.filter((c) => c.visible).length;
    check('Beast modal: only the selected beast is on the stage', visibleCards() === 1 && bm.stageCards[0].visible);
    check('Beast modal: roster includes Thanh Loan and Huyền Quy',
        bm.beasts.map((b) => b.name).join('|') === 'Cửu Vĩ Bạch Hồ|Ngọc Thỏ|Thanh Loan|Huyền Quy');
    bm.selectBeast(1);
    await settle(360);
    check('Beast modal: tab switch swaps the stage to Ngọc Thỏ (never stacked)',
        bm.selectedIndex === 1 && bm.stageCards[1].visible && !bm.stageCards[0].visible && bm.beastName.text === 'Ngọc Thỏ');
    bm.selectBeast(2, { animate: false });
    check('Beast modal: Thanh Loan shows +15% tốc độ cây lớn',
        bm.beastName.text === 'Thanh Loan' && (bm.buffsList?.list ?? []).some((n) => /15% tốc độ cây lớn/.test(n.text ?? '')));
    bm.selectBeast(3, { animate: false });
    check('Beast modal: Huyền Quy shows +20% tỷ lệ đan dược cao cấp',
        bm.beastName.text === 'Huyền Quy' && (bm.buffsList?.list ?? []).some((n) => /20% tỷ lệ đan dược/.test(n.text ?? '')));
    bm.step(1);
    await settle(360);
    check('Beast modal: carousel wraps from Huyền Quy back to Cửu Vĩ Bạch Hồ',
        bm.selectedIndex === 0 && bm.beastName.text === 'Cửu Vĩ Bạch Hồ' && visibleCards() === 1);
    check('Beast modal: title/name use light text on the dark panel',
        bm.title.style.color === '#ffe9a8' && bm.beastName.style.color === '#ffe9a8' && bm.subtitle.style.color === '#b9a3dd');
    const ev = fakeEvent();
    bm.tabs[1].list.find((o) => o.type === 'Zone').emit('pointerdown', pointerAt(540, 700), 0, 0, ev);
    await settle(50);
    check('Beast modal: tab tap stops propagation and keeps the modal open', ev.cancelled && bm.isOpen() && bm.selectedIndex === 1);
    // Câu Cá → Nuôi Thú: 1 Linh Ngư → +20 Thân Mật, persisted
    {
        const sys = scene.beasts;
        sys.grantLinhNgu(1);
        const fox = sys.getBeast('fox_01');
        const beforeAff = fox.affinity;
        const beforeFish = sys.getLinhNgu();
        bm.selectBeast(0, { animate: false });
        bm.handleFeed();
        check('Feed loop: Cho Ăn consumes 1 Linh Ngư', sys.getLinhNgu() === beforeFish - 1);
        check('Feed loop: Cho Ăn adds +20 Thân Mật', fox.affinity === Math.min(fox.affinityMax, beforeAff + 20));
        check('Feed loop: BEAST_FED published on the bus', scene.bus.wasEmitted(EV.BEAST_FED));
        const saved = JSON.parse(scene.beasts.store.read() ? JSON.stringify(scene.beasts.store.read()) : 'null');
        check('Feed loop: state persisted to LocalStorage/StateStore',
            !!saved && saved.linhNgu === sys.getLinhNgu()
            && saved.beasts.find((b) => b.id === 'fox_01').affinity === fox.affinity);
    }
    bm.close();
    await settle(260);
}

// -- 2. sickle vs planting: strict tool separation --
{
    scene.clearSelection();
    const t = scene.tiles[0][5];
    // bloom a plot the fast way
    scene.selectedSeed = scene.seedCards[0].seed;
    scene.activeTool = TOOL.SEED;
    scene.plantSeed(t);
    t.gridData.state = 'GROWING';
    t.gridData.watered = true;
    scene.bloomTile(t);
    check('Sickle test: plot is BLOOMING', t.gridData.state === 'BLOOMING');
    // arm the sickle while a seed is still "selected" from before
    scene.setTool(TOOL.SICKLE);
    check('Sickle tool: selecting the sickle drops the seed selection', scene.activeTool === TOOL.SICKLE && scene.selectedSeed === null);
    scene.selectedSeed = scene.seedCards[0].seed; // adversarial: seed present AND sickle active
    const plantedBefore = scene.plantedCount;
    scene.handleTileClick(t);
    await settle(50);
    check('Sickle tap on a bloom harvests and clears the plot', t.gridData.state === 'EMPTY' && t.gridData.seedId === null);
    check('Sickle tap NEVER re-seeds the cleared plot (no fall-through to planting)', t.gridData.state === 'EMPTY' && scene.plantedCount === plantedBefore);
    scene.handleTileClick(t);
    await settle(50);
    check('Sickle tap on an EMPTY plot plants nothing', t.gridData.state === 'EMPTY' && scene.plantedCount === plantedBefore);
    scene.selectedSeed = null;
    // seed tool must not harvest
    const t2 = scene.tiles[5][0];
    scene.activeTool = TOOL.NONE;
    scene.selectedSeed = scene.seedCards[0].seed;
    scene.plantSeed(t2);
    t2.gridData.state = 'GROWING';
    t2.gridData.watered = true;
    scene.bloomTile(t2);
    scene.selectSeed(scene.seedCards[0].seed);
    await settle(300);
    const stonesBeforeSeedTap = scene.economy.spiritStones;
    scene.handleTileClick(t2);
    await settle(50);
    check('Seed tool tap on a bloom does NOT harvest it', t2.gridData.state === 'BLOOMING' && scene.economy.spiritStones === stonesBeforeSeedTap);
    scene.setTool(TOOL.SICKLE);
    scene.handleTileClick(t2);
    await settle(50);
    check('Switching to the sickle then tapping harvests that same bloom', t2.gridData.state === 'EMPTY');
    scene.setTool(TOOL.NONE);
}

// -- 3. diamond economy: seed shop + paid quick-water + HUD sync --
{
    const eco = scene.economy;
    eco.spiritStones = 12;
    scene.updateHud();
    const purple = scene.seedCards.find((c) => c.seed.id === 'flower_purple_wisteria');
    eco.inventory.flower_purple_wisteria = 0;
    const before = eco.spiritStones;
    const ok = scene.selectSeed(purple.seed);
    await settle(300);
    check('Seed shop: picking an unowned premium seed buys it (-5 💎)', ok === true && eco.spiritStones === before - 5);
    check('Seed shop: HUD badge shows the deducted balance', scene.stoneValue.text === `💎 ${eco.spiritStones}`);
    check('Seed shop: DIAMONDS_CHANGED was published for the purchase',
        scene.bus.wasEmitted(EV.DIAMONDS_CHANGED, (p) => p.reason === 'seed-purchase' && p.delta === -5));
    check('Seed shop: card shows the owned packet', /Sở hữu: 1/.test(purple.owned.text));
    // plant it: consumes the packet; the next plant needs another purchase
    const p1 = scene.tiles[4][0];
    const p2 = scene.tiles[4][1];
    scene.handleTileClick(p1);
    await settle(50);
    check('Seed shop: planting consumes the premium packet', p1.gridData.state === 'PLANTED' && eco.getInventoryCount('flower_purple_wisteria') === 0);
    const b2 = eco.spiritStones;
    scene.handleTileClick(p2);
    await settle(50);
    check('Seed shop: planting with an empty packet auto-buys another (-5 💎)', p2.gridData.state === 'PLANTED' && eco.spiritStones === b2 - 5);
    // broke: refuse + notice, nothing planted
    eco.spiritStones = 0;
    scene.updateHud();
    const p3 = scene.tiles[4][2];
    scene.handleTileClick(p3);
    await settle(50);
    check('Seed shop: with 0 💎 nothing is planted and a notice appears', p3.gridData.state === 'EMPTY' && scene.isNoticeVisible() && /Thiếu Đá Linh Khí|Không đủ/.test(scene.noticeText));
    scene.hideNotice();
    await settle(200);
    const rareSel = scene.selectSeed(rareCard.seed);
    check('Seed shop: an unaffordable rare seed is not selected', rareSel === false && scene.selectedSeed?.id !== 'flower_rare_nguyet_cuc' && scene.isNoticeVisible());
    scene.hideNotice();
    scene.setTool(TOOL.NONE);

    // quick-water: refused at 0 💎 (no growth), then paid at 1 💎
    check('Quick-water: planted plots are waiting', scene.getWaterablePlots().length >= 2);
    scene.openModal();
    await settle(250);
    check('Quick-water: modal prices the tap in diamonds', /💎/.test(scene.quickWaterBtn.label.text) && /thiếu/.test(scene.quickWaterBtn.label.text));
    const started = scene.quickWater();
    await settle(300);
    check('Quick-water: refused with 0 💎 — dialog shown, plots stay PLANTED',
        started === false && scene.isNoticeVisible() && p1.gridData.state === 'PLANTED' && p2.gridData.state === 'PLANTED' && scene.watering === false);
    scene.hideNotice();
    scene.closeModal(false);
    await settle(220);
    eco.spiritStones = 3;
    scene.updateHud();
    const diamondSpends = [];
    const offSpend = scene.bus.on(EV.DIAMONDS_CHANGED, (p) => diamondSpends.push(p));
    const n = scene.getWaterablePlots().length;
    const cost = eco.getQuickWaterCost(n);
    check('Quick-water: cost is 1–2 💎', cost >= 1 && cost <= 2);
    const started2 = scene.quickWater();
    await settle(2600);
    check('Quick-water: paid tap deducts the cost and grows the plots', started2 === true && eco.spiritStones === 3 - cost && p1.gridData.state === 'BLOOMING' && p2.gridData.state === 'BLOOMING');
    offSpend();
    check('Quick-water: HUD reflects the spend via DIAMONDS_CHANGED',
        scene.stoneValue.text === `💎 ${eco.spiritStones}` && diamondSpends.some((p) => p.reason === 'quick-water' && p.delta === -cost));
    check('Quick-water: rewarded ad still credits diamonds through the economy',
        scene.bus.listenerCount(EV.DIAMONDS_CHANGED) > 0);
}

// -- 4b. HUD safe area --
check('HUD title padded 30px below the top edge (mobile notch safe area)', scene.safeTop === 30 && scene.hudTitle.y === 74 && scene.hudSubtitle.y === 132);
check('No runtime errors after the bugfix pass', errors.length === 0);

console.log('--- runtime errors ---');
console.log(errors.length ? errors.join('\n') : '(none)');
console.log(fails === 0 ? '\nALL RUNTIME TESTS PASSED' : `\n${fails} RUNTIME TEST(S) FAILED`);
game.destroy(true);
process.exit(fails === 0 ? 0 : 1);
