/**
 * FishingModal — visual contract for Câu Cá Hồ Tiên.
 *
 * Presentation for Câu Cá Hồ Tiên. A successful cast publishes FISH_CAUGHT
 * (1× Linh Ngư) on the shared bus so BeastSystem can stock the feeding loop
 * (Câu Cá → Nuôi Thú). Tension math stays out of this widget.
 */
import { FISHING_ASSET_MANIFEST, FISHING_TEXTURES } from '../data/FishingAssetManifest.js';
import { LAYERS } from '../core/Layers.js';
import { EVENTS } from '../systems/EventManager.js';
import { DIALOG_FONT } from '../systems/DialogSystem.js';
import {
    bindBackdropClose, createModalBlocker, createPanelShield, guarded,
    hideModalChrome, localRectToWorld, makeCloseLayer, showModalChrome,
} from './modalInput.js';

const W = FISHING_ASSET_MANIFEST.stage.width;
const H = FISHING_ASSET_MANIFEST.stage.height;
const P = {
    x: 46,
    y: 186,
    w: 988,
    h: 1510,
    scene: { x: 540, y: 738, w: 900, h: 750 },
};

const COLORS = {
    ink: '#f8ead0',
    muted: '#bdadd2',
    plum: 0x1a102f,
    panel: 0x261642,
    gold: 0xdfb15b,
    teal: 0x25a996,
    lavender: 0x8a5fa8,
};

const copy = {
    title: 'CÂU CÁ HỒ TIÊN',
    subtitle: 'Bến Nguyệt · Linh khí trên mặt hồ',
    status: 'Mặt hồ tĩnh lặng',
    gauge: 'VÒNG LỰC KÉO',
    hint: 'Thả mồi để câu Linh Ngư · mang về Vườn Linh Thú mà Cho Ăn',
};

const addText = (scene, x, y, value, style = {}) => scene.add.text(x, y, value, {
    fontFamily: DIALOG_FONT,
    ...style,
});

export class FishingModal {
    /**
     * @param {Phaser.Scene} scene
     * @param {{onClose?: () => void, audio?: object, bus?: object, onCatch?: Function}} options
     */
    constructor(scene, { onClose = null, audio = null, bus = null, onCatch = null } = {}) {
        if (!scene) throw new TypeError('FishingModal requires a Phaser scene');
        this.scene = scene;
        this.onClose = onClose;
        this.audio = audio;
        this.bus = bus;
        this.onCatch = onCatch;
        this.opened = false;
        this.catching = false;
        this.animationTweens = [];
        this.root = null;
    }

    create() {
        if (this.root) return this;
        const s = this.scene;
        /* modal depth contract (HUD punch-through fix, see modalInput.js):
           blocker 9000 · window 9500 (this root) · close 9999 */
        this.root = s.add.container(0, 0).setDepth(LAYERS.MODAL_WINDOW).setVisible(false).setAlpha(0);

        // Backdrop: tap OUTSIDE the pier panel closes. Taps inside the panel
        // are swallowed by the guard + the panel shield below (mobile fix).
        const dim = createModalBlocker(s, {
            x: W / 2, y: H / 2, width: W, height: H, color: 0x070512, alpha: 0.78,
        });
        bindBackdropClose(dim, () => this.getPanelWorldRect(), () => this.close());

        const frame = s.add.graphics();
        frame.fillStyle(COLORS.plum, 0.98);
        frame.lineStyle(6, COLORS.gold, 1);
        frame.fillRoundedRect(P.x, P.y, P.w, P.h, 34);
        frame.strokeRoundedRect(P.x, P.y, P.w, P.h, 34);
        frame.lineStyle(2, COLORS.teal, 0.62);
        frame.strokeRoundedRect(P.x + 18, P.y + 18, P.w - 36, P.h - 36, 26);

        // Panel shield: every pointerdown inside the frame stops propagating
        // here, so it can never reach the dim and auto-close the modal.
        const shield = createPanelShield(s, P.x + P.w / 2, P.y + P.h / 2, P.w, P.h);

        const title = addText(s, W / 2, P.y + 60, copy.title, {
            fontSize: '48px', color: COLORS.ink, fontStyle: 'bold',
            stroke: '#28133f', strokeThickness: 8,
        }).setOrigin(0.5);
        const subtitle = addText(s, W / 2, P.y + 114, copy.subtitle, {
            fontSize: '23px', color: COLORS.muted, fontStyle: 'italic',
        }).setOrigin(0.5);

        // close ✕ — top-level at LAYERS.MODAL_CLOSE (9999)
        const closeButton = makeCloseLayer(s, addText(s, P.x + P.w - 46, P.y + 49, '✕', {
            fontFamily: 'Arial', fontSize: '40px', color: '#ffcfb0',
        }).setOrigin(0.5).setInteractive({ useHandCursor: true }));
        closeButton.on('pointerdown', guarded(() => this.close()));

        const status = s.add.container(P.x + 158, P.y + 178);
        const statusBg = s.add.graphics();
        statusBg.fillStyle(0x123b45, 0.92).lineStyle(2, COLORS.teal, 0.9);
        statusBg.fillRoundedRect(-136, -22, 272, 44, 22).strokeRoundedRect(-136, -22, 272, 44, 22);
        const statusText = addText(s, 0, 0, `◉  ${copy.status}`, {
            fontSize: '21px', color: '#a9f3dc', fontStyle: 'bold',
        }).setOrigin(0.5);
        status.add([statusBg, statusText]);
        this.statusText = statusText;

        const sceneFrame = s.add.graphics();
        sceneFrame.fillStyle(0x0e243a, 1);
        sceneFrame.lineStyle(3, COLORS.lavender, 0.9);
        sceneFrame.fillRoundedRect(P.x + 34, 372, P.w - 68, 770, 22);
        sceneFrame.strokeRoundedRect(P.x + 34, 372, P.w - 68, 770, 22);
        const pier = s.add.image(P.scene.x, P.scene.y, FISHING_TEXTURES.pier_background.key)
            .setDisplaySize(P.scene.w, P.scene.h);
        const vignette = s.add.rectangle(P.scene.x, P.scene.y, P.scene.w, P.scene.h, 0x100c2a, 0.08);

        // Fishing props sit above the illustrated pier and share manifest-style
        // coordinates so a future game system can replace the mock values.
        const rod = s.add.image(172, 762, FISHING_TEXTURES.fishing_rod.key).setDisplaySize(148, 485).setAngle(-7);
        const bobber = s.add.image(702, 855, FISHING_TEXTURES.bobber.key).setDisplaySize(104, 104);
        const goldFish = s.add.image(714, 885, FISHING_TEXTURES.fish_koi_gold.key)
            .setDisplaySize(246, 164).setAlpha(0.78);
        const blueFish = s.add.image(574, 1003, FISHING_TEXTURES.fish_koi_blue.key)
            .setDisplaySize(218, 145).setAlpha(0.62).setFlipX(true);

        const waterLabel = addText(s, 846, 1056, 'Linh ngư đang dạo\ntrong làn nước ngọc', {
            fontSize: '20px', color: '#dcfff0', align: 'center', lineSpacing: 4,
            stroke: '#123d4d', strokeThickness: 4,
        }).setOrigin(0.5);

        const lowerRule = s.add.graphics();
        lowerRule.lineStyle(2, COLORS.gold, 0.48).lineBetween(P.x + 50, 1187, P.x + P.w - 50, 1187);
        const gauge = s.add.image(540, 1343, FISHING_TEXTURES.gauge_ring.key)
            .setDisplaySize(264, 264).setAlpha(0.94);
        const gaugeLabel = addText(s, 540, 1343, copy.gauge, {
            fontSize: '22px', color: '#ffe3a0', fontStyle: 'bold',
            align: 'center', stroke: '#1c1034', strokeThickness: 5,
        }).setOrigin(0.5);
        const gaugeHint = addText(s, 540, 1420, 'Giữ nhịp câu · lực kéo cân bằng', {
            fontSize: '20px', color: COLORS.muted, align: 'center',
        }).setOrigin(0.5);

        const castButton = s.add.container(540, 1538);
        const castBg = s.add.graphics();
        castBg.fillStyle(0x2c8f84, 0.96).lineStyle(4, 0xbaf5d8, 0.9);
        castBg.fillRoundedRect(-260, -38, 520, 76, 38).strokeRoundedRect(-260, -38, 520, 76, 38);
        const castText = addText(s, 0, 0, '✦  THẢ MỒI · CÂU LINH NGƯ  ✦', {
            fontSize: '25px', color: '#f4ffe1', fontStyle: 'bold',
            stroke: '#164b4e', strokeThickness: 5,
        }).setOrigin(0.5);
        const castZone = s.add.zone(0, 0, 520, 76).setInteractive({ useHandCursor: true });
        castZone.on('pointerdown', guarded(() => this.playCastPreview()));
        castButton.add([castBg, castText, castZone]);

        const hint = addText(s, 540, 1628, copy.hint, {
            fontSize: '18px', color: '#9381b2', fontStyle: 'italic', align: 'center',
        }).setOrigin(0.5);

        // dim (blocker 9000) + closeButton (9999) are TOP-LEVEL objects now —
        // they must never be parented into the 9500 window container.
        this.parts = { frame, shield, title, subtitle, status, sceneFrame, pier, vignette, rod, bobber, goldFish, blueFish, waterLabel, lowerRule, gauge, gaugeLabel, gaugeHint, castButton, hint };
        this.dim = dim;
        this.closeButton = closeButton;
        this.panelShield = shield;
        this.root.add(Object.values(this.parts));
        this.startMockAnimations();
        return this;
    }

    startMockAnimations() {
        this.stopMockAnimations();
        if (!this.parts) return;
        const { rod, bobber, goldFish, blueFish, gauge } = this.parts;
        const s = this.scene;
        this.animationTweens = [
            s.tweens.add({ targets: rod, angle: { from: -9, to: -3 }, duration: 1700, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' }),
            s.tweens.add({ targets: bobber, y: { from: 850, to: 864 }, scale: { from: 0.96, to: 1.04 }, duration: 1150, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' }),
            s.tweens.add({ targets: goldFish, x: { from: 760, to: 624 }, y: { from: 890, to: 913 }, duration: 3000, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' }),
            s.tweens.add({ targets: blueFish, x: { from: 548, to: 682 }, y: { from: 1005, to: 985 }, duration: 3600, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' }),
            s.tweens.add({ targets: gauge, angle: { from: -3, to: 3 }, alpha: { from: 0.82, to: 1 }, duration: 2200, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' }),
        ];
    }

    stopMockAnimations() {
        this.animationTweens.forEach((tween) => tween?.remove?.());
        this.animationTweens = [];
        if (!this.parts) return;
        this.scene.tweens.killTweensOf([
            this.parts.rod,
            this.parts.bobber,
            this.parts.goldFish,
            this.parts.blueFish,
            this.parts.gauge,
        ]);
    }

    /** Cast, then land 1 Linh Ngư on the bus (Câu Cá → Nuôi Thú). */
    playCastPreview() {
        if (!this.opened || !this.parts || this.catching) return;
        this.catching = true;
        this.audio?.click?.();
        this.stopMockAnimations();
        const { rod, bobber, gauge, goldFish } = this.parts;
        const s = this.scene;
        rod.setAngle(-18);
        bobber.setPosition(660, 820).setAlpha(0.3);
        gauge.setAngle(-11);
        goldFish.setAlpha(0.24);
        this.statusText?.setText('◉  Đang kéo cá…');
        s.tweens.add({ targets: rod, angle: -4, duration: 360, ease: 'Back.easeOut' });
        s.tweens.add({
            targets: bobber, x: 702, y: 864, alpha: 1, duration: 620, ease: 'Cubic.easeOut',
            onComplete: () => {
                s.tweens.add({ targets: bobber, y: 848, duration: 180, yoyo: true, repeat: 2, ease: 'Sine.easeInOut' });
            },
        });
        s.tweens.add({
            targets: goldFish, alpha: 0.78, x: 694, duration: 1200, ease: 'Sine.easeInOut',
            onComplete: () => {
                this.catching = false;
                if (!this.opened) return;
                this.grantCatch();
                this.startMockAnimations();
            },
        });
    }

    /** Publish 1 Linh Ngư so BeastSystem can stock the feeding bag. */
    grantCatch() {
        const payload = { itemId: 'linh_ngu', name: 'Linh Ngư', amount: 1, source: 'cast' };
        this.bus?.emit?.(EVENTS.FISH_CAUGHT, payload);
        this.onCatch?.(payload);
        this.statusText?.setText('◉  Câu được Linh Ngư ×1');
        this.audio?.chime?.(880, { gain: 0.08 });
        return payload;
    }

    open() {
        if (!this.root) this.create();
        this.opened = true;
        this.startMockAnimations();
        showModalChrome(this.scene, { blocker: this.dim, window: this.root, close: this.closeButton },
            { duration: 300, popScale: 0.94 });
        return this;
    }

    close() {
        if (!this.root || !this.opened) return this;
        this.opened = false;
        this.stopMockAnimations();
        hideModalChrome(this.scene, { blocker: this.dim, window: this.root, close: this.closeButton },
            { duration: 190, popScale: 0.96 });
        this.audio?.click?.();
        this.onClose?.();
        return this;
    }

    toggle() { return this.opened ? this.close() : this.open(); }
    isOpen() { return this.opened; }

    /** World rect of the pier panel (backdrop guard + tests). The root is
     *  stage-origin, so scale is applied around (0,0); P is already world. */
    getPanelWorldRect() {
        return localRectToWorld(this.root, P.x, P.y, P.w, P.h);
    }

    destroy() {
        this.stopMockAnimations();
        this.scene.tweens.killTweensOf([this.dim, this.closeButton, this.root].filter(Boolean));
        this.dim?.destroy();
        this.closeButton?.destroy();
        this.root?.destroy(true);
        this.dim = this.closeButton = null;
        this.root = null;
        this.parts = null;
        this.opened = false;
    }
}

export default FishingModal;
