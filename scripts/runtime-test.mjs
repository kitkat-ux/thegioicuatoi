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
// Point both globals at Node's native Performance (jsdom's Performance impl
// recurses into the host's `performance` getter → stack overflow otherwise).
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

// jsdom's Image never loads data URLs, but Phaser's TextureManager waits for 3
// default base64 textures before emitting READY. @napi-rs/canvas's Image does
// decode data URLs, so use it as the Image implementation.
import { Image as NapiImage } from '@napi-rs/canvas';
global.Image = NapiImage;
window.Image = NapiImage;
global.HTMLVideoElement = window.HTMLVideoElement || class HTMLVideoElement {};
window.HTMLVideoElement = global.HTMLVideoElement;

// ---- Phaser expects these ----
let fails = 0;
const check = (name, cond) => {
    console.log((cond ? 'PASS' : 'FAIL') + '  ' + name);
    if (!cond) fails++;
};

// Source build is CJS (module.exports = Phaser) — via ESM interop it lands on
// `default`; this keeps the same module identity as `import Phaser from 'phaser'`
// in the scene, so `instanceof` checks behave.
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
        make('icon_seed_drawer', 192, 192, '#7a4a1e');
        make('icon_water_bucket', 192, 192, '#2f8f6b');
        make('icon_search', 192, 192, '#3a2410');
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

// poll until the scene's create() completes (or timeout)
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

check('scene booted (create ran, no exceptions)', !errors.length);
console.log('errors so far:', errors.length ? errors.join('\n') : '(none)');
check('36 tiles created', scene.tiles.flat().length === 36);
check('textures loaded: bg', scene.textures.exists('bg_manor_isometric'));
check('textures loaded: 4 flowers', ['flower_purple', 'flower_golden', 'flower_cyan', 'flower_emerald'].every((k) => scene.textures.exists(k)));
check('particle emitters exist', scene.petalBursts && scene.sparks && scene.petalRain);

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

scene.searchInput.node.value = '';
scene.onSearchInput('');
await new Promise((r) => setTimeout(r, 100));
visible = scene.seedCards.filter((c) => c.container.visible).length;
check('empty filter shows all 4', visible === 4);

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
check('harmony incremented (2 blooms)', scene.harmony >= 2);
check('bloom sprite created', !!tile22.gridData.bloomSprite);

// ---- Rewarded ad flow ----
const before = scene.harmony;
scene.watchAd();
await new Promise((r) => setTimeout(r, 4500));
check('rewarded ad grants +3 harmony', scene.harmony === before + 3);
check('flowers still blooming after ad', tile22.gridData.state === 'BLOOMING');

console.log('--- runtime errors ---');
console.log(errors.length ? errors.join('\n') : '(none)');
console.log(fails === 0 ? '\nALL RUNTIME TESTS PASSED' : `\n${fails} RUNTIME TEST(S) FAILED`);
game.destroy(true);
process.exit(fails === 0 ? 0 : 1);
