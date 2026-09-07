/**
 * BeastModal — Vườn Linh Thú / Spirit Beast Sanctuary UI.
 *
 * Guofeng modal displaying beast pen/habitat slots with interactive
 * "Cho Ăn" (Feed) and "Xoa Đầu" (Pet) buttons, affinity progress bar,
 * and passive buff stats display.
 *
 * The widget owns presentation only. Beast state is driven externally via
 * props so the modal stays decoupled from GardenScene / EconomySystem.
 */
import Phaser from 'phaser';
import { DIALOG_FONT } from '../systems/DialogSystem.js';
import { BEAST_ASSETS } from '../data/BeastAssetManifest.js';

const W = 880;
const H = 1100;
const GOLD = 0xdfb15b;
const INK = 0x25143b;
const JADE = 0x4fd1a5;
const RUBY = 0xe54545;

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

export class BeastModal {
    constructor(
        scene,
        {
            beasts = DEFAULT_BEASTS,
            bus = null,
            audio = null,
            onFeed = () => {},
            onPet = () => {},
        } = {},
    ) {
        if (!scene) throw new TypeError('BeastModal requires a Phaser scene');
        this.scene = scene;
        this.beasts = beasts;
        this.bus = bus;
        this.audio = audio;
        this.onFeed = onFeed;
        this.onPet = onPet;
        this.opened = false;
        this.selectedIndex = 0;
        this.nodes = [];
        this.disposers = [];
    }

    /* ---------- lifecycle ---------- */

    create() {
        const s = this.scene;

        this.root = s.add.container(540, 960).setDepth(1000).setVisible(false);

        /* backdrop */
        const shade = s.add.rectangle(0, 0, 1080, 1920, 0x110a22, 0.76).setInteractive();

        /* panel frame */
        const panel = s.add.graphics();
        panel.fillStyle(0xf4e5c2, 1).fillRoundedRect(-W / 2, -H / 2, W, H, 26);
        panel.lineStyle(8, GOLD, 1).strokeRoundedRect(-W / 2, -H / 2, W, H, 26);
        panel.lineStyle(2, 0x8a5fa8, 0.8).strokeRoundedRect(-W / 2 + 18, -H / 2 + 18, W - 36, H - 36, 18);

        /* title */
        this.title = s
            .add.text(0, -H / 2 + 58, 'Vườn Linh Thú', {
                fontFamily: DIALOG_FONT,
                fontSize: '42px',
                color: '#4b2864',
                fontStyle: 'bold',
            })
            .setOrigin(0.5);

        this.subtitle = s
            .add.text(0, -H / 2 + 108, 'Thuần dưỡng · Nâng cấp · Hưởng thụ linh khí thụ động', {
                fontFamily: DIALOG_FONT,
                fontSize: '22px',
                color: '#795b49',
            })
            .setOrigin(0.5);

        /* close */
        this.closeButton = s
            .add.text(W / 2 - 48, -H / 2 + 35, '×', {
                fontSize: '44px',
                color: '#5d356f',
            })
            .setOrigin(0.5)
            .setInteractive({ useHandCursor: true });
        this.closeButton.on('pointerdown', () => this.close());

        /* beast slots row */
        this.slotContainer = s.add.container(0, -H / 2 + 200);
        this.slots = [];
        this.beasts.forEach((beast, i) => {
            const slot = this.makeBeastSlot(i, beast);
            this.slots.push(slot);
            this.slotContainer.add(slot);
        });

        /* selected beast display area */
        this.displayY = -H / 2 + 380;
        this.beastSprite = s.add.sprite(0, this.displayY + 10, this.beasts[0]?.assetKey ?? '')
            .setOrigin(0.5)
            .setScale(1.2)
            .setVisible(false);
        this.beastName = s.add.text(0, this.displayY + 110, this.beasts[0]?.name ?? '', {
            fontFamily: DIALOG_FONT,
            fontSize: '30px',
            color: '#4b2864',
            fontStyle: 'bold',
        }).setOrigin(0.5);
        this.rarityBadge = s.add.text(0, this.displayY + 148, this.beasts[0]?.rarity ?? '', {
            fontFamily: DIALOG_FONT,
            fontSize: '18px',
            color: '#fff',
            backgroundColor: '#8a5fa8',
            padding: { left: 10, right: 10, top: 4, bottom: 4 },
        }).setOrigin(0.5);

        /* affinity bar */
        const affinityY = this.displayY + 195;
        this.affinityLabel = s
            .add.text(-260, affinityY, 'Thân mật:', {
                fontFamily: DIALOG_FONT,
                fontSize: '22px',
                color: '#3d2851',
            })
            .setOrigin(0, 0.5);
        const barBg = s.add.graphics();
        barBg.fillStyle(0xe8d9b0, 1).fillRoundedRect(-180, affinityY - 14, 360, 28, 10);
        this.affinityFill = s.add.graphics();
        this.affinityText = s.add.text(0, affinityY, '', {
            fontFamily: DIALOG_FONT,
            fontSize: '18px',
            color: '#fff',
            fontStyle: 'bold',
        }).setOrigin(0.5);
        this.updateAffinityBar(this.beasts[0]);

        /* action buttons */
        const btnY = this.displayY + 280;
        this.feedBtn = this.makeActionButton(-140, btnY, 'Cho Ăn', JADE, () => this.handleFeed());
        this.petBtn = this.makeActionButton(140, btnY, 'Xoa Đầu', RUBY, () => this.handlePet());

        /* cooldown hints */
        this.feedCooldown = s.add.text(-140, btnY + 44, '', {
            fontFamily: DIALOG_FONT,
            fontSize: '16px',
            color: '#795b49',
        }).setOrigin(0.5);
        this.petCooldown = s.add.text(140, btnY + 44, '', {
            fontFamily: DIALOG_FONT,
            fontSize: '16px',
            color: '#795b49',
        }).setOrigin(0.5);

        /* passive buffs panel */
        const buffsY = this.displayY + 360;
        s.add.graphics()
            .fillStyle(0xfff8e9, 1)
            .lineStyle(3, 0xb89158, 0.6)
            .fillRoundedRect(-320, buffsY - 12, 640, 120, 14)
            .strokeRoundedRect(-320, buffsY - 12, 640, 120, 14);
        s.add.text(0, buffsY + 4, '✦ Linh khí thụ động ', {
            fontFamily: DIALOG_FONT,
            fontSize: '22px',
            color: '#633d70',
        }).setOrigin(0.5);
        this.buffsList = s.add.container(0, buffsY + 46);
        this.refreshBuffs(this.beasts[0]);

        /* assemble */
        this.root.add([
            shade, panel, this.title, this.subtitle, this.closeButton,
            this.slotContainer,
            this.beastSprite, this.beastName, this.rarityBadge,
            this.affinityLabel, this.affinityFill, this.affinityText,
            this.feedBtn, this.petBtn, this.feedCooldown, this.petCooldown,
            this.buffsList,
        ]);

        this.refreshSlots();
        this.selectBeast(0);
        return this;
    }

    /* ---------- helpers ---------- */

    makeBeastSlot(index, beast) {
        const s = this.scene;
        const x = -200 + index * 200;
        const container = s.add.container(x, 0);

        const g = s.add.graphics();
        g.fillStyle(0xfff8e9, 1)
            .lineStyle(3, 0xb89158, 1)
            .fillRoundedRect(-75, -75, 150, 150, 14)
            .strokeRoundedRect(-75, -75, 150, 150, 14);

        const sprite = s.add.sprite(0, -10, beast.assetKey).setOrigin(0.5).setScale(0.55).setVisible(false);
        const name = s
            .add.text(0, 40, beast.name, {
                fontFamily: DIALOG_FONT,
                fontSize: '15px',
                color: '#3d2851',
                align: 'center',
                wordWrap: { width: 130 },
            })
            .setOrigin(0.5);

        const hit = s.add.rectangle(0, 0, 150, 150, 0x000000, 0)
            .setOrigin(0.5)
            .setInteractive({ useHandCursor: true });
        hit.on('pointerdown', () => this.selectBeast(index));

        container.add([g, sprite, name, hit]);
        container.sprite = sprite;
        container.nameText = name;
        return container;
    }

    makeActionButton(x, y, label, color, handler) {
        const s = this.scene;
        const bg = s.add.graphics();
        bg.fillStyle(color, 1).fillRoundedRect(x - 95, y - 28, 190, 56, 22);
        bg.lineStyle(2, 0xfff7dd, 0.6).strokeRoundedRect(x - 95, y - 28, 190, 56, 22);

        const txt = s
            .add.text(x, y, label, {
                fontFamily: DIALOG_FONT,
                fontSize: '26px',
                color: '#fff7dd',
            })
            .setOrigin(0.5)
            .setInteractive({ useHandCursor: true });

        txt.on('pointerover', () => bg.setAlpha(0.85));
        txt.on('pointerout', () => bg.setAlpha(1));
        txt.on('pointerdown', handler);
        return txt;
    }

    /* ---------- state ---------- */

    selectBeast(index) {
        if (index < 0 || index >= this.beasts.length) return;
        this.selectedIndex = index;
        const beast = this.beasts[index];

        /* highlight slot */
        this.slots.forEach((slot, i) => {
            slot.alpha = i === index ? 1 : 0.6;
        });

        /* update display */
        this.beastName.setText(beast.name);
        this.rarityBadge.setText(beast.rarity.toUpperCase());
        this.updateAffinityBar(beast);
        this.refreshBuffs(beast);
        this.updateCooldowns(beast);

        /* animation */
        this.scene.tweens.add({
            targets: this.beastName,
            scaleX: { from: 0.8, to: 1 },
            scaleY: { from: 0.8, to: 1 },
            alpha: { from: 0.4, to: 1 },
            duration: 300,
            ease: 'Sine.easeOut',
        });
    }

    updateAffinityBar(beast) {
        if (!beast || !this.affinityFill) return;
        const pct = Phaser.Math.Clamp(beast.affinity / beast.affinityMax, 0, 1);
        const barWidth = 360 * pct;
        const barY = -this.displayY + this.displayY + 195;

        this.affinityFill.clear();
        this.affinityFill.fillStyle(0x4fd1a5, 1);
        this.affinityFill.fillRoundedRect(-180, 195 - 14, barWidth, 28, 10);

        this.affinityText.setText(`${Math.floor(beast.affinity)} / ${beast.affinityMax}`);

        /* tint by affinity level */
        if (pct >= 0.8) this.affinityFill.fillStyle(0x4fd1a5, 1);
        else if (pct >= 0.4) this.affinityFill.fillStyle(0xdfb15b, 1);
        else this.affinityFill.fillStyle(0xe54545, 1);
    }

    refreshBuffs(beast) {
        if (!this.buffsList) return;
        this.buffsList.removeAll(true);
        if (!beast || !beast.buffs || !beast.buffs.length) {
            this.buffsList.add(
                this.scene.add.text(0, 0, 'Chưa có linh khí thụ động.', {
                    fontFamily: DIALOG_FONT,
                    fontSize: '20px',
                    color: '#876e63',
                }).setOrigin(0.5),
            );
            return;
        }
        beast.buffs.forEach((buff, i) => {
            const row = this.scene.add.text(0, i * 32, `✧  ${buff.label}`, {
                fontFamily: DIALOG_FONT,
                fontSize: '22px',
                color: '#3d2851',
            }).setOrigin(0.5);
            this.buffsList.add(row);
        });
    }

    refreshSlots() {
        this.slots.forEach((slot, i) => {
            if (slot.sprite) slot.sprite.setVisible(true);
        });
    }

    updateCooldowns(beast) {
        const now = Date.now();
        const FEED_CD = 5000;
        const PET_CD = 3000;
        const feedLeft = Math.max(0, FEED_CD - (now - beast.lastFed));
        const petLeft = Math.max(0, PET_CD - (now - beast.lastPet));
        this.feedCooldown.setText(feedLeft > 0 ? `Chờ ${Math.ceil(feedLeft / 1000)}s` : '');
        this.petCooldown.setText(petLeft > 0 ? `Chờ ${Math.ceil(petLeft / 1000)}s` : '');
        this.feedBtn.setAlpha(feedLeft > 0 ? 0.5 : 1);
        this.petBtn.setAlpha(petLeft > 0 ? 0.5 : 1);
    }

    /* ---------- actions ---------- */

    handleFeed() {
        const beast = this.beasts[this.selectedIndex];
        if (!beast) return;
        const now = Date.now();
        if (now - beast.lastFed < 5000) return; /* cooldown */

        beast.lastFed = now;
        beast.affinity = Math.min(beast.affinityMax, beast.affinity + 5);

        this.audio?.pluck?.(523.25, { gain: 0.1 }); /* C5 */
        this.updateAffinityBar(beast);
        this.refreshBuffs(beast);
        this.updateCooldowns(beast);

        /* burst animation */
        this.scene.tweens.add({
            targets: this.affinityFill,
            alpha: { from: 0.3, to: 1 },
            duration: 250,
            yoyo: true,
            ease: 'Sine.easeOut',
        });

        this.onFeed(beast);
    }

    handlePet() {
        const beast = this.beasts[this.selectedIndex];
        if (!beast) return;
        const now = Date.now();
        if (now - beast.lastPet < 3000) return; /* cooldown */

        beast.lastPet = now;
        beast.affinity = Math.min(beast.affinityMax, beast.affinity + 2);

        this.audio?.pluck?.(659.25, { gain: 0.1 }); /* E5 */
        this.updateAffinityBar(beast);
        this.refreshBuffs(beast);
        this.updateCooldowns(beast);

        /* gentle pulse */
        this.scene.tweens.add({
            targets: this.beastName,
            scaleX: { from: 1, to: 1.15 },
            scaleY: { from: 1, to: 1.15 },
            duration: 200,
            yoyo: true,
            ease: 'Sine.easeInOut',
        });

        this.onPet(beast);
    }

    /* ---------- open / close ---------- */

    open() {
        this.opened = true;
        this.root.setVisible(true);
        return this;
    }

    close() {
        this.opened = false;
        this.root?.setVisible(false);
        return this;
    }

    isOpen() {
        return this.opened;
    }

    destroy() {
        this.disposers.forEach((off) => off());
        this.root?.destroy(true);
        this.opened = false;
    }
}

export default BeastModal;
