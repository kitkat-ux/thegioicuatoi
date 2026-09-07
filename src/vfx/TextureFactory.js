/**
 * TextureFactory — procedural canvas textures for VFX and UI framing,
 * plus guaranteed fallback textures for every game asset so the game
 * always boots even if an image file fails to load (auto-fallback rule).
 */
import { SEED_CATALOG } from '../data/seedCatalog.js';

function canvasTex(scene, key, w, h, draw) {
    if (scene.textures.exists(key)) return scene.textures.get(key);
    const tex = scene.textures.createCanvas(key, w, h);
    const ctx = tex.getContext();
    ctx.clearRect(0, 0, w, h);
    draw(ctx, w, h);
    // refresh() uploads to the WebGL renderer; in headless/no-renderer modes
    // (Phaser.HEADLESS) calling it would dereference a null renderer.
    if (scene.game.renderer) tex.refresh();
    return tex;
}

function diamondPath(ctx, cx, cy, rx, ry) {
    ctx.beginPath();
    ctx.moveTo(cx, cy - ry);
    ctx.lineTo(cx + rx, cy);
    ctx.lineTo(cx, cy + ry);
    ctx.lineTo(cx - rx, cy);
    ctx.closePath();
}

function tintHex(hex) {
    const n = parseInt(hex.replace('#', ''), 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/* ------------------------------------------------------------------ */
/* VFX / platform textures (always procedural)                         */
/* ------------------------------------------------------------------ */

export function buildExtraTextures(scene) {
    // Soft radial glow (tintable)
    canvasTex(scene, 'glow', 256, 256, (ctx, w, h) => {
        const g = ctx.createRadialGradient(w / 2, h / 2, 4, w / 2, h / 2, w / 2);
        g.addColorStop(0, 'rgba(255,255,255,1)');
        g.addColorStop(0.35, 'rgba(255,255,255,0.55)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
    });

    // 4-point sparkle star (tintable)
    canvasTex(scene, 'spark', 96, 96, (ctx, w, h) => {
        const cx = w / 2, cy = h / 2;
        ctx.translate(cx, cy);
        ctx.fillStyle = 'rgba(255,255,255,0.95)';
        for (let i = 0; i < 2; i++) {
            ctx.save();
            ctx.rotate((i * Math.PI) / 2);
            ctx.beginPath();
            ctx.moveTo(0, -46);
            ctx.quadraticCurveTo(6, -6, 42, 0);
            ctx.quadraticCurveTo(6, 6, 0, 46);
            ctx.quadraticCurveTo(-6, 6, -42, 0);
            ctx.quadraticCurveTo(-6, -6, 0, -46);
            ctx.fill();
            ctx.restore();
        }
        ctx.beginPath();
        ctx.arc(0, 0, 10, 0, Math.PI * 2);
        ctx.fill();
    });

    // Petal (tintable) — teardrop with soft gradient
    canvasTex(scene, 'petal', 48, 48, (ctx, w, h) => {
        ctx.translate(w / 2, h / 2);
        const g = ctx.createRadialGradient(0, -6, 2, 0, 0, 22);
        g.addColorStop(0, 'rgba(255,255,255,1)');
        g.addColorStop(0.6, 'rgba(255,255,255,0.8)');
        g.addColorStop(1, 'rgba(255,255,255,0.25)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(0, -20);
        ctx.bezierCurveTo(14, -10, 14, 8, 0, 22);
        ctx.bezierCurveTo(-14, 8, -14, -10, 0, -20);
        ctx.fill();
    });

    // Water droplet (tintable)
    canvasTex(scene, 'droplet', 40, 56, (ctx, w, h) => {
        ctx.translate(w / 2, h / 2);
        const g = ctx.createLinearGradient(0, -24, 0, 26);
        g.addColorStop(0, 'rgba(255,255,255,0.95)');
        g.addColorStop(0.55, 'rgba(255,255,255,0.55)');
        g.addColorStop(1, 'rgba(255,255,255,0.15)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(0, -26);
        ctx.bezierCurveTo(12, -10, 13, 8, 0, 26);
        ctx.bezierCurveTo(-13, 8, -12, -10, 0, -26);
        ctx.fill();
    });

    // Ethereal mist puff
    canvasTex(scene, 'mist', 256, 128, (ctx, w, h) => {
        const g = ctx.createRadialGradient(w / 2, h / 2, 8, w / 2, h / 2, w / 2);
        g.addColorStop(0, 'rgba(255,255,255,0.85)');
        g.addColorStop(0.5, 'rgba(255,255,255,0.35)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.save();
        ctx.scale(1, 0.5);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h * 2);
        ctx.restore();
    });

    // Jade sprout
    canvasTex(scene, 'sprout', 96, 96, (ctx, w, h) => {
        ctx.strokeStyle = '#3d9e5f';
        ctx.lineWidth = 6;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(w / 2, h - 14);
        ctx.quadraticCurveTo(w / 2 + 2, h / 2, w / 2, 40);
        ctx.stroke();
        const leaf = (x, y, rot, flip) => {
            ctx.save();
            ctx.translate(x, y);
            ctx.rotate(rot);
            ctx.scale(flip ? -1 : 1, 1);
            const g = ctx.createLinearGradient(0, 0, 0, -32);
            g.addColorStop(0, '#2c7a46');
            g.addColorStop(1, '#8ceb9f');
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.ellipse(14, -12, 24, 10, -0.5, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        };
        leaf(w / 2, 46, 0.35, false);
        leaf(w / 2, 50, -0.35, true);
    });

    // Isometric tile highlight (diamond outline for hover feedback)
    canvasTex(scene, 'tile_highlight', 128, 64, (ctx, w, h) => {
        const cx = w / 2, cy = h / 2;
        diamondPath(ctx, cx, cy, 58, 27);
        ctx.strokeStyle = 'rgba(255,255,255,0.95)';
        ctx.lineWidth = 4;
        ctx.stroke();
        diamondPath(ctx, cx, cy, 62, 30);
        ctx.strokeStyle = 'rgba(190,232,255,0.5)';
        ctx.lineWidth = 2;
        ctx.stroke();
    });

    // Seed mound
    canvasTex(scene, 'seed', 40, 28, (ctx, w, h) => {
        ctx.fillStyle = '#4a2c14';
        ctx.beginPath();
        ctx.ellipse(w / 2, h / 2, 15, 10, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#6b431f';
        ctx.beginPath();
        ctx.ellipse(w / 2 - 2, h / 2 - 3, 7, 4, 0, 0, Math.PI * 2);
        ctx.fill();
    });

    // Stone garden platform grounding the grid (carved manor courtyard)
    canvasTex(scene, 'platform', 936, 540, (ctx, w, h) => {
        const cx = w / 2, cy = h / 2, rx = w / 2 - 6, ry = h / 2 - 6;
        ctx.save();
        ctx.shadowColor = 'rgba(0,0,0,0.6)';
        ctx.shadowBlur = 30;
        ctx.shadowOffsetY = 16;
        diamondPath(ctx, cx, cy, rx, ry);
        ctx.fillStyle = '#171529';
        ctx.fill();
        ctx.restore();

        // raised golden rim
        diamondPath(ctx, cx, cy + 8, rx, ry);
        ctx.fillStyle = '#4d3413';
        ctx.fill();
        const g = ctx.createLinearGradient(cx, cy - ry, cx, cy + ry);
        g.addColorStop(0, '#3b6370');
        g.addColorStop(0.5, '#274550');
        g.addColorStop(1, '#152b33');
        diamondPath(ctx, cx, cy, rx, ry);
        ctx.fillStyle = g;
        ctx.fill();

        // inner sheen (water-light reflection)
        const sheen = ctx.createRadialGradient(cx, cy - ry * 0.35, 10, cx, cy, ry);
        sheen.addColorStop(0, 'rgba(140,240,255,0.22)');
        sheen.addColorStop(0.55, 'rgba(140,240,255,0.06)');
        sheen.addColorStop(1, 'rgba(0,0,0,0)');
        diamondPath(ctx, cx, cy, rx - 18, ry - 18);
        ctx.fillStyle = sheen;
        ctx.fill();

        // stone specks
        ctx.fillStyle = 'rgba(255,255,255,0.07)';
        for (let i = 0; i < 90; i++) {
            const t = Math.random() * 2 - 1;
            const u = Math.random() * 2 - 1;
            const px = cx + t * (rx - 30);
            const py = cy + u * (ry - 30) - Math.abs(t) * 20;
            ctx.beginPath();
            ctx.ellipse(px, py, 2 + Math.random() * 4, 1.2 + Math.random() * 2.2, 0, 0, Math.PI * 2);
            ctx.fill();
        }

        // carved border
        ctx.strokeStyle = '#d8a24e';
        ctx.lineWidth = 7;
        diamondPath(ctx, cx, cy, rx - 4, ry - 4);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(255,224,150,0.75)';
        ctx.lineWidth = 2.4;
        diamondPath(ctx, cx, cy, rx - 22, ry - 22);
        ctx.stroke();
        ctx.strokeStyle = '#6a3f16';
        ctx.lineWidth = 2;
        diamondPath(ctx, cx, cy, rx - 42, ry - 42);
        ctx.stroke();
    });
}

/* ------------------------------------------------------------------ */
/* Fallback game assets (only generated when the PNG file is missing)  */
/* ------------------------------------------------------------------ */

function drawFallbackFlower(scene, key, baseHex, deepHex, highlightHex) {
    canvasTex(scene, key, 256, 256, (ctx, w, h) => {
        const cx = w / 2, cy = h / 2 + 8;
        const { r, g, b } = tintHex(baseHex);
        const d = tintHex(deepHex);
        const hl = tintHex(highlightHex);
        // leaves
        ctx.save();
        ctx.translate(cx - 34, cy + 42);
        ctx.rotate(-0.5);
        ctx.fillStyle = `rgb(${d.r},${d.g},${d.b})`;
        ctx.beginPath();
        ctx.ellipse(18, 0, 30, 12, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        // petals
        const petals = 10;
        for (let i = 0; i < petals; i++) {
            ctx.save();
            ctx.translate(cx, cy);
            ctx.rotate((i / petals) * Math.PI * 2);
            const pg = ctx.createLinearGradient(0, 0, 0, -58);
            pg.addColorStop(0, `rgb(${d.r},${d.g},${d.b})`);
            pg.addColorStop(1, `rgb(${hl.r},${hl.g},${hl.b})`);
            ctx.fillStyle = pg;
            ctx.beginPath();
            ctx.ellipse(0, -34, 15, 32, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }
        const cg = ctx.createRadialGradient(cx, cy, 4, cx, cy, 30);
        cg.addColorStop(0, `rgb(255,255,230)`);
        cg.addColorStop(1, `rgb(${r},${g},${b})`);
        ctx.fillStyle = cg;
        ctx.beginPath();
        ctx.arc(cx, cy, 28, 0, Math.PI * 2);
        ctx.fill();
    });
}

function drawFallbackIcons(scene) {
    canvasTex(scene, 'icon_seed_drawer', 192, 192, (ctx, w, h) => {
        ctx.fillStyle = '#7a4a1e';
        ctx.strokeStyle = '#d8a24e';
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.roundRect(w / 2 - 70, h / 2 - 50, 140, 100, 10);
        ctx.fill();
        ctx.stroke();
        ctx.strokeStyle = '#5b3413';
        ctx.lineWidth = 4;
        for (let i = -45; i <= 45; i += 30) {
            ctx.beginPath();
            ctx.moveTo(w / 2 + i, h / 2 - 50);
            ctx.lineTo(w / 2 + i, h / 2 + 50);
            ctx.stroke();
        }
        // glowing seed pouches
        ctx.fillStyle = '#ffe9a8';
        for (const [dx, dy] of [[-30, -18], [28, 6], [-28, 26], [30, -32]]) {
            ctx.beginPath();
            ctx.arc(w / 2 + dx, h / 2 + dy, 11, 0, Math.PI * 2);
            ctx.fill();
        }
    });

    canvasTex(scene, 'icon_water_bucket', 192, 192, (ctx, w, h) => {
        const cx = w / 2, cy = h / 2;
        const g = ctx.createLinearGradient(cx - 60, cy, cx + 60, cy);
        g.addColorStop(0, '#2f8f6b');
        g.addColorStop(0.5, '#67e0b0');
        g.addColorStop(1, '#1f6b4f');
        ctx.fillStyle = g;
        ctx.strokeStyle = '#d8a24e';
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.moveTo(cx - 52, cy - 34);
        ctx.lineTo(cx + 52, cy - 34);
        ctx.lineTo(cx + 38, cy + 54);
        ctx.lineTo(cx - 38, cy + 54);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = 'rgba(140,255,235,0.9)';
        ctx.beginPath();
        ctx.ellipse(cx, cy - 34, 52, 12, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#8a5a26';
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.arc(cx, cy - 20, 66, Math.PI * 1.15, Math.PI * 1.85);
        ctx.stroke();
    });

    canvasTex(scene, 'icon_search', 192, 192, (ctx, w, h) => {
        const cx = w / 2 - 14, cy = h / 2 - 14, r = 52;
        ctx.fillStyle = '#3a2410';
        ctx.strokeStyle = '#d8a24e';
        ctx.lineWidth = 12;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.strokeStyle = '#d8a24e';
        ctx.lineWidth = 18;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(cx + r * 0.72, cy + r * 0.72);
        ctx.lineTo(cx + r + 34, cy + r + 34);
        ctx.stroke();
        ctx.fillStyle = '#ffe9a8';
        ctx.beginPath();
        ctx.arc(cx, cy, 26, 0, Math.PI * 2);
        ctx.fill();
    });
}

export function ensureFallbackTextures(scene) {
    const needed = {
        bg_manor_isometric: () =>
            canvasTex(scene, 'bg_manor_isometric', 1080, 1920, (ctx, w, h) => {
                const sky = ctx.createLinearGradient(0, 0, 0, h);
                sky.addColorStop(0, '#1b1140');
                sky.addColorStop(0.5, '#3a1c5e');
                sky.addColorStop(1, '#0e6a72');
                ctx.fillStyle = sky;
                ctx.fillRect(0, 0, w, h);
                ctx.fillStyle = 'rgba(180,120,255,0.35)';
                for (let i = 0; i < 26; i++) {
                    ctx.beginPath();
                    ctx.arc(Math.random() * w, 60 + Math.random() * 500, 2 + Math.random() * 5, 0, Math.PI * 2);
                    ctx.fill();
                }
            }),
        tile_soil: () =>
            canvasTex(scene, 'tile_soil', 128, 64, (ctx, w, h) => {
                const cx = w / 2, cy = h / 2;
                const g = ctx.createLinearGradient(cx, cy - 32, cx, cy + 32);
                g.addColorStop(0, '#5a3a1c');
                g.addColorStop(1, '#38210e');
                diamondPath(ctx, cx, cy, 62, 30);
                ctx.fillStyle = g;
                ctx.fill();
                ctx.strokeStyle = '#7a4a1e';
                ctx.lineWidth = 4;
                diamondPath(ctx, cx, cy, 60, 29);
                ctx.stroke();
                ctx.strokeStyle = 'rgba(40,22,8,0.7)';
                ctx.lineWidth = 2;
                for (let i = -2; i <= 2; i++) {
                    ctx.beginPath();
                    ctx.moveTo(cx - 42, cy + i * 9);
                    ctx.lineTo(cx + 42, cy + i * 9);
                    ctx.stroke();
                }
            }),
    };
    // draw procedurally only for keys that failed to load
    for (const key of Object.keys(needed)) {
        if (!scene.textures.exists(key)) {
            console.warn(`[TextureFactory] ${key} missing — using procedural fallback`);
            needed[key]();
        }
    }
    for (const seed of SEED_CATALOG) {
        if (!scene.textures.exists(seed.sprite_key)) {
            console.warn(`[TextureFactory] ${seed.sprite_key} missing — using procedural fallback`);
            const palettes = {
                flower_cyan: ['#00E5FF', '#006c8a', '#c8ffff'],
                flower_purple: ['#B26BFF', '#5a2b8a', '#f0d4ff'],
                flower_golden: ['#FFD700', '#a06a00', '#fff3b0'],
                flower_emerald: ['#2E8B57', '#0f5031', '#a8ffcf'],
            };
            drawFallbackFlower(scene, seed.sprite_key, ...palettes[seed.sprite_key]);
        }
    }
    for (const icon of ['icon_seed_drawer', 'icon_water_bucket', 'icon_search']) {
        if (!scene.textures.exists(icon)) {
            console.warn(`[TextureFactory] ${icon} missing — using procedural fallback`);
        }
    }
    drawFallbackIcons(scene); // no-op for existing keys
}
