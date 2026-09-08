// Keyes AI raw assets generated on a solid pitch-black studio background
// (raw_assets/, gitignored) into clean 32-bit RGBA PNGs with true alpha.
//
// Why edge-connected keying instead of process-assets.mjs's plain removeBlack:
// the Băng Tuyết Tiên Tử sprite carries near-black line art INSIDE the subject
// (eyes, hairpin outlines) and the Hoa Các pagoda has near-black interior
// shadows + dark jade roofs. A global "max(r,g,b) < t → transparent" ramp
// would punch holes through all of them. Background darkness, however, is
// always CONNECTED TO THE CANVAS BORDER, so:
//
//   1. per-pixel soft key level  a(mx) = ramp(max(r,g,b), aLo..aHi)
//   2. flood fill from every border pixel across pixels that are not fully
//      opaque (a < 255) — the set reached from the border IS the background
//   3. only background pixels take the ramped alpha; interior darks stay
//      fully opaque. Semi-transparent background pixels are unpremultiplied
//      so the golden glow of the pagoda fades out instead of browning out.
//
// After keying: RGB zeroed where alpha is 0, transparent margins trimmed,
// output fitted inside its catalog size budget. Every output is a clean
// 4-channel RGBA PNG (07_VISUAL_ASSET_CATALOG rules).
//
// Tasks whose raw source is missing are SKIPPED so the pipeline stays
// runnable with a partial raw set (same contract as process-assets.mjs).
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

const RAW = 'raw_assets';

/**
 * Edge-connected black key → unpremultiply → trim → fit → write.
 * @param {string} relIn   raw source (raw_assets/<relIn>)
 * @param {string} out     absolute output path
 * @param {{maxEdge?:number, aLo?:number, aHi?:number}} [opts]
 */
async function keyEdgeConnectedBlack(relIn, out, { maxEdge = null, aLo = 8, aHi = 70 } = {}) {
    const src = path.join(RAW, relIn);
    if (!fs.existsSync(src)) {
        console.log(`SKIP ${relIn} (raw source not present)`);
        return false;
    }
    console.log(`>> ${relIn} (edge-connected black-key ${aLo}/${aHi})`);
    const { data, info } = await sharp(src).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const w = info.width;
    const h = info.height;
    const n = w * h;

    /* ---- pass 1: per-pixel soft key level from luminance maximum ---- */
    const level = new Uint8Array(n); // 0..255 key alpha before connectivity
    for (let i = 0; i < n; i++) {
        const o = i * 4;
        const mx = Math.max(data[o], data[o + 1], data[o + 2]);
        level[i] = mx <= aLo ? 0 : mx >= aHi ? 255 : Math.round(((mx - aLo) / (aHi - aLo)) * 255);
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
        } else if (a >= 16) {
            // unpremultiply so semi-transparent glow keeps its true hue
            const k = a / 255;
            px[o] = Math.min(255, Math.round(data[o] / k));
            px[o + 1] = Math.min(255, Math.round(data[o + 1] / k));
            px[o + 2] = Math.min(255, Math.round(data[o + 2] / k));
        } else {
            // too dark to unpremultiply stably — the color is invisible anyway
            px[o] = data[o];
            px[o + 1] = data[o + 1];
            px[o + 2] = data[o + 2];
        }
        keyed++;
        if (a > 0 && a < 255) partial++;
    }
    const total = n;
    console.log(`    keyed ${(keyed * 100 / total).toFixed(1)}% | opaque ${(kept * 100 / total).toFixed(1)}% | partial ${((partial * 100) / total).toFixed(1)}%`);

    let img = sharp(px, { raw: { width: w, height: h, channels: 4 } });

    /* ---- trim transparent margins ---- */
    const t = await img
        .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .toBuffer({ resolveWithObject: true });
    img = sharp(t.data, { raw: { width: t.info.width, height: t.info.height, channels: 4 } });

    /* ---- fit inside the catalog size budget ---- */
    if (maxEdge) {
        img = img.resize(maxEdge, maxEdge, { fit: 'inside', withoutEnlargement: true, background: { r: 0, g: 0, b: 0, alpha: 0 } });
    }

    fs.mkdirSync(path.dirname(out), { recursive: true });
    await img.png({ compressionLevel: 9 }).toFile(out);
    const m = await sharp(out).metadata();
    console.log(`OK  ${path.relative(process.cwd(), out)} -> ${m.width}x${m.height} ch=${m.channels} (${(fs.statSync(out).size / 1024).toFixed(0)} KB)`);
    return true;
}

/* ---------------- tasks ---------------- */

// Step 1a — Băng Tuyết Tiên Tử (Frost Realm celestial spirit NPC).
// public/assets/npc/npc_frost_fairy.png — 720px max edge like npc_tien_nu.
await keyEdgeConnectedBlack('npc_frost_fairy_black.png', 'public/assets/npc/npc_frost_fairy.png', { maxEdge: 720, aLo: 8, aHi: 70 });

// Step 1b — Hoa Các (Garden Shop) golden pagoda treasury icon.
// public/assets/ui/icon_shop.png — 192px icon budget per the 07 catalog.
await keyEdgeConnectedBlack('icon_shop_black.png', 'public/assets/ui/icon_shop.png', { maxEdge: 192, aLo: 6, aHi: 56 });

console.log('\ndone.');
