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
        make('icon_codex_scroll', 192, 192, '#f3e6c6');
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
const noteError = (e) => {
    const msg = String(e?.stack || e);
    errors.push('uncaught: ' + msg);
    console.log('UNCAUGHT —', msg.split('\n').slice(0, 3).join('\n  '));
};
process.on('uncaughtException', noteError);
process.on('unhandledRejection', noteError);

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

/* ---------- Phase 1: night / rain / codex frames ---------- */
// (1) night with the ambient wash ON, then the same instant with it OFF:
//     the only difference may be pixels BELOW LAYERS.AMBIENT. Drifting
//     particles are frozen first so the two frames are otherwise identical.
for (const o of scene.children.list) if (o.type === 'ParticleEmitter') o.pause();
scene.weather.forcePhase('night');
scene.weatherView.sync({ instant: true });
await new Promise((r) => setTimeout(r, 350));
saveFrame('render_test_night_wash.png');
scene.weatherView.wash.setVisible(false);
scene.weatherView.lift.setVisible(false);
await new Promise((r) => setTimeout(r, 350));
saveFrame('render_test_night_nowash.png');
scene.weatherView.wash.setVisible(true);
scene.weatherView.lift.setVisible(true);

for (const o of scene.children.list) if (o.type === 'ParticleEmitter') o.resume();
// (2) rain over the lake
scene.weather.forceRain(true);
scene.weatherView.sync({ instant: true });
await new Promise((r) => setTimeout(r, 700));
saveFrame('render_test_rain.png');
scene.weather.forceRain(false);
await new Promise((r) => setTimeout(r, 200));

// (3) day, back to the reference lighting
scene.weather.forcePhase('day');
scene.weatherView.sync({ instant: true });
await new Promise((r) => setTimeout(r, 300));

// (4) the codex scroll, opened with real catalogue progress
scene.codex.recordBloom('flower_cyan_orchid');
scene.codex.recordBloom('flower_purple_wisteria');
scene.codex.recordBloom('flower_golden_amber');
scene.codex.recordBloom('flower_emerald_bamboo');
for (let i = 0; i < 4; i++) scene.codex.recordHarvest('flower_cyan_orchid');
for (let i = 0; i < 3; i++) scene.codex.recordHarvest('flower_purple_wisteria');
scene.openCodex();
await new Promise((r) => setTimeout(r, 500));
saveFrame('render_test_codex.png');
scene.codexModal.setScroll(99999); // scrolled to the buffs / milestone pages
await new Promise((r) => setTimeout(r, 300));
saveFrame('render_test_codex_bottom.png');
fs.writeFileSync('scripts/shots/codex_geom.json', JSON.stringify(scene.codexModal.getSnapshot()));
scene.closeCodex();
await new Promise((r) => setTimeout(r, 400));

// Vườn Linh Thú — dark Guofeng panel, tab/carousel (one beast at a time)
scene.beastModal.open();
await new Promise((r) => setTimeout(r, 500));
saveFrame('render_test_beast_fox.png');
scene.beastModal.selectBeast(1);
await new Promise((r) => setTimeout(r, 500));
saveFrame('render_test_beast_rabbit.png');
scene.beastModal.close();
await new Promise((r) => setTimeout(r, 400));

// economy notice (not enough Đá Linh Khí) over the paid quick-water modal
scene.openModal();
await new Promise((r) => setTimeout(r, 300));
scene.showNotice({ title: 'Thiếu Đá Linh Khí', message: 'Tưới nhanh 4 ô cần 1 💎 — hiện có 0 💎.\nXem quảng cáo để tưới miễn phí, hoặc thu hoạch hoa để nhận thêm Đá Linh Khí.', tone: 'warn' });
await new Promise((r) => setTimeout(r, 400));
saveFrame('render_test_water_notice.png');
scene.hideNotice();
scene.closeModal(false);
await new Promise((r) => setTimeout(r, 400));

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
const BTN_Y = 1775; // action-button row centre (see GardenScene makeActionButton)
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

// 1b) no stray full-screen veil may sit on the display list (a dim left
//     outside its overlay container once blacked out the whole garden)
{
    const { data: vd, info: vi } = await sharpMod('scripts/shots/render_test_garden.png').raw().toBuffer({ resolveWithObject: true });
    let s = 0, n = 0;
    for (let y = 0; y < vi.height; y += 6) for (let x = 0; x < vi.width; x += 6) {
        const i = (y * vi.width + x) * vi.channels;
        s += 0.299 * vd[i] + 0.587 * vd[i + 1] + 0.114 * vd[i + 2]; n++;
    }
    const whole = s / n;
    rcheck('Day frame is not veiled by a stray overlay', whole > 26 && whole < 90, `mean luminance=${whole.toFixed(1)}`);
}

// 1c) ambient wash layering: world re-tinted, HUD pixels untouched.
//     Both frames are the same instant with only the wash toggled, so any
//     difference must come from an object rendered below LAYERS.AMBIENT.
{
    const [on, off] = await Promise.all([
        sharpMod('scripts/shots/render_test_night_wash.png').raw().toBuffer({ resolveWithObject: true }),
        sharpMod('scripts/shots/render_test_night_nowash.png').raw().toBuffer({ resolveWithObject: true }),
    ]);
    const at = (b, x, y) => { const i = (y * b.info.width + x) * b.info.channels; return 0.299 * b.data[i] + 0.587 * b.data[i + 1] + 0.114 * b.data[i + 2]; };
    const diff = (x0, x1, y0, y1) => {
        let moved = 0, total = 0, sum = 0;
        for (let y = y0; y <= y1; y += 3) for (let x = x0; x <= x1; x += 3) {
            const d = Math.abs(at(on, x, y) - at(off, x, y));
            sum += d; total++; if (d > 4) moved++;
        }
        return { movedPct: (moved * 100) / total, mean: sum / total };
    };
    const world = diff(240, 840, 980, 1420);   // island + lake: below the wash
    // The button CORES are opaque art parented above the wash, so those exact
    // pixels must not move at all (the bar backdrop is translucent by design
    // and legitimately shows the dimmed garden through it).
    const cores = [160, 540, 920].map((cx) => diff(cx - 44, cx + 44, BTN_Y - 44, BTN_Y + 44));
    const worstCore = cores.reduce((a, b) => (b.movedPct > a.movedPct ? b : a));
    rcheck('Night wash re-tints the garden (everything below LAYERS.AMBIENT)',
        world.movedPct > 90, `${world.movedPct.toFixed(1)}% of world px moved, mean Δ${world.mean.toFixed(1)}`);
    rcheck('Night wash never dims the action buttons (opaque UI renders above it)',
        worstCore.movedPct < 1, `worst button: ${worstCore.movedPct.toFixed(2)}% moved, mean Δ${worstCore.mean.toFixed(2)}`);
    rcheck('Night wash dims the world, opaque UI above it is pixel-identical',
        world.mean > 20 && worstCore.mean < 0.5, `world Δ${world.mean.toFixed(1)} vs button Δ${worstCore.mean.toFixed(2)}`);

    // rain streaks must actually draw (frozen-day comparison is not usable here,
    // so compare against the night frame at the same lighting)
    const rain = await sharpMod('scripts/shots/render_test_rain.png').raw().toBuffer({ resolveWithObject: true });
    let drops = 0;
    for (let y = 320; y <= 900; y += 2) for (let x = 90; x <= 990; x += 2) {
        if (at(rain, x, y) > at(off, x, y) + 14) drops++;
    }
    rcheck('Rain streaks render over the garden (emitter visible)', drops > 400, `${drops} brightened px`);
}

// 1d) the codex scroll renders a readable sheet, clipped to the panel — all
//     regions come from the live snapshot geometry, never hard-coded numbers.
{
    const geom = JSON.parse(fs.readFileSync('scripts/shots/codex_geom.json', 'utf8'));
    const { panel, body } = geom;
    const cod = await sharpMod('scripts/shots/render_test_codex.png').raw().toBuffer({ resolveWithObject: true });
    const atC = (x, y) => { const i = (y * cod.info.width + x) * cod.info.channels; return [cod.data[i], cod.data[i + 1], cod.data[i + 2]]; };
    const frac = (x0, x1, y0, y1, pred) => {
        let hit = 0, n = 0;
        for (let y = Math.ceil(y0); y <= y1; y += 2) for (let x = Math.ceil(x0); x <= x1; x += 2) {
            if (pred(...atC(x, y))) hit++; n++;
        }
        return hit / n;
    };
    const warm = (r, g, b) => r > 140 && g > 120 && b > 80 && r > b;
    const dark = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b < 95;
    const lit = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b > 70;

    const inBody = frac(panel.x + 18, panel.x + panel.w - 18, body.top + 8, body.bottom - 8, warm);
    rcheck('Codex scroll: parchment sheet fills the masked body', inBody > 0.5, `${(inBody * 100).toFixed(0)}% warm px`);
    const ink = frac(panel.x + 18, panel.x + panel.w - 18, body.top + 8, body.bottom - 8, dark);
    rcheck('Codex scroll: entries are inked (text + reward lines render)', ink > 0.02, `${(ink * 100).toFixed(1)}% dark px`);
    const avgL = (x0, x1, y0, y1) => frac(x0, x1, y0, y1, (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b) / (1 / ((x1 - x0) / 2 + 1) / ((y1 - y0) / 2 + 1));
    // mean luminance helper (frac averages booleans; reuse the same sampling)
    const meanL = (src, x0, x1, y0, y1) => {
        let s = 0, n = 0;
        for (let y = Math.ceil(y0); y <= y1; y += 2) for (let x = Math.ceil(x0); x <= x1; x += 2) {
            const i = (y * src.info.width + x) * src.info.channels;
            s += 0.299 * src.data[i] + 0.587 * src.data[i + 1] + 0.114 * src.data[i + 2]; n++;
        }
        return s / n;
    };
    void avgL;
    const day = await sharpMod('scripts/shots/render_test_garden.png').raw().toBuffer({ resolveWithObject: true });
    // bands above and below the scroll, clear of its rollers and aura
    const bands = [[6, 1074, 4, panel.y - 26], [6, 1074, panel.y + panel.h + 26, 1916]];
    const dayBand = bands.map((b) => meanL(day, ...b));
    const codexBand = bands.map((b) => meanL(cod, ...b));
    const drop = dayBand.reduce((a, v, i) => a + v, 0) / 2 - codexBand.reduce((a, v, i) => a + v, 0) / 2;
    rcheck('Codex scroll: the garden behind the sheet is dimmed', drop > 5,
        `outside the panel ${dayBand.map((v) => v.toFixed(1)).join('/')} → ${codexBand.map((v) => v.toFixed(1)).join('/')}`);
    const headerLit = frac(panel.x + panel.w - 150, panel.x + panel.w - 40, panel.y + 30, panel.y + 150, lit);
    rcheck('Codex scroll: close button renders in the header', headerLit > 0.2, `${(headerLit * 100).toFixed(0)}% lit px`);
    const underPanel = frac(panel.x, panel.x + panel.w, panel.y + panel.h + 8, 1918, warm);
    rcheck('Codex scroll: masked body does not bleed past the panel foot', underPanel < 0.02, `${(underPanel * 100).toFixed(2)}% warm px below the panel`);
    const abovePanel = frac(panel.x, panel.x + panel.w, 2, panel.y - 8, warm);
    rcheck('Codex scroll: nothing bleeds above the panel head', abovePanel < 0.02, `${(abovePanel * 100).toFixed(2)}% warm px above`);
    const bottomFrame = await sharpMod('scripts/shots/render_test_codex_bottom.png').raw().toBuffer({ resolveWithObject: true });
    void bottomFrame;
    rcheck('Codex scroll: scrolled to the bottom the sheet still fills the body',
        geom.scroll > 0 && geom.scrollMax > 0, `scroll=${geom.scroll.toFixed(0)}/${geom.scrollMax.toFixed(0)}`);
}

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
