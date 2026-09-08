/**
 * CodexModal — the UI half of System 9: VẠN HOA ĐỒ GIÁM (Flora Codex).
 *
 * Per 06_EXPANDED_SYSTEMS_ROADMAP.md #9 the codex is a calligraphy scroll
 * (trục thư pháp) holding, for every flower grown successfully, a painted
 * portrait, a biography and its poem. This class draws both halves:
 *
 *   1. an ornate scroll button parked on the top HUD (right column, below the
 *      Spirit Stone badge), with a discovery badge and an attention pulse;
 *   2. a full-screen classical scroll overlay: rolled top/bottom rods, aged
 *      parchment, ink-wash poem cartouches, a masked + draggable body, and a
 *      clean close button (✕ in the header *and* a thumb-height footer button).
 *
 * Layout is computed from the 1080x1920 stage with proportional margins, so the
 * scroll stays centered and readable at any 9:16 size (Scale.FIT does the
 * rest). All state comes from CodexManager, and every exchange with the other
 * systems goes through the shared EventManager bus.
 */
import Phaser from 'phaser';
import { LAYERS } from '../core/Layers.js';
import { EVENTS } from '../systems/EventManager.js';
import { SEED_BY_ID } from '../data/seedCatalog.js';
import { CODEX_UI } from '../data/codexLore.js';
import { DIALOG_FONT } from '../systems/DialogSystem.js';
import {
    bindBackdropClose, createModalBlocker, hideModalChrome, localRectToWorld,
    makeCloseLayer, showModalChrome,
} from './modalInput.js';

const W = 1080;
const H = 1920;

/* Scroll geometry — proportional to the stage, hence intrinsically
   responsive in 9:16 portrait. */
const SIDE_MARGIN = 44;
const PANEL = { x: SIDE_MARGIN, y: 178, w: W - SIDE_MARGIN * 2, h: H - 178 - 178 };
const ROD_H = 34; // rolled rod thickness (top + bottom)
const PAD = 40; // inner padding of the writing surface
const HEADER_H = 176; // title + progress + close button
const FOOTER_H = 118; // pinned close button
const BODY = {
    left: PANEL.x + PAD,
    top: PANEL.y + HEADER_H + 6,
    w: PANEL.w - PAD * 2,
    h: 0, // filled below
};
BODY.h = PANEL.y + PANEL.h - FOOTER_H - 8 - BODY.top;
BODY.bottom = BODY.top + BODY.h;

const INK = '#33224a';
const INK_SOFT = '#5b4776';
const INK_GOLD = '#7a4a1e';
const INK_MUTED = '#7c6b55';

const RARITY_VI = {
    common: 'Phổ Thông',
    uncommon: 'Quý Hiếm',
    rare: 'Sử Thi',
    legendary: 'Thần Thoại',
};
const RARITY_TINT = {
    common: 0x2f8f6b,
    uncommon: 0x8a5fa8,
    rare: 0xc98040,
    legendary: 0xb26bff,
};

const text = (scene, x, y, str, opts = {}) => scene.add.text(x, y, str, {
    fontFamily: DIALOG_FONT, ...opts,
});

export class CodexModal {
    /**
     * @param {Phaser.Scene} scene
     * @param {{codex: import('../systems/CodexManager.js').CodexManager,
     *          bus?: import('../systems/EventManager.js').EventManager,
     *          audio?: import('../audio/AudioManager.js').default}} deps
     */
    constructor(scene, { codex, bus = null, audio = null } = {}) {
        this.scene = scene;
        this.codex = codex;
        this.bus = bus;
        this.audio = audio;
        this.visible = false;
        this.scroll = 0;
        this.scrollMax = 0;
        this.dragging = null;
        this.disposers = [];
        this.rowNodes = [];
        this.headerNodes = [];
    }

    create() {
        this.createHudButton();
        this.createOverlay();
        this.bindBus();
        this.refresh();
        return this;
    }

    bindBus() {
        if (!this.bus) return this;
        this.disposers.push(
            // live refresh: anything written while the scroll is open re-flows
            this.bus.on(EVENTS.CODEX_ENTRY_UPDATED, () => { this.updateBadge(); if (this.visible) this.refresh(); }, { owner: 'codex-modal' }),
            this.bus.on(EVENTS.CODEX_SPECIES_DISCOVERED, (p) => this.celebrate(p), { owner: 'codex-modal' }),
            this.bus.on(EVENTS.CODEX_MILESTONE, (p) => this.celebrateMilestone(p), { owner: 'codex-modal' }),
        );
        return this;
    }

    /* =============================== HUD BUTTON ===============================
       Ornate scroll medallion on the top HUD: gold ring, parchment face, the
       keyed icon_codex_scroll art, a "n/5" discovery badge, breathing idle and
       press feedback — the same motion language as the bottom action bar.   */
    createHudButton() {
        const { scene } = this;
        const cx = 958;
        const cy = 322;
        const R = 54;

        this.button = scene.add.container(cx, cy).setDepth(LAYERS.HUD_BUTTONS);
        const inner = scene.add.container(0, 0);

        const plate = scene.add.graphics();
        const drawPlate = (hover) => {
            plate.clear();
            plate.fillStyle(0x1d1330, 0.95);
            plate.lineStyle(4, hover ? 0xffe3a0 : 0xd8a24e, 1);
            plate.fillCircle(0, 0, R);
            plate.strokeCircle(0, 0, R);
            plate.fillStyle(0xf3e6c6, 1); // parchment face
            plate.fillCircle(0, 0, R - 9);
            plate.lineStyle(2, 0x8a5fa8, 0.65);
            plate.strokeCircle(0, 0, R - 15);
        };
        drawPlate(false);

        const aura = scene.add.image(0, 0, 'glow')
            .setTint(0xffd97a).setAlpha(0.22).setScale(1.5);
        const icon = scene.add.image(0, 0, 'icon_codex_scroll').setDisplaySize(84, 84);
        const label = text(scene, 0, R + 18, CODEX_UI.buttonLabel, {
            fontSize: '20px', color: '#ffe9c4', fontStyle: 'bold',
            stroke: '#1b1140', strokeThickness: 5,
        }).setOrigin(0.5);

        // discovery badge (n/5)
        this.badge = scene.add.container(R - 4, -R + 10);
        const badgeBg = scene.add.graphics();
        badgeBg.fillStyle(0x2a1c4a, 0.98);
        badgeBg.lineStyle(3, 0xffe3a0, 0.95);
        badgeBg.fillRoundedRect(-42, -20, 84, 40, 18);
        badgeBg.strokeRoundedRect(-42, -20, 84, 40, 18);
        this.badgeText = text(scene, 0, 1, '0/5', {
            fontSize: '21px', color: '#ffe9a8', fontStyle: 'bold',
        }).setOrigin(0.5);
        this.badge.add([badgeBg, this.badgeText]);

        inner.add([aura, plate, icon, label, this.badge]);
        this.button.add(inner);

        const zone = scene.add.zone(0, 0, 152, 152).setInteractive();
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
        });
        this.buttonAura = aura;
        this.buttonRadius = R;
        this.buttonPos = { x: cx, y: cy };
        this.updateBadge();
    }

    updateBadge() {
        if (!this.badgeText || !this.codex) return;
        const p = this.codex.getProgress();
        this.badgeText.setText(`${p.discovered}/${p.total}`);
    }

    /** Attention pulse when new lore is written into the scroll. */
    pulseButton() {
        const { scene } = this;
        if (!this.buttonAura) return;
        scene.tweens.killTweensOf(this.buttonAura);
        scene.tweens.add({
            targets: this.buttonAura,
            alpha: { from: 0.22, to: 0.78 },
            scale: { from: 1.5, to: 2.35 },
            duration: 480,
            yoyo: true,
            repeat: 2,
            ease: 'Sine.easeOut',
            onComplete: () => this.buttonAura.setAlpha(0.22).setScale(1.5),
        });
    }

    /* ================================ OVERLAY ================================ */
    createOverlay() {
        const { scene } = this;
        /* modal depth contract (HUD punch-through fix, see modalInput.js):
           blocker 9000 · window 9500 (this root) · close 9999 */
        this.root = scene.add.container(0, 0).setDepth(LAYERS.MODAL_WINDOW).setVisible(false).setAlpha(0);

        // Blocker: full-screen interactive dark veil at 9000. It starts
        // hidden and only owns the stage while the scroll is open, so the
        // closed garden is never veiled. Taps outside the sheet close it;
        // taps inside the sheet rect are swallowed (mobile auto-close fix).
        this.dim = createModalBlocker(scene, {
            x: W / 2, y: H / 2, width: W, height: H, color: 0x05030c, alpha: 0.74,
        });
        bindBackdropClose(this.dim, () => this.getPanelWorldRect(), () => this.close());

        this.frame = scene.add.graphics();
        this.root.add(this.frame);

        // aged rice-paper grain over the sheet (procedural texture, multiply)
        if (scene.textures.exists('parchment')) {
            this.parchment = scene.add.image(PANEL.x + PANEL.w / 2, PANEL.y + PANEL.h / 2, 'parchment')
                .setDisplaySize(PANEL.w, PANEL.h)
                .setAlpha(0.5)
                .setBlendMode(Phaser.BlendModes.MULTIPLY);
            this.root.add(this.parchment);
        }

        /* ---- writing surface (masked, scrollable) ---- */
        this.content = scene.add.container(0, 0);
        const maskG = scene.make.graphics();
        maskG.fillStyle(0xffffff, 1);
        maskG.fillRect(BODY.left, BODY.top, BODY.w, BODY.h);
        this.bodyMask = maskG.createGeometryMask();
        this.content.setMask(this.bodyMask);

        /* ---- drag surface for scrolling the body ---- */
        this.bodyZone = scene.add.zone(BODY.left + BODY.w / 2, BODY.top + BODY.h / 2, BODY.w, BODY.h)
            .setInteractive({ draggable: false });
        this.bodyZone.on('pointerdown', (p) => { this.dragging = { y: p.y, from: this.scroll }; });

        /* ---- scroll-affordance + fade ---- */
        this.scrollHint = text(scene, PANEL.x + PANEL.w - 34, BODY.bottom - 6, '⇕', {
            fontSize: '26px', color: '#8c7a63',
        }).setOrigin(1, 0.5);
        this.fade = scene.add.graphics();

        /* ---- footer close button (thumb height, pinned) — top-level at 9999 */
        this.closeBtn = makeCloseLayer(scene, scene.add.container(W / 2, BODY.bottom + FOOTER_H / 2 + 2));
        const cbG = scene.add.graphics();
        cbG.fillStyle(0x2a1c4a, 0.98);
        cbG.lineStyle(4, 0xd8a24e, 1);
        cbG.fillRoundedRect(-268, -38, 536, 76, 36);
        cbG.strokeRoundedRect(-268, -38, 536, 76, 36);
        const cbText = text(scene, 0, 1, CODEX_UI.closeLabel, {
            fontSize: '27px', color: '#ffe9c4', fontStyle: 'bold',
            stroke: '#1b1140', strokeThickness: 5,
        }).setOrigin(0.5);
        const cbZone = scene.add.zone(0, 0, 536, 76).setInteractive();
        cbZone.on('pointerdown', () => {
            scene.tweens.add({ targets: this.closeBtn, scale: 0.95, yoyo: true, duration: 90 });
            this.close();
        });
        this.closeBtn.add([cbG, cbText, cbZone]);

        this.root.add([this.content, this.fade, this.scrollHint, this.bodyZone]);

        this.wheelHandler = (p, over, dx, dy) => {
            if (this.visible) this.setScroll(this.scroll + dy * 0.6);
        };
        scene.input.on('wheel', this.wheelHandler);
    }

    /** Ornate rods, parchment sheet and borders (drawn per refresh). */
    drawFrame() {
        const g = this.frame;
        const { scene } = this;
        void scene;
        g.clear();

        const { x, y, w, h } = PANEL;

        // lacquer board behind the sheet
        g.fillStyle(0x241223, 0.99);
        g.fillRoundedRect(x - 12, y - 12, w + 24, h + 24, 26);
        g.lineStyle(4, 0xd8a24e, 1);
        g.strokeRoundedRect(x - 12, y - 12, w + 24, h + 24, 26);

        // parchment sheet
        g.fillStyle(0xf0e3c4, 1);
        g.fillRoundedRect(x, y, w, h, 18);

        // rolled rods with gold caps (top + bottom)
        for (const [rodY, dir] of [[y - 14, -1], [y + h + 14, 1]]) {
            g.fillStyle(0x4a2a18, 1);
            g.fillRoundedRect(x - 34, rodY - ROD_H / 2, w + 68, ROD_H, ROD_H / 2);
            g.lineStyle(3, 0x8a5a26, 1);
            g.strokeRoundedRect(x - 34, rodY - ROD_H / 2, w + 68, ROD_H, ROD_H / 2);
            g.fillStyle(0x6b431f, 0.6);
            g.fillRoundedRect(x - 30, rodY - 6, w + 60, 6, 3);
            for (const capX of [x - 48, x + w + 14]) {
                g.fillStyle(0xd8a24e, 1);
                g.fillRoundedRect(capX, rodY - ROD_H / 2 - 5, 34, ROD_H + 10, 8);
                g.fillStyle(0xffe3a0, 0.9);
                g.fillRoundedRect(capX + 7, rodY - 7, 20, 14, 6);
            }
            if (dir > 0) {
                // silk cord + jade bead dangling from the lower rod
                g.lineStyle(4, 0xb26bff, 0.85);
                g.lineBetween(W / 2, rodY + ROD_H / 2, W / 2, rodY + ROD_H / 2 + 28);
                g.fillStyle(0x7dffb6, 0.9);
                g.fillCircle(W / 2, rodY + ROD_H / 2 + 36, 9);
            }
        }

        // inner rules
        g.lineStyle(2, 0x8a5fa8, 0.45);
        g.strokeRect(x + 18, y + 18, w - 36, h - 36);
        g.lineStyle(2, 0x6a3f16, 0.28);
        g.strokeRect(BODY.left - 14, BODY.top - 14, BODY.w + 28, BODY.h + 28);

        // header + footer rules
        g.lineStyle(3, 0xd8a24e, 0.8);
        g.lineBetween(x + 30, y + HEADER_H - 14, x + w - 30, y + HEADER_H - 14);
        g.fillStyle(0x8a5fa8, 0.9);
        g.fillTriangle(x + w / 2, y + HEADER_H - 22, x + w / 2 + 9, y + HEADER_H - 14, x + w / 2 - 9, y + HEADER_H - 14);
        g.lineStyle(3, 0xb98a3e, 0.6);
        g.lineBetween(x + 30, BODY.bottom + 14, x + w - 30, BODY.bottom + 14);
    }

    /* ============================== open / close ============================= */

    isOpen() {
        return this.visible;
    }

    /** World rect of the parchment sheet (backdrop-close guard + tests). */
    getPanelWorldRect() {
        return localRectToWorld(this.root, PANEL.x, PANEL.y, PANEL.w, PANEL.h);
    }

    toggle() {
        if (this.visible) this.close();
        else this.open();
    }

    open() {
        if (this.visible) return this;
        const { scene } = this;
        this.audio?.ensure?.();
        this.audio?.chime?.(880, { gain: 0.07 });
        this.audio?.pluck?.(523.25, { gain: 0.05, dur: 1.1 });
        this.visible = true;
        this.refresh();
        showModalChrome(scene, { blocker: this.dim, window: this.root, close: this.closeBtn },
            { duration: 260, popScale: 0.965 });
        // unroll: the ink flows in just after the sheet appears
        scene.tweens.add({ targets: this.content, alpha: { from: 0, to: 1 }, duration: 320, delay: 90 });
        this.bus?.emit(EVENTS.CODEX_OPENED, { progress: this.codex.getProgress() });
        return this;
    }

    close() {
        if (!this.visible) return this;
        const { scene } = this;
        this.visible = false;
        this.dragging = null;
        this.audio?.click?.(0);
        hideModalChrome(scene, { blocker: this.dim, window: this.root, close: this.closeBtn },
            { duration: 200, popScale: 0.975 });
        this.bus?.emit(EVENTS.CODEX_CLOSED, {});
        return this;
    }

    /* ================================= CONTENT ===============================
       One page per species (painting + biography + poem + mastery), then the
       collection milestones, then the aggregated buff list, then (at 5/5) the
       full-scope poem Vạn Hoa Ca. Rows flow top-down and the body scrolls.  */
    refresh() {
        if (!this.root || !this.codex) return this;
        this.destroyRows(this.rowNodes);
        this.destroyRows(this.headerNodes);
        this.drawFrame();
        this.buildHeader();

        let y = BODY.top + 4;
        const pages = this.codex.getPages();
        const found = pages.filter((p) => p.discovered).length;

        y = this.sectionTitle(y, 'Bách Thảo Ký', `${found} / ${pages.length} loài đã chép vào trục`);
        for (const page of pages) y = this.buildSpeciesPage(y, page);

        y = this.sectionTitle(y + 8, 'Mốc Sưu Tập', 'Danh hiệu & skin công cụ');
        for (const m of this.codex.getMilestoneRows()) y = this.buildMilestoneRow(y, m);

        y = this.sectionTitle(y + 8, 'Buff Đang Kích Hoạt', 'Linh khí hồi đáp người trồng');
        const buffs = this.codex.getActiveBuffs();
        if (!buffs.length) {
            y = this.noteRow(y, 'Trục thư còn trắng — sưu tập thêm loài để linh khí hồi đáp người trồng ✧');
        } else {
            for (const b of buffs) y = this.buildBuffRow(y, b);
        }

        if (this.codex.fullPoemUnlocked) y = this.buildFullPoem(y + 6);

        const contentBottom = y + 8;
        this.contentBottom = contentBottom;
        this.scrollMax = Math.max(0, Math.ceil(contentBottom - BODY.bottom));
        this.setScroll(Math.min(this.scroll, this.scrollMax));
        return this;
    }

    destroyRows(list) {
        for (const node of list) {
            if (node && node.active !== false && typeof node.destroy === 'function') node.destroy();
        }
        list.length = 0;
    }

    buildHeader() {
        const { scene } = this;
        const p = this.codex.getProgress();
        const x = PANEL.x + PAD;

        // indented past the close disc (PANEL.x + 46, r 34) so the title is
        // never clipped by the button sitting on top of it
        const title = text(scene, PANEL.x + 100, PANEL.y + 40, CODEX_UI.header, {
            fontSize: '46px', color: '#4a2c14', fontStyle: 'bold',
            stroke: '#fbf3df', strokeThickness: 3,
        });
        const sub = text(scene, PANEL.x + 101, PANEL.y + 100, CODEX_UI.subHeader, {
            fontSize: '21px', color: INK_SOFT,
        });
        const stats = text(scene, PANEL.x + PANEL.w - PAD, PANEL.y + 52,
            `✿ ${p.harvests} thu hoạch · ${p.blooms} lần nở · ${p.percent}%`, {
            fontSize: '21px', color: INK_GOLD, align: 'right',
        }).setOrigin(1, 0);
        const titleChip = text(scene, PANEL.x + PANEL.w - PAD, PANEL.y + 84,
            p.title ? `Danh hiệu: ${p.title}` : 'Chưa có danh hiệu', {
            fontSize: '20px', color: p.title ? '#6b3f8f' : INK_MUTED, fontStyle: p.title ? 'bold' : 'normal', align: 'right',
        }).setOrigin(1, 0);

        // clean close button (top-left of the header, high contrast on paper)
        const close = scene.add.container(PANEL.x + 46, PANEL.y + 52);
        const cg = scene.add.graphics();
        cg.fillStyle(0x2a1c4a, 0.96);
        cg.lineStyle(3, 0xd8a24e, 1);
        cg.fillCircle(0, 0, 34);
        cg.strokeCircle(0, 0, 34);
        const xLabel = text(scene, 0, 1, '✕', { fontSize: '36px', color: '#ffd7d7', fontStyle: 'bold' }).setOrigin(0.5);
        const cz = scene.add.zone(0, 0, 100, 100).setInteractive();
        cz.on('pointerdown', () => {
            scene.tweens.add({ targets: close, scale: 0.9, yoyo: true, duration: 90 });
            this.close();
        });
        close.add([cg, xLabel, cz]);

        this.headerNodes = [title, sub, stats, titleChip, close];
        this.root.add(this.headerNodes);
        this.headerCloseButton = close;
        this.headerTitle = title;
        this.headerStatsText = stats;
    }

    /** Dark brush band with a section title + a right-aligned hint. */
    sectionTitle(y, label, hint) {
        const { scene } = this;
        const c = scene.add.container(BODY.left, y);
        const g = scene.add.graphics();
        g.fillStyle(0x2b1d3f, 0.92);
        g.fillRoundedRect(0, 0, BODY.w, 54, 12);
        g.lineStyle(2, 0xd8a24e, 0.5);
        g.strokeRoundedRect(0, 0, BODY.w, 54, 12);
        c.add([
            g,
            text(scene, 18, 27, `❖ ${label}`, { fontSize: '25px', color: '#ffe9c4', fontStyle: 'bold' }).setOrigin(0, 0.5),
            text(scene, BODY.w - 18, 27, hint || '', { fontSize: '19px', color: '#d8c3f2' }).setOrigin(1, 0.5),
        ]);
        this.attach(c, y);
        return y + 66;
    }

    /**
     * One species page. The card height is derived from its own content, so
     * longer biographies or a 4-line poem never overflow the neighbouring row.
     */
    buildSpeciesPage(y, page) {
        const { scene } = this;
        const lore = page.lore || {};
        const seed = SEED_BY_ID[page.seedId] || {};
        const discovered = page.discovered;
        const tx = 168; // text column start (painting occupies 0..160)
        const tw = BODY.w - tx - 20;

        const c = scene.add.container(BODY.left, y);
        const bg = scene.add.graphics();
        c.add(bg); // first child = always the backdrop

        let cy = 20;

        // painting (or the blank, sealed page)
        const artBox = { x: 80, y: 96, size: 116 };
        if (discovered) {
            const glow = scene.add.image(artBox.x, artBox.y, 'glow')
                .setTint(seed.petals ?? 0xffe3a0).setAlpha(0.42).setScale(1.05);
            const art = scene.add.image(artBox.x, artBox.y, seed.sprite_key ?? 'flower_cyan')
                .setDisplaySize(artBox.size, artBox.size);
            c.add([glow, art]);
        } else {
            const lock = scene.add.graphics();
            lock.fillStyle(0xdccdaa, 0.75);
            lock.fillRoundedRect(artBox.x - 58, artBox.y - 58, 116, 116, 14);
            lock.lineStyle(3, 0xa89880, 0.85);
            lock.strokeRoundedRect(artBox.x - 58, artBox.y - 58, 116, 116, 14);
            lock.lineStyle(2, 0xa89880, 0.5);
            lock.lineBetween(artBox.x - 46, artBox.y + 30, artBox.x + 46, artBox.y - 42);
            c.add(lock);
            c.add(text(scene, artBox.x, artBox.y - 4, '?', {
                fontSize: '56px', color: '#8c7a63', fontStyle: 'bold',
            }).setOrigin(0.5));
        }

        // name + rarity chip
        const name = text(scene, tx, cy, discovered ? (lore.scrollTitle || seed.name || page.seedId) : CODEX_UI.lockedName, {
            fontSize: '29px', color: discovered ? INK : INK_MUTED, fontStyle: 'bold',
        });
        c.add(name);
        const rarityVi = RARITY_VI[seed.rarity] || RARITY_VI.common;
        const chip = scene.add.text(BODY.w - 20, cy + 4, discovered ? rarityVi : 'Chưa xác định', {
            fontFamily: DIALOG_FONT, fontSize: '18px', color: '#fff6e2', fontStyle: 'bold',
            backgroundColor: discovered ? `#${(RARITY_TINT[seed.rarity] ?? 0x2f8f6b).toString(16).padStart(6, '0')}` : '#9c8f7c',
            padding: { x: 12, y: 5 },
        }).setOrigin(1, 0);
        c.add(chip);
        cy += 40;

        const sub = text(scene, tx, cy, discovered
            ? `${seed.name ?? ''} · ${seed.english ?? ''}`
            : CODEX_UI.lockedText, {
            fontSize: '18px', color: INK_SOFT, wordWrap: { width: tw },
        });
        c.add(sub);
        cy += sub.height + 12;

        if (discovered) {
            const bio = text(scene, tx, cy, lore.biography ?? '', {
                fontSize: '17px', color: '#41305a', wordWrap: { width: tw }, lineSpacing: 4,
            });
            c.add(bio);
            cy += bio.height + 10;
            const meta = text(scene, tx, cy,
                `✿ Nở ${page.blooms} · Thu hoạch ${page.harvests} · ${lore.habitat ?? ''}`, {
                fontSize: '16px', color: INK_GOLD,
            });
            c.add(meta);
            cy += meta.height + 14;

            // ---- poem cartouche (ink wash) ----
            const poemLines = (page.poem?.lines ?? []).slice();
            const verseBlock = page.verse ? page.verse.lines.map((l) => `    ${l}`) : [];
            const allLines = [...poemLines, ...verseBlock];
            const cartH = Math.max(96, allLines.length * 24 + 46);
            const cart = scene.add.graphics();
            cart.fillStyle(0x2b1d3f, 0.94);
            cart.fillRoundedRect(tx - 148, cy, BODY.w - (tx - 148) - 20, cartH, 14);
            cart.lineStyle(2, 0xd8a24e, 0.55);
            cart.strokeRoundedRect(tx - 148, cy, BODY.w - (tx - 148) - 20, cartH, 14);
            c.add(cart);
            const poemTitle = text(scene, tx - 130, cy + 12, page.poem ? `Thơ: ${page.poem.title}` : '', {
                fontSize: '16px', color: '#d8c3f2', fontStyle: 'italic',
            });
            c.add(poemTitle);
            const poem = text(scene, tx - 130, cy + 40, allLines.join('\n'), {
                fontSize: '17px', color: '#f6ead0', fontStyle: 'italic', lineSpacing: 6,
            });
            c.add(poem);
            cy += cartH + 12;

            // ---- mastery ribbon ----
            const tiers = page.unlockedTiers || [];
            const next = page.nextTier;
            const mastery = tiers.length
                ? `✦ ${tiers.map((t) => `${t.name}: ${t.gain}`).join('   ·   ')}`
                : `✦ Chưa có bậc thành thạo — còn ${Math.max(0, (next?.atHarvests ?? 0) - page.harvests)} lần thu hoạch tới bậc ${next?.name ?? ''}`;
            const mh = text(scene, tx - 130, cy + 6, mastery, {
                fontSize: '16px', color: '#4a2c14', wordWrap: { width: BODY.w - (tx - 130) - 24 }, lineSpacing: 3,
            });
            c.add(mh);
            cy += mh.height + 16;
        } else {
            const hint = text(scene, tx, cy,
                'Chưa có tranh, chưa có thơ. Gieo hạt, tưới nước và để hoa nở một lần — trục thư sẽ tự chép ✦', {
                fontSize: '17px', color: INK_MUTED, wordWrap: { width: tw }, lineSpacing: 4, fontStyle: 'italic',
            });
            c.add(hint);
            cy += hint.height + 22;
        }

        const cardH = Math.max(150, Math.ceil(cy));
        bg.fillStyle(discovered ? 0xf7ecd4 : 0xe6d8bd, discovered ? 0.92 : 0.7);
        bg.fillRoundedRect(0, 0, BODY.w, cardH, 18);
        bg.lineStyle(3, discovered ? 0xb98a3e : 0xa89880, discovered ? 0.95 : 0.5);
        bg.strokeRoundedRect(0, 0, BODY.w, cardH, 18);
        if (discovered) {
            bg.fillStyle(0xb98a3e, 0.5);
            bg.fillRoundedRect(6, 16, 5, cardH - 32, 3); // ink brush margin rule
        }

        this.attach(c, y);
        return y + cardH + 14;
    }

    buildMilestoneRow(y, m) {
        const { scene } = this;
        const c = scene.add.container(BODY.left, y);
        const g = scene.add.graphics();
        g.fillStyle(m.unlocked ? 0xf3e6c6 : 0xe8dcc0, 0.8);
        g.fillRoundedRect(0, 0, BODY.w, 62, 12);
        g.lineStyle(2, m.unlocked ? 0x1f7a4a : 0xb0a084, m.unlocked ? 0.8 : 0.5);
        g.strokeRoundedRect(0, 0, BODY.w, 62, 12);
        c.add([
            g,
            text(scene, 16, 31, m.unlocked ? '✓' : '◇', {
                fontSize: '26px', color: m.unlocked ? '#1f7a4a' : '#8c7a63',
            }).setOrigin(0.5),
            text(scene, 44, 15, m.title, { fontSize: '21px', color: INK, fontStyle: 'bold' }),
            text(scene, 44, 39, `Sưu tập ${m.at} loài`, { fontSize: '16px', color: INK_SOFT }),
            text(scene, BODY.w - 16, 31, m.rewardText, {
                fontSize: '17px', color: m.unlocked ? '#6b3f8f' : INK_MUTED, align: 'right',
            }).setOrigin(1, 0.5),
        ]);
        this.attach(c, y);
        return y + 70;
    }

    buildBuffRow(y, b) {
        const { scene } = this;
        const c = scene.add.container(BODY.left, y);
        const g = scene.add.graphics();
        g.fillStyle(0xdff0e2, 0.85);
        g.fillRoundedRect(0, 0, BODY.w, 64, 12);
        g.lineStyle(2, 0x2f8f6b, 0.65);
        g.strokeRoundedRect(0, 0, BODY.w, 64, 12);
        c.add([
            g,
            text(scene, 16, 32, '✦', { fontSize: '24px', color: '#1f7a4a' }).setOrigin(0, 0.5),
            text(scene, 46, 14, b.label, { fontSize: '20px', color: INK, fontStyle: 'bold', wordWrap: { width: BODY.w - 260 } }),
            text(scene, 46, 38, b.detail, { fontSize: '17px', color: '#41305a', wordWrap: { width: BODY.w - 260 } }),
            text(scene, BODY.w - 16, 32, b.source, { fontSize: '16px', color: INK_SOFT, align: 'right' }).setOrigin(1, 0.5),
        ]);
        this.attach(c, y);
        return y + 72;
    }

    noteRow(y, message) {
        const { scene } = this;
        const c = scene.add.container(BODY.left, y);
        const t = text(scene, 16, 12, message, {
            fontSize: '19px', color: INK_MUTED, fontStyle: 'italic', wordWrap: { width: BODY.w - 32 },
        });
        c.add(t);
        this.attach(c, y);
        return y + t.height + 22;
    }

    buildFullPoem(y) {
        const { scene } = this;
        const poem = this.codex.fullPoem;
        const c = scene.add.container(BODY.left, y);
        const g = scene.add.graphics();
        const lines = poem.lines ?? [];
        const h = lines.length * 30 + 72;
        g.fillStyle(0x2b1d3f, 0.95);
        g.fillRoundedRect(0, 0, BODY.w, h, 18);
        g.lineStyle(3, 0xffe3a0, 0.8);
        g.strokeRoundedRect(0, 0, BODY.w, h, 18);
        c.add([
            g,
            text(scene, BODY.w / 2, 20, `✦ ${poem.title} ✦`, {
                fontSize: '26px', color: '#ffe9a8', fontStyle: 'bold', align: 'center',
            }).setOrigin(0.5, 0),
            text(scene, BODY.w / 2, 60, lines.join('\n'), {
                fontSize: '21px', color: '#e6d8ff', align: 'center', lineSpacing: 7,
            }).setOrigin(0.5, 0),
        ]);
        this.attach(c, y);
        return y + h + 20;
    }

    /** Put a finished row into the scrollable content and remember it. */
    attach(container, y) {
        container.setY(y);
        this.content.add(container);
        this.rowNodes.push(container);
    }

    setScroll(value) {
        this.scroll = Math.max(0, Math.min(value, this.scrollMax));
        this.content.y = -this.scroll;
        const canScroll = this.scrollMax > 0;
        const atEnd = this.scroll >= this.scrollMax - 0.5;
        this.scrollHint.setVisible(canScroll);
        this.fade.setVisible(canScroll && !atEnd);
        if (canScroll && !atEnd) {
            this.fade.clear();
            this.fade.fillGradientStyle(0xf0e3c4, 0xf0e3c4, 0xf0e3c4, 0xf0e3c4, 0, 0, 0.92, 0.92);
            this.fade.fillRect(BODY.left, BODY.bottom - 34, BODY.w, 34);
        }
        return this.scroll;
    }

    /** GardenScene forwards body drags here (single global pointer handler). */
    handleDragMove(pointer) {
        if (!this.dragging || !this.visible) return;
        this.setScroll(this.dragging.from + (this.dragging.y - pointer.y));
    }

    handleDragEnd() {
        this.dragging = null;
    }

    /* ------------------------------- celebrations --------------------------- */

    celebrate({ seedId, lore }) {
        this.updateBadge();
        const seed = SEED_BY_ID[seedId] || {};
        this.toast(`✦ Đồ Giám chép mới: ${lore?.scrollTitle || seed.name || seedId}`, 0xd8a24e);
    }

    celebrateMilestone({ title, rewardText }) {
        this.toast(`🏆 ${title} — ${rewardText}`, 0x7ff7ff);
        this.pulseButton();
    }

    /** Transient banner inside the sheet. It is deliberately placed on the
        parchment (below the header, over the content) instead of the top of the
        stage: up there it would collide with the title and the HUD badges. */
    toast(message, tint) {
        const { scene } = this;
        const y = BODY.top + 62;
        const banner = scene.add.text(W / 2, y, message, {
            fontFamily: DIALOG_FONT, fontSize: '28px', color: '#ffe9a8', fontStyle: 'bold',
            stroke: '#3a1c5e', strokeThickness: 8,
        }).setOrigin(0.5).setDepth(LAYERS.TOAST).setScale(0.6).setAlpha(0);
        scene.tweens.add({
            targets: banner, scale: 1, alpha: 1, duration: 360, ease: 'Back.easeOut',
            onComplete: () => {
                scene.tweens.add({
                    targets: banner, alpha: 0, y: banner.y - 40, delay: 1500, duration: 420,
                    onComplete: () => banner.destroy(),
                });
            },
        });
        const glow = scene.add.image(W / 2, y, 'glow').setTint(tint).setAlpha(0.35)
            .setScale(3.6, 1.15).setDepth(LAYERS.TOAST - 1);
        scene.tweens.add({ targets: glow, alpha: 0, duration: 950, onComplete: () => glow.destroy() });
    }

    /** Layout + state snapshot for the test suite / debug overlays. */
    getSnapshot() {
        return {
            open: this.visible,
            panel: { ...PANEL },
            body: { ...BODY },
            bodyMaxH: BODY.h,
            scroll: this.scroll,
            scrollMax: this.scrollMax,
            contentBottom: this.contentBottom ?? 0,
            rowCount: this.rowNodes.length,
            pages: this.codex?.getPages?.().length ?? 0,
            discovered: this.codex?.getDiscoveredCount?.() ?? 0,
            depth: this.root?.depth ?? LAYERS.MODAL_WINDOW,
            aboveAmbient: (this.root?.depth ?? LAYERS.MODAL_WINDOW) > LAYERS.AMBIENT,
            buttonDepth: this.button?.depth ?? LAYERS.HUD_BUTTONS,
            buttonAboveAmbient: (this.button?.depth ?? LAYERS.HUD_BUTTONS) > LAYERS.AMBIENT,
        };
    }

    destroy() {
        const { scene } = this;
        if (this.bus) for (const off of this.disposers) off();
        this.disposers = [];
        if (this.wheelHandler) scene.input.off('wheel', this.wheelHandler);
        if (this.release) scene.input.off('pointerup', this.release);
        this.destroyRows(this.rowNodes);
        this.destroyRows(this.headerNodes);
        this.parchment?.destroy?.();
        this.dim?.destroy?.();
        this.closeBtn?.destroy?.(true);
        this.root?.destroy?.();
        this.button?.destroy?.();
        this.dim = this.closeBtn = null;
    }
}

export default CodexModal;
