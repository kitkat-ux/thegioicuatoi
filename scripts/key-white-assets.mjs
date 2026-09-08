// HOTFIX asset pipeline — keys the white/gray-studio raw plates that shipped
// directly in public/assets (PR #17 dropped them unkeyed; raw_assets/ is
// gitignored and absent, so the shipped files are the source of truth).
//
// Why edge-connected keying (same reasoning as key-frost-assets.mjs, mirrored
// for a WHITE/GRAY screen): the celestial/flame/nether guardians carry
// near-white ivories INSIDE the subject, and the sacred halo fades out into
// a light gray vignette, so a global "bright + low saturation → transparent"
// ramp would punch holes through the art. Background whiteness, however, is
// always CONNECTED TO THE CANVAS BORDER, so:
//
//   1. per-pixel soft key level from "whiteness" = max(r,g,b) - 2*saturation
//      (brightness penalized by chroma: the flat screen keys, saturated gold
//      rings and colored robes never do)
//   2. flood fill from every border pixel across pixels that are not fully
//      opaque — the set reached from the border IS the background
//   3. only background pixels take the ramped alpha; interior brights stay
//      fully opaque. Semi-transparent pixels are unpremultiplied against
//      WHITE so edge colors keep their true hue instead of fringing.
//
// After keying: RGB zeroed where alpha is 0, transparent margins trimmed,
// output fitted inside its 07_VISUAL_ASSET_CATALOG budget. Realm backgrounds
// are full-bleed plates — they are not keyed, only normalized to 1080x1920.
//
// Idempotent: a file that already carries true transparency is skipped (its
// zeroed RGB would read as "art" to the whiteness ramp and re-opaque it).
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

/** True when the file already has meaningful alpha transparency (already keyed). */
async function alreadyKeyed(file) {
    const { data, info } = await sharp(file)
        .resize(64, 64, { fit: 'inside' })
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
    let clear = 0;
    const n = info.width * info.height;
    for (let i = 0; i < n; i++) if (data[i * 4 + 3] < 8) clear++;
    return clear / n > 0.02;
}

/**
 * Edge-connected WHITE key → unpremultiply vs white → trim → fit → write.
 * @param {string} src                    source image (absolute/relative path)
 * @param {string} out                    output path
 * @param {{maxEdge?:number, width?:number, square?:number, wLo?:number, wHi?:number}} [opts]
 */
async function keyEdgeConnectedWhite(src, out, { maxEdge = null, width = null, square = null, wLo = 200, wHi = 226 } = {}) {
    if (!fs.existsSync(src)) {
        console.log(`SKIP ${src} (not present — already processed?)`);
        return false;
    }
    if (await alreadyKeyed(src)) {
        console.log(`SKIP ${src} (already keyed — true alpha present)`);
        return false;
    }
    console.log(`>> ${src} (edge-connected white-key ${wLo}/${wHi})`);
    const { data, info } = await sharp(src).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const w = info.width;
    const h = info.height;
    const n = w * h;

    /* ---- pass 1: per-pixel soft key level from whiteness ---- */
    const level = new Uint8Array(n); // 0..255 key alpha before connectivity
    for (let i = 0; i < n; i++) {
        const o = i * 4;
        const r = data[o], g = data[o + 1], b = data[o + 2];
        const mx = Math.max(r, g, b);
        const whiteness = mx - 2 * (mx - Math.min(r, g, b));
        level[i] = whiteness >= wHi ? 0 : whiteness <= wLo ? 255 : Math.round((255 * (wHi - whiteness)) / (wHi - wLo));
    }

    /* ---- pass 2: flood fill the background from the canvas borders ---- */
    const background = new Uint8Array(n);
    const queue = new Int32Array(n);
    let qh = 0;
    let qt = 0;
    const push = (i) => {
        if (!background[i] && level[i] < 255) {
            background[i] = 1;
            queue[qt++] = i;
        }
    };
    for (let x = 0; x < w; x++) {
        push(x);
        push((h - 1) * w + x);
    }
    for (let y = 0; y < h; y++) {
        push(y * w);
        push(y * w + w - 1);
    }
    while (qh < qt) {
        const i = queue[qh++];
        const x = i % w;
        const y = (i / w) | 0;
        if (x > 0) push(i - 1);
        if (x < w - 1) push(i + 1);
        if (y > 0) push(i - w);
        if (y < h - 1) push(i + w);
    }

    /* ---- pass 3: compose the keyed RGBA buffer ---- */
    const px = Buffer.alloc(n * 4);
    let keyed = 0;
    let partial = 0;
    let kept = 0;
    for (let i = 0; i < n; i++) {
        const o = i * 4;
        if (!background[i]) {
            px[o] = data[o];
            px[o + 1] = data[o + 1];
            px[o + 2] = data[o + 2];
            px[o + 3] = 255;
            kept++;
            continue;
        }
        const a = level[i];
        px[o + 3] = a;
        if (a === 0) {
            px[o] = px[o + 1] = px[o + 2] = 0; // clean RGB so trim() sees exact bg
        } else if (a >= 24) {
            // unpremultiply against white so edges/glow keep their true hue
            const k = a / 255;
            px[o] = Math.max(0, Math.min(255, Math.round((data[o] - 255 * (1 - k)) / k)));
            px[o + 1] = Math.max(0, Math.min(255, Math.round((data[o + 1] - 255 * (1 - k)) / k)));
            px[o + 2] = Math.max(0, Math.min(255, Math.round((data[o + 2] - 255 * (1 - k)) / k)));
        } else {
            // too close to the screen to unpremultiply stably — invisible anyway
            px[o] = data[o];
            px[o + 1] = data[o + 1];
            px[o + 2] = data[o + 2];
        }
        keyed++;
        if (a > 0 && a < 255) partial++;
    }
    console.log(`    keyed ${(keyed * 100 / n).toFixed(1)}% | opaque ${(kept * 100 / n).toFixed(1)}% | partial ${((partial * 100) / n).toFixed(1)}%`);

    let img = sharp(px, { raw: { width: w, height: h, channels: 4 } });

    /* ---- trim transparent margins ---- */
    const t = await img
        .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .toBuffer({ resolveWithObject: true });
    img = sharp(t.data, { raw: { width: t.info.width, height: t.info.height, channels: 4 } });

    /* ---- fit inside the catalog size budget ---- */
    if (square) {
        img = img.resize(square, square, { fit: 'fill', background: { r: 0, g: 0, b: 0, alpha: 0 } });
    } else if (width) {
        img = img.resize({ width, background: { r: 0, g: 0, b: 0, alpha: 0 } });
    } else if (maxEdge) {
        img = img.resize(maxEdge, maxEdge, { fit: 'inside', withoutEnlargement: true, background: { r: 0, g: 0, b: 0, alpha: 0 } });
    }

    fs.mkdirSync(path.dirname(out), { recursive: true });
    await img.png({ compressionLevel: 9 }).toFile(out);
    const m = await sharp(out).metadata();
    console.log(`OK  ${path.relative(process.cwd(), out)} -> ${m.width}x${m.height} ch=${m.channels} (${(fs.statSync(out).size / 1024).toFixed(0)} KB)`);
    return true;
}

/** Normalize a full-bleed realm background to the 1080x1920 stage plate. */
async function coverRealmBackground(src, out) {
    if (!fs.existsSync(src)) {
        console.log(`SKIP ${src} (not present)`);
        return false;
    }
    const m = await sharp(src).metadata();
    if (m.width === 1080 && m.height === 1920) {
        console.log(`SKIP ${src} (already 1080x1920)`);
        return false;
    }
    // buffer first — sharp refuses to read and write the same path in one pass
    const buf = await sharp(src)
        .resize(1080, 1920, { fit: 'cover', position: 'centre' })
        .png({ compressionLevel: 9 })
        .toBuffer();
    fs.writeFileSync(out, buf);
    console.log(`OK  ${path.relative(process.cwd(), out)} -> 1080x1920 (${(fs.statSync(out).size / 1024).toFixed(0)} KB)`);
    return true;
}

/**
 * Normalize a 128px-wide realm soil tile to the game's iso geometry.
 * GardenScene pins every plot with setOrigin(0.5, 32 / tile.height): the
 * diamond's EQUATOR (widest row of the top face) must sit exactly 32px from
 * the top, i.e. the top face must be the 2:1 diamond 128x64 — same as
 * tile_frost_soil. AI plates draw the diamond taller than 2:1, so the whole
 * tile is squashed vertically until the measured equator lands on 32.
 */
async function fitIsoFace(file) {
    const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
    const rowWidth = (y) => {
        let c = 0;
        for (let x = 0; x < info.width; x++) if (data[(y * info.width + x) * 4 + 3] > 40) c++;
        return c;
    };
    let equator = -1;
    for (let y = 0; y < info.height; y++) {
        if (rowWidth(y) >= info.width - 2) { equator = y; break; }
    }
    if (equator <= 32 || equator < 0) {
        console.log(`    iso face already 2:1 (equator y=${equator}) — no squash`);
        return;
    }
    const targetH = Math.max(64, Math.round((info.height * 32) / equator));
    const buf = await sharp(file)
        .resize(info.width, targetH, { fit: 'fill', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png({ compressionLevel: 9 })
        .toBuffer();
    fs.writeFileSync(file, buf);
    console.log(`    iso face squashed: equator y=${equator} → 32 (${info.height}px → ${targetH}px tall)`);
}

/* ---------------- tasks ---------------- */

// Realm guardian NPCs — white-studio plates keyed to 720px max edge
// (same budget as npc_tien_nu / npc_frost_fairy). Screens are a flat white
// with a soft gray drop shadow around the subject: the 200/226 ramp keys
// both, while the guardians' bright ivories stay opaque (border-protected).
await keyEdgeConnectedWhite('public/assets/npc/npc_celestial.png', 'public/assets/npc/npc_celestial.png', { maxEdge: 720 });
await keyEdgeConnectedWhite('public/assets/npc/npc_flame.png', 'public/assets/npc/npc_flame.png', { maxEdge: 720 });
await keyEdgeConnectedWhite('public/assets/npc/npc_nether.png', 'public/assets/npc/npc_nether.png', { maxEdge: 720 });
await keyEdgeConnectedWhite('public/assets/npc/npc_frost_hd.png', 'public/assets/npc/npc_frost_hd.png', { maxEdge: 720 });

// Realm soil tiles — noisy gray-screen plates keyed + fitted to the 128px
// iso footprint (same budget as tile_frost_soil). The screen dithers between
// white and light gray (whiteness ~230..255), all above the 226 key line.
// fitIsoFace then squashes the diamond to the 2:1 face the plot origin pin
// (setOrigin(0.5, 32 / height)) expects.
await keyEdgeConnectedWhite('public/assets/realms/tile_flame_soil.png', 'public/assets/realms/tile_flame_soil.png', { width: 128 });
await fitIsoFace('public/assets/realms/tile_flame_soil.png');
await keyEdgeConnectedWhite('public/assets/realms/tile_nether_soil.png', 'public/assets/realms/tile_nether_soil.png', { width: 128 });
await fitIsoFace('public/assets/realms/tile_nether_soil.png');

// Sacred halo — the ornate golden halo dropped in public/assets/ui/ (an icon
// dir with a 192px budget). Keyed from its light-gray vignette screen — the
// looser 150/172 ramp follows the vignette gradient — and shipped as a proper
// 256px keyed sprite in public/assets/images/ where GardenScene preloads it.
// The scene still STRICTLY checks textures.exists('sacred_halo') before use
// (see createHaloSprite); if the file is absent the procedural 'glow' runs.
if (fs.existsSync('public/assets/ui/sacred_halo.png')) {
    const moved = await keyEdgeConnectedWhite(
        'public/assets/ui/sacred_halo.png',
        'public/assets/images/sacred_halo.png',
        { square: 256, wLo: 150, wHi: 172 },
    );
    if (moved) fs.rmSync('public/assets/ui/sacred_halo.png');
} else {
    console.log('SKIP public/assets/ui/sacred_halo.png (already moved to images/)');
}

// Realm backgrounds — full-bleed landscape plates normalized to the
// 1080x1920 portrait stage (no keying: backgrounds are opaque plates).
await coverRealmBackground('public/assets/realms/bg_celestial_realm.png', 'public/assets/realms/bg_celestial_realm.png');
await coverRealmBackground('public/assets/realms/bg_flame_realm.png', 'public/assets/realms/bg_flame_realm.png');
await coverRealmBackground('public/assets/realms/bg_nether_realm.png', 'public/assets/realms/bg_nether_realm.png');

console.log('\ndone.');
