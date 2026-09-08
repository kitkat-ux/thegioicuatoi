/**
 * RealmModal — Bí Cảnh (Secret Realms) portal selector UI.
 *
 * Dark Guofeng overlay listing all unlocked realms with thumbnails and lore.
 * Clicking "Tiến Vào" (Enter Realm) closes the modal, triggers a smooth
 * fade-to-white transition, and reloads GardenScene with the selected realm's
 * background, tile textures, and saved plot data.
 *
 * DEPTH CONTRACT (HUD punch-through fix, see modalInput.js):
 *   · blocker 9000 — full-screen interactive dark backdrop; taps can never
 *     fall through to the HUD buttons at 2000
 *   · window  9500 — the panel + every widget
 *   · close   9999 — the ✕ button, always on top
 *
 * Input rules: every interactive element calls event.stopPropagation() via
 * guarded(), and a panel shield prevents backdrop auto-close on inside taps.
 *
 * MOBILE SCROLL: all five realm cards live in a masked, clamped scroll
 * container. Vertical drag scrolling (pointerdown → pointermove → pointerup)
 * works from anywhere on the card list — including a finger that lands on a
 * "Tiến Vào" button — and the drag is clamped to [0, scrollMax] so the list
 * can never be flung past its own bounds.
 */
import Phaser from 'phaser';
import { LAYERS } from '../core/Layers.js';
import { DIALOG_FONT } from '../systems/DialogSystem.js';
import { REALMS, REALM_ORDER, resolveRealm } from '../data/RealmsData.js';
import {
    bindBackdropClose, createModalBlocker, createPanelShield, guarded,
    hideModalChrome, localRectToWorld, makeCloseLayer, showModalChrome,
} from './modalInput.js';

const STAGE_W = 1080;
const STAGE_H = 1920;
const PANEL_W = 900;
const PANEL_H = 1100;
const PANEL_X = (STAGE_W - PANEL_W) / 2;
const PANEL_Y = (STAGE_H - PANEL_H) / 2 - 40;

/* Card list geometry — the scrollable viewport sits between the subtitle and
   the panel foot. 5 cards × 300px (280 card + 20 gap) = 1500px of content,
   which overflows the ~940px viewport, so drag scrolling is required. */
const LIST_TOP = PANEL_Y + 140;
const LIST_BOTTOM = PANEL_Y + PANEL_H - 18;
const CARD_H = 280;
const CARD_GAP = 20;
const DRAG_SLOP = 6; // px of movement before a press is treated as a drag

/** Dark Guofeng theme matching the beast/alchemy modals. */
const T = {
    bg: 0x121016,
    bgHex: '#121016',
    card: 0x1c1724,
    cardDeep: 0x0d0a12,
    gold: 0xdfb15b,
    goldLight: 0xffe3a0,
    goldDim: 0x8a6a3a,
    cyan: 0x7ff7ff,
    text: '#f8ead0',
    textGold: '#ffe9a8',
    textMuted: '#b9a3dd',
    textSoft: '#d8c3f2',
};

export default class RealmModal {
    /**
     * @param {Phaser.Scene} scene  the GardenScene
     * @param {{ bus: EventManager, audio: AudioManager, activeRealmId: string, onSelectRealm: (realmId: string) => void }} opts
     */
    constructor(scene, opts = {}) {
        this.scene = scene;
        this.bus = opts.bus;
        this.audio = opts.audio;
        this.activeRealmId = opts.activeRealmId ?? 'DEFAULT_GARDEN';
        this.onSelectRealm = opts.onSelectRealm ?? (() => {});
        this.container = null;
        this.visible = false;
        /* drag-scroll state */
        this.scroll = 0;
        this.scrollMax = 0;
        this.dragging = null;
        this.inputHandlers = [];
    }

    create() {
        const s = this.scene;

        /* ---- blocker (depth 9000, interactive — the HUD punch-through fix) ---- */
        this.shade = createModalBlocker(s, {
            x: STAGE_W / 2, y: STAGE_H / 2, width: STAGE_W, height: STAGE_H,
            color: 0x05030c, alpha: 0.82,
        });

        /* ---- window (depth 9500) ---- */
        this.container = s.add.container(0, 0).setDepth(LAYERS.MODAL_WINDOW).setVisible(false);

        // Backdrop close (only outside panel)
        bindBackdropClose(this.shade, () => this.getPanelWorldRect(), () => this.close());

        // Panel background
        const panel = s.add.graphics();
        panel.fillStyle(T.bg, 0.98);
        panel.lineStyle(6, T.gold, 1);
        panel.fillRoundedRect(PANEL_X, PANEL_Y, PANEL_W, PANEL_H, 30);
        panel.strokeRoundedRect(PANEL_X, PANEL_Y, PANEL_W, PANEL_H, 30);
        // inner frame
        panel.lineStyle(2, T.goldDim, 0.5);
        panel.strokeRoundedRect(PANEL_X + 16, PANEL_Y + 16, PANEL_W - 32, PANEL_H - 32, 24);
        this.container.add(panel);

        // Panel shield (stops propagation to backdrop)
        const shield = createPanelShield(s, STAGE_W / 2, PANEL_Y + PANEL_H / 2, PANEL_W, PANEL_H);
        this.container.add(shield);

        // Title
        const title = s.add.text(STAGE_W / 2, PANEL_Y + 54, '⛩ BÍ CẢNH ⛩', {
            fontFamily: 'Georgia, serif', fontSize: '44px', color: T.textGold, fontStyle: 'bold',
            stroke: '#3a1c5e', strokeThickness: 8,
        }).setOrigin(0.5);
        this.container.add(title);

        // Subtitle
        const subtitle = s.add.text(STAGE_W / 2, PANEL_Y + 100, 'Chọn bí cảnh để khám phá — mỗi cõi có hoa linh riêng', {
            fontFamily: DIALOG_FONT, fontSize: '22px', color: T.textMuted,
            stroke: T.bgHex, strokeThickness: 4,
        }).setOrigin(0.5);
        this.container.add(subtitle);

        /* ---- scrollable realm-card list (masked + drag-panned) ---- */
        this.scrollContainer = s.add.container(0, 0);
        // The mask shape itself must NEVER join the display list: s.add.graphics()
        // would render the raw white fill as a solid rectangle (the "two white
        // rectangles" bug). Only s.make.graphics({ add: false }) is safe.
        const maskG = s.make.graphics({ add: false });
        maskG.fillStyle(0xffffff, 1);
        maskG.fillRect(PANEL_X + 22, LIST_TOP, PANEL_W - 44, LIST_BOTTOM - LIST_TOP);
        this.listMask = maskG.createGeometryMask();
        this.scrollContainer.setMask(this.listMask);
        this.container.add(this.scrollContainer);

        // Realm cards
        this.realmCards = [];
        const unlockedRealms = REALM_ORDER.map((id) => REALMS[id]).filter((r) => r.unlocked);
        const startY = PANEL_Y + 160;
        let contentBottom = startY;
        for (let i = 0; i < unlockedRealms.length; i++) {
            const realm = unlockedRealms[i];
            const card = this.createRealmCard(realm, startY + i * (CARD_H + CARD_GAP), CARD_H);
            this.realmCards.push(card);
            this.scrollContainer.add(card.container);
            contentBottom = startY + i * (CARD_H + CARD_GAP) + CARD_H;
        }
        // Clamp bounds: the list may scroll exactly as far as its content
        // overflows the viewport — never further, never backwards past 0.
        this.scrollMax = Math.max(0, Math.ceil(contentBottom - LIST_BOTTOM));

        // Scroll affordance (only when the list actually overflows)
        this.scrollHint = s.add.text(PANEL_X + PANEL_W - 40, LIST_BOTTOM - 14, '⇕', {
            fontFamily: DIALOG_FONT, fontSize: '26px', color: T.goldDim,
        }).setOrigin(1, 0.5).setVisible(this.scrollMax > 0);
        this.container.add(this.scrollHint);

        // Soft fade at the viewport's bottom edge (signals clipped cards)
        this.listFade = s.add.graphics();
        this.container.add(this.listFade);
        this.drawListFade();

        /* ---- mobile drag scrolling (pointerdown → pointermove → pointerup) ---- */
        this.setupDragScroll();

        /* ---- close button (top-level at depth 9999) ---- */
        const closeBtn = makeCloseLayer(s, s.add.container(PANEL_X + PANEL_W - 50, PANEL_Y + 50));
        const closeBg = s.add.graphics();
        closeBg.fillStyle(T.card, 0.98);
        closeBg.lineStyle(3, T.gold, 0.9);
        closeBg.fillRoundedRect(-30, -30, 60, 60, 16);
        closeBg.strokeRoundedRect(-30, -30, 60, 60, 16);
        const closeLabel = s.add.text(0, 0, '✕', {
            fontFamily: 'Arial', fontSize: '34px', color: '#ffb0b0',
        }).setOrigin(0.5);
        const closeZone = s.add.zone(0, 0, 60, 60).setInteractive();
        closeZone.on('pointerdown', guarded(() => this.close()));
        closeBtn.add([closeBg, closeLabel, closeZone]);
        this.closeButton = closeBtn;

        return this;
    }

    /* ===================== drag scrolling (mobile) =====================
       The list is panned by dragging anywhere on the card viewport. A
       pointerdown lands either on a card widget (button taps must keep
       working, so the zone alone is not enough) or on the drag surface —
       both start a drag; pointermove applies the delta, clamped to
       [0, scrollMax]; pointerup ends it. A tap that moves less than
       DRAG_SLOP never scrolls, so "Tiến Vào" taps stay perfectly crisp. */
    setupDragScroll() {
        const s = this.scene;

        // Invisible drag surface over the viewport, UNDER the cards, so card
        // buttons keep winning the hit test while empty areas still grab.
        this.dragZone = s.add.zone(PANEL_X + PANEL_W / 2, (LIST_TOP + LIST_BOTTOM) / 2,
            PANEL_W - 44, LIST_BOTTOM - LIST_TOP).setInteractive();
        this.dragZone.on('pointerdown', (p) => this.beginDrag(p));
        this.container.add(this.dragZone);
        // keep the drag surface beneath the cards (insert at index 2, after
        // panel + shield) so card buttons render — and hit — above it
        this.container.moveTo(this.dragZone, 2);

        const onMove = (p) => {
            if (!this.dragging || !this.visible) return;
            const dy = this.dragging.y - p.y;
            // ignore a few px of jitter so a "Tiến Vào" tap never micro-scrolls
            if (!this.dragging.moved && Math.abs(dy) < DRAG_SLOP) return;
            this.dragging.moved = true;
            this.setScroll(this.dragging.from + dy);
        };
        const onUp = () => { this.dragging = null; };
        // Scene-level fallback so a drag that starts on a card button (or a
        // finger that slides off the viewport) still pans and still releases.
        const onDown = (p) => {
            if (!this.visible || this.dragging) return;
            if (this.pointerOverList(p)) this.beginDrag(p);
        };
        s.input.on('pointerdown', onDown);
        s.input.on('pointermove', onMove);
        s.input.on('pointerup', onUp);
        this.inputHandlers = [
            ['pointerdown', onDown],
            ['pointermove', onMove],
            ['pointerup', onUp],
        ];
    }

    beginDrag(pointer) {
        if (!this.visible) return;
        this.dragging = { y: pointer.y, from: this.scroll, moved: false };
    }

    pointerOverList(pointer) {
        const x = pointer.worldX ?? pointer.x;
        const y = pointer.worldY ?? pointer.y;
        return x >= PANEL_X && x <= PANEL_X + PANEL_W && y >= LIST_TOP && y <= LIST_BOTTOM;
    }

    /** Clamp + apply the list scroll offset and refresh the affordances. */
    setScroll(value) {
        this.scroll = Phaser.Math.Clamp(value, 0, this.scrollMax);
        this.scrollContainer.y = -this.scroll;
        this.scrollHint.setVisible(this.scrollMax > 0 && this.scroll < this.scrollMax - 0.5);
        this.drawListFade();
    }

    /** Gradient veil at the viewport foot — only while clipped cards remain. */
    drawListFade() {
        const g = this.listFade;
        g.clear();
        if (this.scrollMax <= 0 || this.scroll >= this.scrollMax - 0.5) return;
        g.fillGradientStyle(0x121016, 0x121016, 0x121016, 0x121016, 0, 0, 1, 1);
        g.fillRect(PANEL_X + 22, LIST_BOTTOM - 40, PANEL_W - 44, 40);
    }

    createRealmCard(realm, y, h) {
        const s = this.scene;
        const cardX = PANEL_X + 30;
        const cardW = PANEL_W - 60;
        const isActive = realm.id === this.activeRealmId;

        const container = s.add.container(0, 0);

        // Card background
        const bg = s.add.graphics();
        bg.fillStyle(isActive ? 0x2a1f4a : T.card, 0.95);
        bg.lineStyle(isActive ? 4 : 2, isActive ? T.goldLight : T.goldDim, isActive ? 1 : 0.7);
        bg.fillRoundedRect(cardX, y, cardW, h, 20);
        bg.strokeRoundedRect(cardX, y, cardW, h, 20);
        container.add(bg);

        // Thumbnail area (left side — tinted glow as placeholder for bg preview)
        const thumbX = cardX + 20;
        const thumbY = y + 20;
        const thumbW = 180;
        const thumbH = h - 40;

        // Realm background preview (thumbnail)
        if (s.textures.exists(realm.backgroundKey)) {
            const thumb = s.add.image(thumbX + thumbW / 2, thumbY + thumbH / 2, realm.backgroundKey)
                .setDisplaySize(thumbW, thumbH);
            // Clip to rounded area with mask. The mask shape itself must NEVER
            // join the display list: s.add.graphics() would render the raw
            // white fill as a solid white rectangle over the card (the
            // "two white rectangles" bug — one per realm card). Only
            // s.make.graphics({ add: false }) + createGeometryMask() is safe.
            const mask = s.make.graphics({ add: false });
            mask.fillStyle(0xffffff);
            mask.fillRoundedRect(thumbX, thumbY, thumbW, thumbH, 14);
            thumb.setMask(mask.createGeometryMask());
            container.add(thumb);
        } else {
            // Fallback: tinted glow
            const thumbGlow = s.add.image(thumbX + thumbW / 2, thumbY + thumbH / 2, 'glow')
                .setTint(realm.tint).setAlpha(0.4).setScale(2.2, 3.0);
            container.add(thumbGlow);
        }

        // Realm icon overlay
        const iconText = s.add.text(thumbX + thumbW / 2, thumbY + thumbH / 2, realm.icon, {
            fontFamily: 'Arial', fontSize: '64px', color: '#ffffff',
            stroke: '#000000', strokeThickness: 4,
        }).setOrigin(0.5);
        container.add(iconText);

        // Text area (right side)
        const textX = thumbX + thumbW + 24;
        const textW = cardW - thumbW - 68;

        // Realm name
        const nameText = s.add.text(textX, y + 24, realm.name, {
            fontFamily: 'Georgia, serif', fontSize: '30px', color: T.textGold, fontStyle: 'bold',
            stroke: T.bgHex, strokeThickness: 5,
        }).setOrigin(0, 0);
        container.add(nameText);

        // English name
        const engText = s.add.text(textX, y + 62, realm.english, {
            fontFamily: DIALOG_FONT, fontSize: '18px', color: T.textMuted,
            stroke: T.bgHex, strokeThickness: 3,
        }).setOrigin(0, 0);
        container.add(engText);

        // Lore / description (truncated)
        const loreText = s.add.text(textX, y + 92, realm.description, {
            fontFamily: DIALOG_FONT, fontSize: '19px', color: T.textSoft,
            wordWrap: { width: textW }, lineSpacing: 4,
            stroke: T.bgHex, strokeThickness: 3,
        }).setOrigin(0, 0);
        container.add(loreText);

        // Exclusive seeds badge
        if (realm.exclusiveSeeds.length > 0) {
            const seedLabel = s.add.text(textX, y + h - 80, `🌸 Hạt giống riêng: ${realm.exclusiveSeeds.length} loại`, {
                fontFamily: DIALOG_FONT, fontSize: '17px', color: '#aef4ff',
                stroke: T.bgHex, strokeThickness: 3,
            }).setOrigin(0, 0);
            container.add(seedLabel);
        }

        // "Tiến Vào" (Enter) button or "Đang ở đây" badge
        if (isActive) {
            const badge = s.add.graphics();
            badge.fillStyle(0x2a4a2a, 0.95);
            badge.lineStyle(2, 0x7dffb6, 0.8);
            badge.fillRoundedRect(cardX + cardW - 200, y + h - 62, 170, 44, 14);
            badge.strokeRoundedRect(cardX + cardW - 200, y + h - 62, 170, 44, 14);
            const badgeText = s.add.text(cardX + cardW - 115, y + h - 40, '✦ Đang ở đây', {
                fontFamily: DIALOG_FONT, fontSize: '19px', color: '#bff2d8', fontStyle: 'bold',
            }).setOrigin(0.5);
            container.add([badge, badgeText]);
        } else {
            const btnBg = s.add.graphics();
            btnBg.fillStyle(0x7a4a1e, 0.98);
            btnBg.lineStyle(3, T.goldLight, 1);
            btnBg.fillRoundedRect(cardX + cardW - 200, y + h - 62, 170, 44, 14);
            btnBg.strokeRoundedRect(cardX + cardW - 200, y + h - 62, 170, 44, 14);
            const btnLabel = s.add.text(cardX + cardW - 115, y + h - 40, '⚡ Tiến Vào', {
                fontFamily: DIALOG_FONT, fontSize: '19px', color: '#fff7dd', fontStyle: 'bold',
            }).setOrigin(0.5);
            const btnZone = s.add.zone(cardX + cardW - 115, y + h - 40, 170, 44).setInteractive({ useHandCursor: true });
            btnZone.on('pointerdown', guarded(() => {
                this.audio?.ensure?.();
                this.audio?.chime?.(880, { gain: 0.06 });
                this.onSelectRealm(realm.id);
            }));
            container.add([btnBg, btnLabel, btnZone]);
        }

        return { container, realm, bg };
    }

    getPanelWorldRect() {
        return localRectToWorld(this.container, PANEL_X, PANEL_Y, PANEL_W, PANEL_H);
    }

    open() {
        if (!this.container) return;
        this.visible = true;
        this.audio?.click?.();
        this.setScroll(this.scroll); // re-clamp + refresh affordances
        showModalChrome(this.scene, { blocker: this.shade, window: this.container, close: this.closeButton },
            { duration: 280, popScale: 0.94 });
    }

    close() {
        if (!this.container || !this.visible) return;
        this.visible = false;
        this.dragging = null;
        this.audio?.click?.();
        hideModalChrome(this.scene, { blocker: this.shade, window: this.container, close: this.closeButton },
            { duration: 200, popScale: 0.94 });
    }

    isOpen() {
        return this.visible;
    }

    destroy() {
        for (const [event, handler] of this.inputHandlers) {
            this.scene.input?.off?.(event, handler);
        }
        this.inputHandlers = [];
        this.shade?.destroy();
        this.closeButton?.destroy(true);
        this.container?.destroy(true);
        this.shade = this.closeButton = this.container = null;
    }
}
