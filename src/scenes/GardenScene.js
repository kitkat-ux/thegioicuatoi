import Phaser from 'phaser';
import { IsoMath } from '../core/IsoMath.js';
import { SEED_CATALOG, SEED_BY_ID, normalizeText } from '../data/seedCatalog.js';
import { buildExtraTextures, ensureFallbackTextures } from '../vfx/TextureFactory.js';
import AudioManager from '../audio/AudioManager.js';
import { EconomySystem, SEED_RARITY } from '../systems/EconomySystem.js';
import { DialogSystem } from '../systems/DialogSystem.js';

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
   hint 4/5, chip 90, action bar 120, drawer 1200, modal 1500, npc 200, dialog 1400. */
const D = { TILES: 910, PETALS: 1080, CHIP: 90, BAR: 120, DRAWER: 1200, MODAL: 1500, NPC: 200, DIALOG: 1400 };

/* pentatonic walk for bloom chimes (C major pentatonic, 2 octaves) */
const SEED_CHIME_BASE = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5, 1174.66, 1318.51, 1567.98, 1760.0];
const PENTATONIC_WATER_BASE = 1046.5;

/* Touch zone radius for action buttons (172px = 108px button + 64px padding) */
const TOUCH_ZONE_RADIUS = 172;

/* Gesture thresholds */
const SWIPE_THRESHOLD = 60;      // min px to register a swipe
const DRAG_PLANT_MIN_DIST = 30;  // min px from tile center to trigger plant

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
        // New state
        this.spiritStones = 0;
        this.economy = null;
        this.dialog = null;
        this.npcActive = false;
        this.dialogVisible = false;
        // Gesture state
        this.gestureActive = false;
        this.gestureStartX = 0;
        this.gestureStartY = 0;
        this.lastDragTile = null;
    }

    /* ============================ PRELOAD ============================ */
    preload() {
        // All asset keys below MUST match a file in public/assets/images/<key>.png.
        // Vite serves the public/ directory at the site root; the leading
        // "./" ensures Phaser's loader resolves URLs correctly regardless
        // of the page path (avoids 404s that would trigger procedural fallbacks).
        const assets = [
            'bg_manor_isometric',
            'tile_soil',
            'flower_purple',
            'flower_golden',
            'flower_cyan',
            'flower_emerald',
            'flower_rare',
            'icon_seed_drawer',
            'icon_water_bucket',
            'icon_search',
            'icon_sickle',
            'icon_spirit_stone',
            'npc_tien_nu',
            'bridge_pavilion',
        ];
        for (const a of assets) {
            this.load.image(a, `./assets/images/${a}.png`);
        }
        // Log any 404 failures so missing assets are immediately visible
        // in the browser console instead of silently falling back to canvas.
        this.load.on('loaderror', (file) => {
            console.error(`[GardenScene] 404 / load error: ${file.key} (${file.url}) — fallback texture will be generated`);
        });
        this.load.on('complete', () => {
            const missing = assets.filter((k) => !this.textures.exists(k));
            if (missing.length) {
                console.warn(`[GardenScene] Assets missing after preload (fallbacks will be used): ${missing.join(', ')}`);
            } else {
                console.log(`[GardenScene] All ${assets.length} image assets loaded OK (no fallbacks triggered)`);
            }
        });
    }

    /* ============================ BOOT ============================ */
    create() {
        // Procedural textures first, then fallbacks for any asset that failed
        // to load (auto-fallback rule), so every texture key exists up front.
        buildExtraTextures(this);
        ensureFallbackTextures(this);

        // Initialize economy and dialog systems
        this.economy = new EconomySystem();
        this.economy.init();
        this.dialog = new DialogSystem();

        // Background covers 1080x1920
        this.add.image(W / 2, H / 2, 'bg_manor_isometric').setDisplaySize(W, H).setDepth(-100);

        this.audio = new AudioManager(this);
        this.input.once('pointerdown', () => {
            this.audio.ensure();
            this.audio.startAmbient();
        });

        this.createPlatform();
        this.createBridgeAndNpc();
        this.createGrid();
        this.createHud();
        this.createActionBar();
        this.createDrawer();
        this.createModal();
        this.createDialogBox();
        this.createMist();
        this.createParticleEmitters();
        this.createBloomRadiance();
        this.setupGestures();

        this.updateHint();
        this.updateHud();
    }

    /* ====================== PLATFORM (grounding the grid) ====================== */
    createPlatform() {
        this.platform = this.add.image(540, 1110, 'platform')
            .setDepth(-60)
            .setScale(0.82)
            .setAlpha(0.96);
        this.add.image(540, 1112, 'glow').setTint(0x2c8ea8).setAlpha(0.12).setScale(4.0, 2.2).setDepth(-59);
    }

    /* ====================== BRIDGE + NPC ====================== */
    createBridgeAndNpc() {
        // Bridge/pavilion decoration above the grid
        this.bridgeSprite = this.add.image(180, 780, 'bridge_pavilion')
            .setDisplaySize(280, 210)
            .setDepth(D.NPC - 10)
            .setAlpha(0.9);

        // NPC: Tiên Nữ Hoa Giang — standing on stone path/bridge, scaled to 0.8
        this.npcGroup = this.add.container(220, 780).setDepth(D.NPC);
        const npcSprite = this.add.image(0, -40, 'npc_tien_nu')
            .setDisplaySize(205, 307);
        // NPC glow aura
        const npcGlow = this.add.image(0, -20, 'glow')
            .setTint(0xc9dff8).setAlpha(0.25).setScale(1.8, 2.2);
        // Name tag
        const npcName = this.add.text(0, 120, 'Tiên Nữ Hoa Giang', {
            fontFamily: 'Georgia, serif', fontSize: '20px', color: '#c9dff8',
            align: 'center', stroke: '#1b1140', strokeThickness: 4,
        }).setOrigin(0.5);
        // Interaction zone
        const npcZone = this.add.zone(0, -10, 180, 320).setInteractive();
        npcZone.on('pointerdown', () => this.onNpcClick());

        this.npcGroup.add([npcGlow, npcSprite, npcName, npcZone]);

        // Breathing / float idle animation
        this.tweens.add({
            targets: this.npcGroup,
            y: { from: 774, to: 786 },
            duration: 2800,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.easeInOut',
        });
        // gentle scale breathing
        this.tweens.add({
            targets: npcSprite,
            scaleX: { from: 0.99, to: 1.01 },
            scaleY: { from: 1.0, to: 1.02 },
            duration: 3200,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.easeInOut',
        });
        // aura pulse
        this.tweens.add({
            targets: npcGlow,
            alpha: { from: 0.15, to: 0.35 },
            scale: { from: 1.6, to: 2.0 },
            duration: 2400,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.easeInOut',
        });
    }

    onNpcClick() {
        this.audio.ensure();
        this.audio.chime(880, { gain: 0.06 });
        // Update dialog state from game state
        this.dialog.updateQuestState({
            hasFirstBloom: this.bloomCount >= 1,
            totalBlooms: this.bloomCount,
            currentBlooms: this.tiles.flat().filter(t => t.gridData.state === STATE.BLOOMING).length,
            hasRareSeed: (this.selectedSeed?.id === 'flower_rare_nguyet_cuc') ||
                         this.economy.getInventoryCount('flower_rare_nguyet_cuc') > 0,
            spiritStones: this.economy.spiritStones,
            completedQuests: this.economy.completedQuests,
        });
        this.openDialog();
    }

    /* ============================ DIALOG BOX ============================ */
    createDialogBox() {
        this.dialogBox = this.add.container(0, 0).setDepth(D.DIALOG).setVisible(false);

        // Dimmed backdrop
        const dim = this.add.rectangle(W / 2, H / 2, W, H, 0x05030c, 0.5).setInteractive();
        dim.on('pointerdown', () => this.closeDialog());

        // Dialog panel
        const panel = this.add.graphics();
        panel.fillStyle(C.panelDeep, 0.97);
        panel.lineStyle(4, C.gold, 1);
        panel.fillRoundedRect(60, 320, W - 120, 440, 28);
        panel.strokeRoundedRect(60, 320, W - 120, 440, 28);
        panel.lineStyle(2, 0xffe3a0, 0.3);
        panel.strokeRoundedRect(80, 340, W - 160, 400, 22);

        // NPC portrait frame
        const portraitFrame = this.add.graphics();
        portraitFrame.fillStyle(0x241540, 0.95);
        portraitFrame.lineStyle(3, 0xc9dff8, 0.9);
        portraitFrame.fillRoundedRect(100, 350, 160, 180, 16);
        portraitFrame.strokeRoundedRect(100, 350, 160, 180, 16);

        this.dialogPortrait = this.add.image(180, 430, 'npc_tien_nu').setDisplaySize(130, 195);
        this.dialogName = this.add.text(290, 370, 'Tiên Nữ Hoa Giang', {
            fontFamily: 'Georgia, serif', fontSize: '28px', color: '#c9dff8', fontStyle: 'bold',
            stroke: '#1b1140', strokeThickness: 5,
        });
        this.dialogText = this.add.text(290, 420, '', {
            fontFamily: 'Georgia, serif', fontSize: '26px', color: '#e6d8ff',
            wordWrap: { width: W - 440 }, lineSpacing: 8,
        });

        // Choice buttons container
        this.dialogChoices = [];
        for (let i = 0; i < 4; i++) {
            const btn = this.add.container(0, 0);
            const bg = this.add.graphics();
            bg.fillStyle(0x2a1c4a, 0.95);
            bg.lineStyle(2, C.gold, 0.8);
            const text = this.add.text(0, 0, '', {
                fontFamily: 'Georgia, serif', fontSize: '24px', color: '#ffe9c4',
            }).setOrigin(0, 0.5);
            const zone = this.add.zone(0, 0, 600, 52).setInteractive();
            zone.on('pointerdown', () => this.onDialogChoice(i));
            btn.add([bg, text, zone]);
            btn.setVisible(false);
            this.dialogChoices.push({ container: btn, bg, text, zone });
        }

        // Close button
        const closeBtn = this.add.text(W - 100, 340, '✕', {
            fontFamily: 'Arial', fontSize: '36px', color: '#ffb0b0',
        }).setOrigin(0.5).setInteractive();
        closeBtn.on('pointerdown', () => this.closeDialog());

        this.dialogBox.add([dim, panel, portraitFrame, this.dialogPortrait, this.dialogName, this.dialogText, closeBtn]);
        this.dialogChoices.forEach(c => this.dialogBox.add(c.container));
    }

    openDialog() {
        const node = this.dialog.startDialogue();
        if (!node) return;
        this.dialogVisible = true;
        this.dialogBox.setVisible(true).setAlpha(0);
        this.tweens.add({ targets: this.dialogBox, alpha: 1, duration: 200 });
        this.renderDialogNode(node);
    }

    closeDialog() {
        this.dialogVisible = false;
        this.tweens.add({
            targets: this.dialogBox, alpha: 0, duration: 180,
            onComplete: () => this.dialogBox.setVisible(false),
        });
    }

    renderDialogNode(node) {
        this.dialogText.setText(node.text);
        // Layout choice buttons
        let y = 600;
        this.dialogChoices.forEach((c, i) => {
            if (i < node.choices.length) {
                c.container.setVisible(true).setPosition(300, y);
                c.text.setText(node.choices[i].text);
                // Redraw bg to fit text
                const tw = Math.min(c.text.width + 40, 580);
                c.bg.clear();
                c.bg.fillStyle(0x2a1c4a, 0.95);
                c.bg.lineStyle(2, C.gold, 0.8);
                c.bg.fillRoundedRect(-10, -24, tw + 20, 48, 12);
                c.bg.strokeRoundedRect(-10, -24, tw + 20, 48, 12);
                c.zone.setSize(tw + 20, 48);
                c.zone.setPosition(tw / 2, 0);
                y += 56;
            } else {
                c.container.setVisible(false);
            }
        });
    }

    onDialogChoice(index) {
        this.audio.click();
        const node = this.dialog.choose(index);
        if (node) {
            this.renderDialogNode(node);
        } else {
            this.closeDialog();
        }
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
        const data = tile.gridData;
        const canPlant = this.selectedSeed && data.state === STATE.EMPTY;
        const canHarvest = data.state === STATE.BLOOMING;
        if (on && canPlant) {
            this.tileHighlight.setVisible(true).setPosition(tile.x, tile.y).setAlpha(0.9);
            tile.setTint(0xbfe8ff);
        } else if (on && canHarvest) {
            this.tileHighlight.setVisible(true).setPosition(tile.x, tile.y).setAlpha(0.9);
            tile.setTint(0xffe3a0);
        } else if (on === false) {
            this.tileHighlight.setVisible(false);
            if (data.state === STATE.EMPTY) tile.clearTint();
        }
    }

    handleTileClick(tile) {
        this.audio.ensure();
        const data = tile.gridData;
        // If blooming, harvest it
        if (data.state === STATE.BLOOMING) {
            this.harvestTile(tile);
            return;
        }
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

    /* ============================ HARVEST (NEW) ============================ */
    harvestTile(tile) {
        const data = tile.gridData;
        if (data.state !== STATE.BLOOMING) return;
        const seedId = data.seedId;

        this.audio.ensure();
        this.audio.chime(1046.5, { gain: 0.08 });
        this.audio.pluck(880, { gain: 0.06 });

        // Economy reward
        const reward = this.economy.harvestFlower(seedId);
        const newQuests = this.economy.checkQuests();

        // Visual: sparkle burst + reward popup
        const seed = SEED_BY_ID[seedId];
        this.emitPetals(tile.x, tile.y - 26, seedId, 14);
        this.sparks.emitParticleAt(tile.x, tile.y - 26, 10);

        // Destroy bloom sprites
        const bloomSprite = data.bloomSprite;
        const bloomGlow = data.bloomGlow;
        if (bloomSprite) {
            this.tweens.add({
                targets: bloomSprite, scale: 0.1, alpha: 0, duration: 300,
                onComplete: () => { if (bloomSprite.active) bloomSprite.destroy(); },
            });
        }
        if (bloomGlow) {
            this.tweens.add({
                targets: bloomGlow, alpha: 0, duration: 300,
                onComplete: () => { if (bloomGlow.active) bloomGlow.destroy(); },
            });
        }

        // Floating reward text
        const rewardText = `+${reward.harmony} ✿  +${reward.spiritStones} 💎`;
        const pop = this.add.text(tile.x, tile.y - 60, rewardText, {
            fontFamily: 'Georgia, serif', fontSize: '28px', color: '#ffe9a8', fontStyle: 'bold',
            stroke: '#3a1c5e', strokeThickness: 6,
        }).setOrigin(0.5).setDepth(D.PETALS + 3);
        this.tweens.add({
            targets: pop, y: tile.y - 130, alpha: 0, duration: 1100, ease: 'Cubic.easeOut',
            onComplete: () => pop.destroy(),
        });

        // Reset plot instantly
        data.state = STATE.EMPTY;
        data.seedId = null;
        data.watered = false;
        data.plantSprites = null;
        data.bloomSprite = null;
        data.bloomGlow = null;
        tile.clearTint();
        this.bloomCount--;

        // Update HUD
        this.harmony = this.economy.harmony;
        this.spiritStones = this.economy.spiritStones;
        this.updateHud();

        // Quest completion celebration
        if (newQuests.length > 0) {
            this.showQuestCompletion(newQuests);
        }
    }

    harvestAll() {
        const bloomingTiles = this.tiles.flat().filter(t => t.gridData.state === STATE.BLOOMING);
        if (bloomingTiles.length === 0) {
            this.audio.click();
            this.flashHint('Chưa có hoa nào để thu hoạch ✧');
            return;
        }
        this.audio.ensure();
        this.audio.splash();
        this.audio.chime(783.99, { gain: 0.1 });

        // Stagger harvest animation
        bloomingTiles.forEach((tile, i) => {
            this.time.delayedCall(i * 80, () => this.harvestTile(tile));
        });
    }

    showQuestCompletion(quests) {
        quests.forEach((q, i) => {
            this.time.delayedCall(400 + i * 600, () => {
                const banner = this.add.text(W / 2, 250 + i * 70, `🏆 ${q.name} — +${q.reward} 💎`, {
                    fontFamily: 'Georgia, serif', fontSize: '34px', color: '#ffe9a8', fontStyle: 'bold',
                    stroke: '#7a4a1e', strokeThickness: 8,
                }).setOrigin(0.5).setDepth(D.MODAL - 5).setScale(0.5).setAlpha(0);
                this.tweens.add({
                    targets: banner, scale: 1, alpha: 1, duration: 400, ease: 'Back.easeOut',
                    onComplete: () => {
                        this.tweens.add({ targets: banner, alpha: 0, y: banner.y - 40, delay: 1500, duration: 500 });
                    },
                });
                this.audio.chime(1046.5, { gain: 0.1 });
                this.audio.chime(1318.5, { gain: 0.08, when: 0.1 });
            });
        });
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
        this.drawer = this.add.container(0, H).setDepth(D.DRAWER);
        const panel = this.add.graphics();
        panel.fillStyle(C.ink, 0.97);
        panel.fillRoundedRect(24, H - 620, W - 48, 600, 26);
        panel.lineStyle(4, C.gold, 0.9);
        panel.strokeRoundedRect(24, H - 620, W - 48, 600, 26);
        panel.fillStyle(C.panel, 1);
        panel.fillRoundedRect(40, H - 604, W - 80, 92, 18);
        this.drawer.add(panel);

        // close button
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

        // search icon
        const searchIcon = this.add.image(230, H - 574, 'icon_search').setDisplaySize(52, 52).setAlpha(0.95);
        this.drawer.add(searchIcon);

        // DOM search input
        this.searchInput = this.add.dom(
            500, H - 574, 'input',
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

        // selected-seed chip
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
        const cy = H - 390;
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

        const frame = this.textures.get(seed.sprite_key).getSourceImage();
        const aspect = frame.width / frame.height;
        const thumbH = 132;
        const thumbW = Math.min(thumbH * aspect, w - 60);
        const glow = this.add.image(0, -34, 'glow').setTint(seed.petals).setAlpha(0.35).setScale(0.9, 0.72);
        const flower = this.add.image(0, -30, seed.sprite_key).setDisplaySize(thumbW, thumbH);
        const name = this.add.text(0, 64, seed.name, {
            fontFamily: 'Georgia, serif', fontSize: '24px', color: C.text,
            align: 'center', wordWrap: { width: w - 20 }, fontStyle: 'bold',
        }).setOrigin(0.5);
        const cost = this.economy.getSeedCost(seed.id);
        const costLabel = cost > 0 ? `${cost} 💎` : 'Miễn phí';
        const sub = this.add.text(0, 104, `${seed.colorName} · ${costLabel}`, {
            fontFamily: 'Georgia, serif', fontSize: '20px', color: '#b9a3dd',
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
        const hud = this.add.container(860, 72).setDepth(10);
        const badge = this.add.graphics();
        badge.fillStyle(0x241540, 0.92);
        badge.lineStyle(3, C.gold, 0.9);
        badge.fillRoundedRect(-190, -42, 380, 84, 22);
        badge.strokeRoundedRect(-190, -42, 380, 84, 22);
        const lotus = this.add.image(-148, 0, 'glow').setTint(0xffd97a).setScale(0.35);
        this.harmonyText = this.add.text(-118, -12, 'Hòa Hợp', {
            fontFamily: 'Georgia, serif', fontSize: '18px', color: '#d8c3f2',
        }).setOrigin(0, 0.5);
        this.harmonyValue = this.add.text(-118, 12, '✿ 0', {
            fontFamily: 'Georgia, serif', fontSize: '28px', color: '#ffe9a8', fontStyle: 'bold',
        }).setOrigin(0, 0.5);
        hud.add([badge, lotus, this.harmonyText, this.harmonyValue]);

        // Spirit Stones badge
        const stoneHud = this.add.container(860, 162).setDepth(10);
        const stoneBadge = this.add.graphics();
        stoneBadge.fillStyle(0x241540, 0.92);
        stoneBadge.lineStyle(3, 0xb26bff, 0.9);
        stoneBadge.fillRoundedRect(-190, -36, 380, 72, 20);
        stoneBadge.strokeRoundedRect(-190, -36, 380, 72, 20);
        this.stoneIcon = this.add.image(-148, 0, 'icon_spirit_stone').setDisplaySize(48, 48);
        this.stoneText = this.add.text(-118, -8, 'Đá Linh Khí', {
            fontFamily: 'Georgia, serif', fontSize: '17px', color: '#c9b2ff',
        }).setOrigin(0, 0.5);
        this.stoneValue = this.add.text(-118, 14, '💎 10', {
            fontFamily: 'Georgia, serif', fontSize: '26px', color: '#e8d4ff', fontStyle: 'bold',
        }).setOrigin(0, 0.5);
        stoneHud.add([stoneBadge, this.stoneIcon, this.stoneText, this.stoneValue]);

        // hint line
        this.hintBg = this.add.rectangle(W / 2, 218, 900, 52, 0x1a0f2e, 0.62)
            .setStrokeStyle(2, C.gold, 0.5).setDepth(4);
        this.hintText = this.add.text(W / 2, 218, '', {
            fontFamily: 'Georgia, serif', fontSize: '26px', color: '#efe0ff',
            align: 'center', stroke: '#1b1140', strokeThickness: 6,
        }).setOrigin(0.5).setDepth(5);
    }

    updateHint() {
        if (this.selectedSeed && !this.drawerOpen) {
            this.hintText.setText('✨ Đã chọn: ' + this.selectedSeed.name + ' — chạm/kéo vào ô đất để gieo · vuốt qua hoa nở để thu hoạch');
            this.hintText.setColor('#ffe9a8');
            this.hintBg.setSize(1020, 52);
        } else if (this.drawerOpen) {
            this.hintText.setText('🔍 Gõ từ khóa (tim · vang · xanh · gold · blue) rồi chọn hạt giống');
            this.hintText.setColor('#d8c3f2');
            this.hintBg.setSize(1000, 52);
        } else {
            this.hintText.setText('Mở Ngăn Hạt Giống ⬇ · Chạm NPC để nhận nhiệm vụ · Vuốt để thu hoạch');
            this.hintText.setColor('#efe0ff');
            this.hintBg.setSize(980, 52);
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
        this.harmony = this.economy.harmony;
        this.spiritStones = this.economy.spiritStones;
        this.harmonyValue.setText(`✿ ${this.harmony}`);
        this.stoneValue.setText(`💎 ${this.spiritStones}`);
    }

    /* ============================ ACTION BAR (with 172px touch zones) ============================ */
    createActionBar() {
        // --- Drawer button (left) ---
        this.drawerBtn = this.add.container(160, 1780).setDepth(D.BAR);
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
        const dbLabel = this.add.text(0, 128, 'Hạt Giống', {
            fontFamily: 'Georgia, serif', fontSize: '22px', color: C.text, fontStyle: 'bold',
            stroke: '#1b1140', strokeThickness: 5,
        }).setOrigin(0.5);
        // 172px invisible touch zone (108px button + 64px padding)
        const dbZone = this.add.zone(0, 0, TOUCH_ZONE_RADIUS * 2, TOUCH_ZONE_RADIUS * 2, 0xffffff, 0.001).setInteractive();
        dbZone.on('pointerdown', () => {
            this.audio.ensure();
            if (this.drawerOpen) this.closeDrawer();
            else this.openDrawer();
        });
        dbZone.on('pointerover', () => dbDraw(true));
        dbZone.on('pointerout', () => dbDraw(false));
        this.drawerBtn.add([db, dbIcon, dbLabel, dbZone]);

        // --- Harvest All button (center) - Cổ Phong Sickle ---
        this.harvestAllBtn = this.add.container(540, 1780).setDepth(D.BAR);
        const hb = this.add.graphics();
        const hbDraw = (hover) => {
            hb.clear();
            hb.fillStyle(0x3a2810, 0.96);
            hb.lineStyle(4, hover ? 0xffe3a0 : C.gold, 1);
            hb.fillCircle(0, 0, 108);
            hb.strokeCircle(0, 0, 108);
            hb.fillStyle(0x1a1008, 0.8);
            hb.fillCircle(0, 0, 96);
        };
        hbDraw(false);
        const hbIcon = this.add.image(0, 0, 'icon_sickle').setDisplaySize(140, 140);
        const hbLabel = this.add.text(0, 128, 'Thu Hoạch ✦', {
            fontFamily: 'Georgia, serif', fontSize: '22px', color: '#ffe9a8', fontStyle: 'bold',
            stroke: '#3a2810', strokeThickness: 5,
        }).setOrigin(0.5);
        // 172px invisible touch zone
        const hbZone = this.add.zone(0, 0, TOUCH_ZONE_RADIUS * 2, TOUCH_ZONE_RADIUS * 2, 0xffffff, 0.001).setInteractive();
        hbZone.on('pointerdown', () => this.harvestAll());
        hbZone.on('pointerover', () => hbDraw(true));
        hbZone.on('pointerout', () => hbDraw(false));
        this.harvestAllBtn.add([hb, hbIcon, hbLabel, hbZone]);

        // --- Water button (right) ---
        this.waterBtn = this.add.container(920, 1780).setDepth(D.BAR);
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
        const wbLabel = this.add.text(0, 128, 'Tưới Nước', {
            fontFamily: 'Georgia, serif', fontSize: '22px', color: '#aef4ff', fontStyle: 'bold',
            stroke: '#0a2830', strokeThickness: 5,
        }).setOrigin(0.5);
        // 172px invisible touch zone
        const wbZone = this.add.zone(0, 0, TOUCH_ZONE_RADIUS * 2, TOUCH_ZONE_RADIUS * 2, 0xffffff, 0.001).setInteractive();
        wbZone.on('pointerdown', () => this.onWaterButton());
        wbZone.on('pointerover', () => wbDraw(true));
        wbZone.on('pointerout', () => wbDraw(false));
        this.waterBtn.add([wb, wbIcon, wbLabel, wbZone]);
    }

    onWaterButton() {
        this.audio.ensure();
        const planted = this.tiles.flat().filter((t) => t.gridData.state !== STATE.EMPTY);
        if (planted.length === 0) {
            this.audio.click();
            this.tweens.add({ targets: this.waterBtn, x: { from: 920, to: 928 }, yoyo: true, repeat: 2, duration: 60 });
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

        const vip = this.add.container(W / 2, 920);
        const vipGlow = this.add.image(0, 0, 'glow').setTint(0x00e5ff).setScale(1.6, 1.2).setAlpha(0.55);
        const vipIcon = this.add.image(0, 0, 'icon_water_bucket').setDisplaySize(180, 180);
        vip.add([vipGlow, vipIcon]);

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
                        this.economy.harmony += 3;
                        this.economy.spiritStones += 2;
                        this.updateHud();
                        this.closeModal(true);
                    });
                }
            },
        });
    }

    /* ============================ GESTURE SYSTEM ============================ */
    setupGestures() {
        // Drag-to-Plant: when a seed is selected, dragging across empty tiles plants them
        // Swipe-to-Harvest: swiping across blooming tiles harvests them
        this.input.on('pointerdown', (pointer) => {
            if (this.drawerOpen || this.dialogVisible || this.adWatching) return;
            this.gestureActive = true;
            this.gestureStartX = pointer.x;
            this.gestureStartY = pointer.y;
            this.lastDragTile = null;
        });

        this.input.on('pointermove', (pointer) => {
            if (!this.gestureActive) return;
            if (this.drawerOpen || this.dialogVisible) return;

            // Convert pointer to game coords
            const worldX = pointer.x;
            const worldY = pointer.y;

            // Find which tile is under the pointer
            const gridPos = IsoMath.screenToGrid(worldX, worldY, ORIGIN.x, ORIGIN.y);
            const { gridX: c, gridY: r } = gridPos;

            if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return;
            const tile = this.tiles[r][c];
            if (tile === this.lastDragTile) return;
            this.lastDragTile = tile;

            const data = tile.gridData;

            // Drag-to-Plant: if we have a selected seed and tile is empty
            if (this.selectedSeed && data.state === STATE.EMPTY) {
                this.plantSeed(tile);
            }
            // Swipe-to-Harvest: if tile is blooming
            else if (data.state === STATE.BLOOMING) {
                this.harvestTile(tile);
            }
        });

        this.input.on('pointerup', () => {
            this.gestureActive = false;
            this.lastDragTile = null;
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

        // Record bloom in economy
        this.economy.recordBloom(data.seedId);
        const newQuests = this.economy.checkQuests();

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

        // audio
        this.audio.chime(SEED_CHIME_BASE[this.bloomCount % SEED_CHIME_BASE.length], { gain: 0.09 });
        if (this.bloomCount % 4 === 0) {
            this.audio.flute(SEED_CHIME_BASE[(this.bloomCount / 4) % 5], { gain: 0.06 });
        }

        this.updateHud();
        const pop = this.add.text(tile.x, tile.y - 92, '✿ Nở!', {
            fontFamily: 'Georgia, serif', fontSize: '28px', color: '#ffe9a8', fontStyle: 'bold',
            stroke: '#3a1c5e', strokeThickness: 6,
        }).setOrigin(0.5).setDepth(D.PETALS + 3);
        this.tweens.add({
            targets: pop, y: tile.y - 140, alpha: 0, duration: 900, ease: 'Cubic.easeOut',
            onComplete: () => pop.destroy(),
        });

        // Quest completion check
        if (newQuests.length > 0) {
            this.showQuestCompletion(newQuests);
        }

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
        this.petalRain = this.add.particles(0, 0, 'petal', {
            x: { min: -80, max: W + 80 },
            y: -60,
            speedY: { min: 60, max: 160 },
            speedX: { min: -60, max: 60 },
            lifespan: 5200,
            scale: { start: 0.5, end: 0.2 },
            alpha: { start: 0.9, end: 0 },
            rotate: { min: -180, max: 180 },
            tint: [0xffd97a, 0xc98bff, 0x7ff7ff, 0xff9ec4, 0xe8b4ff],
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
