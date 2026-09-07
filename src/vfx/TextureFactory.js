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
                flower_rare: ['#E8B4FF', '#6a2b8a', '#ffffff'],
            };
            if (palettes[seed.sprite_key]) {
                drawFallbackFlower(scene, seed.sprite_key, ...palettes[seed.sprite_key]);
            } else if (seed.sprite_key === 'flower_rare') {
                drawRareFlowerFallback(scene);
            }
        }
    }
    // New asset fallbacks
    if (!scene.textures.exists('flower_rare')) {
        drawRareFlowerFallback(scene);
    }
    if (!scene.textures.exists('npc_tien_nu')) {
        drawNpcTienNuFallback(scene);
    }
    if (!scene.textures.exists('icon_sickle')) {
        drawSickleIconFallback(scene);
    }
    if (!scene.textures.exists('icon_spirit_stone')) {
        drawSpiritStoneIconFallback(scene);
    }
    if (!scene.textures.exists('bridge_pavilion')) {
        drawBridgePavilionFallback(scene);
    }
    for (const icon of ['icon_seed_drawer', 'icon_water_bucket', 'icon_search']) {
        if (!scene.textures.exists(icon)) {
            console.warn(`[TextureFactory] ${icon} missing — using procedural fallback`);
        }
    }
    drawFallbackIcons(scene); // no-op for existing keys
}

/* ------------------------------------------------------------------ */
/* 5 new AI asset procedural fallbacks                                 */
/* ------------------------------------------------------------------ */

/**
 * Rare flower: Nguyệt Cúc Thiên Hà — a galaxy-themed chrysanthemum with
 * swirling purple/silver petals and a luminous star center.
 */
function drawRareFlowerFallback(scene) {
    canvasTex(scene, 'flower_rare', 256, 256, (ctx, w, h) => {
        const cx = w / 2, cy = h / 2 + 8;
        // outer glow halo
        const halo = ctx.createRadialGradient(cx, cy, 10, cx, cy, 120);
        halo.addColorStop(0, 'rgba(232,180,255,0.4)');
        halo.addColorStop(0.5, 'rgba(180,120,255,0.15)');
        halo.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = halo;
        ctx.fillRect(0, 0, w, h);
        // swirling petals (16 long chrysanthemum petals)
        const petals = 16;
        for (let i = 0; i < petals; i++) {
            ctx.save();
            ctx.translate(cx, cy);
            ctx.rotate((i / petals) * Math.PI * 2);
            const pg = ctx.createLinearGradient(0, 0, 0, -70);
            pg.addColorStop(0, '#6a2b8a');
            pg.addColorStop(0.5, '#c98bff');
            pg.addColorStop(1, '#ffffff');
            ctx.fillStyle = pg;
            ctx.beginPath();
            ctx.ellipse(0, -42, 10, 38, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }
        // inner ring of shorter petals
        for (let i = 0; i < 8; i++) {
            ctx.save();
            ctx.translate(cx, cy);
            ctx.rotate((i / 8) * Math.PI * 2 + 0.2);
            const pg2 = ctx.createLinearGradient(0, 0, 0, -40);
            pg2.addColorStop(0, '#e8b4ff');
            pg2.addColorStop(1, '#ffffff');
            ctx.fillStyle = pg2;
            ctx.beginPath();
            ctx.ellipse(0, -26, 8, 22, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }
        // star center
        const cg = ctx.createRadialGradient(cx, cy, 2, cx, cy, 26);
        cg.addColorStop(0, '#ffffff');
        cg.addColorStop(0.4, '#e8b4ff');
        cg.addColorStop(1, '#9b4dca');
        ctx.fillStyle = cg;
        ctx.beginPath();
        ctx.arc(cx, cy, 24, 0, Math.PI * 2);
        ctx.fill();
        // sparkle dots
        ctx.fillStyle = '#ffffff';
        for (let i = 0; i < 8; i++) {
            const angle = (i / 8) * Math.PI * 2;
            const r = 14;
            ctx.beginPath();
            ctx.arc(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r, 2.5, 0, Math.PI * 2);
            ctx.fill();
        }
    });
}

/**
 * NPC: Tiên Nữ Hoa Giang — an ethereal fairy maiden with flowing robes,
 * rendered as a silhouette-style sprite for the bridge/pavilion area.
 */
function drawNpcTienNuFallback(scene) {
    canvasTex(scene, 'npc_tien_nu', 256, 384, (ctx, w, h) => {
        const cx = w / 2;
        // ethereal glow
        const glow = ctx.createRadialGradient(cx, h * 0.4, 10, cx, h * 0.4, 160);
        glow.addColorStop(0, 'rgba(200,230,255,0.5)');
        glow.addColorStop(0.5, 'rgba(180,200,255,0.2)');
        glow.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = glow;
        ctx.fillRect(0, 0, w, h);
        // flowing robe body (triangular silhouette)
        const robeGrad = ctx.createLinearGradient(cx, h * 0.2, cx, h * 0.9);
        robeGrad.addColorStop(0, '#c9dff8');
        robeGrad.addColorStop(0.4, '#8bb8e8');
        robeGrad.addColorStop(1, '#4a6fa0');
        ctx.fillStyle = robeGrad;
        ctx.beginPath();
        ctx.moveTo(cx, h * 0.2);
        ctx.bezierCurveTo(cx - 30, h * 0.3, cx - 50, h * 0.6, cx - 60, h * 0.88);
        ctx.quadraticCurveTo(cx, h * 0.92, cx + 60, h * 0.88);
        ctx.bezierCurveTo(cx + 50, h * 0.6, cx + 30, h * 0.3, cx, h * 0.2);
        ctx.fill();
        // head
        const headGrad = ctx.createRadialGradient(cx, h * 0.15, 4, cx, h * 0.15, 28);
        headGrad.addColorStop(0, '#f0e8d8');
        headGrad.addColorStop(1, '#c8b8a0');
        ctx.fillStyle = headGrad;
        ctx.beginPath();
        ctx.arc(cx, h * 0.15, 24, 0, Math.PI * 2);
        ctx.fill();
        // flowing hair
        ctx.fillStyle = '#2a1a3e';
        ctx.beginPath();
        ctx.moveTo(cx - 20, h * 0.1);
        ctx.quadraticCurveTo(cx - 35, h * 0.2, cx - 40, h * 0.45);
        ctx.quadraticCurveTo(cx - 20, h * 0.3, cx, h * 0.1);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(cx + 20, h * 0.1);
        ctx.quadraticCurveTo(cx + 35, h * 0.2, cx + 40, h * 0.45);
        ctx.quadraticCurveTo(cx + 20, h * 0.3, cx, h * 0.1);
        ctx.fill();
        // flowing sleeves
        ctx.fillStyle = 'rgba(200,220,255,0.7)';
        ctx.beginPath();
        ctx.moveTo(cx - 20, h * 0.32);
        ctx.bezierCurveTo(cx - 60, h * 0.38, cx - 80, h * 0.5, cx - 50, h * 0.55);
        ctx.bezierCurveTo(cx - 40, h * 0.45, cx - 25, h * 0.38, cx - 20, h * 0.32);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(cx + 20, h * 0.32);
        ctx.bezierCurveTo(cx + 60, h * 0.38, cx + 80, h * 0.5, cx + 50, h * 0.55);
        ctx.bezierCurveTo(cx + 40, h * 0.45, cx + 25, h * 0.38, cx + 20, h * 0.32);
        ctx.fill();
        // golden sash
        ctx.strokeStyle = '#d8a24e';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(cx - 25, h * 0.35);
        ctx.quadraticCurveTo(cx, h * 0.38, cx + 25, h * 0.35);
        ctx.stroke();
        // flower ornament in hair
        ctx.fillStyle = '#e8b4ff';
        ctx.beginPath();
        ctx.arc(cx + 16, h * 0.09, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(cx + 16, h * 0.09, 3, 0, Math.PI * 2);
        ctx.fill();
    });
}

/**
 * Sickle icon (Cổ Phong Sickle) — used for the "Harvest All" button.
 * An ancient curved blade with a golden handle.
 */
function drawSickleIconFallback(scene) {
    canvasTex(scene, 'icon_sickle', 192, 192, (ctx, w, h) => {
        const cx = w / 2, cy = h / 2;
        // handle
        ctx.strokeStyle = '#8a5a26';
        ctx.lineWidth = 14;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(cx + 10, cy + 50);
        ctx.lineTo(cx - 20, cy - 30);
        ctx.stroke();
        // handle wrap
        ctx.strokeStyle = '#d8a24e';
        ctx.lineWidth = 5;
        for (let i = 0; i < 4; i++) {
            const y = cy + 40 - i * 18;
            ctx.beginPath();
            ctx.moveTo(cx + 6, y);
            ctx.lineTo(cx - 4 - i * 2, y - 12);
            ctx.stroke();
        }
        // blade
        const bladeGrad = ctx.createLinearGradient(cx - 50, cy - 50, cx + 30, cy - 10);
        bladeGrad.addColorStop(0, '#c0c8d4');
        bladeGrad.addColorStop(0.5, '#e8edf4');
        bladeGrad.addColorStop(1, '#8090a0');
        ctx.fillStyle = bladeGrad;
        ctx.beginPath();
        ctx.moveTo(cx - 20, cy - 30);
        ctx.quadraticCurveTo(cx - 60, cy - 70, cx - 40, cy - 80);
        ctx.quadraticCurveTo(cx - 10, cy - 85, cx + 20, cy - 60);
        ctx.quadraticCurveTo(cx + 10, cy - 40, cx - 10, cy - 28);
        ctx.closePath();
        ctx.fill();
        // blade edge highlight
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(cx - 18, cy - 32);
        ctx.quadraticCurveTo(cx - 55, cy - 68, cx - 38, cy - 78);
        ctx.stroke();
        // magical glow at tip
        const tipGlow = ctx.createRadialGradient(cx - 40, cy - 78, 2, cx - 40, cy - 78, 18);
        tipGlow.addColorStop(0, 'rgba(127,247,255,0.8)');
        tipGlow.addColorStop(1, 'rgba(127,247,255,0)');
        ctx.fillStyle = tipGlow;
        ctx.fillRect(cx - 58, cy - 96, 36, 36);
    });
}

/**
 * Spirit Stone icon — a glowing crystalline gem used as currency.
 */
function drawSpiritStoneIconFallback(scene) {
    canvasTex(scene, 'icon_spirit_stone', 128, 128, (ctx, w, h) => {
        const cx = w / 2, cy = h / 2;
        // outer glow
        const glow = ctx.createRadialGradient(cx, cy, 8, cx, cy, 56);
        glow.addColorStop(0, 'rgba(200,160,255,0.6)');
        glow.addColorStop(0.5, 'rgba(140,100,255,0.2)');
        glow.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = glow;
        ctx.fillRect(0, 0, w, h);
        // crystal body (hexagonal)
        const crystalGrad = ctx.createLinearGradient(cx - 30, cy - 36, cx + 30, cy + 36);
        crystalGrad.addColorStop(0, '#e8d4ff');
        crystalGrad.addColorStop(0.3, '#b26bff');
        crystalGrad.addColorStop(0.7, '#7a3ec0');
        crystalGrad.addColorStop(1, '#4a1e80');
        ctx.fillStyle = crystalGrad;
        ctx.beginPath();
        ctx.moveTo(cx, cy - 36);
        ctx.lineTo(cx + 26, cy - 16);
        ctx.lineTo(cx + 26, cy + 16);
        ctx.lineTo(cx, cy + 36);
        ctx.lineTo(cx - 26, cy + 16);
        ctx.lineTo(cx - 26, cy - 16);
        ctx.closePath();
        ctx.fill();
        // crystal outline
        ctx.strokeStyle = '#d8a24e';
        ctx.lineWidth = 3;
        ctx.stroke();
        // inner facet highlight
        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ctx.beginPath();
        ctx.moveTo(cx, cy - 34);
        ctx.lineTo(cx + 20, cy - 14);
        ctx.lineTo(cx + 4, cy + 6);
        ctx.lineTo(cx - 14, cy - 10);
        ctx.closePath();
        ctx.fill();
        // sparkle
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(cx - 8, cy - 14, 4, 0, Math.PI * 2);
        ctx.fill();
    });
}

/**
 * Bridge/Pavilion decoration — a small arched bridge with a traditional
 * Vietnamese/Chinese pavilion roof, placed at the edge of the garden.
 */
function drawBridgePavilionFallback(scene) {
    canvasTex(scene, 'bridge_pavilion', 320, 240, (ctx, w, h) => {
        // arch bridge
        ctx.fillStyle = '#3a2810';
        ctx.beginPath();
        ctx.moveTo(20, h * 0.75);
        ctx.quadraticCurveTo(w / 2, h * 0.4, w - 20, h * 0.75);
        ctx.lineTo(w - 20, h * 0.85);
        ctx.quadraticCurveTo(w / 2, h * 0.5, 20, h * 0.85);
        ctx.closePath();
        ctx.fill();
        // bridge rails
        ctx.strokeStyle = '#d8a24e';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(30, h * 0.7);
        ctx.quadraticCurveTo(w / 2, h * 0.35, w - 30, h * 0.7);
        ctx.stroke();
        // rail posts
        for (let i = 0; i < 5; i++) {
            const t = (i + 0.5) / 5;
            const x = 30 + t * (w - 60);
            const topY = h * 0.7 - Math.sin(t * Math.PI) * (h * 0.35);
            ctx.fillStyle = '#d8a24e';
            ctx.fillRect(x - 3, topY, 6, h * 0.12);
        }
        // pavilion roof
        ctx.fillStyle = '#4a1e20';
        ctx.beginPath();
        ctx.moveTo(w / 2, h * 0.08);
        ctx.lineTo(w * 0.18, h * 0.32);
        ctx.quadraticCurveTo(w / 2, h * 0.28, w * 0.82, h * 0.32);
        ctx.closePath();
        ctx.fill();
        // roof edge
        ctx.strokeStyle = '#d8a24e';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(w * 0.15, h * 0.33);
        ctx.quadraticCurveTo(w / 2, h * 0.28, w * 0.85, h * 0.33);
        ctx.stroke();
        // pillars
        ctx.fillStyle = '#5a2020';
        ctx.fillRect(w * 0.3, h * 0.32, 8, h * 0.3);
        ctx.fillRect(w * 0.65, h * 0.32, 8, h * 0.3);
    });
}
