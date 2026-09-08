/**
 * BeastModal — Vườn Linh Thú / Spirit Beast Sanctuary UI.
 *
 * Dark Guofeng overlay (ink #121016 + gold frame) with:
 *  - a TAB ROW (one pill per beast) + ‹ › carousel arrows + swipe on the stage,
 *    so Cửu Vĩ Bạch Hồ and Ngọc Thỏ are shown ONE AT A TIME instead of being
 *    stacked at the same coordinates;
 *  - a single stage that shows only the selected beast on its lotus nest;
 *  - affinity bar, "Cho Ăn" (Feed) / "Xoa Đầu" (Pet) buttons with cooldowns,
 *    and the passive-buff card.
 *
 * Input rules (mobile fix): every interactive element inside the panel calls
 * `event.stopPropagation()` and an invisible panel shield sits between the
 * panel art and the widgets, so a tap inside the modal can never reach the
 * backdrop and auto-close it. Only a tap OUTSIDE the panel closes it.
 *
 * The widget owns presentation only. Beast state is driven by BeastSystem
 * (affinity, Linh Ngư bag, LocalStorage). Fishing publishes FISH_CAUGHT on
 * the bus; feeding consumes 1 Linh Ngư for +20 Thân Mật.
 */
import Phaser from 'phaser';
import { LAYERS } from '../core/Layers.js';
import { EVENTS } from '../systems/EventManager.js';
import { DIALOG_FONT } from '../systems/DialogSystem.js';
import { BEAST_ASSETS } from '../data/BeastAssetManifest.js';
import { BEAST_DEFAULTS, createBeastRuntimeState } from '../systems/BeastSystem.js';
import {
    bindBackdropClose, createModalBlocker, createPanelShield, guarded,
    hideModalChrome, localRectToWorld, makeCloseLayer, showModalChrome,
} from './modalInput.js';

const STAGE_W = 1080;
const STAGE_H = 1920;
const W = 900;
const H = 1180;

/* Dark Guofeng palette — same family as the alchemy furnace + codex chrome. */
export const BEAST_THEME = {
    bg: 0x121016,          // ink panel (spec: #121016)
    bgHex: '#121016',
    card: 0x1c1724,        // raised card / tab surface
    cardDeep: 0x0d0a12,
    gold: 0xdfb15b,        // frame + active accents
    goldLight: 0xffe3a0,
    goldDim: 0x8a6a3a,
    jade: 0x2f9f7f,
    ruby: 0xb23a4a,
    plum: 0x8a5fa8,
    text: '#f8ead0',       // primary — warm parchment on ink
    textGold: '#ffe9a8',
    textMuted: '#b9a3dd',
    textSoft: '#d8c3f2',
    stroke: '#0d0a12',
};

const RARITY_STYLE = {
    legendary: { bg: '#dfb15b', color: '#2a1a08', label: 'HUYỀN THOẠI' },
    rare: { bg: '#8a5fa8', color: '#fff7ee', label: 'HIẾM' },
    uncommon: { bg: '#2f9f7f', color: '#f3fff8', label: 'ÍT GẶP' },
    common: { bg: '#4a4358', color: '#f3eefc', label: 'THƯỜNG' },
};

const FEED_CD = 5000;
const PET_CD = 3000;
const SWIPE_PX = 60;

/** Default beast data used when no external provider is wired yet. */
const DEFAULT_BEASTS = [
    {
        id: 'fox_01',
        assetKey: BEAST_ASSETS.spirit_fox.key,
        name: 'Cửu Vĩ Bạch Hồ',
        rarity: 'legendary',
        affinity: 72,
        affinityMax: 100,
        buffs: [{ label: '+10% tốc độ thu hoạch', value: 0.10 }],
        lastFed: Date.now() - 3600_000,
        lastPet: Date.now() - 1800_000,
    },
    {
        id: 'rabbit_01',
        assetKey: BEAST_ASSETS.jade_rabbit.key,
        name: 'Ngọc Thỏ',
        rarity: 'rare',
        affinity: 35,
        affinityMax: 100,
        buffs: [{ label: '+5% may mắn gieo trồng', value: 0.05 }],
        lastFed: Date.now() - 7200_000,
        lastPet: Date.now() - 600_000,
    },
];

const text = (scene, x, y, str, style = {}) => scene.add.text(x, y, str, { fontFamily: DIALOG_FONT, ...style });

export class BeastModal {
    constructor(
        scene,
        {
            beasts = DEFAULT_BEASTS,
            beastSystem = null,
            bus = null,
            audio = null,
            onFeed = () => {},
            onPet = () => {},
        } = {},
    ) {
        if (!scene) throw new TypeError('BeastModal requires a Phaser scene');
        this.scene = scene;
        this.beastSystem = beastSystem;
        this.beasts = beastSystem?.getBeasts?.() ?? beasts;
        this.bus = bus;
        this.audio = audio;
        this.onFeed = onFeed;
        this.onPet = onPet;
        this.opened = false;
        this.selectedIndex = 0;
        this.nodes = [];
        this.disposers = [];
        this.tabs = [];
        this.stageCards = [];
        this._switching = false;
        this._cooldownTimer = null;
    }

    /* ---------- lifecycle ---------- */

    create() {
        const s = this.scene;
        const T = BEAST_THEME;

        /* modal depth contract (HUD punch-through fix, see modalInput.js):
           blocker 9000 · window 9500 (this root) · close 9999 */
        this.root = s.add.container(STAGE_W / 2, STAGE_H / 2).setDepth(LAYERS.MODAL_WINDOW).setVisible(false);

        /* backdrop — tap OUTSIDE the panel closes; inside taps are swallowed */
        this.dim = createModalBlocker(s, {
            x: STAGE_W / 2, y: STAGE_H / 2, width: STAGE_W, height: STAGE_H,
            color: 0x05030c, alpha: 0.8,
        });
        bindBackdropClose(this.dim, () => this.getPanelWorldRect(), () => this.close());

        /* panel frame — ink + gold (dark Guofeng) */
        const panel = s.add.graphics();
        panel.fillStyle(T.bg, 0.985).fillRoundedRect(-W / 2, -H / 2, W, H, 28);
        panel.lineStyle(6, T.gold, 1).strokeRoundedRect(-W / 2, -H / 2, W, H, 28);
        panel.lineStyle(2, T.goldDim, 0.7).strokeRoundedRect(-W / 2 + 16, -H / 2 + 16, W - 32, H - 32, 20);
        // corner ornaments (small gold diamonds)
        panel.fillStyle(T.gold, 0.9);
        for (const [cx, cy] of [[-W / 2 + 34, -H / 2 + 34], [W / 2 - 34, -H / 2 + 34], [-W / 2 + 34, H / 2 - 34], [W / 2 - 34, H / 2 - 34]]) {
            panel.fillTriangle(cx, cy - 9, cx + 9, cy, cx, cy + 9);
            panel.fillTriangle(cx, cy - 9, cx - 9, cy, cx, cy + 9);
        }

        /* panel shield: captures every inside pointerdown → stopPropagation */
        this.panelShield = createPanelShield(s, 0, 0, W, H);

        /* title block */
        this.title = text(s, 0, -H / 2 + 60, 'VƯỜN LINH THÚ', {
            fontSize: '44px', color: T.textGold, fontStyle: 'bold',
            stroke: '#3a2810', strokeThickness: 7,
        }).setOrigin(0.5);
        this.subtitle = text(s, 0, -H / 2 + 108, 'Thuần dưỡng · Nâng cấp · Hưởng linh khí thụ động', {
            fontSize: '21px', color: T.textMuted,
        }).setOrigin(0.5);

        /* close — top-level at LAYERS.MODAL_CLOSE (9999), world-positioned */
        this.closeButton = makeCloseLayer(s, text(s, STAGE_W / 2 + W / 2 - 50, STAGE_H / 2 - H / 2 + 44, '✕', {
            fontFamily: 'Arial', fontSize: '40px', color: '#ffb0b0', fontStyle: 'bold',
        }).setOrigin(0.5).setInteractive({ useHandCursor: true }));
        this.closeButton.on('pointerdown', guarded(() => this.close()));

        /* tab row (one pill per beast) — replaces the stacked slot layout */
        this.tabRowY = -H / 2 + 172;
        this.tabRow = s.add.container(0, this.tabRowY);
        this.tabs = this.beasts.map((beast, i) => this.makeTab(i, beast));
        this.tabRow.add(this.tabs);
        this.slots = this.tabs; // backwards-compatible alias

        /* stage: the selected beast on its nest (only ONE card visible) */
        this.stageY = -H / 2 + 420;

        /* carousel arrows (need stageY — they flank the stage vertically centred) */
        this.prevArrow = this.makeArrow(-W / 2 + 62, '‹', () => this.step(-1));
        this.nextArrow = this.makeArrow(W / 2 - 62, '›', () => this.step(1));
        this.stage = s.add.container(0, this.stageY);
        const stageBg = s.add.graphics();
        stageBg.fillStyle(T.cardDeep, 0.9).fillRoundedRect(-330, -190, 660, 380, 22);
        stageBg.lineStyle(2, T.goldDim, 0.8).strokeRoundedRect(-330, -190, 660, 380, 22);
        this.stage.add(stageBg);
        // soft lantern glow behind the beast
        if (s.textures.exists('glow')) {
            this.stageGlow = s.add.image(0, 10, 'glow').setTint(T.gold).setAlpha(0.16).setScale(2.6, 1.9);
            this.stage.add(this.stageGlow);
        }
        // shared nest platform
        const nestKey = BEAST_ASSETS.nest_platform?.key;
        if (nestKey && s.textures.exists(nestKey)) {
            this.nest = s.add.image(0, 120, nestKey).setDisplaySize(420, 280).setAlpha(0.95);
            this.stage.add(this.nest);
        }
        // one masked-in card per beast; only the selected one is visible
        this.stageCards = this.beasts.map((beast) => this.makeStageCard(beast));
        this.stage.add(this.stageCards);
        // swipe zone (guarded) — swipe left/right to change beast
        const stageZone = s.add.zone(0, 0, 660, 380).setInteractive();
        stageZone.on('pointerdown', (pointer, lx, ly, event) => {
            event?.stopPropagation?.();
            this._swipeStartX = pointer.x;
        });
        stageZone.on('pointerup', (pointer, lx, ly, event) => {
            event?.stopPropagation?.();
            if (this._swipeStartX == null) return;
            const dx = pointer.x - this._swipeStartX;
            this._swipeStartX = null;
            if (Math.abs(dx) >= SWIPE_PX) this.step(dx < 0 ? 1 : -1);
        });
        stageZone.on('pointerout', () => { this._swipeStartX = null; });
        this.stage.add(stageZone);
        this.stageZone = stageZone;

        /* page dots */
        this.dots = s.add.graphics();
        this.dotsY = this.stageY + 214;

        /* name + rarity */
        this.beastName = text(s, 0, this.stageY + 252, this.beasts[0]?.name ?? '', {
            fontSize: '34px', color: T.textGold, fontStyle: 'bold',
            stroke: '#3a2810', strokeThickness: 6,
        }).setOrigin(0.5);
        this.rarityBadge = text(s, 0, this.stageY + 296, '', {
            fontSize: '17px', color: '#2a1a08', fontStyle: 'bold',
            backgroundColor: '#dfb15b',
            padding: { left: 14, right: 14, top: 5, bottom: 5 },
        }).setOrigin(0.5);

        /* affinity bar */
        this.affinityY = this.stageY + 350;
        this.affinityLabel = text(s, -300, this.affinityY, 'Thân mật', {
            fontSize: '22px', color: T.textSoft, fontStyle: 'bold',
        }).setOrigin(0, 0.5);
        this.affinityBg = s.add.graphics();
        this.affinityBg.fillStyle(0x241540, 1).fillRoundedRect(-180, this.affinityY - 15, 400, 30, 12);
        this.affinityBg.lineStyle(2, T.goldDim, 0.9).strokeRoundedRect(-180, this.affinityY - 15, 400, 30, 12);
        this.affinityFill = s.add.graphics();
        this.affinityText = text(s, 20, this.affinityY, '', {
            fontSize: '18px', color: '#ffffff', fontStyle: 'bold',
            stroke: T.stroke, strokeThickness: 4,
        }).setOrigin(0.5);
        const heartKey = BEAST_ASSETS.affinity_heart?.key;
        if (heartKey && s.textures.exists(heartKey)) {
            this.affinityIcon = s.add.image(258, this.affinityY, heartKey).setDisplaySize(44, 44);
        }

        /* action buttons */
        this.btnY = this.stageY + 432;
        this.feedBtn = this.makeActionButton(-150, this.btnY, 'Cho Ăn', T.jade, BEAST_ASSETS.feed_berry?.key, () => this.handleFeed());
        this.petBtn = this.makeActionButton(150, this.btnY, 'Xoa Đầu', T.ruby, null, () => this.handlePet());

        /* cooldown hints */
        this.feedCooldown = text(s, -150, this.btnY + 48, '', { fontSize: '17px', color: T.textMuted }).setOrigin(0.5);
        this.petCooldown = text(s, 150, this.btnY + 48, '', { fontSize: '17px', color: T.textMuted }).setOrigin(0.5);

        /* passive buffs card */
        this.buffsY = this.stageY + 520;
        this.buffsPanel = s.add.graphics();
        this.buffsPanel.fillStyle(T.card, 1).fillRoundedRect(-330, this.buffsY - 14, 660, 130, 16);
        this.buffsPanel.lineStyle(2, T.goldDim, 0.8).strokeRoundedRect(-330, this.buffsY - 14, 660, 130, 16);
        this.buffsTitle = text(s, 0, this.buffsY + 8, '✦ Linh khí thụ động', {
            fontSize: '22px', color: '#ffd787', fontStyle: 'bold',
            stroke: '#1b1140', strokeThickness: 4,
        }).setOrigin(0.5);
        this.buffsList = s.add.container(0, this.buffsY + 56);

        /* footer hint */
        this.footerHint = text(s, 0, H / 2 - 44, 'Chạm thẻ hoặc vuốt để đổi linh thú · chạm ngoài khung để đóng', {
            fontSize: '17px', color: '#8f7fa8', fontStyle: 'italic',
        }).setOrigin(0.5);

        /* assemble — order matters: panel → shield → widgets.
           The blocker (this.dim, 9000) and close button (9999) are TOP-LEVEL
           display objects under the modal depth contract — never parented. */
        this.root.add([
            panel, this.panelShield,
            this.title, this.subtitle,
            this.tabRow, this.prevArrow, this.nextArrow,
            this.stage, this.dots,
            this.beastName, this.rarityBadge,
            this.affinityLabel, this.affinityBg, this.affinityFill, this.affinityText,
            ...(this.affinityIcon ? [this.affinityIcon] : []),
            this.feedBtn, this.petBtn, this.feedCooldown, this.petCooldown,
            this.buffsPanel, this.buffsTitle, this.buffsList,
            this.footerHint,
        ]);

        this.bindBus();
        this.selectBeast(0, { animate: false });
        return this;
    }

    bindBus() {
        if (!this.bus) return this;
        this.disposers.push(
            this.bus.on(EVENTS.FISH_CAUGHT, () => {
                if (this.opened) this.updateCooldowns();
            }, { owner: 'beast-modal' }),
            this.bus.on(EVENTS.BEAST_FED, () => {
                if (this.opened) this.refreshSelected();
            }, { owner: 'beast-modal' }),
            this.bus.on(EVENTS.BEAST_PETTED, () => {
                if (this.opened) this.refreshSelected();
            }, { owner: 'beast-modal' }),
            this.bus.on(EVENTS.BEAST_STATE_CHANGED, () => {
                if (this.opened) this.refreshSelected();
            }, { owner: 'beast-modal' }),
        );
        return this;
    }

    refreshSelected() {
        const beast = this.beasts[this.selectedIndex];
        if (!beast) return;
        this.updateAffinityBar(beast);
        this.refreshBuffs(beast);
        this.updateCooldowns(beast);
    }

    /* ---------- builders ---------- */

    /** A pill tab; the active one reads gold, the others ink. */
    makeTab(index, beast) {
        const s = this.scene;
        const T = BEAST_THEME;
        const n = this.beasts.length;
        const tabW = Math.min(300, (W - 220) / Math.max(1, n) - 12);
        const tabH = 64;
        const totalW = n * tabW + (n - 1) * 14;
        const x = -totalW / 2 + tabW / 2 + index * (tabW + 14);
        const container = s.add.container(x, 0);

        const bg = s.add.graphics();
        const draw = (active) => {
            bg.clear();
            bg.fillStyle(active ? 0x3a2810 : T.card, 1);
            bg.lineStyle(active ? 3 : 2, active ? T.goldLight : 0x5a4a6a, 1);
            bg.fillRoundedRect(-tabW / 2, -tabH / 2, tabW, tabH, tabH / 2);
            bg.strokeRoundedRect(-tabW / 2, -tabH / 2, tabW, tabH, tabH / 2);
        };
        draw(false);

        let icon = null;
        if (s.textures.exists(beast.assetKey)) {
            icon = s.add.image(-tabW / 2 + 38, 0, beast.assetKey);
            fitImage(icon, 44, 44);
        }
        const label = text(s, icon ? -tabW / 2 + 68 : 0, 0, beast.shortName || beast.name, {
            fontSize: n >= 4 ? '17px' : '21px', color: T.textMuted, fontStyle: 'bold',
            wordWrap: { width: tabW - 86 },
        }).setOrigin(icon ? 0 : 0.5, 0.5);

        const hit = s.add.zone(0, 0, tabW, tabH).setInteractive({ useHandCursor: true });
        hit.on('pointerdown', guarded(() => this.selectBeast(index)));
        hit.on('pointerup', guarded(() => {}));

        container.add([bg, ...(icon ? [icon] : []), label, hit]);
        container.draw = draw;
        container.label = label;
        container.setActive = (active) => {
            draw(active);
            label.setColor(active ? T.textGold : T.textMuted);
            container.setAlpha(1);
        };
        return container;
    }

    /** Carousel arrow button (‹ / ›). */
    makeArrow(x, glyph, handler) {
        const s = this.scene;
        const T = BEAST_THEME;
        const c = s.add.container(x, this.stageY);
        const g = s.add.graphics();
        g.fillStyle(T.card, 1).fillCircle(0, 0, 30);
        g.lineStyle(2, T.gold, 0.9).strokeCircle(0, 0, 30);
        const t = text(s, 0, -3, glyph, { fontSize: '44px', color: T.textGold, fontStyle: 'bold' }).setOrigin(0.5);
        const zone = s.add.zone(0, 0, 84, 84).setInteractive({ useHandCursor: true });
        zone.on('pointerdown', guarded(() => {
            s.tweens.add({ targets: c, scale: { from: 0.9, to: 1 }, duration: 160, ease: 'Back.easeOut' });
            handler();
        }));
        c.add([g, t, zone]);
        return c;
    }

    /** One card per beast inside the stage — only the selected one is visible. */
    makeStageCard(beast) {
        const s = this.scene;
        const card = s.add.container(0, 0).setVisible(false);
        if (s.textures.exists(beast.assetKey)) {
            const sprite = s.add.image(0, 0, beast.assetKey).setOrigin(0.5, 0.5);
            fitImage(sprite, 300, 320);
            sprite.y = -6;
            card.add(sprite);
            card.sprite = sprite;
        } else {
            const ph = text(s, 0, 0, beast.name, { fontSize: '26px', color: BEAST_THEME.textMuted }).setOrigin(0.5);
            card.add(ph);
        }
        card.beastId = beast.id;
        return card;
    }

    makeActionButton(x, y, label, color, iconKey, handler) {
        const s = this.scene;
        const c = s.add.container(x, y);
        const bg = s.add.graphics();
        const draw = (hover) => {
            bg.clear();
            bg.fillStyle(color, 1).fillRoundedRect(-110, -30, 220, 60, 30);
            bg.lineStyle(3, hover ? BEAST_THEME.goldLight : 0xfff7dd, hover ? 1 : 0.55).strokeRoundedRect(-110, -30, 220, 60, 30);
        };
        draw(false);
        let icon = null;
        if (iconKey && s.textures.exists(iconKey)) {
            icon = s.add.image(-72, 0, iconKey);
            fitImage(icon, 40, 40);
        }
        const txt = text(s, icon ? 14 : 0, 0, label, {
            fontSize: '26px', color: '#fff7dd', fontStyle: 'bold',
            stroke: BEAST_THEME.stroke, strokeThickness: 4,
        }).setOrigin(0.5);
        const zone = s.add.zone(0, 0, 240, 84).setInteractive({ useHandCursor: true });
        zone.on('pointerover', () => draw(true));
        zone.on('pointerout', () => draw(false));
        zone.on('pointerdown', guarded(() => {
            s.tweens.killTweensOf(c);
            s.tweens.add({ targets: c, scale: { from: 0.92, to: 1 }, duration: 220, ease: 'Back.easeOut' });
            handler();
        }));
        zone.on('pointerup', guarded(() => {}));
        c.add([bg, ...(icon ? [icon] : []), txt, zone]);
        c.labelText = txt;
        return c;
    }

    /* ---------- state ---------- */

    /** Move the carousel by ±1 (wraps around). */
    step(delta) {
        const n = this.beasts.length;
        if (!n) return;
        this.selectBeast((this.selectedIndex + delta + n) % n, { direction: Math.sign(delta) || 1 });
    }

    selectBeast(index, { animate = true, direction = 0 } = {}) {
        if (index < 0 || index >= this.beasts.length) return;
        const prev = this.selectedIndex;
        this.selectedIndex = index;
        const beast = this.beasts[index];
        const s = this.scene;
        const dir = direction || (index > prev ? 1 : index < prev ? -1 : 0);

        /* tabs */
        this.tabs.forEach((tab, i) => tab.setActive(i === index));

        /* stage — hide everything but the selected card (never stack) */
        this.stageCards.forEach((card, i) => {
            const on = i === index;
            if (on === card.visible && !(on && animate && dir)) return;
            if (!on) {
                if (animate && card.visible && dir) {
                    s.tweens.killTweensOf(card);
                    s.tweens.add({
                        targets: card, x: -dir * 160, alpha: 0, duration: 200, ease: 'Quad.easeIn',
                        onComplete: () => { card.setVisible(false).setX(0).setAlpha(1); },
                    });
                } else {
                    card.setVisible(false).setX(0).setAlpha(1);
                }
            } else {
                s.tweens.killTweensOf(card);
                card.setVisible(true);
                if (animate) {
                    card.setX(dir * 160).setAlpha(0);
                    s.tweens.add({ targets: card, x: 0, alpha: 1, duration: 300, ease: 'Cubic.easeOut' });
                } else {
                    card.setX(0).setAlpha(1);
                }
            }
        });
        this.drawDots();

        /* info */
        this.beastName.setText(beast.name);
        const rs = RARITY_STYLE[beast.rarity] ?? RARITY_STYLE.common;
        this.rarityBadge.setText(rs.label).setStyle({ backgroundColor: rs.bg, color: rs.color });
        this.updateAffinityBar(beast);
        this.refreshBuffs(beast);
        this.updateCooldowns(beast);

        if (animate) {
            s.tweens.killTweensOf(this.beastName);
            s.tweens.add({
                targets: this.beastName,
                scaleX: { from: 0.85, to: 1 }, scaleY: { from: 0.85, to: 1 }, alpha: { from: 0.4, to: 1 },
                duration: 280, ease: 'Sine.easeOut',
            });
            this.audio?.click?.();
        }
    }

    drawDots() {
        if (!this.dots) return;
        const n = this.beasts.length;
        const g = this.dots;
        g.clear();
        const gap = 22;
        const x0 = -((n - 1) * gap) / 2;
        for (let i = 0; i < n; i++) {
            const active = i === this.selectedIndex;
            g.fillStyle(active ? BEAST_THEME.goldLight : 0x5a4a6a, 1);
            g.fillCircle(x0 + i * gap, this.dotsY, active ? 7 : 5);
        }
    }

    updateAffinityBar(beast) {
        if (!beast || !this.affinityFill) return;
        const pct = Phaser.Math.Clamp(beast.affinity / beast.affinityMax, 0, 1);
        const barWidth = Math.max(0, 400 * pct);
        // colour by affinity level (chosen BEFORE drawing — the old code set it after)
        const color = pct >= 0.8 ? 0x4fd1a5 : pct >= 0.4 ? 0xdfb15b : 0xe54545;
        this.affinityFill.clear();
        if (barWidth > 0) {
            this.affinityFill.fillStyle(color, 1);
            this.affinityFill.fillRoundedRect(-180, this.affinityY - 15, Math.max(barWidth, 30), 30, 12);
        }
        this.affinityText.setText(`${Math.floor(beast.affinity)} / ${beast.affinityMax}`);
    }

    refreshBuffs(beast) {
        if (!this.buffsList) return;
        this.buffsList.removeAll(true);
        if (!beast || !beast.buffs || !beast.buffs.length) {
            this.buffsList.add(text(this.scene, 0, 0, 'Chưa có linh khí thụ động.', {
                fontSize: '20px', color: BEAST_THEME.textMuted,
            }).setOrigin(0.5));
            return;
        }
        beast.buffs.forEach((buff, i) => {
            this.buffsList.add(text(this.scene, 0, i * 32, `✧  ${buff.label}`, {
                fontSize: '22px', color: '#e6d8ff',
            }).setOrigin(0.5));
        });
    }

    /** @deprecated kept for API compatibility — tabs redraw themselves */
    refreshSlots() {
        this.tabs.forEach((tab, i) => tab.setActive(i === this.selectedIndex));
    }

    updateCooldowns(beast = this.beasts[this.selectedIndex]) {
        if (!beast || !this.feedCooldown) return;
        const now = Date.now();
        const feedLeft = Math.max(0, FEED_CD - (now - beast.lastFed));
        const petLeft = Math.max(0, PET_CD - (now - beast.lastPet));
        const linhNgu = this.beastSystem ? this.beastSystem.getLinhNgu() : null;
        const noFish = linhNgu != null && linhNgu < 1;
        if (feedLeft > 0) this.feedCooldown.setText(`Chờ ${Math.ceil(feedLeft / 1000)}s`);
        else if (noFish) this.feedCooldown.setText('Thiếu Linh Ngư ✧');
        else if (linhNgu != null) this.feedCooldown.setText(`Linh Ngư ×${linhNgu} ✦`);
        else this.feedCooldown.setText('Sẵn sàng ✦');
        this.petCooldown.setText(petLeft > 0 ? `Chờ ${Math.ceil(petLeft / 1000)}s` : 'Sẵn sàng ✦');
        this.feedBtn.setAlpha((feedLeft > 0 || noFish) ? 0.55 : 1);
        this.petBtn.setAlpha(petLeft > 0 ? 0.55 : 1);
    }

    /* ---------- actions ---------- */

    handleFeed() {
        const beast = this.beasts[this.selectedIndex];
        if (!beast) return;
        if (this.beastSystem) {
            const result = this.beastSystem.feed(beast.id);
            if (!result.success) {
                this.audio?.click?.(0);
                this.updateCooldowns(beast);
                return;
            }
        } else {
            const now = Date.now();
            if (now - beast.lastFed < FEED_CD) {
                this.audio?.click?.(0);
                return; /* cooldown */
            }
            beast.lastFed = now;
            beast.affinity = Math.min(beast.affinityMax, beast.affinity + FEED_GAIN);
        }

        this.audio?.pluck?.(523.25, { gain: 0.1 }); /* C5 */
        this.updateAffinityBar(beast);
        this.refreshBuffs(beast);
        this.updateCooldowns(beast);
        this.bounceStage(1.06);

        this.scene.tweens.add({
            targets: this.affinityFill, alpha: { from: 0.3, to: 1 }, duration: 250, yoyo: true, ease: 'Sine.easeOut',
        });
        this.onFeed(beast);
    }

    handlePet() {
        const beast = this.beasts[this.selectedIndex];
        if (!beast) return;
        if (this.beastSystem) {
            const result = this.beastSystem.pet(beast.id);
            if (!result.success) {
                this.audio?.click?.(0);
                this.updateCooldowns(beast);
                return;
            }
        } else {
            const now = Date.now();
            if (now - beast.lastPet < PET_CD) {
                this.audio?.click?.(0);
                return; /* cooldown */
            }
            beast.lastPet = now;
            beast.affinity = Math.min(beast.affinityMax, beast.affinity + 2);
        }

        this.audio?.pluck?.(659.25, { gain: 0.1 }); /* E5 */
        this.updateAffinityBar(beast);
        this.refreshBuffs(beast);
        this.updateCooldowns(beast);
        this.bounceStage(1.04);

        this.scene.tweens.add({
            targets: this.beastName, scaleX: { from: 1, to: 1.12 }, scaleY: { from: 1, to: 1.12 },
            duration: 200, yoyo: true, ease: 'Sine.easeInOut',
        });
        this.onPet(beast);
    }

    bounceStage(scale) {
        const card = this.stageCards[this.selectedIndex];
        if (!card?.sprite) return;
        this.scene.tweens.killTweensOf(card.sprite);
        this.scene.tweens.add({
            targets: card.sprite, scaleX: card.sprite.scaleX * scale, scaleY: card.sprite.scaleY * scale,
            duration: 160, yoyo: true, ease: 'Sine.easeInOut',
        });
    }

    /* ---------- open / close ---------- */

    /** World rect of the panel (backdrop guard + tests). */
    getPanelWorldRect() {
        return localRectToWorld(this.root, -W / 2, -H / 2, W, H);
    }

    open() {
        if (this.opened) return this;
        this.opened = true;
        showModalChrome(this.scene, { blocker: this.dim, window: this.root, close: this.closeButton },
            { duration: 260, popScale: 0.96 });
        this.updateCooldowns();
        this._cooldownTimer?.remove();
        this._cooldownTimer = this.scene.time.addEvent({ delay: 500, loop: true, callback: () => this.updateCooldowns() });
        this.audio?.chime?.(659.25, { gain: 0.06 });
        return this;
    }

    close() {
        if (!this.opened) return this;
        this.opened = false;
        this._cooldownTimer?.remove();
        this._cooldownTimer = null;
        hideModalChrome(this.scene, { blocker: this.dim, window: this.root, close: this.closeButton },
            { duration: 190, popScale: 0.97 });
        this.audio?.click?.(0);
        return this;
    }

    isOpen() {
        return this.opened;
    }

    destroy() {
        this.disposers.forEach((off) => off());
        this._cooldownTimer?.remove();
        this._cooldownTimer = null;
        this.dim?.destroy();
        this.closeButton?.destroy();
        this.root?.destroy(true);
        this.dim = this.closeButton = null;
        this.opened = false;
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

export default BeastModal;
