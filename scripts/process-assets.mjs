// Processes AI-generated raw assets into game-ready PNGs:
// - removes near-black studio backgrounds (alpha from max channel)
// - unpremultiplies RGB so edges keep their true color
// - trims transparent margins and normalizes sizes
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

const RAW = 'raw_assets';
const OUT = 'public/assets/images';

async function removeBlack(input, aLo = 10, aHi = 30) {
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
    px[i] = Math.min(255, Math.round(r / (k || 1)));
    px[i + 1] = Math.min(255, Math.round(g / (k || 1)));
    px[i + 2] = Math.min(255, Math.round(b / (k || 1)));
    px[i + 3] = a;
  }
  return sharp(px, { raw: { width: info.width, height: info.height, channels: 4 } });
}

async function makeSprite(relIn, relOut, size, { fit = 'inside', trim = true, keyLo = 56, keyHi = 160 } = {}) {
  const src = path.join(RAW, relIn);
  const dst = path.join(OUT, relOut);
  let img = await removeBlack(src, keyLo, keyHi);
  if (trim) {
    const t = await img.trim({ background: { r: 0, g: 0, b: 0, alpha: 0 } }).toBuffer({ resolveWithObject: true });
    // rebuild from the trimmed raw buffer so the crop is applied
    img = sharp(t.data, { raw: { width: t.info.width, height: t.info.height, channels: t.info.channels } });
  }
  const resized = await img
    .resize(size, size, { fit, withoutEnlargement: false, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  await sharp(resized).toFile(dst);
  const m = await sharp(dst).metadata();
  console.log(`OK ${relOut} -> ${m.width}x${m.height}`);
}

async function makeBackground() {
  const dst = path.join(OUT, 'bg_manor_isometric.png');
  await sharp(path.join(RAW, 'bg_manor_isometric.png'))
    .resize(1080, 1920, { fit: 'cover', position: 'centre' })
    .png({ palette: true, quality: 90, compressionLevel: 9 })
    .toFile(dst);
  const m = await sharp(dst).metadata();
  console.log(`OK bg_manor_isometric.png -> ${m.width}x${m.height}`);
}

async function makeSoilTile() {
  const dst = path.join(OUT, 'tile_soil.png');
  const img = await removeBlack(path.join(RAW, 'tile_soil.png'), 10, 30);
  const t = await img.trim({ background: { r: 0, g: 0, b: 0, alpha: 0 } }).toBuffer({ resolveWithObject: true });
  await sharp(t.data, { raw: { width: t.info.width, height: t.info.height, channels: 4 } })
    .resize(128, 64, { fit: 'fill' })
    .png()
    .toFile(dst);
  console.log(`OK tile_soil.png (trim ${t.info.width}x${t.info.height} -> 128x64)`);
}

fs.mkdirSync(OUT, { recursive: true });
await makeBackground();
await makeSoilTile();
await makeSprite('flower_purple.png', 'flower_purple.png', 256);
await makeSprite('flower_golden.png', 'flower_golden.png', 256);
await makeSprite('flower_cyan.png', 'flower_cyan.png', 256);
await makeSprite('flower_emerald.png', 'flower_emerald.png', 256);
await makeSprite('icon_seed_drawer.png', 'icon_seed_drawer.png', 192);
await makeSprite('icon_water_bucket.png', 'icon_water_bucket.png', 192);
await makeSprite('icon_search.png', 'icon_search.png', 192);
console.log('done');
