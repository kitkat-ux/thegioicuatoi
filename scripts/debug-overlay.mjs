// Renders the exact in-game layout (platform + 6x6 isometric grid + UI zones)
// over the real background image, so tile alignment can be verified visually.
import sharp from 'sharp';
import fs from 'fs';

const W = 1080, H = 1920;
const ORIGIN = { x: 540, y: 950 };
const TW = 128, TH = 64;

const gridToScreen = (gx, gy) => ({
    x: ORIGIN.x + (gx - gy) * (TW / 2),
    y: ORIGIN.y + (gx + gy) * (TH / 2),
});

const diamond = (cx, cy, rx, ry) =>
    `M ${cx} ${cy - ry} L ${cx + rx} ${cy} L ${cx} ${cy + ry} L ${cx - rx} ${cy} Z`;

const parts = [];
// platform (center 540,1110, texture 936x540 at scale 0.82 -> rx 384 ry 221)
parts.push(`<path d="${diamond(540, 1110, 384, 221)}" fill="rgba(0,255,220,0.10)" stroke="rgba(255,215,130,0.9)" stroke-width="4"/>`);

// tiles
for (let r = 0; r < 6; r++) {
    for (let c = 0; c < 6; c++) {
        const p = gridToScreen(c, r);
        parts.push(`<path d="${diamond(p.x, p.y, 62, 30)}" fill="rgba(255,80,80,0.28)" stroke="rgba(255,255,255,0.85)" stroke-width="2"/>`);
    }
}
// origin marker & corners (isometric alignment checks)
const marks = [
    ['top', gridToScreen(0, 0)],
    ['bottom', gridToScreen(5, 5)],
    ['left', gridToScreen(0, 5)],
    ['right', gridToScreen(5, 0)],
    ['center', gridToScreen(2.5, 2.5)],
];
for (const [name, p] of marks) {
    parts.push(`<circle cx="${p.x}" cy="${p.y}" r="9" fill="${name === 'center' ? '#ff0' : '#0ff'}"/>`);
}

// ---- UI zones (approximate centers) ----
const ui = [
    [210, 1812, 108, 'rgba(255,215,130,0.7)'],   // drawer button
    [870, 1812, 108, 'rgba(0,229,255,0.7)'],     // water button
    [540, 1435, -92, 'rgba(255,255,255,0.6)'],   // selected chip (h=92)
    [860, 92, -116, 'rgba(255,215,130,0.5)'],    // harmony badge (h=116)
];
for (const [x, y, r, col] of ui) {
    if (r > 0) parts.push(`<circle cx="${x}" cy="${y}" r="${r}" fill="none" stroke="${col}" stroke-width="4"/>`);
    else parts.push(`<rect x="${x - 300}" y="${y + r / 2}" width="600" height="${-r}" fill="none" stroke="${col}" stroke-width="4"/>`);
}
// hint bar
parts.push(`<rect x="${540 - 450}" y="${168 - 28}" width="900" height="56" fill="none" stroke="rgba(255,255,255,0.5)" stroke-width="3"/>`);

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${parts.join('')}</svg>`;
fs.mkdirSync('scripts/shots', { recursive: true });
await sharp('public/assets/images/bg_manor_isometric.png')
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .png()
    .toFile('scripts/shots/layout_check.png');
console.log('written scripts/shots/layout_check.png');
