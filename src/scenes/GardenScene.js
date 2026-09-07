import Phaser from 'phaser';
import { IsoMath } from '../core/IsoMath.js';
import { SEED_CATALOG, SEED_BY_ID, normalizeText } from '../data/seedCatalog.js';
import { buildExtraTextures, ensureFallbackTextures } from '../vfx/TextureFactory.js';
import AudioManager from '../audio/AudioManager.js';
import { EconomySystem, SEED_RARITY } from '../systems/EconomySystem.js';
import { DialogSystem, DIALOG_FONT } from '../systems/DialogSystem.js';

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

/* Touch zone radius for action buttons — generous invisible hitbox
   (172px radius: 86px visible button + 86px invisible padding). */
const TOUCH_ZONE_RADIUS = 172;

/* Bottom action buttons: sleek ~20% smaller visuals (86px ring vs the
   original 108px), with micro-animations (idle breathing + press feedback). */
const BTN_VISUAL_RADIUS = 86;
const BTN_INNER_RADIUS = 77;
const BTN_Y = 1780;

/* NPC Tiên Nữ Hoa Giang — bottom-right lower bridge deck, facing left
   toward the grid. */
const NPC_POS = { x: 890, y: 1345 };
const NPC_FLOAT_AMP = 4; // sinusoidal idle float: yoyo -4px..+4px

/* Khung Thoại (dialog) layout — three distinct vertical sections.
   Panel spans (60,400)-(1020,1080):
   - HEADER 400..572 : portrait + title
   - BODY   592..772 : quest-list container, max-height 180px, masked + scroll
   - FOOTER 792..1080: response buttons pinned strictly to the bottom        */
const DLG = {
    x: 60, y: 400, w: W - 120, h: 680,
    bodyTop: 592, bodyMaxH: 180,
    footerBottom: 1054, btnH: 64, btnGap: 16,
};

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
        // Dialog scroll state (body section)
        this.dialogScroll = 0;
        this.dialogScrollMax = 0;
        this.dialogDragging = null;
        this.questRowContainers = [];
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
            'npc_tien_nu_portrait',
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
        this.setupDialogInput();
    }

    /* ============ LINH ĐẢO PHÙ VÂN — floating celestial stone island ============ */
    createPlatform() {
        // Soft shadow the island casts on the water beneath it (~0.45 alpha),
        // with a slow shimmer as the water moves.
        this.islandShadow = this.add.image(540, 1452, 'island_shadow')
            .setDisplaySize(700, 172)
            .setAlpha(0.45)
            .setDepth(-70);
        this.tweens.add({
            targets: this.islandShadow,
            alpha: { from: 0.41, to: 0.48 },
            duration: 3400,
            yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
        });

        // The island: texture 936x660 whose TOP diamond center sits at texture
        // (468, 270). The image is offset so that diamond center lands exactly
        // on the grid center (540, 1110) — tile alignment is unchanged, and the
        // rocky 2.5D underside hangs over the water below.
        const texH = 660, texCy = 270;
        this.platform = this.add.image(540, 1110 + (texH / 2 - texCy) * 0.82, 'platform')
            .setDepth(-60)
            .setScale(0.82);
        // celestial aura around the island
        this.add.image(540, 1180, 'glow').setTint(0x8f7ae0).setAlpha(0.12).setScale(5.4, 3.0).setDepth(-59);
        // island name, resting on the shadow like a reflection
        this.add.text(540, 1452, '· Linh Đảo Phù Vân ·', {
            fontFamily: DIALOG_FONT, fontSize: '24px', color: '#cfc0ff', fontStyle: 'italic',
            stroke: '#160f2e', strokeThickness: 5,
        }).setOrigin(0.5).setDepth(-58).setAlpha(0.9);
    }

    /* ====================== BRIDGE + NPC ====================== */
    createBridgeAndNpc() {
        // NOTE: bg_manor_isometric already contains the complete scenery
        // (pavilion, bridge, lake, mountains). Never layer duplicate
        // bridge/pavilion patches over it — any overlay at (150-350,700-900)
        // would produce a faux-checkerboard artifact.

        // NPC: Tiên Nữ Hoa Giang — hovering above the bottom-right LOWER bridge
        // deck (x: 890, y: 1345), body facing left toward the garden grid.
        // The sprite is the elegant flying fairy with flowing lavender ribbons
        // (clean 4-channel PNG with true alpha — no faux background).
        this.npcGroup = this.add.container(NPC_POS.x, NPC_POS.y).setDepth(D.NPC);
        const npcSprite = this.add.image(0, -44, 'npc_tien_nu')
            .setDisplaySize(344, 274);
        // soft celestial aura
        const npcGlow = this.add.image(0, -44, 'glow')
            .setTint(0xc9b2ff).setAlpha(0.25).setScale(2.4, 2.1);
        // name tag
        const npcName = this.add.text(0, 132, 'Tiên Nữ Hoa Giang', {
            fontFamily: DIALOG_FONT, fontSize: '22px', color: '#dce8ff',
            align: 'center', stroke: '#1b1140', strokeThickness: 4,
        }).setOrigin(0.5);
        // interaction zone (generous, covers sprite + ribbons)
        const npcZone = this.add.zone(0, -20, 400, 360).setInteractive();
        npcZone.on('pointerdown', () => this.onNpcClick());

        this.npcGroup.add([npcGlow, npcSprite, npcName, npcZone]);

        // Smooth sinusoidal idle floating: yoyo between -4px and +4px around
        // the deck anchor — she never touches the stone, she hovers.
        this.npcFloatTween = this.tweens.add({
            targets: this.npcGroup,
            y: { from: NPC_POS.y - NPC_FLOAT_AMP, to: NPC_POS.y + NPC_FLOAT_AMP },
            duration: 1500,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.easeInOut',
        });
        // aura pulse
        this.tweens.add({
            targets: npcGlow,
            alpha: { from: 0.16, to: 0.34 },
            scale: { from: 2.2, to: 2.6 },
            duration: 2400,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.easeInOut',
        });
        // faint spirit motes drifting up from her ribbons
        this.npcSparkles = this.add.particles(0, 0, 'spark', {
            x: { min: NPC_POS.x - 150, max: NPC_POS.x + 150 },
            y: { min: NPC_POS.y - 160, max: NPC_POS.y + 40 },
            speedY: { min: -20, max: -8 },
            speedX: { min: -8, max: 8 },
            lifespan: 2800,
            scale: { start: 0.32, end: 0 },
            alpha: { start: 0.5, end: 0 },
            tint: [0xd8c3ff, 0x9fd8ff, 0xffe9c4],
            frequency: 460,
            blendMode: Phaser.BlendModes.ADD,
        }).setDepth(D.NPC + 5);
    }

    onNpcClick() {
        this.audio.ensure();
        this.audio.chime(880, { gain: 0.06 });
        // Update dialog state from game state (live economy stats feed the
        // quest-list progress counters in the dialog body).
        this.dialog.updateQuestState({
            hasFirstBloom: this.bloomCount >= 1,
            totalBlooms: this.economy.stats.totalBlooms,
            currentBlooms: this.tiles.flat().filter(t => t.gridData.state === STATE.BLOOMING).length,
            hasRareSeed: (this.selectedSeed?.id === 'flower_rare_nguyet_cuc') ||
                         this.economy.getInventoryCount('flower_rare_nguyet_cuc') > 0,
            spiritStones: this.economy.spiritStones,
            completedQuests: this.economy.completedQuests,
            maxSimultaneousBlooms: this.economy.stats.maxSimultaneousBlooms,
            totalStonesEarned: this.economy.stats.totalStonesEarned,
            rareBlooms: this.economy.stats.rareBlooms,
            totalHarvests: this.economy.stats.totalHarvests,
        });
        this.openDialog();
    }

    /* ============================ DIALOG BOX (KHUNG THOẠI) ============================
       Three distinct vertical sections:
       - HEADER : clean portrait + title (name / role) + close button
       - BODY   : quest-list container, max-height 180px, masked + scrollable
                  (drag or wheel) so text NEVER overflows into the footer
       - FOOTER : response buttons pinned strictly at the panel bottom           */
    createDialogBox() {
        this.dialogBox = this.add.container(0, 0).setDepth(D.DIALOG).setVisible(false);

        // Dimmed backdrop
        const dim = this.add.rectangle(W / 2, H / 2, W, H, 0x05030c, 0.55).setInteractive();
        dim.on('pointerdown', () => this.closeDialog());

        /* ---- panel ---- */
        const panel = this.add.graphics();
        panel.fillStyle(C.panelDeep, 0.97);
        panel.lineStyle(4, C.gold, 1);
        panel.fillRoundedRect(DLG.x, DLG.y, DLG.w, DLG.h, 28);
        panel.strokeRoundedRect(DLG.x, DLG.y, DLG.w, DLG.h, 28);
        panel.lineStyle(2, 0xffe3a0, 0.3);
        panel.strokeRoundedRect(DLG.x + 20, DLG.y + 20, DLG.w - 40, DLG.h - 40, 22);

        /* ---- HEADER (400..572): portrait + title ---- */
        const portraitFrame = this.add.graphics();
        portraitFrame.fillStyle(0x241540, 0.95);
        portraitFrame.lineStyle(3, 0xc9dff8, 0.9);
        portraitFrame.fillRoundedRect(96, 424, 128, 128, 16);
        portraitFrame.strokeRoundedRect(96, 424, 128, 128, 16);
        this.dialogPortrait = this.add.image(160, 488, 'npc_tien_nu_portrait').setDisplaySize(108, 108);
        this.dialogName = this.add.text(248, 442, 'Tiên Nữ Hoa Giang', {
            fontFamily: DIALOG_FONT, fontSize: '30px', color: '#c9dff8', fontStyle: 'bold',
            stroke: '#1b1140', strokeThickness: 5,
        });
        this.dialogRole = this.add.text(250, 490, 'Người trấn giữ cầu kiều · Linh Đảo Phù Vân', {
            fontFamily: DIALOG_FONT, fontSize: '20px', color: '#b9a3dd',
            stroke: '#1b1140', strokeThickness: 4,
        });
        const closeBtn = this.add.text(964, 438, '✕', {
            fontFamily: DIALOG_FONT, fontSize: '34px', color: '#ffb0b0',
        }).setOrigin(0.5).setInteractive();
        closeBtn.on('pointerdown', () => this.closeDialog());
        const divider = this.add.graphics();
        divider.lineStyle(2, C.gold, 0.55);
        divider.lineBetween(96, 572, 984, 572);
        divider.fillStyle(C.gold, 0.9);
        divider.fillTriangle(540, 565, 549, 572, 540, 579);
        divider.fillTriangle(540, 565, 531, 572, 540, 579);

        /* ---- BODY (592..772): scrollable, masked quest/text container ---- */
        this.dialogBodyMaxH = DLG.bodyMaxH; // exposed for tests (max-height 180px)
        this.dialogContent = this.add.container(0, 0);
        this.dialogText = this.add.text(92, DLG.bodyTop, '', {
            fontFamily: DIALOG_FONT, fontSize: '25px', color: '#e6d8ff',
            wordWrap: { width: 888 }, lineSpacing: 9,
        });
        this.dialogContent.add(this.dialogText);

        // geometry mask — everything outside 92,592 → 988,772 is clipped
        const maskG = this.make.graphics();
        maskG.fillStyle(0xffffff, 1);
        maskG.fillRect(92, DLG.bodyTop, 896, DLG.bodyMaxH);
        this.dialogBodyMask = maskG.createGeometryMask();
        this.dialogContent.setMask(this.dialogBodyMask);

        // soft fade at the body's bottom edge (signals clipped content)
        this.dialogFade = this.add.graphics();
        this.dialogFade.setVisible(false);
        // scroll affordance
        this.dialogScrollHint = this.add.text(980, 764, '⇕', {
            fontFamily: DIALOG_FONT, fontSize: '24px', color: '#d8c3f2',
        }).setOrigin(1, 0.5).setVisible(false);

        // drag surface for scrolling the body
        const bodyZone = this.add.zone(540, DLG.bodyTop + DLG.bodyMaxH / 2, 896, DLG.bodyMaxH).setInteractive();
        bodyZone.on('pointerdown', (p) => {
            this.dialogDragging = { y: p.y, from: this.dialogScroll };
        });

        /* ---- FOOTER: response buttons pinned strictly at the bottom ---- */
        this.dialogChoices = [];
        for (let i = 0; i < 4; i++) {
            const btn = this.add.container(540, 0);
            const bg = this.add.graphics();
            const text = this.add.text(0, 0, '', {
                fontFamily: DIALOG_FONT, fontSize: '24px', color: '#ffe9c4', fontStyle: 'bold',
                stroke: '#1b1140', strokeThickness: 4,
            }).setOrigin(0.5);
            const zone = this.add.zone(0, 0, 660, DLG.btnH).setInteractive();
            const descriptor = { container: btn, bg, text, zone, index: i, onClose: false };
            zone.on('pointerdown', () => {
                this.tweens.killTweensOf(btn);
                btn.setScale(0.96);
                this.tweens.add({ targets: btn, scale: 1, duration: 240, ease: 'Back.easeOut' });
                if (descriptor.onClose) this.closeDialog();
                else this.onDialogChoice(descriptor.index);
            });
            btn.add([bg, text, zone]);
            btn.setVisible(false);
            this.dialogChoices.push(descriptor);
        }

        this.dialogBox.add([
            dim, panel, portraitFrame, this.dialogPortrait, this.dialogName, this.dialogRole,
            closeBtn, divider, this.dialogContent, this.dialogFade, this.dialogScrollHint, bodyZone,
        ]);
        this.dialogChoices.forEach((c) => this.dialogBox.add(c.container));
    }

    /** Global drag/wheel handling for the dialog body scroll. */
    setupDialogInput() {
        this.input.on('pointermove', (p) => {
            if (!this.dialogDragging || !this.dialogVisible) return;
            this.setDialogScroll(this.dialogDragging.from + (this.dialogDragging.y - p.y));
        });
        this.input.on('pointerup', () => { this.dialogDragging = null; });
        this.input.on('wheel', (p, over, dx, dy) => {
            if (this.dialogVisible) this.setDialogScroll(this.dialogScroll + dy * 0.5);
        });
    }

    /** Clamp + apply the body scroll offset and refresh fade/hint affordances. */
    setDialogScroll(value) {
        this.dialogScroll = Phaser.Math.Clamp(value, 0, this.dialogScrollMax);
        this.dialogContent.y = -this.dialogScroll;
        const canScroll = this.dialogScrollMax > 0;
        const atEnd = this.dialogScroll >= this.dialogScrollMax - 0.5;
        this.dialogFade.setVisible(canScroll && !atEnd);
        this.dialogScrollHint.setVisible(canScroll);
        if (canScroll && !atEnd) {
            this.dialogFade.clear();
            this.dialogFade.fillGradientStyle(0x181026, 0x181026, 0x181026, 0x181026, 0, 0, 1, 1);
            this.dialogFade.fillRect(92, DLG.bodyTop + DLG.bodyMaxH - 36, 896, 36);
        }
    }

    /** Build one quest-list row (status glyph · name · progress · reward). */
    buildQuestRow(row, y) {
        const c = this.add.container(92, y);
        const status = this.add.text(10, 0, row.done ? '✓' : '◇', {
            fontFamily: DIALOG_FONT, fontSize: '24px', color: row.done ? '#7dffb6' : '#d8a24e',
        }).setOrigin(0.5);
        const name = this.add.text(36, 0, row.name, {
            fontFamily: DIALOG_FONT, fontSize: '23px', color: row.done ? '#9f93c9' : '#ffe9c4', fontStyle: 'bold',
        }).setOrigin(0, 0.5);
        const progress = this.add.text(660, 0, row.done ? 'hoàn thành' : `${row.progress}/${row.target}`, {
            fontFamily: DIALOG_FONT, fontSize: '19px', color: row.done ? '#7dffb6' : '#b9a3dd',
        }).setOrigin(1, 0.5);
        const reward = this.add.text(884, 0, `+${row.reward} 💎`, {
            fontFamily: DIALOG_FONT, fontSize: '21px', color: '#ffe9a8',
        }).setOrigin(1, 0.5);
        const line = this.add.graphics();
        line.lineStyle(1, C.gold, 0.18);
        line.lineBetween(0, 26, 856, 26);
        c.add([line, status, name, progress, reward]);
        return c;
    }

    clearQuestRows() {
        for (const row of this.questRowContainers) row.destroy();
        this.questRowContainers = [];
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
        this.dialogDragging = null;
        this.tweens.add({
            targets: this.dialogBox, alpha: 0, duration: 180,
            onComplete: () => this.dialogBox.setVisible(false),
        });
    }

    renderDialogNode(node) {
        /* ---- BODY ---- */
        this.clearQuestRows();
        this.dialogText.setText(node.text);
        let contentBottom = this.dialogText.y + this.dialogText.height;
        if (node.questList) {
            let ry = this.dialogText.y + this.dialogText.height + 16;
            for (const row of this.dialog.getQuestRows()) {
                const rowContainer = this.buildQuestRow(row, ry);
                this.dialogContent.add(rowContainer);
                this.questRowContainers.push(rowContainer);
                ry += 52;
            }
            contentBottom = ry - 8;
        }
        // anything taller than 180px becomes scrollable instead of overflowing
        this.dialogScrollMax = Math.max(0, Math.ceil(contentBottom - DLG.bodyTop - DLG.bodyMaxH));
        this.setDialogScroll(0);

        /* ---- FOOTER: choices pinned bottom-up (last button flush at 1054) ---- */
        const choices = (node.choices && node.choices.length)
            ? node.choices
            : [{ text: 'Đóng ✦', close: true }];
        this.dialogChoices.forEach((c, i) => {
            const choice = choices[i];
            if (!choice) {
                c.container.setVisible(false);
                c.onClose = false;
                return;
            }
            c.onClose = !!choice.close;
            const slot = choices.length - 1 - i; // 0 = bottom-most button
            const y = DLG.footerBottom - DLG.btnH / 2 - slot * (DLG.btnH + DLG.btnGap);
            c.container.setVisible(true).setPosition(540, y);
            c.text.setText(choice.text);
            c.bg.clear();
            c.bg.fillStyle(c.onClose ? 0x1f1636 : 0x2a1c4a, 0.96);
            c.bg.lineStyle(3, c.onClose ? 0x8f7ae0 : C.gold, 0.9);
            c.bg.fillRoundedRect(-330, -DLG.btnH / 2, 660, DLG.btnH, 32);
            c.bg.strokeRoundedRect(-330, -DLG.btnH / 2, 660, DLG.btnH, 32);
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

        // selected-seed chip (below the island shadow, above the action bar)
        this.selectedChip = this.add.container(540, 1585).setDepth(D.CHIP).setVisible(false);
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

    /* ============================ ACTION BAR ============================
       3 buttons (Seeds · Ornate Sickle · Water Can), each:
       - ~20% smaller visuals (86px ring vs the old 108px)
       - generous invisible 172px-radius touch hitbox
       - micro-animations: gentle floating idle breathing on the outer
         container + responsive press feedback (0.9x down on pointerdown,
         Back-ease bounce to 1.0x on pointerup) on the inner container.  */
    makeActionButton({ x, baseColor, innerColor, hoverStroke, iconKey, iconW, iconH, label, labelColor, labelStroke, phase = 0, onTap }) {
        // Outer: position + idle breathing. Inner: visuals + press feedback.
        const outer = this.add.container(x, BTN_Y).setDepth(D.BAR);
        const inner = this.add.container(0, 0);

        const ring = this.add.graphics();
        const drawRing = (hover) => {
            ring.clear();
            ring.fillStyle(baseColor, 0.96);
            ring.lineStyle(4, hover ? C.goldLight : hoverStroke, 1);
            ring.fillCircle(0, 0, BTN_VISUAL_RADIUS);
            ring.strokeCircle(0, 0, BTN_VISUAL_RADIUS);
            ring.fillStyle(innerColor, 0.8);
            ring.fillCircle(0, 0, BTN_INNER_RADIUS);
        };
        drawRing(false);

        const icon = this.add.image(0, -5, iconKey).setDisplaySize(iconW, iconH);
        const text = this.add.text(0, BTN_VISUAL_RADIUS + 20, label, {
            fontFamily: DIALOG_FONT, fontSize: '21px', color: labelColor, fontStyle: 'bold',
            stroke: labelStroke, strokeThickness: 5,
        }).setOrigin(0.5);

        inner.add([ring, icon, text]);
        outer.add(inner);

        // Generous invisible touch hitbox — deliberately larger than the
        // visible ring so nearby taps still register.
        const zone = this.add.zone(0, 0, TOUCH_ZONE_RADIUS * 2, TOUCH_ZONE_RADIUS * 2).setInteractive();
        outer.add(zone);

        // Responsive press feedback: 0.9x on pointerdown, bounce to 1.0x on release.
        let pressed = false;
        const press = () => {
            pressed = true;
            this.tweens.killTweensOf(inner);
            inner.setScale(1);
            this.tweens.add({ targets: inner, scale: 0.9, duration: 70, ease: 'Quad.easeOut' });
        };
        const release = () => {
            if (!pressed) return;
            pressed = false;
            this.tweens.killTweensOf(inner);
            this.tweens.add({ targets: inner, scale: 1, duration: 320, ease: 'Back.easeOut' });
        };
        zone.on('pointerdown', () => { press(); onTap(); });
        zone.on('pointerup', release);
        zone.on('pointerout', release);
        this.input.on('pointerup', release); // safety net if the pointer leaves the canvas
        zone.on('pointerover', () => drawRing(true));
        zone.on('pointerout', () => drawRing(false));

        // Gentle floating idle breathing (slightly offset phase per button).
        this.tweens.add({
            targets: outer,
            scale: { from: 1, to: 1.03 },
            y: { from: BTN_Y, to: BTN_Y - 5 },
            duration: 2000 + phase * 220,
            yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
            delay: phase * 260,
        });

        return { outer, inner, zone, ring, label: text, radius: BTN_VISUAL_RADIUS, hitRadius: TOUCH_ZONE_RADIUS, press, release };
    }

    createActionBar() {
        this.actionButtons = [
            // --- Seeds drawer (left) ---
            this.makeActionButton({
                x: 160,
                baseColor: 0x241540, innerColor: 0x181026, hoverStroke: C.gold,
                iconKey: 'icon_seed_drawer', iconW: 118, iconH: 114,
                label: 'Hạt Giống', labelColor: C.text, labelStroke: '#1b1140',
                phase: 0,
                onTap: () => {
                    this.audio.ensure();
                    if (this.drawerOpen) this.closeDrawer();
                    else this.openDrawer();
                },
            }),
            // --- Ornate sickle / harvest all (center) ---
            this.makeActionButton({
                x: 540,
                baseColor: 0x3a2810, innerColor: 0x1a1008, hoverStroke: C.gold,
                iconKey: 'icon_sickle', iconW: 114, iconH: 99,
                label: 'Thu Hoạch ✦', labelColor: '#ffe9a8', labelStroke: '#3a2810',
                phase: 1,
                onTap: () => this.harvestAll(),
            }),
            // --- Water can (right) ---
            this.makeActionButton({
                x: 920,
                baseColor: 0x0e3a44, innerColor: 0x082830, hoverStroke: 0x00e5ff,
                iconKey: 'icon_water_bucket', iconW: 112, iconH: 111,
                label: 'Tưới Nước', labelColor: '#aef4ff', labelStroke: '#0a2830',
                phase: 2,
                onTap: () => this.onWaterButton(),
            }),
        ];
        this.drawerBtn = this.actionButtons[0];
        this.harvestAllBtn = this.actionButtons[1];
        this.waterBtn = this.actionButtons[2];
    }

    onWaterButton() {
        this.audio.ensure();
        const planted = this.tiles.flat().filter((t) => t.gridData.state !== STATE.EMPTY);
        if (planted.length === 0) {
            this.audio.click();
            this.tweens.add({ targets: this.waterBtn.outer, x: { from: 920, to: 928 }, yoyo: true, repeat: 2, duration: 60 });
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
