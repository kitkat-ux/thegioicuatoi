import Phaser from 'phaser';
import { IsoMath } from '../core/IsoMath.js';
import { SEED_CATALOG, SEED_BY_ID, normalizeText } from '../data/seedCatalog.js';
import { buildExtraTextures, ensureFallbackTextures } from '../vfx/TextureFactory.js';
import AudioManager from '../audio/AudioManager.js';

const W = 1080;
const H = 1920;
const ORIGIN = { x: 540, y: 950 };
const ROWS = 6;
const COLS = 6;

const STATE = { EMPTY: 'EMPTY', PLANTED: 'PLANTED', GROWING: 'GROWING', BLOOMING: 'BLOOMING' };

/* ------------------------- UI palette ------------------------- */
const C = {
    gold: 0xd8a24e,
    goldLight: 0xffe3a0,
    ink: 0x1a0f2e,
    panel: 0x241540,
    panelDeep: 0x181026,
    cyan: 0x00e5ff,
    tealGlow: 0x7ff7ff,
    text: '#ffe9c4',
};

/* Depth plan: bg -100, platform -60, tiles ~910..1078, petals 1080+,
   hint 4/5, chip 90, action bar 120, drawer 1200, modal 1500. */
const D = { TILES: 910, PETALS: 1080, CHIP: 90, BAR: 120, DRAWER: 1200, MODAL: 1500 };

/* pentatonic walk for bloom chimes (C major pentatonic, 2 octaves) */
const SEED_CHIME_BASE = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5, 1174.66, 1318.51, 1567.98, 1760.0];
const PENTATONIC_WATER_BASE = 1046.5;

export default class GardenScene extends Phaser.Scene {
    constructor() {
        super({ key: 'GardenScene' });
        this.audio = null;
        this.tiles = [];
        this.selectedSeed = null;
        this.searchQuery = '';
        this.harmony = 0;
        this.plantedCount = 0;
        this.bloomCount = 0;
        this.drawerOpen = false;
        this.watering = false;
        this.fullMosaicShown = false;
    }

    /* ============================ PRELOAD ============================ */
    preload() {
        const assets = [
            'bg_manor_isometric',
            'tile_soil',
            'flower_purple',
            'flower_golden',
            'flower_cyan',
            'flower_emerald',
            'icon_seed_drawer',
            'icon_water_bucket',
            'icon_search',
        ];
        for (const a of assets) {
            this.load.image(a, `assets/images/${a}.png`);
        }
    }

    /* ============================ BOOT ============================ */
    create() {
        // Procedural textures first, then fallbacks for any asset that failed
        // to load (auto-fallback rule), so every texture key exists up front.
        buildExtraTextures(this);
        ensureFallbackTextures(this);

        // Background covers 1080x1920
        this.add.image(W / 2, H / 2, 'bg_manor_isometric').setDisplaySize(W, H).setDepth(-100);

        this.audio = new AudioManager(this);
        this.input.once('pointerdown', () => {
            this.audio.ensure();
            this.audio.startAmbient();
        });

        this.createPlatform();
        this.createGrid();
        this.createHud();
        this.createActionBar();
        this.createDrawer();
        this.createModal();
        this.createMist();
        this.createParticleEmitters();
        this.createBloomRadiance();

        this.updateHint();
    }

    /* ====================== PLATFORM (grounding the grid) ====================== */
    createPlatform() {
        // Grid diamond: top vertex (540,950), bottom vertex (540,1270).
        // The platform texture (936x540) at scale 0.82 wraps it with margin.
        this.platform = this.add.image(540, 1110, 'platform')
            .setDepth(-60)
            .setScale(0.82)
            .setAlpha(0.96);
        // gentle ambient glow on the stone
        this.add.image(540, 1112, 'glow').setTint(0x2c8ea8).setAlpha(0.12).setScale(4.0, 2.2).setDepth(-59);
    }

    /* ============================ GRID ============================ */
    createGrid() {
        this.tileHighlight = this.add.image(-400, -400, 'tile_highlight').setVisible(false).setDepth(D.TILES + 5);
        for (let r = 0; r < ROWS; r++) {
            this.tiles[r] = [];
            for (let c = 0; c < COLS; c++) {
                const pos = IsoMath.gridToScreen(c, r, ORIGIN.x, ORIGIN.y);
                const tile = this.add.image(pos.x, pos.y, 'tile_soil')
                    .setInteractive(
                        new Phaser.Geom.Polygon(IsoMath.hitAreaPoints),
                        Phaser.Geom.Polygon.Contains
                    )
                    .setDepth(D.TILES + (r + c) * 7)
                    .setScale(1.02);
                tile.gridData = { row: r, col: c, state: STATE.EMPTY, seedId: null, watered: false, plantSprites: null };
                tile.on('pointerdown', () => this.handleTileClick(tile));
                tile.on('pointerover', () => this.hoverTile(tile, true));
                tile.on('pointerout', () => this.hoverTile(tile, false));
                this.tiles[r][c] = tile;
            }
        }
    }

    hoverTile(tile, on) {
        const canPlant = this.selectedSeed && tile.gridData.state === STATE.EMPTY;
        if (on && canPlant) {
            this.tileHighlight.setVisible(true).setPosition(tile.x, tile.y).setAlpha(0.9);
            tile.setTint(0xbfe8ff);
        } else if (on === false) {
            this.tileHighlight.setVisible(false);
            if (tile.gridData.state === STATE.EMPTY) tile.clearTint();
        }
    }

    handleTileClick(tile) {
        this.audio.ensure();
        const data = tile.gridData;
        if (data.state !== STATE.EMPTY) {
            this.tweens.add({ targets: tile, scale: { from: 1.0, to: 1.06 }, yoyo: true, duration: 90 });
            this.audio.click();
            return;
        }
        if (!this.selectedSeed) {
            this.flashHint('Hãy mở Ngăn Hạt Giống và chọn một loài hoa ✦');
            return;
        }
        this.plantSeed(tile);
    }

    plantSeed(tile) {
        const data = tile.gridData;
        const seed = this.selectedSeed;
        data.state = STATE.PLANTED;
        data.seedId = seed.id;
        this.plantedCount++;
        this.audio.ensure();
        this.audio.dig();
        this.audio.pluck(seed.id === 'flower_cyan_orchid' ? 880 : 659.25, { gain: 0.1 });

        // seed mound + sprout with pop-in tween
        const mound = this.add.image(tile.x, tile.y + 10, 'seed').setDepth(tile.depth + 2);
        const sprout = this.add.image(tile.x, tile.y - 12, 'sprout')
            .setScale(0.22)
            .setAlpha(0.9)
            .setDepth(tile.depth + 3)
            .setTint(0xbfe8ff);
        data.plantSprites = { mound, sprout };

        this.tweens.add({ targets: mound, scale: { from: 0.3, to: 1 }, duration: 260, ease: 'Back.easeOut' });
        this.tweens.add({ targets: sprout, scale: { from: 0.22, to: 0.5 }, duration: 380, ease: 'Back.easeOut' });
        this.tweens.add({
            targets: sprout, angle: { from: -4, to: 4 }, duration: 800, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
        });
        this.tweens.add({ targets: tile, scale: { from: 1.0, to: 1.04, yoyo: true }, duration: 120 });

        this.updateHud();
        this.updateHint();
        const idx = this.tiles.flat().indexOf(tile);
        this.audio.chime(660 + (idx % 5) * 60, { gain: 0.05 });
    }

    /* ============================ SEARCH DRAWER ============================ */
    createDrawer() {
        // Bottom sheet. Children use absolute coords for the OPEN state;
        // the container slides from y=H to y=0.
        this.drawer = this.add.container(0, H).setDepth(D.DRAWER);
        const panel = this.add.graphics();
        panel.fillStyle(C.ink, 0.97);
        panel.fillRoundedRect(24, H - 620, W - 48, 600, 26);
        panel.lineStyle(4, C.gold, 0.9);
        panel.strokeRoundedRect(24, H - 620, W - 48, 600, 26);
        panel.fillStyle(C.panel, 1);
        panel.fillRoundedRect(40, H - 604, W - 80, 92, 18);
        this.drawer.add(panel);

        // close button (top-right of header)
        const closeBtn = this.add.container(960, H - 574);
        const closeBg = this.add.graphics();
        closeBg.fillStyle(0x2a1c4a, 0.98);
        closeBg.lineStyle(3, C.gold, 0.9);
        closeBg.fillRoundedRect(-42, -42, 84, 84, 20);
        closeBg.strokeRoundedRect(-42, -42, 84, 84, 20);
        const closeLabel = this.add.text(0, 0, '✕', {
            fontFamily: 'Arial', fontSize: '40px', color: '#ffb0b0',
        }).setOrigin(0.5);
        const closeZone = this.add.zone(0, 0, 84, 84).setInteractive();
        closeZone.on('pointerdown', () => this.closeDrawer());
        closeBtn.add([closeBg, closeLabel, closeZone]);
        this.drawer.add(closeBtn);

        // search magnifier icon inside the input's left padding
        const searchIcon = this.add.image(230, H - 574, 'icon_search').setDisplaySize(52, 52).setAlpha(0.95);
        this.drawer.add(searchIcon);

        // DOM search input (rendered above the canvas by Phaser)
        this.searchInput = this.add.dom(
            500,
            H - 574,
            'input',
            'width:620px;height:78px;box-sizing:border-box;background:rgba(24,14,44,0.92);' +
                'border:2px solid rgba(216,162,78,0.9);border-radius:14px;color:#ffe9c4;' +
                'font-size:30px;padding:0 18px 0 78px;outline:none;font-family:Georgia,serif;'
        );
        this.searchInput.node.placeholder = 'Tìm hoa… (tim, vang, xanh, gold, blue)';
        this.searchInput.node.addEventListener('input', (e) => this.onSearchInput(e.target.value));
        this.searchInput.setVisible(false);

        // seed cards
        this.seedCards = SEED_CATALOG.map((seed, i) => this.createSeedCard(seed, i));
        this.seedCards.forEach((c) => this.drawer.add(c.container));

        // selected-seed chip (shown when drawer is closed)
        this.selectedChip = this.add.container(540, 1435).setDepth(D.CHIP).setVisible(false);
        const chipBg = this.add.graphics();
        chipBg.fillStyle(0x241540, 0.95);
        chipBg.lineStyle(3, C.gold, 0.9);
        chipBg.fillRoundedRect(-300, -46, 600, 92, 44);
        chipBg.strokeRoundedRect(-300, -46, 600, 92, 44);
        this.chipIcon = this.add.image(-228, 0, 'flower_cyan').setDisplaySize(74, 74);
        this.chipText = this.add.text(-172, 0, '', {
            fontFamily: 'Georgia, serif', fontSize: '30px', color: C.text, fontStyle: 'bold',
        }).setOrigin(0, 0.5);
        const chipX = this.add.text(252, 0, '✕', {
            fontFamily: 'Arial', fontSize: '40px', color: '#ffb0b0',
        }).setOrigin(0.5);
        const chipHit = this.add.zone(0, 0, 600, 92).setInteractive();
        chipHit.on('pointerdown', () => this.clearSelection());
        this.selectedChip.add([chipBg, this.chipIcon, this.chipText, chipX, chipHit]);
    }

    createSeedCard(seed, index) {
        const cx = 148 + index * 264;
        const cy = H - 390; // card center (absolute coords in closed container state)
        const container = this.add.container(cx, cy);
        const w = 232;
        const h = 240;

        const bg = this.add.graphics();
        const draw = (selected) => {
            bg.clear();
            bg.fillStyle(selected ? 0x3c2a63 : C.panel, 0.98);
            bg.lineStyle(selected ? 5 : 3, selected ? 0xffe3a0 : C.gold, selected ? 1 : 0.75);
            bg.fillRoundedRect(-w / 2, -h / 2, w, h, 20);
            bg.strokeRoundedRect(-w / 2, -h / 2, w, h, 20);
            bg.fillStyle(0x181026, 0.9);
            bg.fillRoundedRect(-w / 2 + 16, -h / 2 + 14, w - 32, 128, 14);
        };
        draw(false);

        // aspect-correct flower thumbnail
        const frame = this.textures.get(seed.sprite_key).getSourceImage();
        const aspect = frame.width / frame.height;
        const thumbH = 132;
        const thumbW = Math.min(thumbH * aspect, w - 60);
        const glow = this.add.image(0, -34, 'glow').setTint(seed.petals).setAlpha(0.35).setScale(0.9, 0.72);
        const flower = this.add.image(0, -30, seed.sprite_key).setDisplaySize(thumbW, thumbH);
        const name = this.add.text(0, 64, seed.name, {
            fontFamily: 'Georgia, serif', fontSize: '26px', color: C.text,
            align: 'center', wordWrap: { width: w - 20 }, fontStyle: 'bold',
        }).setOrigin(0.5);
        const sub = this.add.text(0, 104, `${seed.colorName} · ${Math.round(seed.growthMs / 1000)}s`, {
            fontFamily: 'Georgia, serif', fontSize: '21px', color: '#b9a3dd',
        }).setOrigin(0.5);

        container.add([bg, glow, flower, name, sub]);
        const zone = this.add.zone(0, 0, w, h).setInteractive();
        zone.on('pointerdown', () => this.selectSeed(seed));
        container.add(zone);

        return { container, seed, bg, draw };
    }

    openDrawer() {
        this.audio.ensure();
        this.audio.click();
        this.drawerOpen = true;
        this.tweens.killTweensOf([this.drawer, this.searchInput]);
        // keep the DOM input in sync while the sheet slides up
        this.searchInput.setVisible(true).setAlpha(0).setY(H + (H - 574));
        this.tweens.add({
            targets: this.drawer,
            y: { from: H, to: 0 },
            duration: 320,
            ease: 'Cubic.easeOut',
        });
        this.tweens.add({
            targets: this.searchInput,
            y: H - 574,
            alpha: 1,
            duration: 300,
            ease: 'Cubic.easeOut',
        });
        // redraw cards for current filter, then fade them up
        this.applyFilter(this.searchQuery);
        this.seedCards.forEach((card, i) => {
            card.container.setAlpha(0).setY(H - 390 + 30);
            this.tweens.add({
                targets: card.container,
                alpha: 1,
                y: H - 390,
                delay: 60 + i * 60,
                duration: 260,
                ease: 'Cubic.easeOut',
            });
        });
        this.updateHint();
    }

    closeDrawer() {
        this.drawerOpen = false;
        this.audio.click();
        this.tweens.killTweensOf([this.drawer, this.searchInput]);
        this.tweens.add({ targets: this.drawer, y: H, duration: 280, ease: 'Cubic.easeIn' });
        this.tweens.add({
            targets: this.searchInput,
            y: H + (H - 574),
            duration: 280,
            ease: 'Cubic.easeIn',
            onComplete: () => {
                this.searchInput.setVisible(false);
                this.searchInput.setAlpha(0);
            },
        });
        this.updateHint();
    }

    onSearchInput(value) {
        this.searchQuery = value;
        this.applyFilter(this.searchQuery);
        this.audio.click(0);
    }

    applyFilter(query) {
        const q = normalizeText(query).trim();
        SEED_CATALOG.forEach((seed, i) => {
            const card = this.seedCards[i];
            const match = !q || seed.searchText.includes(q);
            card.container.setVisible(match);
            if (match) card.draw(this.selectedSeed?.id === seed.id);
        });
    }

    selectSeed(seed) {
        this.audio.ensure();
        this.audio.click();
        this.selectedSeed = seed;
        this.seedCards.forEach((c) => c.draw(c.seed.id === seed.id));
        // close drawer after a beat so the player sees their choice
        this.time.delayedCall(200, () => this.closeDrawer());
        this.showSelectedChip(seed);
        this.updateHint();
    }

    showSelectedChip(seed) {
        this.chipIcon.setTexture(seed.sprite_key);
        this.chipText.setText(`${seed.name}`);
        this.selectedChip.setVisible(true).setAlpha(0).setScale(0.8);
        this.tweens.add({
            targets: this.selectedChip, alpha: 1, scale: 1, duration: 280, ease: 'Back.easeOut',
        });
    }

    clearSelection() {
        this.selectedSeed = null;
        this.audio.click();
        this.tweens.add({
            targets: this.selectedChip, alpha: 0, scale: 0.8, duration: 180,
            onComplete: () => this.selectedChip.setVisible(false),
        });
        this.updateHint();
    }

    /* ============================ HUD ============================ */
    createHud() {
        this.add.text(40, 44, 'HOA VIÊN TIÊN CẢNH', {
            fontFamily: 'Georgia, serif', fontSize: '46px', color: '#ffe9c4', fontStyle: 'bold',
            stroke: '#3a1c5e', strokeThickness: 8,
        });
        this.add.text(44, 102, 'Floral Manor · Cổ Phong Garden', {
            fontFamily: 'Georgia, serif', fontSize: '24px', color: '#c9b2f0',
            stroke: '#1b1140', strokeThickness: 5,
        });

        // Harmony badge
        const hud = this.add.container(860, 92).setDepth(10);
        const badge = this.add.graphics();
        badge.fillStyle(0x241540, 0.92);
        badge.lineStyle(3, C.gold, 0.9);
        badge.fillRoundedRect(-190, -58, 380, 116, 26);
        badge.strokeRoundedRect(-190, -58, 380, 116, 26);
        const lotus = this.add.image(-140, 0, 'glow').setTint(0xffd97a).setScale(0.42);
        this.harmonyText = this.add.text(-108, -16, 'Điểm Hòa Hợp', {
            fontFamily: 'Georgia, serif', fontSize: '22px', color: '#d8c3f2',
        }).setOrigin(0, 0.5);
        this.harmonyValue = this.add.text(-108, 18, '✿ 0', {
            fontFamily: 'Georgia, serif', fontSize: '32px', color: '#ffe9a8', fontStyle: 'bold',
        }).setOrigin(0, 0.5);
        hud.add([badge, lotus, this.harmonyText, this.harmonyValue]);

        // hint line under title
        this.hintBg = this.add.rectangle(W / 2, 168, 900, 56, 0x1a0f2e, 0.62)
            .setStrokeStyle(2, C.gold, 0.5).setDepth(4);
        this.hintText = this.add.text(W / 2, 168, '', {
            fontFamily: 'Georgia, serif', fontSize: '28px', color: '#efe0ff',
            align: 'center', stroke: '#1b1140', strokeThickness: 6,
        }).setOrigin(0.5).setDepth(5);
    }

    updateHint() {
        if (this.selectedSeed && !this.drawerOpen) {
            this.hintText.setText('✨ Đã chọn: ' + this.selectedSeed.name + ' — chạm vào ô đất trống để gieo');
            this.hintText.setColor('#ffe9a8');
            this.hintBg.setSize(1000, 56);
        } else if (this.drawerOpen) {
            this.hintText.setText('🔍 Gõ từ khóa (tim · vang · xanh · gold · blue) rồi chọn hạt giống');
            this.hintText.setColor('#d8c3f2');
            this.hintBg.setSize(1000, 56);
        } else {
            this.hintText.setText('Mở Ngăn Hạt Giống ⬇ để chọn hoa, gieo lên nền hoa viên');
            this.hintText.setColor('#efe0ff');
            this.hintBg.setSize(900, 56);
        }
    }

    flashHint(msg) {
        this.hintText.setText(msg).setColor('#ffd7a8');
        this.tweens.add({ targets: [this.hintText, this.hintBg], alpha: { from: 0.25, to: 1 }, duration: 160 });
        this.time.delayedCall(1800, () => {
            if (this.hintText.text === msg) this.updateHint();
        });
    }

    updateHud() {
        this.harmonyValue.setText(`✿ ${this.harmony}`);
    }

    /* ============================ ACTION BAR ============================ */
    createActionBar() {
        // drawer button
        this.drawerBtn = this.add.container(210, 1812).setDepth(D.BAR);
        const db = this.add.graphics();
        const dbDraw = (hover) => {
            db.clear();
            db.fillStyle(0x241540, 0.96);
            db.lineStyle(4, hover ? 0xffe3a0 : C.gold, 1);
            db.fillCircle(0, 0, 108);
            db.strokeCircle(0, 0, 108);
            db.fillStyle(0x181026, 0.8);
            db.fillCircle(0, 0, 96);
        };
        dbDraw(false);
        const dbIcon = this.add.image(0, 0, 'icon_seed_drawer').setDisplaySize(150, 138);
        const dbLabel = this.add.text(0, 128, 'Ngăn Hạt Giống', {
            fontFamily: 'Georgia, serif', fontSize: '24px', color: C.text, fontStyle: 'bold',
            stroke: '#1b1140', strokeThickness: 5,
        }).setOrigin(0.5);
        const dbZone = this.add.circle(0, 0, 108, 0xffffff, 0.001).setInteractive(
            new Phaser.Geom.Circle(0, 0, 108), Phaser.Geom.Circle.Contains
        );
        dbZone.on('pointerdown', () => {
            this.audio.ensure();
            if (this.drawerOpen) this.closeDrawer();
            else this.openDrawer();
        });
        dbZone.on('pointerover', () => dbDraw(true));
        dbZone.on('pointerout', () => dbDraw(false));
        this.drawerBtn.add([db, dbIcon, dbLabel, dbZone]);

        // one-click water button
        this.waterBtn = this.add.container(870, 1812).setDepth(D.BAR);
        const wb = this.add.graphics();
        const wbDraw = (hover) => {
            wb.clear();
            wb.fillStyle(0x0e3a44, 0.96);
            wb.lineStyle(4, hover ? 0xaef4ff : 0x00e5ff, 1);
            wb.fillCircle(0, 0, 108);
            wb.strokeCircle(0, 0, 108);
            wb.fillStyle(0x082830, 0.8);
            wb.fillCircle(0, 0, 96);
        };
        wbDraw(false);
        const wbIcon = this.add.image(0, 0, 'icon_water_bucket').setDisplaySize(140, 140);
        const wbLabel = this.add.text(0, 128, 'Tưới Một Chạm ✦', {
            fontFamily: 'Georgia, serif', fontSize: '24px', color: '#aef4ff', fontStyle: 'bold',
            stroke: '#0a2830', strokeThickness: 5,
        }).setOrigin(0.5);
        const wbZone = this.add.circle(0, 0, 108, 0xffffff, 0.001).setInteractive(
            new Phaser.Geom.Circle(0, 0, 108), Phaser.Geom.Circle.Contains
        );
        wbZone.on('pointerdown', () => this.onWaterButton());
        wbZone.on('pointerover', () => wbDraw(true));
        wbZone.on('pointerout', () => wbDraw(false));
        this.waterBtn.add([wb, wbIcon, wbLabel, wbZone]);

        // center decorative lantern divider
        this.add.image(540, 1806, 'glow').setTint(0xffc46b).setScale(0.55, 0.8).setAlpha(0.8);
        this.add.circle(540, 1806, 10, 0xffe3a0, 1).setDepth(D.BAR + 1);
    }

    onWaterButton() {
        this.audio.ensure();
        const planted = this.tiles.flat().filter((t) => t.gridData.state !== STATE.EMPTY);
        if (planted.length === 0) {
            this.audio.click();
            this.tweens.add({ targets: this.waterBtn, x: { from: 870, to: 878 }, yoyo: true, repeat: 2, duration: 60 });
            this.flashHint('Chưa có hạt nào được gieo — hãy chọn hoa và gieo trước ✧');
            return;
        }
        this.openModal();
    }

    /* ============================ REWARDED MODAL ============================ */
    createModal() {
        this.modal = this.add.container(0, 0).setDepth(D.MODAL).setVisible(false);
        const dim = this.add.rectangle(W / 2, H / 2, W, H, 0x05030c, 0.78).setInteractive();
        const panel = this.add.graphics();
        panel.fillStyle(C.panelDeep, 0.98);
        panel.lineStyle(4, C.gold, 1);
        panel.fillRoundedRect(W / 2 - 410, 560, 820, 620, 30);
        panel.strokeRoundedRect(W / 2 - 410, 560, 820, 620, 30);
        panel.lineStyle(2, 0xffe3a0, 0.35);
        panel.strokeRoundedRect(W / 2 - 390, 580, 780, 580, 24);
        const title = this.add.text(W / 2, 660, 'TƯỚI NƯỚC TOÀN TRANG VIÊN', {
            fontFamily: 'Georgia, serif', fontSize: '44px', color: '#ffe9a8', fontStyle: 'bold',
            stroke: '#1b1140', strokeThickness: 8,
        }).setOrigin(0.5);
        const desc = this.add.text(W / 2, 760, 'Một chạm tưới mọi ô đất — mọi mầm non cùng lúc\nnở hoa rực rỡ. ✦ VIP: xem quảng cáo nhận +3 Hòa Hợp.', {
            fontFamily: 'Georgia, serif', fontSize: '28px', color: '#e6d8ff',
            align: 'center', lineSpacing: 10,
        }).setOrigin(0.5);

        // VIP water icon
        const vip = this.add.container(W / 2, 920);
        const vipGlow = this.add.image(0, 0, 'glow').setTint(0x00e5ff).setScale(1.6, 1.2).setAlpha(0.55);
        const vipIcon = this.add.image(0, 0, 'icon_water_bucket').setDisplaySize(180, 180);
        vip.add([vipGlow, vipIcon]);

        // buttons (each is a container with graphics + text + zone)
        const grayBtn = this.makeModalButton(W / 2, 1072, 'Tưới Ngay (Miễn Phí)', false);
        const goldBtn = this.makeModalButton(W / 2, 1152, '▶ Xem Quảng Cáo · +3 Hòa Hợp', true);
        goldBtn.zone.on('pointerdown', () => this.watchAd());
        grayBtn.zone.on('pointerdown', () => this.closeModal(true));
        const closeX = this.add.text(W / 2 + 380, 600, '✕', {
            fontFamily: 'Arial', fontSize: '42px', color: '#ffb0b0',
        }).setOrigin(0.5).setInteractive();
        closeX.on('pointerdown', () => this.closeModal(false));

        this.adTimerText = this.add.text(W / 2, 830, '', {
            fontFamily: 'Georgia, serif', fontSize: '38px', color: '#aef4ff', fontStyle: 'bold',
            stroke: '#0a2830', strokeThickness: 8,
        }).setOrigin(0.5);

        this.modal.add([dim, panel, title, desc, vip, grayBtn.container, goldBtn.container, closeX, this.adTimerText]);
    }

    makeModalButton(x, y, label, gold) {
        const container = this.add.container(0, 0);
        const g = this.add.graphics();
        g.fillStyle(gold ? 0x7a4a1e : 0x2a1c4a, 0.98);
        g.lineStyle(4, gold ? 0xffe3a0 : C.gold, 1);
        g.fillRoundedRect(x - 330, y - 36, 660, 72, 36);
        g.strokeRoundedRect(x - 330, y - 36, 660, 72, 36);
        const t = this.add.text(x, y, label, {
            fontFamily: 'Georgia, serif', fontSize: '29px',
            color: gold ? '#fff3d0' : '#e6d8ff', fontStyle: 'bold',
        }).setOrigin(0.5);
        const zone = this.add.zone(x, y, 660, 72).setInteractive();
        container.add([g, t, zone]);
        return { container, zone };
    }

    openModal() {
        this.audio.ensure();
        this.audio.click();
        this.modal.setVisible(true).setAlpha(0);
        this.tweens.add({ targets: this.modal, alpha: 1, duration: 200 });
    }

    closeModal(waterNow) {
        this.tweens.add({
            targets: this.modal, alpha: 0, duration: 180,
            onComplete: () => this.modal.setVisible(false),
        });
        if (waterNow) this.waterAll();
    }

    watchAd() {
        if (this.adWatching) return;
        this.adWatching = true;
        this.audio.ensure();
        this.audio.startAmbient();
        // simulated rewarded ad: 3-second countdown
        let left = 3;
        this.adTimerText.setText(`Đang phát quảng cáo… ${left}`);
        const timer = this.time.addEvent({
            delay: 1000,
            repeat: 2,
            callback: () => {
                left--;
                if (left > 0) {
                    this.adTimerText.setText(`Đang phát quảng cáo… ${left}`);
                    this.audio.chime(880 + (3 - left) * 110, { gain: 0.05 });
                } else {
                    this.adTimerText.setText('✦ Nhận thưởng! ✦');
                    this.audio.chime(1046.5, { gain: 0.12 });
                    this.audio.chime(1318.5, { gain: 0.1, when: 0.12 });
                    this.audio.chime(1568, { gain: 0.09, when: 0.24 });
                    timer.remove();
                    this.time.delayedCall(700, () => {
                        this.adWatching = false;
                        this.adTimerText.setText('');
                        this.harmony += 3;
                        this.updateHud();
                        this.closeModal(true);
                    });
                }
            },
        });
    }

    /* ============================ WATER & BLOOM ============================ */
    waterAll() {
        if (this.watering) return;
        this.watering = true;
        this.audio.ensure();
        this.audio.splash();
        this.audio.pluck(PENTATONIC_WATER_BASE, { gain: 0.14, dur: 2.2 });

        const plantable = this.tiles.flat().filter((t) => t.gridData.state !== STATE.EMPTY);
        let growIndex = 0;
        plantable.forEach((tile, i) => {
            const data = tile.gridData;
            if (data.state === STATE.BLOOMING) return;
            data.watered = true;
            tile.setTint(0xaee8ff);
            this.waterDropOnTile(tile, i);
            data.state = STATE.GROWING;
            growIndex++;
        });

        // staggered cascade bloom after the droplets land
        this.time.delayedCall(650, () => {
            let k = 0;
            plantable.forEach((tile) => {
                const data = tile.gridData;
                if (data.state === STATE.GROWING) {
                    this.time.delayedCall(k * 90, () => this.bloomTile(tile));
                    k++;
                }
            });
        });

        this.time.delayedCall(700 + growIndex * 90, () => {
            this.watering = false;
        });
    }

    waterDropOnTile(tile, index) {
        const flash = this.add.image(tile.x, tile.y, 'glow')
            .setTint(0x7ff7ff).setAlpha(0.5).setScale(0.8, 0.5).setDepth(tile.depth + 4);
        this.tweens.add({ targets: flash, alpha: 0, scale: 1.4, duration: 500, onComplete: () => flash.destroy() });
        const drop = this.add.image(tile.x, tile.y - 150, 'droplet')
            .setTint(0xbef4ff).setScale(0.8).setDepth(tile.depth + 5);
        this.tweens.add({
            targets: drop,
            y: tile.y - 30,
            alpha: { from: 1, to: 0.3 },
            duration: 420 + (index % 5) * 40,
            ease: 'Quad.easeIn',
            onComplete: () => drop.destroy(),
        });
    }

    bloomTile(tile) {
        const data = tile.gridData;
        if (data.state !== STATE.GROWING) return;
        const seed = SEED_BY_ID[data.seedId];
        data.state = STATE.BLOOMING;
        tile.clearTint();
        this.bloomCount++;

        // ground highlight
        const groundGlow = this.add.image(tile.x, tile.y, 'glow')
            .setTint(seed.petals).setAlpha(0.4).setScale(0.7, 0.45).setDepth(tile.depth + 6);
        this.tweens.add({
            targets: groundGlow, alpha: 0.12, scale: 1.15, duration: 900,
            onComplete: () => groundGlow.destroy(),
        });

        const sprout = data.plantSprites?.sprout;
        const mound = data.plantSprites?.mound;
        const bloom = this.add.image(tile.x, tile.y - 26, seed.sprite_key)
            .setScale(0.15).setAlpha(0.4).setDepth(tile.depth + 8);
        data.bloomSprite = bloom;

        // burst halo
        const halo = this.add.image(tile.x, tile.y - 26, 'glow')
            .setTint(seed.petals).setAlpha(0.85).setScale(0.3).setDepth(tile.depth + 7);
        this.tweens.add({
            targets: halo, scale: 2.4, alpha: 0, duration: 650, ease: 'Cubic.easeOut',
            onComplete: () => halo.destroy(),
        });

        // petal burst + sparkles
        this.emitPetals(tile.x, tile.y - 26, seed.id, 22);
        this.sparks.emitParticleAt(tile.x, tile.y - 26, 7);

        this.tweens.add({ targets: bloom, scale: 0.85, alpha: 1, duration: 520, ease: 'Back.easeOut' });
        this.tweens.add({
            targets: bloom, y: tile.y - 30, duration: 900, ease: 'Sine.easeInOut', yoyo: true, repeat: -1,
        });
        if (sprout) {
            this.tweens.add({ targets: sprout, alpha: 0, scale: 0.1, duration: 220, onComplete: () => sprout.destroy() });
        }
        if (mound) this.tweens.add({ targets: mound, alpha: 0, duration: 320, onComplete: () => mound.destroy() });

        // per-bloom permanent glow
        const glow = this.add.image(tile.x, tile.y - 28, 'glow')
            .setTint(seed.petals).setAlpha(0.18).setScale(1.5, 1.1).setDepth(tile.depth + 9);
        data.bloomGlow = glow;
        this.tweens.add({ targets: glow, alpha: 0.3, duration: 1400, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });

        // audio: pentatonic walk through the blooms
        this.audio.chime(SEED_CHIME_BASE[this.bloomCount % SEED_CHIME_BASE.length], { gain: 0.09 });
        if (this.bloomCount % 4 === 0) {
            this.audio.flute(SEED_CHIME_BASE[(this.bloomCount / 4) % 5], { gain: 0.06 });
        }

        this.harmony += 1;
        this.updateHud();
        const pop = this.add.text(tile.x, tile.y - 92, '+1 ✿', {
            fontFamily: 'Georgia, serif', fontSize: '30px', color: '#ffe9a8', fontStyle: 'bold',
            stroke: '#3a1c5e', strokeThickness: 6,
        }).setOrigin(0.5).setDepth(D.PETALS + 3);
        this.tweens.add({
            targets: pop, y: tile.y - 140, alpha: 0, duration: 900, ease: 'Cubic.easeOut',
            onComplete: () => pop.destroy(),
        });

        // full mosaic celebration
        if (this.bloomCount >= ROWS * COLS && !this.fullMosaicShown) {
            this.fullMosaicShown = true;
            this.time.delayedCall(500, () => this.celebrateMosaic());
        }
    }

    celebrateMosaic() {
        const halo = this.add.image(W / 2, 1090, 'glow').setTint(0xffd97a).setAlpha(0.9).setScale(0.6, 0.4);
        this.tweens.add({
            targets: halo, scale: { from: 0.6, to: 7 }, alpha: 0, duration: 1600, ease: 'Cubic.easeOut',
            onComplete: () => halo.destroy(),
        });
        this.petalRain.explode(160, W / 2, 300);
        this.time.delayedCall(900, () => this.petalRain.explode(120, W / 2, 300));
        [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) => this.audio.chime(f, { gain: 0.1, when: i * 0.14 }));
        const banner = this.add.text(W / 2, 480, '✦ HOA VIÊN ĐẠI THÀNH ✦', {
            fontFamily: 'Georgia, serif', fontSize: '60px', color: '#ffe9a8', fontStyle: 'bold',
            stroke: '#7a4a1e', strokeThickness: 12,
        }).setOrigin(0.5).setDepth(D.MODAL - 10).setScale(0.5).setAlpha(0);
        this.tweens.add({
            targets: banner, scale: 1, alpha: 1, duration: 600, ease: 'Back.easeOut',
            onComplete: () => {
                this.tweens.add({ targets: banner, alpha: 0, y: 380, delay: 1800, duration: 600 });
            },
        });
    }

    /* ============================ VFX EMITTERS ============================ */
    createParticleEmitters() {
        // petal burst emitters — one per flower color
        this.petalBursts = {};
        for (const seed of SEED_CATALOG) {
            this.petalBursts[seed.id] = this.add.particles(0, 0, 'petal', {
                speed: { min: 90, max: 320 },
                angle: { min: 0, max: 360 },
                gravityY: 240,
                lifespan: { min: 700, max: 1400 },
                scale: { start: 0.55, end: 0 },
                alpha: { start: 1, end: 0 },
                rotate: { min: -260, max: 260 },
                tint: seed.petals,
                quantity: 1,
                emitting: false,
            }).setDepth(D.PETALS);
        }
        this.sparks = this.add.particles(0, 0, 'spark', {
            speed: { min: 60, max: 200 },
            angle: { min: 0, max: 360 },
            lifespan: { min: 350, max: 700 },
            scale: { start: 0.5, end: 0 },
            alpha: { start: 1, end: 0 },
            rotate: { min: 0, max: 360 },
            blendMode: Phaser.BlendModes.ADD,
            emitting: false,
        }).setDepth(D.PETALS + 1);
        // gentle petal rain for the celebration
        this.petalRain = this.add.particles(0, 0, 'petal', {
            x: { min: -80, max: W + 80 },
            y: -60,
            speedY: { min: 60, max: 160 },
            speedX: { min: -60, max: 60 },
            lifespan: 5200,
            scale: { start: 0.5, end: 0.2 },
            alpha: { start: 0.9, end: 0 },
            rotate: { min: -180, max: 180 },
            tint: [0xffd97a, 0xc98bff, 0x7ff7ff, 0xff9ec4],
            frequency: -1,
            emitting: false,
        }).setDepth(D.PETALS + 2);
    }

    emitPetals(x, y, seedId, count) {
        this.petalBursts[seedId]?.emitParticleAt(x, y, count);
    }

    /* ============================ MIST ============================ */
    createMist() {
        this.mistPurple = this.add.particles(0, 0, 'mist', {
            x: { min: -100, max: W + 100 },
            y: { min: 1700, max: 1860 },
            speedX: { min: 12, max: 30 },
            speedY: { min: 2, max: 6 },
            lifespan: 9000,
            scale: { start: 1.6, end: 2.4 },
            alpha: { start: 0.16, end: 0 },
            tint: 0xb26bff,
            frequency: 900,
            blendMode: Phaser.BlendModes.ADD,
        }).setDepth(70);
        this.mistCyan = this.add.particles(0, 0, 'mist', {
            x: { min: -100, max: W + 100 },
            y: { min: 1730, max: 1880 },
            speedX: { min: -26, max: -10 },
            speedY: { min: 2, max: 6 },
            lifespan: 8000,
            scale: { start: 1.2, end: 2.0 },
            alpha: { start: 0.14, end: 0 },
            tint: 0x00e5ff,
            frequency: 1300,
            blendMode: Phaser.BlendModes.ADD,
        }).setDepth(71);
    }

    createBloomRadiance() {
        this.add.image(W / 2, 1100, 'glow').setTint(0x3a2a72).setAlpha(0.25).setScale(5.4, 3.2).setDepth(-58);
    }
}
