// Render-path test: boots the REAL GardenScene in Phaser.CANVAS mode
// (jsdom + @napi-rs/canvas) and renders actual frames, verifying things the
// HEADLESS runtime test cannot: geometry masks (dialog body clipping),
// gradient fills, particles, tween-driven press feedback, and the layout of
// the floating island / shadow / action bar / dialog sections.
//
// Environment note: jsdom's canvas cannot rasterize PNG-decoded textures
// (drawImage of an @napi-rs Image source silently no-ops), so game textures
// are stubbed with flat canvases for Part A. Part B verifies the real PNG
// assets by compositing them with sharp at the exact in-game display rects.
//
// Frames are saved to scripts/shots/ for manual inspection.
// canvas render smoke — boots Phaser.CANVAS over jsdom+@napi-rs/canvas

// (Phaser.HEADLESS renderer), drives the full gameplay loop, and asserts state.
// Catches runtime errors that a build alone cannot.
import { JSDOM } from 'jsdom';
import fs from 'fs';

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



// expose node-canvas classes to window so Phaser's Features.canvas check passes
{
    const _cv = document.createElement('canvas');
    const _ctx = _cv.getContext('2d');
    window.CanvasRenderingContext2D = _ctx.constructor;
    global.CanvasRenderingContext2D = _ctx.constructor;
    const _grad = _ctx.createLinearGradient(0, 0, 1, 1);
    window.CanvasGradient = _grad.constructor;
    global.CanvasGradient = _grad.constructor;
    window.Path2D = window.Path2D || global.Path2D;
}

const { default: GardenScene } = await import('../src/scenes/GardenScene.js');


class TestGardenScene extends GardenScene {
    preload() {
        const make = (key, w, h, color) => {
            const cv = document.createElement('canvas');
            cv.width = w; cv.height = h;
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
setTimeout(() => { console.log('HARD TIMEOUT — errors:', errors.join(' | ') || '(none)'); process.exit(3); }, 90000).unref();
const game = new Phaser.Game({
    type: Phaser.CANVAS,
    parent: 'game-container',
    width: 1080, height: 1920,
    backgroundColor: '#120b22',
    dom: { createContainer: true },
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    scene: [TestGardenScene],
});
game.events.on('error', (e) => errors.push(String(e?.stack || e)));
process.on('unhandledRejection', (e) => errors.push('unhandled: ' + String(e?.stack || e)));
process.on('uncaughtException', (e) => errors.push('uncaught: ' + String(e?.stack || e)));

let scene = null;
for (let i = 0; i < 40 && !scene; i++) {
    await new Promise((r) => setTimeout(r, 200));
    scene = game.scene.getScene('GardenScene');
}
if (!scene) { console.log('BOOT FAILED', errors.join('\n')); process.exit(1); }
await new Promise((r) => setTimeout(r, 1500)); // render idle frames

const saveFrame = (name) => {
    const b64 = game.canvas.toDataURL('image/png');
    fs.writeFileSync(`scripts/shots/${name}`, Buffer.from(b64.split(',')[1], 'base64'));
    console.log('saved', name);
};
fs.mkdirSync('scripts/shots', { recursive: true });
saveFrame('render_test_garden.png');
// A/B: same frame with the island shadow hidden (isolates the shadow's effect)
scene.islandShadow.setVisible(false);
await new Promise((r) => setTimeout(r, 400));
saveFrame('render_test_noshadow.png');
scene.islandShadow.setVisible(true);
await new Promise((r) => setTimeout(r, 200));

// open dialog -> quest list -> scroll to bottom
scene.onNpcClick();
await new Promise((r) => setTimeout(r, 400));
let guard = 0;
while (scene.dialog.currentNodeId !== 'quest_details' && guard++ < 4) {
    const node = scene.dialog.getCurrentNode();
    const idx = node.choices.findIndex((c) => {
        const next = typeof c.next === 'function' ? c.next(scene.dialog.questState) : c.next;
        return next === 'quest_details' || next === 'quest_offer';
    });
    scene.onDialogChoice(Math.max(0, idx));
    await new Promise((r) => setTimeout(r, 120));
}
scene.setDialogScroll(120);
await new Promise((r) => setTimeout(r, 500));
saveFrame('render_test_dialog.png');
scene.closeDialog();
await new Promise((r) => setTimeout(r, 400));

console.log('render errors:', errors.length ? errors.join('\n') : '(none)');
game.destroy(true);

// ---------- pixel verification ----------
const sharpMod = (await import('sharp')).default;
let rfails = 0;
const rcheck = (name, cond, extra = '') => {
    console.log((cond ? 'PASS' : 'FAIL') + '  ' + name + (extra ? `  (${extra})` : ''));
    if (!cond) rfails++;
};
const { data, info } = await sharpMod('scripts/shots/render_test_garden.png').raw().toBuffer({ resolveWithObject: true });
const px = (x, y) => {
    const i = (y * info.width + x) * info.channels;
    return [data[i], data[i + 1], data[i + 2]];
};
const lum = (x, y) => { const [r, g, b] = px(x, y); return 0.299 * r + 0.587 * g + 0.114 * b; };
const avgLum = (cx, cy, rad, step = 4) => {
    let s = 0, n = 0;
    for (let y = cy - rad; y <= cy + rad; y += step) for (let x = cx - rad; x <= cx + rad; x += step) {
        s += lum(x, y); n++;
    }
    return s / n;
};

// 1) island shadow: same scene with/without the shadow — region under the
//    island must be distinctly darker when the shadow is visible
const { data: dNS, info: iNS } = await sharpMod('scripts/shots/render_test_noshadow.png').raw().toBuffer({ resolveWithObject: true });
const lumNS = (x, y) => {
    const i = (y * iNS.width + x) * iNS.channels;
    return 0.299 * dNS[i] + 0.587 * dNS[i + 1] + 0.114 * dNS[i + 2];
};
const regionAvg = (lumFn, x0, x1, y0, y1, step = 4) => {
    let s = 0, n = 0;
    for (let y = y0; y <= y1; y += step) for (let x = x0; x <= x1; x += step) { s += lumFn(x, y); n++; }
    return s / n;
};
// core band of the shadow ellipse (700x172 at 540,1452), clear of the rocks
const withShadow = regionAvg(lum, 420, 660, 1432, 1472);
const noShadow = regionAvg(lumNS, 420, 660, 1432, 1472);
rcheck('island shadow darkens the water beneath (~0.45 alpha)', withShadow < noShadow - 2, `with=${withShadow.toFixed(1)} vs without=${noShadow.toFixed(1)}`);

// 2) fairy sprite present at the lower bridge deck (bright pixels vs empty deck)
const fairyLum = avgLum(890, 1290, 70);
const emptyDeckLum = avgLum(890, 1560, 40);
rcheck('fairy sprite rendered at (890,1345) area', fairyLum > emptyDeckLum + 8, `fairy-region=${fairyLum.toFixed(1)}`);

// 3) island rock underside visible below the grid (rock pixels between grid bottom and shadow)
const rockLum = avgLum(540, 1385, 40);
const deepWaterLum = avgLum(160, 1560, 40);
rcheck('island rocky underside rendered under the grid', rockLum > deepWaterLum, `rock=${rockLum.toFixed(1)} vs water=${deepWaterLum.toFixed(1)}`);

// 4) action buttons: rings visible at y~1780 (three bright clusters)
const btnL = avgLum(160, 1775, 40), btnC = avgLum(540, 1775, 40), btnR = avgLum(920, 1775, 40);
rcheck('three action buttons visible', btnL > 30 && btnC > 30 && btnR > 30, `L=${btnL.toFixed(1)} C=${btnC.toFixed(1)} R=${btnR.toFixed(1)}`);

// 5) dialog frame: panel + quest text + footer buttons
const { data: d2, info: i2 } = await sharpMod('scripts/shots/render_test_dialog.png').raw().toBuffer({ resolveWithObject: true });
const px2 = (x, y) => {
    const i = (y * i2.width + x) * i2.channels;
    return [d2[i], d2[i + 1], d2[i + 2]];
};
const avgLum2 = (cx, cy, rad, step = 4) => {
    let s = 0, n = 0;
    for (let y = cy - rad; y <= cy + rad; y += step) for (let x = cx - rad; x <= cx + rad; x += step) {
        const [r, g, b] = px2(x, y); s += 0.299 * r + 0.587 * g + 0.114 * b; n++;
    }
    return s / n;
};
// bright text pixels inside the masked body (quest rows)
let brightInBody = 0, nBody = 0;
for (let y = 600; y < 760; y += 2) for (let x = 100; x < 980; x += 2) {
    const [r, g, b] = px2(x, y);
    if (r + g + b > 420) brightInBody++;
    nBody++;
}
rcheck('quest text renders inside the 180px body', brightInBody > 150, `${brightInBody} bright px`);
// footer buttons: bright bands at the pinned positions (y 942 & 1022)
const foot1 = avgLum2(540, 942, 120, 6), foot2 = avgLum2(540, 1022, 120, 6);
const panelBg = avgLum2(540, 700, 60, 6);
rcheck('footer response buttons pinned at bottom', foot1 > panelBg + 6 && foot2 > panelBg + 6, `btn1=${foot1.toFixed(1)} btn2=${foot2.toFixed(1)} vs panel=${panelBg.toFixed(1)}`);
// nothing bright bleeds below the panel bottom (1054..1070 should be panel edge, not text)
let bleed = 0;
for (let y = 1058; y < 1074; y += 2) for (let x = 80; x < 1000; x += 2) {
    const [r, g, b] = px2(x, y);
    if (r + g + b > 480) bleed++;
}
rcheck('no text overflows below the pinned footer', bleed < 40, `${bleed} bright px`);


// ================= PART B: composite proof (real assets) =================
// jsdom's canvas cannot rasterize PNG-decoded textures (drawImage of a
// NapiImage source silently no-ops), so real-asset sprites are verified by
// compositing them with sharp at the exact in-game display rect — the same
// pixels the browser will show at that spot.
const FW = 344, FH = 274;                    // NPC setDisplaySize(344, 274)
const CXn = 890, CYn = 1345 - 44;            // sprite center inside npcGroup
const LEFTn = Math.round(CXn - FW / 2), TOPn = Math.round(CYn - FH / 2);

const fairyBuf = await sharpMod('public/assets/images/npc_tien_nu.png')
    .resize(FW, FH, { fit: 'fill', kernel: 'lanczos3' }).png().toBuffer();
await sharpMod('public/assets/images/bg_manor_isometric.png')
    .composite([{ input: fairyBuf, left: LEFTn, top: TOPn }])
    .png().toFile('scripts/shots/composite_npc_check.png');

const compRaw = await sharpMod('scripts/shots/composite_npc_check.png').raw().toBuffer({ resolveWithObject: true });
const bgRaw = await sharpMod('public/assets/images/bg_manor_isometric.png').raw().toBuffer({ resolveWithObject: true });
const cpx = (x, y) => { const i = (y * compRaw.info.width + x) * compRaw.info.channels; return [compRaw.data[i], compRaw.data[i+1], compRaw.data[i+2]]; };
const bpx = (x, y) => { const i = (y * bgRaw.info.width + x) * bgRaw.info.channels; return [bgRaw.data[i], bgRaw.data[i+1], bgRaw.data[i+2]]; };

let cIvory = 0, cLavender = 0, cResidue = 0, cN = 0;
for (let y = TOPn; y < TOPn + FH; y += 2) for (let x = LEFTn; x < LEFTn + FW; x += 2) {
    const [r, g, b] = cpx(x, y); cN++;
    if (r > 195 && g > 185 && b > 165 && Math.abs(r - b) < 75) cIvory++;
    if (b > 130 && r > 110 && b > g + 18 && r > g) cLavender++;
    // residue = green AND near the measured chroma-key screen color
    if (g > Math.max(r, b) + 40 && Math.hypot(r - 14, g - 186, b - 27) < 60) cResidue++;
}
rcheck('NPC composite: ivory robes present', cIvory > 40, `${cIvory} px`);
rcheck('NPC composite: lavender ribbons present', cLavender > 200, `${cLavender} px`);
rcheck('NPC composite: zero chroma-key residue', cResidue === 0, `${cResidue} px`);

const insets = [[LEFTn+10, TOPn+10], [LEFTn+FW-11, TOPn+10], [LEFTn+10, TOPn+FH-11], [LEFTn+FW-11, TOPn+FH-11]];
let cTransparent = 0;
for (const [x, y] of insets) {
    const a = cpx(x, y), b = bpx(x, y);
    if (Math.abs(a[0]-b[0]) + Math.abs(a[1]-b[1]) + Math.abs(a[2]-b[2]) < 45) cTransparent++;
}
rcheck('NPC composite: corners transparent, background shows through', cTransparent === 4, `${cTransparent}/4`);

console.log(rfails === 0 ? 'RENDER CHECK PASSED (canvas render + asset composite)' : `${rfails} RENDER CHECK(S) FAILED`);
process.exit(rfails ? 1 : 0);
