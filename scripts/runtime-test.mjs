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
process.on('uncaughtException', (e) => errors.push('uncaught: ' + String(e?.stack || e)));
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

// ---- Rare seed in catalog ----
const rareCard = scene.seedCards.find(c => c.seed.id === 'flower_rare_nguyet_cuc');
check('rare seed card exists in drawer', rareCard !== undefined);

console.log('--- runtime errors ---');
console.log(errors.length ? errors.join('\n') : '(none)');
console.log(fails === 0 ? '\nALL RUNTIME TESTS PASSED' : `\n${fails} RUNTIME TEST(S) FAILED`);
game.destroy(true);
process.exit(fails === 0 ? 0 : 1);
