// Processes AI-generated raw assets into game-ready PNGs.
//
// Two keying strategies:
//  1. removeGreen  — chroma-key a flat pure-green screen (best quality: the
//     subject never contains the key color, so no detail is lost) + despill.
//  2. removeBlack  — removes near-black studio backgrounds (alpha from max
//     channel) and unpremultiplies RGB so edges keep their true color.
//
// After keying: RGB is zeroed where alpha is 0, transparent margins are
// trimmed, and sizes are normalized. Every output is a clean 4-channel RGBA
// PNG with true alpha transparency — never a faux checkerboard background.
//
// Sources live in raw_assets/ (gitignored); outputs go to public/assets/images/.
// Tasks whose raw source is missing are SKIPPED (with a notice) so the
// pipeline stays runnable with a partial raw set.
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

const RAW = 'raw_assets';
const OUT = 'public/assets/images';

/* ---------------- green chroma-key ---------------- */

/**
 * Key out a flat green screen. `tHi` and `tLo` are "greenness" thresholds
 * where greenness = g - max(r, b). Pixels at/above tHi become fully
 * transparent, at/below tLo stay opaque, in between get proportional alpha
 * (anti-aliased edges). Surviving pixels are despilled (green pulled toward
 * max(r,b)) to remove the green fringe.
 */
async function removeGreen(input, { tLo = 60, tHi = 110, keepTint = 0.15, scrubDist = 55 } = {}) {
    const { data, info } = await sharp(input)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });

    // measure the actual screen color from the four corners
    const corners = [
        [2, 2], [info.width - 3, 2], [2, info.height - 3], [info.width - 3, info.height - 3],
    ];
    let sr = 0, sg = 0, sb = 0;
    for (const [x, y] of corners) {
        const i = (y * info.width + x) * 4;
        sr += data[i]; sg += data[i + 1]; sb += data[i + 2];
    }
    sr /= 4; sg /= 4; sb /= 4;

    const px = Buffer.from(data);
    let keyed = 0, partial = 0, kept = 0, spill = 0, scrubbed = 0;
    for (let i = 0; i < px.length; i += 4) {
        const r = px[i], g = px[i + 1], b = px[i + 2];
        const d = g - Math.max(r, b);
        let a;
        if (d >= tHi) a = 0;
        else if (d <= tLo) a = 255;
        else a = Math.round(255 * (1 - (d - tLo) / (tHi - tLo)));
        a = Math.round((a * px[i + 3]) / 255); // respect existing alpha if any

        // scrub: kill stray survivors that are still the screen color
        if (a > 0 && Math.hypot(r - sr, g - sg, b - sb) < scrubDist) {
            a = 0; scrubbed++;
        }

        if (a === 0) {
            px[i] = px[i + 1] = px[i + 2] = 0; // clean RGB so trim() sees exact bg
            keyed++;
        } else {
            if (a < 255) partial++;
            else kept++;
            if (d > 0) { // despill: remove green cast on kept pixels
                const mx = Math.max(r, b);
                if (g > mx) {
                    px[i + 1] = mx + Math.round((g - mx) * keepTint);
                    spill++;
                }
            }
        }
        px[i + 3] = a;
    }
    const total = info.width * info.height;
    console.log(`    keyed ${(keyed * 100 / total).toFixed(1)}% | opaque ${(kept * 100 / total).toFixed(1)}% | partial ${(partial * 100 / total).toFixed(1)}% | despilled ${spill} | scrubbed ${scrubbed}`);
    return sharp(px, { raw: { width: info.width, height: info.height, channels: 4 } });
}

/* ---------------- near-black key ---------------- */

async function removeBlack(input, aLo = 46, aHi = 150) {
    const { data, info } = await sharp(input)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });

    const px = Buffer.alloc(info.width * info.height * 4);
    for (let i = 0; i < data.length; i += 4) {
        const r = data[i], g = data[i + 1], b = data[i + 2];
        const mx = Math.max(r, g, b);
        let a;
        if (mx <= aLo) a = 0;
        else if (mx >= aHi) a = 255;
        else a = Math.round(((mx - aLo) / (aHi - aLo)) * 255);
        const k = a / 255;
        px[i] = a === 0 ? 0 : Math.min(255, Math.round(r / (k || 1)));
        px[i + 1] = a === 0 ? 0 : Math.min(255, Math.round(g / (k || 1)));
        px[i + 2] = a === 0 ? 0 : Math.min(255, Math.round(b / (k || 1)));
        px[i + 3] = a;
    }
    return sharp(px, { raw: { width: info.width, height: info.height, channels: 4 } });
}

/* ---------------- helpers ---------------- */

/** Measure the flat green screen color of a raw asset from its corners. */
async function measureScreenColor(src) {
    const { data, info } = await sharp(src).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const corners = [
        [2, 2], [info.width - 3, 2], [2, info.height - 3], [info.width - 3, info.height - 3],
    ];
    let r = 0, g = 0, b = 0;
    for (const [x, y] of corners) {
        const i = (y * info.width + x) * 4;
        r += data[i]; g += data[i + 1]; b += data[i + 2];
    }
    return { r: r / 4, g: g / 4, b: b / 4 };
}

/**
 * Post-resize cleanup: bicubic interpolation overshoot can re-introduce
 * near-invisible (alpha 1..9) screen-colored specks along cut-out edges.
 * Zero out alpha < 10 and any surviving screen-color pixels.
 */
async function finalClean(img, sc, { minAlpha = 10, scrubDist = 60 } = {}) {
    const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
    const px = Buffer.from(data);
    for (let i = 0; i < px.length; i += 4) {
        const a = px[i + 3];
        if (a < minAlpha) {
            px[i] = px[i + 1] = px[i + 2] = px[i + 3] = 0;
            continue;
        }
        if (sc && Math.hypot(px[i] - sc.r, px[i + 1] - sc.g, px[i + 2] - sc.b) < scrubDist) {
            px[i] = px[i + 1] = px[i + 2] = px[i + 3] = 0;
        }
    }
    return sharp(px, { raw: { width: info.width, height: info.height, channels: 4 } });
}

async function trimToBuffer(img) {
    const t = await img
        .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .toBuffer({ resolveWithObject: true });
    return sharp(t.data, { raw: { width: t.info.width, height: t.info.height, channels: 4 } });
}

async function writePng(img, relOut) {
    const dst = path.join(OUT, relOut);
    await img.png({ compressionLevel: 9 }).toFile(dst);
    const m = await sharp(dst).metadata();
    console.log(`OK  ${relOut} -> ${m.width}x${m.height} (${(fs.statSync(dst).size / 1024).toFixed(0)} KB)`);
    return dst;
}

function rawExists(relIn) {
    const p = path.join(RAW, relIn);
    if (fs.existsSync(p)) return p;
    console.log(`SKIP ${relIn} (raw source not present)`);
    return null;
}

/** Green-key a raw asset -> trim -> optional resize (fit inside) -> write. */
async function makeGreenKeySprite(relIn, relOut, { size = null } = {}) {
    const src = rawExists(relIn);
    if (!src) return;
    console.log(`>> ${relIn} (green-key)`);
    let img = await removeGreen(src);
    img = await trimToBuffer(img);
    if (size) {
        img = img.resize(size, size, { fit: 'inside', withoutEnlargement: false, background: { r: 0, g: 0, b: 0, alpha: 0 } });
    }
    img = await finalClean(img, await measureScreenColor(src));
    await writePng(img, relOut);
}

/** Black-key a raw asset -> trim -> optional resize (fit inside) -> write. */
async function makeBlackKeySprite(relIn, relOut, { size = null, keyLo = 46, keyHi = 150 } = {}) {
    const src = rawExists(relIn);
    if (!src) return;
    console.log(`>> ${relIn} (black-key ${keyLo}/${keyHi})`);
    let img = await removeBlack(src, keyLo, keyHi);
    img = await trimToBuffer(img);
    if (size) {
        img = img.resize(size, size, { fit: 'inside', withoutEnlargement: false, background: { r: 0, g: 0, b: 0, alpha: 0 } });
    }
    await writePng(img, relOut);
}

/* ---------------- tasks ---------------- */

fs.mkdirSync(OUT, { recursive: true });

// --- NPC: Tiên Nữ Hoa Giang — flying fairy, green-keyed to a clean 4-channel
// PNG (true alpha; NO faux checkerboard). Also emits a square portrait crop
// (head + torso) for the dialog header.
async function makeNpc() {
    const src = rawExists('npc_fairy_greenscreen.png');
    if (!src) return;
    console.log('>> npc_fairy_greenscreen.png (green-key)');
    const sc = await measureScreenColor(src);
    let img = await removeGreen(src);
    img = await trimToBuffer(img);
    // keep ~2.4x the in-game display size (crisp on high-DPI) without bloat
    img = img.resize(720, 576, { fit: 'inside', withoutEnlargement: true, background: { r: 0, g: 0, b: 0, alpha: 0 } });
    img = await finalClean(img, sc);
    const full = await writePng(img, 'npc_tien_nu.png');

    // square portrait crop from the top of the trimmed sprite
    const m = await sharp(full).metadata();
    const side = Math.min(m.width, m.height);
    const left = Math.floor((m.width - side) / 2);
    let portrait = sharp(full)
        .extract({ left, top: 0, width: side, height: side })
        .resize(256, 256, { fit: 'inside', background: { r: 0, g: 0, b: 0, alpha: 0 } });
    portrait = await finalClean(portrait, sc);
    await writePng(portrait, 'npc_tien_nu_portrait.png');
}

// --- Legacy black-key sprites (kept for reproducibility) ---
async function makeBackground() {
    const src = rawExists('bg_manor_isometric.png');
    if (!src) return;
    await sharp(src)
        .resize(1080, 1920, { fit: 'cover', position: 'centre' })
        .png({ palette: true, quality: 90, compressionLevel: 9 })
        .toFile(path.join(OUT, 'bg_manor_isometric.png'));
    console.log('OK  bg_manor_isometric.png -> 1080x1920');
}

async function makeSoilTile() {
    const src = rawExists('tile_soil.png');
    if (!src) return;
    let img = await removeBlack(src, 10, 30);
    img = await trimToBuffer(img);
    await writePng(img.resize(128, 64, { fit: 'fill' }), 'tile_soil.png');
}

await makeBackground();
await makeSoilTile();
await makeBlackKeySprite('flower_purple.png', 'flower_purple.png', { size: 256, keyLo: 56, keyHi: 160 });
await makeBlackKeySprite('flower_golden.png', 'flower_golden.png', { size: 256, keyLo: 56, keyHi: 160 });
await makeBlackKeySprite('flower_cyan.png', 'flower_cyan.png', { size: 256, keyLo: 56, keyHi: 160 });
await makeBlackKeySprite('flower_emerald.png', 'flower_emerald.png', { size: 256, keyLo: 56, keyHi: 160 });
await makeBlackKeySprite('icon_seed_drawer.png', 'icon_seed_drawer.png', { size: 192, keyLo: 56, keyHi: 160 });
await makeBlackKeySprite('icon_water_bucket.png', 'icon_water_bucket.png', { size: 192, keyLo: 56, keyHi: 160 });
await makeBlackKeySprite('icon_search.png', 'icon_search.png', { size: 192, keyLo: 56, keyHi: 160 });
// New celestial assets (green-keyed):
await makeNpc();
await makeGreenKeySprite('flower_rare_greenscreen.png', 'flower_rare.png', { size: 256 });
await makeGreenKeySprite('icon_sickle_greenscreen.png', 'icon_sickle.png', { size: 192 });
// Re-keyed from the previous studio-black versions (raw copies of the old files):
await makeBlackKeySprite('icon_spirit_stone.png', 'icon_spirit_stone.png', { size: 128 });
await makeBlackKeySprite('bridge_pavilion.png', 'bridge_pavilion.png', { keyLo: 46, keyHi: 150 });

/* ---------------- verification ---------------- */
// Every sprite must be a 4-channel RGBA PNG with true transparency (the
// full-bleed background is the only exempt file). For the green-keyed
// sprites we additionally verify that no un-keyed screen-color pixels
// survive (distance to the measured screen color, alpha > 0).
const SCREEN_KEYED = ['npc_tien_nu.png', 'npc_tien_nu_portrait.png', 'flower_rare.png', 'icon_sickle.png'];

console.log('\n--- asset integrity check ---');
let bad = 0;
const screenColors = {};
for (const f of SCREEN_KEYED) {
    const candidate = path.join(RAW, f.replace(/(\.png)$/, '_greenscreen$1'));
    const src = fs.existsSync(candidate)
        ? candidate
        : path.join(RAW, 'npc_fairy_greenscreen.png'); // npc + portrait share one source
    screenColors[f] = await measureScreenColor(src);
}

for (const f of fs.readdirSync(OUT).sort()) {
    if (!f.endsWith('.png')) continue;
    const p = path.join(OUT, f);
    const { data, info } = await sharp(p).raw().toBuffer({ resolveWithObject: true });
    const ch = info.channels;
    const total = info.width * info.height;
    let opaque = 0, transp = 0, semi = 0, residue = 0;
    const sc = screenColors[f];
    for (let i = 0; i < total; i++) {
        const a = ch === 4 ? data[i * 4 + 3] : 255;
        if (a === 255) opaque++;
        else if (a === 0) transp++;
        else semi++;
        if (ch === 4 && a > 0 && sc) {
            const dr = data[i * 4] - sc.r, dg = data[i * 4 + 1] - sc.g, db = data[i * 4 + 2] - sc.b;
            if (Math.sqrt(dr * dr + dg * dg + db * db) < 60) residue++;
        }
    }
    const isBackground = f === 'bg_manor_isometric.png';
    const ok = (isBackground || ch === 4) && (isBackground || transp + semi > 0) && residue === 0;
    if (!ok) bad++;
    console.log(
        `${ok ? 'OK ' : 'BAD'} ${f.padEnd(26)} ${String(info.width).padStart(4)}x${String(info.height).padStart(4)} ch=${ch}` +
        `  opaque=${(opaque * 100 / total).toFixed(0)}% semi=${(semi * 100 / total).toFixed(0)}% transparent=${(transp * 100 / total).toFixed(0)}%` +
        (residue ? `  SCREEN-RESIDUE=${residue}` : '')
    );
}
if (bad) {
    console.error(`\n${bad} asset(s) FAILED the integrity check`);
    process.exit(1);
}
console.log('all assets passed: 4-channel RGBA, true transparency, no keyed-screen residue');
