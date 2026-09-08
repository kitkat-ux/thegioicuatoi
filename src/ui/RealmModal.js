/**
 * RealmModal — Bí Cảnh (Secret Realms) portal selector UI.
 *
 * Dark Guofeng overlay listing all unlocked realms with thumbnails and lore.
 * Clicking "Tiến Vào" (Enter Realm) closes the modal, triggers a smooth
 * fade-to-white transition, and reloads GardenScene with the selected realm's
 * background, tile textures, and saved plot data.
 *
 * Input rules: every interactive element calls event.stopPropagation() via
 * guarded(), and a panel shield prevents backdrop auto-close on inside taps.
 */
import Phaser from 'phaser';
import { LAYERS } from '../core/Layers.js';
import { DIALOG_FONT } from '../systems/DialogSystem.js';
import { REALMS, REALM_ORDER, resolveRealm } from '../data/RealmsData.js';
import { bindBackdropClose, createPanelShield, guarded, localRectToWorld } from './modalInput.js';

const STAGE_W = 1080;
const STAGE_H = 1920;
const PANEL_W = 900;
const PANEL_H = 1100;
const PANEL_X = (STAGE_W - PANEL_W) / 2;
const PANEL_Y = (STAGE_H - PANEL_H) / 2 - 40;

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
    }

    create() {
        const s = this.scene;
        this.container = s.add.container(0, 0).setDepth(LAYERS.REALM).setVisible(false);

        // Dim / backdrop
        const shade = s.add.rectangle(STAGE_W / 2, STAGE_H / 2, STAGE_W, STAGE_H, 0x05030c, 0.82)
            .setInteractive();
        this.container.add(shade);

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

        // Realm cards
        this.realmCards = [];
        const unlockedRealms = REALM_ORDER.map((id) => REALMS[id]).filter((r) => r.unlocked);
        const startY = PANEL_Y + 160;
        const cardH = 280;
        const cardGap = 20;

        for (let i = 0; i < unlockedRealms.length; i++) {
            const realm = unlockedRealms[i];
            const card = this.createRealmCard(realm, startY + i * (cardH + cardGap), cardH);
            this.realmCards.push(card);
            this.container.add(card.container);
        }

        // Close button
        const closeBtn = s.add.container(PANEL_X + PANEL_W - 50, PANEL_Y + 50);
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
        this.container.add(closeBtn);

        // Backdrop close (only outside panel)
        bindBackdropClose(shade, () => this.getPanelWorldRect(), () => this.close());

        return this;
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
        this.container.setVisible(true).setAlpha(0).setScale(0.94);
        this.scene.tweens.add({
            targets: this.container,
            alpha: 1,
            scale: 1,
            duration: 280,
            ease: 'Back.easeOut',
        });
    }

    close() {
        if (!this.container || !this.visible) return;
        this.visible = false;
        this.audio?.click?.();
        this.scene.tweens.add({
            targets: this.container,
            alpha: 0,
            scale: 0.94,
            duration: 200,
            ease: 'Cubic.easeIn',
            onComplete: () => this.container.setVisible(false),
        });
    }

    isOpen() {
        return this.visible;
    }

    destroy() {
        this.container?.destroy();
        this.container = null;
    }
}
