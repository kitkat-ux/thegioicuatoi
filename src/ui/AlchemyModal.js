/**
 * AlchemyModal — the UI half of System 5: LÒ LUYỆN ĐAN (Alchemy Cauldron).
 *
 * Presentation only. AlchemyManager remains the authority for recipes, timers
 * and success rolls; every exchange with the rest of the game goes through
 * the shared EventManager bus (ELIXIR_CONSUMED, ALCHEMY_*, ingredient gains).
 *
 * Two halves, mirroring CodexModal:
 *  1. a bronze cauldron medallion parked on the top HUD (right column, below
 *     the codex scroll), with an elixir count badge + attention pulse;
 *  2. a full overlay: the Bát Quái Lô (`furnace_bagua.png`) with a smooth
 *     breathing tween, the three recipe cards (pill sprites in the slots),
 *     the ingredient slot picker, the herb shelf, the elixir shelf with
 *     Trúc Cơ Đan / Cửu Chuyển Thần Đan art, the "Luyện Đan" CTA with
 *     countdown + claim button, and the live active-buff line.
 *
 * Furnace + pill art comes from `data/AlchemyAssetManifest.js`. The HUD
 * medallion stays a procedural glyph so the top chrome never 404s if a
 * PNG fails to load (headless tests use the same fallback).
 */
import Phaser from 'phaser';
import { LAYERS } from '../core/Layers.js';
import { EVENTS } from '../systems/EventManager.js';
import { HERBS, ELIXIRS, ALCHEMY_RECIPES } from '../systems/AlchemyManager.js';
import { ALCHEMY_ASSETS } from '../data/AlchemyAssetManifest.js';
import { DIALOG_FONT } from '../systems/DialogSystem.js';
import { bindBackdropClose, createPanelShield, guarded, localRectToWorld } from './modalInput.js';

/** Recipe / inventory slot art: Tụ Khí Đan → Trúc Cơ Đan, Tẩy Tủy Đan → Cửu Chuyển Thần Đan. */
const PILL_BY_ELIXIR = {
    tu_khi_dan: ALCHEMY_ASSETS.pill_tier1,
    tay_tui_dan: ALCHEMY_ASSETS.pill_tier3,
};

const W = 1080;
const H = 1920;

/* Overlay panel (9:16 portrait, Scale.FIT handles the rest).
   All content Y's are panel-relative (root is stage-centred). The budget is
   top→bottom with comfortable gaps between sections:
   cauldron -370 (flame to ~-176) · countdown -185 · progress -160 · CTA -105
   elixir shelf 5 · recipe title 85 · cards 115/201/287 · slots 425
   herb title 500 · herb rows 536/608 — all clear of the ±674 inner border. */
const PW = 920;
const PH = 1380;
const PX = W / 2;
const PY = 960;

const LAYOUT = {
    cauldronY: -370,
    countdownY: -185,
    progressY: -160,
    ctaY: -105,
    elixirY: 5,
    recipeTitleY: 85,
    cardTop: 115,
    cardStep: 86,
    slotY: 425,
    herbTitleY: 500,
    herbTop: 536,
    herbStep: 72,
};

/* Guofeng bronze / ink palette (07 catalog: tím · lam ngọc · vàng kim). */
const GOLD = 0xdfb15b;
const BRONZE = 0x6b4e2a;
const BRONZE_LIGHT = 0x8a6a3a;
const BRONZE_DARK = 0x4a3418;
const INK = 0x170f24;
const FIRE = 0xff8a3c;
const FIRE_CORE = 0xffd97a;
const SPIRIT = 0x36c5e8;

const text = (scene, x, y, str, opts = {}) => scene.add.text(x, y, str, {
    fontFamily: DIALOG_FONT, ...opts,
});

/** Draw the bronze cauldron glyph into `g`, pot centre at local (0,0). */
function drawCauldron(g, scale = 1) {
    g.clear();
    // legs
    g.fillStyle(BRONZE_DARK, 1);
    g.fillRoundedRect(-78 * scale, 82 * scale, 26 * scale, 34 * scale, 8 * scale);
    g.fillRoundedRect(-13 * scale, 92 * scale, 26 * scale, 34 * scale, 8 * scale);
    g.fillRoundedRect(52 * scale, 82 * scale, 26 * scale, 34 * scale, 8 * scale);
    // body
    g.fillStyle(BRONZE, 1);
    g.fillEllipse(0, 0, 240 * scale, 190 * scale);
    g.lineStyle(8 * scale, BRONZE_DARK, 1);
    g.strokeEllipse(0, 0, 240 * scale, 190 * scale);
    // gold belly studs
    g.fillStyle(GOLD, 0.9);
    for (const [sx, sy] of [[-88, 18], [-44, 34], [0, 40], [44, 34], [88, 18]]) {
        g.fillCircle(sx * scale, sy * scale, 5 * scale);
    }
    // mouth rim + dark interior + glowing elixir
    g.fillStyle(BRONZE_LIGHT, 1);
    g.fillEllipse(0, -85 * scale, 208 * scale, 66 * scale);
    g.fillStyle(0x241408, 1);
    g.fillEllipse(0, -85 * scale, 184 * scale, 52 * scale);
    g.fillStyle(SPIRIT, 0.92);
    g.fillEllipse(0, -80 * scale, 156 * scale, 38 * scale);
    g.fillStyle(0x9ff0ff, 0.85);
    g.fillEllipse(0, -78 * scale, 96 * scale, 20 * scale);
    g.lineStyle(6 * scale, BRONZE_DARK, 1);
    g.strokeEllipse(0, -85 * scale, 208 * scale, 66 * scale);
    // side ears
    g.fillStyle(BRONZE, 1);
    g.fillCircle(-106 * scale, -92 * scale, 15 * scale);
    g.fillCircle(106 * scale, -92 * scale, 15 * scale);
    g.lineStyle(4 * scale, BRONZE_DARK, 1);
    g.strokeCircle(-106 * scale, -92 * scale, 15 * scale);
    g.strokeCircle(106 * scale, -92 * scale, 15 * scale);
}

export class AlchemyModal {
    /**
     * @param {Phaser.Scene} scene
     * @param {{alchemy: import('../systems/AlchemyManager.js').AlchemyManager,
     *          bus?: import('../systems/EventManager.js').EventManager,
     *          audio?: import('../audio/AudioManager.js').default,
     *          recipes?: Array}} deps
     */
    constructor(scene, { alchemy, bus = null, audio = null, recipes = ALCHEMY_RECIPES } = {}) {
        if (!scene) throw new TypeError('AlchemyModal requires a Phaser scene');
        if (!alchemy) throw new TypeError('AlchemyModal requires an AlchemyManager');
        this.scene = scene;
        this.alchemy = alchemy;
        this.bus = bus;
        this.audio = audio;
        this.recipes = recipes;
        this.visible = false;
        this.selectedRecipeId = recipes[0]?.id ?? null;
        this.lastOutcome = null; // { success, elixirId, name, msg, at }
        this.hintMsg = null;
        this.hintUntil = 0;
        this.disposers = [];
        this.recipeCards = [];
        this.slots = [];
        this.herbChips = [];
        this.elixirChips = [];
    }

    create() {
        this.createHudButton();
        this.createOverlay();
        this.bindBus();
        // 2Hz refresh while open: countdown, progress, buff line, counts.
        this._timer = this.scene.time.addEvent({
            delay: 500,
            loop: true,
            callback: () => { if (this.visible) this.tickUI(); },
        });
        return this;
    }

    bindBus() {
        if (!this.bus) return this;
        this.disposers.push(
            this.bus.on(EVENTS.ALCHEMY_CRAFT_STARTED, (p) => {
                this.audio?.pluck?.(220, { gain: 0.1, dur: 1.4 });
                this.audio?.chime?.(330, { gain: 0.05 });
                this.lastOutcome = null;
                this.buildContent();
            }, { owner: 'alchemy-modal' }),
            this.bus.on(EVENTS.ALCHEMY_CRAFT_SUCCESS, (p) => {
                this.audio?.chime?.(1046.5, { gain: 0.1 });
                this.audio?.chime?.(1318.5, { gain: 0.08, when: 0.12 });
                this.lastOutcome = { success: true, elixirId: p.elixirId, name: p.recipe?.name, at: Date.now() };
                this.toast(`✦ Luyện thành: ${p.recipe?.name ?? p.elixirId}!`, 0xffd97a);
                this.pulseButton();
                this.buildContent();
            }, { owner: 'alchemy-modal' }),
            this.bus.on(EVENTS.ALCHEMY_CRAFT_FAILED, (p) => {
                this.audio?.chime?.(196, { gain: 0.08 });
                this.lastOutcome = { success: false, msg: 'Linh khí tan biến — thảo dược đã hóa khói ✧', at: Date.now() };
                this.toast('Linh khí tan biến…', 0xb26bff);
                this.buildContent();
            }, { owner: 'alchemy-modal' }),
            this.bus.on(EVENTS.ELIXIR_CONSUMED, (p) => {
                this.audio?.splash?.(0);
                this.audio?.chime?.(880, { gain: 0.08, when: 0.1 });
                this.lastOutcome = null;
                this.toast(`✦ ${p.recipe?.name ?? p.elixirId}: ${p.recipe?.description ?? ''}`, 0x7ff7ff);
                this.buildContent();
            }, { owner: 'alchemy-modal' }),
            this.bus.on(EVENTS.ALCHEMY_BUFF_EXPIRED, () => this.tickUI(), { owner: 'alchemy-modal' }),
            this.bus.on(EVENTS.ALCHEMY_INGREDIENT_GAINED, () => {
                this.updateBadge();
                if (this.visible) {
                    // cheap refresh: counts only, no full rebuild
                    this.refreshCounts();
                }
            }, { owner: 'alchemy-modal' }),
        );
        return this;
    }

    /* =============================== HUD BUTTON ===============================
       Bronze cauldron medallion, top HUD right column, below the codex scroll
       (958,322). Same motion language: breathing idle + press feedback.      */
    createHudButton() {
        const { scene } = this;
        const cx = 958;
        const cy = 462;
        const R = 48;

        this.button = scene.add.container(cx, cy).setDepth(LAYERS.HUD);
        const inner = scene.add.container(0, 0);

        const aura = scene.add.image(0, 0, 'glow').setTint(0xffb45e).setAlpha(0.18).setScale(1.4);
        const plate = scene.add.graphics();
        const drawPlate = (hover) => {
            plate.clear();
            plate.fillStyle(0x241540, 0.96);
            plate.lineStyle(4, hover ? 0xffe3a0 : GOLD, 1);
            plate.fillCircle(0, 0, R);
            plate.strokeCircle(0, 0, R);
            plate.fillStyle(0x1c1128, 1);
            plate.fillCircle(0, 0, R - 7);
            plate.lineStyle(2, BRONZE_LIGHT, 0.8);
            plate.strokeCircle(0, 0, R - 12);
        };
        drawPlate(false);

        // mini cauldron glyph
        const glyph = scene.add.graphics();
        glyph.fillStyle(BRONZE, 1);
        glyph.fillEllipse(0, 4, 46, 34);
        glyph.lineStyle(4, BRONZE_DARK, 1);
        glyph.strokeEllipse(0, 4, 46, 34);
        glyph.fillStyle(0x241408, 1);
        glyph.fillEllipse(0, -10, 34, 13);
        glyph.fillStyle(SPIRIT, 0.95);
        glyph.fillEllipse(0, -9, 24, 8);
        glyph.fillStyle(BRONZE_DARK, 1);
        glyph.fillRect(-16, 18, 10, 10);
        glyph.fillRect(6, 18, 10, 10);
        this.fireDots = [];
        for (const [fx, fy] of [[-12, 32], [0, 36], [12, 32]]) {
            const dot = scene.add.graphics();
            dot.fillStyle(FIRE, 1);
            dot.fillCircle(fx, fy, 4.5);
            this.fireDots.push(dot);
        }
        scene.tweens.add({
            targets: this.fireDots,
            alpha: { from: 0.5, to: 1 },
            duration: 420,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.easeInOut',
        });

        const label = text(scene, 0, R + 16, 'Luyện Đan', {
            fontSize: '20px', color: '#ffe9c4', fontStyle: 'bold',
            stroke: '#1b1140', strokeThickness: 5,
        }).setOrigin(0.5);

        // elixir count badge
        this.badge = scene.add.container(R - 6, -R + 8);
        const badgeBg = scene.add.graphics();
        badgeBg.fillStyle(0x2a1c4a, 0.98);
        badgeBg.lineStyle(3, GOLD, 0.95);
        badgeBg.fillRoundedRect(-36, -19, 72, 38, 17);
        badgeBg.strokeRoundedRect(-36, -19, 72, 38, 17);
        this.badgeText = text(scene, 0, 0, '×0', {
            fontSize: '20px', color: '#ffe9a8', fontStyle: 'bold',
        }).setOrigin(0.5);
        this.badge.add([badgeBg, this.badgeText]);

        inner.add([aura, plate, glyph, ...this.fireDots, label, this.badge]);
        this.button.add(inner);

        const zone = scene.add.zone(0, 0, 140, 140).setInteractive();
        this.button.add(zone);

        let pressed = false;
        this.press = () => {
            pressed = true;
            scene.tweens.killTweensOf(inner);
            inner.setScale(1);
            scene.tweens.add({ targets: inner, scale: 0.9, duration: 70, ease: 'Quad.easeOut' });
        };
        this.release = () => {
            if (!pressed) return;
            pressed = false;
            scene.tweens.killTweensOf(inner);
            scene.tweens.add({ targets: inner, scale: 1, duration: 320, ease: 'Back.easeOut' });
        };
        zone.on('pointerdown', () => { this.press(); this.toggle(); });
        zone.on('pointerup', this.release);
        zone.on('pointerout', () => { this.release(); drawPlate(false); });
        zone.on('pointerover', () => drawPlate(true));
        scene.input.on('pointerup', this.release);

        scene.tweens.add({
            targets: this.button,
            scale: { from: 1, to: 1.035 },
            y: { from: cy, to: cy - 4 },
            duration: 2400,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.easeInOut',
            delay: 380,
        });
        this.buttonAura = aura;
        this.buttonPos = { x: cx, y: cy };
        this.updateBadge();
    }

    updateBadge() {
        if (!this.badgeText) return;
        const elixirs = this.alchemy.getInventory().elixirs;
        const total = Object.values(elixirs).reduce((a, b) => a + b, 0);
        this.badgeText.setText(`×${total}`);
    }

    /** Attention pulse when an elixir lands on the shelf. */
    pulseButton() {
        const { scene } = this;
        if (!this.buttonAura) return;
        scene.tweens.killTweensOf(this.buttonAura);
        scene.tweens.add({
            targets: this.buttonAura,
            alpha: { from: 0.18, to: 0.75 },
            scale: { from: 1.4, to: 2.1 },
            duration: 480,
            yoyo: true,
            repeat: 2,
            ease: 'Sine.easeOut',
            onComplete: () => this.buttonAura.setAlpha(0.18).setScale(1.4),
        });
    }

    /* ================================ OVERLAY ================================ */
    createOverlay() {
        const { scene } = this;
        // root is stage-centred: every child below uses panel-relative coords
        this.root = scene.add.container(W / 2, H / 2).setDepth(LAYERS.MODAL + 25).setVisible(false).setAlpha(0);

        // dim MUST be parented into the overlay container (codex regression rule).
        // Tap-outside-to-close is guarded: a pointer inside the panel rect is
        // swallowed, never treated as a backdrop tap (mobile auto-close fix).
        const dim = scene.add.rectangle(0, 0, W, H, 0x05030c, 0.76).setInteractive();
        bindBackdropClose(dim, () => this.getPanelWorldRect(), () => this.close());
        this.dim = dim;
        this.root.add(dim);

        /* ---- panel ---- */
        const panel = scene.add.graphics();
        panel.fillStyle(INK, 0.98);
        panel.lineStyle(6, GOLD, 1);
        panel.fillRoundedRect(-PW / 2, -PH / 2, PW, PH, 28);
        panel.strokeRoundedRect(-PW / 2, -PH / 2, PW, PH, 28);
        panel.lineStyle(2, BRONZE_LIGHT, 0.75);
        panel.strokeRoundedRect(-PW / 2 + 16, -PH / 2 + 16, PW - 32, PH - 32, 20);
        this.root.add(panel);

        // Panel shield: captures every pointerdown inside the panel and calls
        // event.stopPropagation() so the backdrop beneath never closes the modal.
        this.panelShield = createPanelShield(scene, 0, 0, PW, PH);
        this.root.add(this.panelShield);

        this.closeButton = text(scene, PW / 2 - 46, -PH / 2 + 38, '×', {
            fontSize: '46px', color: '#ffb0b0', fontStyle: 'bold',
        }).setOrigin(0.5).setInteractive({ useHandCursor: true });
        this.closeButton.on('pointerdown', guarded(() => this.close()));
        this.root.add(this.closeButton);

        this.title = text(scene, 0, -PH / 2 + 52, 'LÒ LUYỆN ĐAN', {
            fontSize: '44px', color: '#ffe9a8', fontStyle: 'bold',
            stroke: '#3a1c5e', strokeThickness: 6,
        }).setOrigin(0.5);
        this.subtitle = text(scene, 0, -PH / 2 + 98, 'Luyện cánh hoa & Linh Dịch thành đan dược tiên · chín chuyển một lần', {
            fontSize: '21px', color: '#b9a3dd',
        }).setOrigin(0.5);
        this.buffLine = text(scene, 0, -PH / 2 + 132, '', {
            fontSize: '20px', color: '#9ff0ff', fontStyle: 'italic',
        }).setOrigin(0.5);
        this.root.add([this.title, this.subtitle, this.buffLine]);

        /* ---- cauldron + flame (the heart of the furnace) ---- */
        this.cauldron = this.buildCauldron();
        this.root.add(this.cauldron);

        /* ---- countdown + progress + CTA ---- */
        this.countdown = text(scene, 0, LAYOUT.countdownY, '', {
            fontSize: '24px', color: '#ffe9c4', fontStyle: 'bold',
            stroke: '#1b1140', strokeThickness: 5,
        }).setOrigin(0.5);
        this.root.add(this.countdown);

        this.progressBg = scene.add.graphics();
        this.progressBg.fillStyle(0x241540, 0.9);
        this.progressBg.lineStyle(2, BRONZE_LIGHT, 0.8);
        this.progressBg.fillRoundedRect(-220, LAYOUT.progressY - 7, 440, 14, 7);
        this.progressBg.strokeRoundedRect(-220, LAYOUT.progressY - 7, 440, 14, 7);
        this.progressFill = scene.add.graphics();
        this.root.add(this.progressBg, this.progressFill);

        /* ---- CTA: Luyện Đan / countdown / claim ---- */
        this.cta = scene.add.container(0, LAYOUT.ctaY);
        const ctaBg = scene.add.graphics();
        const ctaLabel = text(scene, 0, 0, 'Luyện Đan', {
            fontSize: '30px', color: '#fff7dd', fontStyle: 'bold',
        }).setOrigin(0.5);
        const ctaZone = scene.add.zone(0, 0, 460, 78).setInteractive({ useHandCursor: true });
        ctaZone.on('pointerdown', guarded(() => this.onCta()));
        this.cta.add([ctaBg, ctaLabel, ctaZone]);
        this.ctaBg = ctaBg;
        this.ctaLabel = ctaLabel;
        this.ctaZone = ctaZone;
        this.root.add(this.cta);

        /* ---- content area (rebuilt on state changes) ---- */
        this.content = scene.add.container(0, 0);
        this.root.add(this.content);

        this.setCtaState('idle');
        this.buildContent();
        return this;
    }

    /** Cauldron + fire assembly at (0, LAYOUT.cauldronY). */
    buildCauldron() {
        const { scene } = this;
        const c = scene.add.container(0, LAYOUT.cauldronY);
        const furnace = ALCHEMY_ASSETS.furnace_bagua;
        const furnaceKey = furnace.key;
        this.flameGraphic = null;
        this.furnaceImage = null;
        this.flamePhase = 0;

        // fire glow beneath the pot (sits behind the furnace art)
        const fireGlow = scene.add.image(0, 118, 'glow')
            .setTint(0xff7a2c).setAlpha(0.4).setScale(1.05, 0.5);
        scene.tweens.add({
            targets: fireGlow, alpha: { from: 0.28, to: 0.55 }, scale: { from: 1.0, to: 1.12 },
            duration: 700, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
        });
        c.add(fireGlow);

        if (scene.textures.exists(furnaceKey)) {
            // Bát Quái Lô — centred, origin from the art contract, breathing scale.
            const img = scene.add.image(0, 8, furnaceKey)
                .setOrigin(furnace.origin?.x ?? 0.5, furnace.origin?.y ?? 0.55);
            const maxH = 300;
            const srcH = furnace.height || img.height || maxH;
            const srcW = furnace.width || img.width || maxH;
            const k = maxH / srcH;
            img.setDisplaySize(srcW * k, srcH * k);
            const sx = img.scaleX;
            const sy = img.scaleY;
            scene.tweens.add({
                targets: img,
                scaleX: { from: sx * 0.985, to: sx * 1.04 },
                scaleY: { from: sy * 0.985, to: sy * 1.04 },
                duration: 2400,
                yoyo: true,
                repeat: -1,
                ease: 'Sine.easeInOut',
            });
            this.furnaceImage = img;
            c.add(img);
        } else {
            // Headless / missing-PNG fallback: the original vector pot.
            const pot = scene.add.graphics();
            drawCauldron(pot, 1);
            c.add(pot);

            const liqGlow = scene.add.image(0, -78, 'glow')
                .setTint(SPIRIT).setAlpha(0.35).setScale(0.85, 0.34);
            scene.tweens.add({
                targets: liqGlow, alpha: { from: 0.25, to: 0.5 }, duration: 1600,
                yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
            });
            c.add(liqGlow);

            const flame = scene.add.graphics();
            flame.fillStyle(FIRE, 0.9);
            flame.fillTriangle(-46, 128, 0, 194, 46, 128);
            flame.fillStyle(FIRE_CORE, 0.95);
            flame.fillTriangle(-24, 128, 0, 220, 24, 128);
            this.flameGraphic = flame;
            scene.tweens.add({
                targets: flame,
                alpha: { from: 0.72, to: 1 },
                duration: 340,
                yoyo: true,
                repeat: -1,
                ease: 'Sine.easeInOut',
            });
            c.add(flame);
        }

        // rising sparks from the furnace mouth
        this.flameSparks = scene.add.particles(0, -110, 'spark', {
            speedY: { min: -95, max: -35 },
            speedX: { min: -14, max: 14 },
            lifespan: { min: 500, max: 1100 },
            scale: { start: 0.4, end: 0 },
            alpha: { start: 0.85, end: 0 },
            rotate: { min: 0, max: 360 },
            tint: [0xffd97a, 0xff9a4c, 0x9ff0ff],
            frequency: 260,
            blendMode: Phaser.BlendModes.ADD,
        });
        c.add(this.flameSparks);

        // gentle furnace breathing (the whole assembly floats a few pixels)
        scene.tweens.add({
            targets: c, y: { from: LAYOUT.cauldronY - 4, to: LAYOUT.cauldronY + 4 },
            duration: 2600, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
        });
        return c;
    }

    /* ================================ CONTENT ================================
       Recipe cards → ingredient slots → herb shelf → elixir shelf. Built once
       per state change; `refreshCounts()` only re-writes the counters.      */
    buildContent() {
        if (!this.content) return this;
        this.content.removeAll(true);
        this.recipeCards = [];
        this.slots = [];
        this.herbChips = [];
        this.elixirChips = [];
        const { scene } = this;

        /* ---- elixir shelf (3 chips) ---- */
        ELIXIRS.forEach((e, i) => {
            const cx = -272 + i * 272;
            const chip = scene.add.container(cx, LAYOUT.elixirY);
            const g = scene.add.graphics();
            g.fillStyle(0x241540, 0.95);
            g.lineStyle(3, GOLD, 0.85);
            g.fillRoundedRect(-126, -44, 252, 88, 16);
            g.strokeRoundedRect(-126, -44, 252, 88, 16);
            const pillSpec = PILL_BY_ELIXIR[e.id];
            let pill = null;
            if (pillSpec && scene.textures.exists(pillSpec.key)) {
                pill = scene.add.image(-98, 0, pillSpec.key);
                fitImage(pill, 46, 46);
            } else {
                g.fillStyle(e.tint, 1);
                g.fillCircle(-98, 0, 20);
                g.fillStyle(0x170f24, 0.85);
                g.fillCircle(-98, -5, 11, 5); // elixir pill notch
            }
            const displayName = pillSpec?.description
                ? e.name
                : e.name;
            const name = text(scene, -64, pillSpec ? -16 : -14, displayName, {
                fontSize: '16px', color: '#ffe9c4', fontStyle: 'bold',
                wordWrap: { width: 100 }, align: 'left',
            });
            const flavor = pillSpec
                ? text(scene, -64, 4, pillHonorific(pillSpec), {
                    fontSize: '13px', color: '#9ff0ff', fontStyle: 'italic',
                })
                : null;
            const count = text(scene, -64, 22, '×0', {
                fontSize: '20px', color: '#ffe9a8', fontStyle: 'bold',
            });
            const useBg = scene.add.graphics();
            useBg.fillStyle(0x8a5fa8, 0.95);
            useBg.lineStyle(2, 0xd8b4ff, 0.9);
            useBg.fillRoundedRect(58, -20, 60, 40, 14);
            useBg.strokeRoundedRect(58, -20, 60, 40, 14);
            const useLabel = text(scene, 88, 0, 'Dùng', {
                fontSize: '18px', color: '#fff7dd', fontStyle: 'bold',
            }).setOrigin(0.5);
            const useZone = scene.add.zone(88, 0, 60, 40).setInteractive({ useHandCursor: true });
            useZone.on('pointerdown', guarded(() => this.onUseElixir(e.id)));
            chip.add([g, ...(pill ? [pill] : []), name, ...(flavor ? [flavor] : []), count, useBg, useLabel, useZone]);
            this.content.add(chip);
            this.elixirChips.push({ id: e.id, count, useBg, useLabel, useZone });
        });

        /* ---- recipe section ---- */
        this.content.add(text(scene, 0, LAYOUT.recipeTitleY, '✦ Công Thức Luyện Đan', {
            fontSize: '23px', color: '#ffd787', fontStyle: 'bold',
            stroke: '#1b1140', strokeThickness: 4,
        }).setOrigin(0.5));

        this.recipes.forEach((r, i) => {
            const cy = LAYOUT.cardTop + i * LAYOUT.cardStep;
            const card = scene.add.container(-400, cy);
            // background plate (redrawn on selection) — kept separate from the
            // static ingredient dots so a re-draw never wipes them
            const g = scene.add.graphics();
            const dots = scene.add.graphics();
            const draw = (selected) => {
                g.clear();
                g.fillStyle(selected ? 0x3c2a63 : 0x1f1433, 0.98);
                g.lineStyle(selected ? 4 : 2, selected ? 0xffe3a0 : BRONZE_LIGHT, selected ? 1 : 0.7);
                g.fillRoundedRect(0, 0, 800, 76, 14);
                g.strokeRoundedRect(0, 0, 800, 76, 14);
            };
            draw(this.selectedRecipeId === r.id);
            const pillSpec = PILL_BY_ELIXIR[r.elixirId];
            let pill = null;
            let textX = 24;
            if (pillSpec && scene.textures.exists(pillSpec.key)) {
                pill = scene.add.image(44, 38, pillSpec.key);
                fitImage(pill, 48, 48);
                textX = 78;
            }
            const name = text(scene, textX, 18, pillSpec
                ? `${r.name} · ${pillHonorific(pillSpec)}`
                : r.name, {
                fontSize: '22px', color: '#ffe9c4', fontStyle: 'bold',
            });
            const desc = text(scene, textX, 48, r.description, {
                fontSize: '16px', color: '#b9a3dd',
            });
            // ingredient dots + required counts (static)
            let ix = 470;
            const cnts = [];
            for (const [id, n] of Object.entries(r.ingredients)) {
                const herb = HERBS.find((h) => h.id === id);
                dots.fillStyle(herb?.tint ?? 0xffffff, 1);
                dots.fillCircle(ix, 26, 10);
                dots.lineStyle(2, 0x0d0818, 1);
                dots.strokeCircle(ix, 26, 10);
                cnts.push(text(scene, ix, 46, `×${n}`, {
                    fontSize: '16px', color: '#d8c3f2',
                }).setOrigin(0.5, 0));
                ix += 34;
            }
            const meta = text(scene, 782, 38, `${Math.round(r.durationMs / 1000)}s · ${Math.round(r.successRate * 100)}%`, {
                fontSize: '17px', color: '#9fd8ff',
            }).setOrigin(1, 0.5);
            const zone = scene.add.zone(0, 0, 800, 76).setInteractive({ useHandCursor: true });
            zone.on('pointerdown', guarded(() => this.selectRecipe(r.id)));
            card.add([g, ...(pill ? [pill] : []), name, desc, dots, ...cnts, meta, zone]);
            this.content.add(card);
            this.recipeCards.push({ recipe: r, card, draw, selected: this.selectedRecipeId === r.id });
        });

        /* ---- ingredient slot picker for the selected recipe ---- */
        const sel = this.getRecipe(this.selectedRecipeId);
        if (sel) {
            const entries = Object.entries(sel.ingredients);
            const slotW = 150;
            const gap = 26;
            const totalW = entries.length * slotW + (entries.length - 1) * gap;
            entries.forEach(([id, n], i) => {
                const herb = HERBS.find((h) => h.id === id);
                const sx = -totalW / 2 + slotW / 2 + i * (slotW + gap);
                const slot = scene.add.container(sx, LAYOUT.slotY);
                const g = scene.add.graphics();
                g.fillStyle(0x241540, 0.95);
                g.lineStyle(3, herb?.tint ?? GOLD, 0.9);
                g.fillRoundedRect(-slotW / 2, -50, slotW, 100, 14);
                g.strokeRoundedRect(-slotW / 2, -50, slotW, 100, 14);
                g.fillStyle(herb?.tint ?? 0xffffff, 1);
                g.fillCircle(0, -14, 17);
                g.lineStyle(2, 0x0d0818, 1);
                g.strokeCircle(0, -14, 17);
                const label = text(scene, 0, 16, herb?.name ?? id, {
                    fontSize: '17px', color: '#ffe9c4', fontStyle: 'bold',
                }).setOrigin(0.5);
                const count = text(scene, 0, 38, '0/0', {
                    fontSize: '18px', color: '#9ff0ff', fontStyle: 'bold',
                }).setOrigin(0.5);
                slot.add([g, label, count]);
                this.content.add(slot);
                this.slots.push({ id, need: n, count });
            });
        }

        /* ---- herb shelf (what the hands carry) ---- */
        this.content.add(text(scene, 0, LAYOUT.herbTitleY, 'Thảo Dược Trong Tay', {
            fontSize: '20px', color: '#ffd787', fontStyle: 'bold',
            stroke: '#1b1140', strokeThickness: 4,
        }).setOrigin(0.5));
        HERBS.forEach((h, i) => {
            const col = i % 3;
            const row = Math.floor(i / 3);
            const hx = -286 + col * 286;
            const hy = LAYOUT.herbTop + row * LAYOUT.herbStep;
            const chip = scene.add.container(hx, hy);
            const g = scene.add.graphics();
            g.fillStyle(0x1f1433, 0.95);
            g.lineStyle(2, BRONZE_LIGHT, 0.7);
            g.fillRoundedRect(-130, -28, 260, 56, 12);
            g.strokeRoundedRect(-130, -28, 260, 56, 12);
            g.fillStyle(h.tint, 1);
            g.fillCircle(-104, 0, 11);
            g.lineStyle(2, 0x0d0818, 1);
            g.strokeCircle(-104, 0, 11);
            const name = text(scene, -82, 0, h.name, {
                fontSize: '19px', color: '#e6d8ff',
            }).setOrigin(0, 0.5);
            const count = text(scene, 118, 0, '×0', {
                fontSize: '20px', color: '#ffe9a8', fontStyle: 'bold',
            }).setOrigin(1, 0.5);
            chip.add([g, name, count]);
            this.content.add(chip);
            this.herbChips.push({ id: h.id, count });
        });

        this.refreshCounts();
        this.tickUI();
        return this;
    }

    /** Re-write counters only (called on ingredient gains + the 2Hz tick). */
    refreshCounts() {
        if (!this.content) return;
        const inv = this.alchemy.getInventory();
        for (const chip of this.herbChips) {
            chip.count.setText(`×${inv.herbs[chip.id] ?? 0}`);
        }
        for (const chip of this.elixirChips) {
            const n = inv.elixirs[chip.id] ?? 0;
            chip.count.setText(`×${n}`);
            const on = n > 0;
            chip.useBg.alpha = on ? 1 : 0.35;
            chip.useLabel.alpha = on ? 1 : 0.5;
            chip.useZone.input = on;
        }
        for (const s of this.slots) {
            const have = inv.herbs[s.id] ?? 0;
            s.count.setText(`${have}/${s.need}`);
            s.count.setColor(have >= s.need ? '#9ff0ff' : '#ff9a9a');
        }
        // keep the selection highlight in sync (cheap: 3 cards, static dots
        // live on their own graphics and survive the re-draw)
        for (const card of this.recipeCards) {
            card.selected = card.recipe.id === this.selectedRecipeId;
            card.draw(card.selected);
        }
        this.updateBadge();
    }

    getRecipe(id) {
        return this.recipes.find((r) => r.id === id) ?? null;
    }

    selectRecipe(id) {
        this.selectedRecipeId = id;
        this.audio?.click?.(0);
        this.buildContent(); // re-flows the ingredient slots for the new recipe
    }

    /* --------------------------------- CTA ---------------------------------- */

    setCtaState(mode) {
        // modes: 'idle' | 'crafting' | 'claim'
        const ctaBg = this.ctaBg;
        ctaBg.clear();
        if (mode === 'claim') {
            ctaBg.fillStyle(0x2f8f6b, 0.98);
            ctaBg.lineStyle(4, 0x7dffb6, 1);
            ctaBg.fillRoundedRect(-230, -39, 460, 78, 38);
            ctaBg.strokeRoundedRect(-230, -39, 460, 78, 38);
        } else if (mode === 'crafting') {
            ctaBg.fillStyle(0x3a2810, 0.98);
            ctaBg.lineStyle(4, FIRE, 0.9);
            ctaBg.fillRoundedRect(-230, -39, 460, 78, 38);
            ctaBg.strokeRoundedRect(-230, -39, 460, 78, 38);
        } else {
            ctaBg.fillStyle(0x8a5fa8, 0.98);
            ctaBg.lineStyle(4, 0xffe3a0, 1);
            ctaBg.fillRoundedRect(-230, -39, 460, 78, 38);
            ctaBg.strokeRoundedRect(-230, -39, 460, 78, 38);
        }
        this.ctaMode = mode;
    }

    onCta() {
        if (this.ctaMode === 'claim' && this.lastOutcome?.success) {
            this.audio?.ensure?.();
            const result = this.alchemy.consume(this.lastOutcome.elixirId);
            if (!result.success) this.lastOutcome = null;
            return;
        }
        const recipe = this.getRecipe(this.selectedRecipeId);
        if (!recipe) return;
        if (this.alchemy.getCrafting()) return;
        const result = this.alchemy.craft(recipe.id);
        if (!result.success && result.reason === 'MISSING_INGREDIENTS') {
            this.audio?.click?.(0);
            this.flashCountdown('Thiếu thảo dược — thu hoạch hoa & tưới nước để tích lũy ✧');
        }
    }

    onUseElixir(elixirId) {
        this.audio?.ensure?.();
        const result = this.alchemy.consume(elixirId);
        if (!result.success) this.flashCountdown('Tủ đan còn trống ✧');
    }

    flashCountdown(msg) {
        this.hintMsg = msg;
        this.hintUntil = Date.now() + 2600;
        this.tickUI();
    }

    /** 2Hz: countdown, progress bar, CTA mode, buff line, slot/CTA state. */
    tickUI() {
        if (!this.content) return;
        const now = Date.now();
        const progress = this.alchemy.getCraftProgress();
        const buffs = this.alchemy.getBuffs();

        // buff line
        if (buffs.active.length) {
            this.buffLine.setText(
                buffs.active
                    .map((b) => `${b.label} · còn ${Math.max(1, Math.ceil(b.remainingMs / 1000))}s`)
                    .join('   ✦   '),
            );
        } else {
            this.buffLine.setText('');
        }

        // countdown + progress
        if (this.hintMsg && now < this.hintUntil) {
            this.countdown.setText(this.hintMsg);
        } else if (this.hintMsg) {
            this.hintMsg = null;
            this.countdown.setText('');
        } else if (progress) {
            this.countdown.setText(`Đang luyện ${progress.name}… ${Math.ceil(progress.remainingMs / 1000)}s`);
        } else if (this.lastOutcome?.success) {
            this.countdown.setText(`✦ ${this.lastOutcome.name} đã vào tủ đan — nhận và dùng ngay!`);
        } else if (this.lastOutcome && !this.lastOutcome.success && now - this.lastOutcome.at < 4000) {
            this.countdown.setText(this.lastOutcome.msg ?? '');
        } else {
            this.countdown.setText('');
        }

        this.progressFill.clear();
        if (progress) {
            const w = Math.max(10, 440 * Phaser.Math.Clamp(progress.percent, 0, 1));
            this.progressFill.fillStyle(FIRE_CORE, 0.95);
            this.progressFill.fillRoundedRect(-220 + (440 - w) / 2, LAYOUT.progressY - 7, w, 14, 7);
        }

        // CTA mode
        let mode = 'idle';
        if (progress) mode = 'crafting';
        else if (this.lastOutcome?.success && this.alchemy.getElixir(this.lastOutcome.elixirId) > 0) mode = 'claim';
        if (mode !== this.ctaMode) this.setCtaState(mode);

        const sel = this.getRecipe(this.selectedRecipeId);
        if (mode === 'crafting') {
            this.ctaLabel.setText('Đang luyện…');
        } else if (mode === 'claim') {
            this.ctaLabel.setText('✦ Nhận & Dùng Đan');
        } else {
            this.ctaLabel.setText('Luyện Đan');
        }
        const craftable = !progress && sel && this.alchemy.canCraft(sel.id);
        this.cta.alpha = (mode === 'claim' || craftable) ? 1 : 0.55;
        this.ctaZone.input = mode === 'claim' || craftable;

        // flame flicker phase (cheap scale jitter on top of the tween)
        this.flamePhase += 0.35;
        this.flameGraphic?.setScale(1 + Math.sin(this.flamePhase) * 0.03, 1 + Math.cos(this.flamePhase * 1.3) * 0.04);

        // HUD aura glows while a buff is live
        this.buttonAura?.setAlpha(buffs.active.length ? 0.4 : 0.18);
    }

    /* ------------------------------- open/close ------------------------------ */

    isOpen() {
        return this.visible;
    }

    /** World rect of the panel (used by the backdrop guard + tests). */
    getPanelWorldRect() {
        return localRectToWorld(this.root, -PW / 2, -PH / 2, PW, PH);
    }

    toggle() {
        if (this.visible) this.close();
        else this.open();
        return this;
    }

    open() {
        if (this.visible) return this;
        const { scene } = this;
        this.audio?.ensure?.();
        this.audio?.chime?.(659.25, { gain: 0.07 });
        this.audio?.pluck?.(392, { gain: 0.05, dur: 1.1 });
        this.visible = true;
        this.lastOutcome = null;
        this.hintMsg = null;
        this.buildContent();
        this.root.setVisible(true).setAlpha(0).setScale(0.965);
        scene.tweens.add({ targets: this.root, alpha: 1, scale: 1, duration: 260, ease: 'Back.easeOut' });
        return this;
    }

    close() {
        if (!this.visible) return this;
        const { scene } = this;
        this.visible = false;
        this.audio?.click?.(0);
        scene.tweens.add({
            targets: this.root, alpha: 0, scale: 0.975, duration: 200, ease: 'Quad.easeIn',
            onComplete: () => this.root.setVisible(false),
        });
        return this;
    }

    /** Transient banner inside the panel (under the subtitle, clear of the pot). */
    toast(message, tint) {
        const { scene } = this;
        const toastY = PY - 520;
        const banner = scene.add.text(W / 2, toastY, message, {
            fontFamily: DIALOG_FONT, fontSize: '27px', color: '#ffe9a8', fontStyle: 'bold',
            stroke: '#3a1c5e', strokeThickness: 8,
        }).setOrigin(0.5).setDepth(LAYERS.TOAST).setScale(0.6).setAlpha(0);
        scene.tweens.add({
            targets: banner, scale: 1, alpha: 1, duration: 360, ease: 'Back.easeOut',
            onComplete: () => {
                scene.tweens.add({
                    targets: banner, alpha: 0, y: banner.y - 40, delay: 1400, duration: 420,
                    onComplete: () => banner.destroy(),
                });
            },
        });
        const glow = scene.add.image(W / 2, toastY, 'glow').setTint(tint).setAlpha(0.3)
            .setScale(3.4, 1.05).setDepth(LAYERS.TOAST - 1);
        scene.tweens.add({ targets: glow, alpha: 0, duration: 900, onComplete: () => glow.destroy() });
    }

    /** Layout + state snapshot for the test suite / debug overlays. */
    getSnapshot() {
        return {
            open: this.visible,
            selectedRecipeId: this.selectedRecipeId,
            ctaLabel: this.ctaLabel?.text ?? '',
            ctaMode: this.ctaMode,
            buttonPos: this.buttonPos,
            buttonDepth: this.button?.depth ?? LAYERS.HUD,
            progress: this.alchemy.getCraftProgress(),
            elixirCount: this.elixirChips.map((c) => ({ id: c.id, n: this.alchemy.getElixir(c.id) })),
        };
    }

    destroy() {
        if (this.bus) for (const off of this.disposers) off();
        this.disposers = [];
        this._timer?.remove();
        this._timer = null;
        // the overlay + medallion are display-list children; tearing the root
        // down also releases the cauldron, flame and content container
        this.root?.destroy(true);
        this.button?.destroy(true);
        this.visible = false;
    }
}

/** Scale an image to fit inside (maxW × maxH) preserving aspect ratio. */
function fitImage(img, maxW, maxH) {
    const fw = img.width || 1;
    const fh = img.height || 1;
    const k = Math.min(maxW / fw, maxH / fh);
    img.setDisplaySize(fw * k, fh * k);
    return img;
}

/** "Trúc Cơ Đan — viên đan…" → "Trúc Cơ Đan" */
function pillHonorific(spec) {
    const d = spec?.description ?? '';
    const cut = d.split('—')[0].split(' - ')[0].trim();
    return cut || '';
}

export default AlchemyModal;
