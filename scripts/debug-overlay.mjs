// Renders the exact in-game layout (Linh Đảo Phù Vân island + 6x6 isometric
// grid + water shadow + NPC + UI zones) over the real background image, so
// tile alignment can be verified visually.
import sharp from 'sharp';
import fs from 'fs';

const W = 1080, H = 1920;
const ORIGIN = { x: 540, y: 950 };
const TW = 128, TH = 64;

// Island: texture 936x660 with the top-diamond center at texture (468,270),
// displayed at scale 0.82 with the diamond center on the grid center (540,1110).
const ISLAND = { scale: 0.82, texW: 936, texH: 660, texCy: 270, rx: 462, ry: 264 };
const islandRx = ISLAND.rx * ISLAND.scale;   // 378.8
const islandRy = ISLAND.ry * ISLAND.scale;   // 216.5
const islandImgY = 1110 + (ISLAND.texH / 2 - ISLAND.texCy) * ISLAND.scale; // 1159.2

// NPC: bottom-right lower bridge deck
const NPC = { x: 890, y: 1345 };

const gridToScreen = (gx, gy) => ({
    x: ORIGIN.x + (gx - gy) * (TW / 2),
    y: ORIGIN.y + (gx + gy) * (TH / 2),
});

const diamond = (cx, cy, rx, ry) =>
    `M ${cx} ${cy - ry} L ${cx + rx} ${cy} L ${cx} ${cy + ry} L ${cx - rx} ${cy} Z`;

const parts = [];
// island top diamond (grid alignment reference)
parts.push(`<path d="${diamond(540, 1110, islandRx, islandRy)}" fill="rgba(0,255,220,0.10)" stroke="rgba(255,215,130,0.9)" stroke-width="4"/>`);
// island texture bounds (incl. rocky underside)
parts.push(`<rect x="${540 - ISLAND.texW / 2 * ISLAND.scale}" y="${islandImgY - ISLAND.texH / 2 * ISLAND.scale}" width="${ISLAND.texW * ISLAND.scale}" height="${ISLAND.texH * ISLAND.scale}" fill="none" stroke="rgba(180,120,255,0.65)" stroke-dasharray="10 8" stroke-width="3"/>`);
// island shadow on the water (alpha ~0.45)
parts.push(`<ellipse cx="540" cy="1452" rx="350" ry="86" fill="rgba(0,0,0,0.30)" stroke="rgba(120,200,255,0.8)" stroke-dasharray="8 8" stroke-width="3"/>`);

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

// NPC anchor on the lower bridge deck (+ float range ±4px)
parts.push(`<circle cx="${NPC.x}" cy="${NPC.y}" r="10" fill="#f0f"/>`);
parts.push(`<rect x="${NPC.x - 200}" y="${NPC.y - 180}" width="400" height="360" fill="none" stroke="rgba(255,120,255,0.7)" stroke-dasharray="8 8" stroke-width="3"/>`);
parts.push(`<line x1="${NPC.x - 40}" y1="${NPC.y - 4}" x2="${NPC.x + 40}" y2="${NPC.y - 4}" stroke="#f0f" stroke-width="2"/>`);
parts.push(`<line x1="${NPC.x - 40}" y1="${NPC.y + 4}" x2="${NPC.x + 40}" y2="${NPC.y + 4}" stroke="#f0f" stroke-width="2"/>`);

// ---- UI zones ----
// action buttons: 86px visual ring + 172px invisible touch hitbox
const buttons = [
    [160, 'rgba(255,215,130,0.9)'],
    [540, 'rgba(255,120,120,0.9)'],
    [920, 'rgba(0,229,255,0.9)'],
];
for (const [x, col] of buttons) {
    parts.push(`<circle cx="${x}" cy="1780" r="86" fill="none" stroke="${col}" stroke-width="4"/>`);
    parts.push(`<circle cx="${x}" cy="1780" r="172" fill="none" stroke="${col}" stroke-dasharray="10 8" stroke-width="3" opacity="0.6"/>`);
}
// selected chip
parts.push(`<rect x="${540 - 300}" y="${1585 - 46}" width="600" height="92" fill="none" stroke="rgba(255,255,255,0.6)" stroke-width="4"/>`);
// harmony badge
parts.push(`<rect x="${860 - 300}" y="${92 - 58}" width="600" height="116" fill="none" stroke="rgba(255,215,130,0.5)" stroke-width="4"/>`);
// hint bar
parts.push(`<rect x="${540 - 450}" y="${168 - 28}" width="900" height="56" fill="none" stroke="rgba(255,255,255,0.5)" stroke-width="3"/>`);
// dialog panel (khung thoại): header / body (180px) / footer
parts.push(`<rect x="60" y="400" width="960" height="680" fill="none" stroke="rgba(255,255,255,0.55)" stroke-width="3"/>`);
parts.push(`<rect x="92" y="592" width="896" height="180" fill="rgba(0,229,255,0.08)" stroke="rgba(0,229,255,0.8)" stroke-width="3"/>`);
parts.push(`<text x="540" y="415" fill="#0ff" font-size="26" text-anchor="end">header</text>`);
parts.push(`<text x="984" y="585" fill="#0ff" font-size="26" text-anchor="end">body (max-h 180)</text>`);

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${parts.join('')}</svg>`;
fs.mkdirSync('scripts/shots', { recursive: true });
await sharp('public/assets/images/bg_manor_isometric.png')
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .png()
    .toFile('scripts/shots/layout_check.png');
console.log('written scripts/shots/layout_check.png');
