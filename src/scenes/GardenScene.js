import Phaser from 'phaser';
import { IsoMath } from '../core/IsoMath.js';
import { LAYERS } from '../core/Layers.js';
import { SEED_CATALOG, SEED_BY_ID, normalizeText } from '../data/seedCatalog.js';
import { buildExtraTextures, ensureFallbackTextures } from '../vfx/TextureFactory.js';
import { WeatherView } from '../vfx/WeatherView.js';
import AudioManager from '../audio/AudioManager.js';
import { EconomySystem, SEED_RARITY } from '../systems/EconomySystem.js';
import { DialogSystem, DIALOG_FONT } from '../systems/DialogSystem.js';
import { EventManager, EVENTS } from '../systems/EventManager.js';
import { CodexManager } from '../systems/CodexManager.js';
import { WeatherSystem, PHASE, CONDITION } from '../systems/WeatherSystem.js';
import { CodexModal } from '../ui/CodexModal.js';
import FishingModal from '../ui/FishingModal.js';
import { FISHING_TEXTURES } from '../data/FishingAssetManifest.js';
import { AlchemyManager } from '../systems/AlchemyManager.js';
import { AlchemyModal } from '../ui/AlchemyModal.js';
import { ALCHEMY_ASSETS } from '../data/AlchemyAssetManifest.js';
import BeastModal from '../ui/BeastModal.js';
import { BEAST_ASSETS } from '../data/BeastAssetManifest.js';
import { BeastSystem } from '../systems/BeastSystem.js';
import {
    SOIL_TYPES, SOIL_TEXTURES, UPGRADEABLE_SOILS, DEFAULT_SOIL_ID,
    resolveSoil, soilYieldMult, rollInstantMature,
} from '../data/SoilTypes.js';
import { createPlotData, hydratePlotData, plotBloomDelay, drainPlotWater } from '../data/PlotData.js';
import {
    REALMS, REALM_IDS, REALM_SEEDS, REALM_SEED_BY_ID,
    resolveRealm, getSeedsForRealm, canPlantInRealm,
    saveRealmPlots, loadRealmPlots, saveActiveRealm, loadActiveRealm,
    realmHasUniformTile,
} from '../data/RealmsData.js';
import RealmModal from '../ui/RealmModal.js';
import GardenShopModal from '../ui/GardenShopModal.js';

const W = 1080;
const H = 1920;
const ORIGIN = { x: 540, y: 950 };
const ROWS = 6;
const COLS = 6;

const STATE = { EMPTY: 'EMPTY', PLANTED: 'PLANTED', GROWING: 'GROWING', BLOOMING: 'BLOOMING' };

/* Active tool — the plot interaction is STRICTLY tool-scoped:
   SEED   → only plants on EMPTY plots (never harvests),
   SICKLE → only harvests BLOOMING plots and clears them (never plants),
   NONE   → a single tap on a bloom still harvests it; nothing can be planted. */
export const TOOL = { NONE: 'NONE', SEED: 'SEED', SICKLE: 'SICKLE' };

/* Mobile safe-area: keep the top-left title clear of notches / status bars. */
const SAFE_TOP = 30;

/* ------------------------- UI palette ------------------------- */
const C = {
    gold: 0xd8a24e,
    goldLight: 0xffe3a0,
    goldDim: 0x8a6a3a,
    ink: 0x1a0f2e,
    panel: 0x241540,
    panelDeep: 0x181026,
    cyan: 0x00e5ff,
    tealGlow: 0x7ff7ff,
    text: '#ffe9c4',
};

/* Depth plan lives in src/core/Layers.js (shared with the weather view and the
   codex modal). Short alias kept for readability of the existing call sites:
   bg -100, platform -60, tiles ~910..1078, petals 1080+, weather FX 1088+,
   ★ AMBIENT wash 1100 (world below / UI above), hint 1125, chip 1128,
   HUD 1130, action bar 1140, drawer 1200, dialog 1400, modal 1500,
   codex 1550, toast 1600, npc 200. */
const D = LAYERS;

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
        this.activeTool = TOOL.NONE;
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
        /* Phase-1 systems (all talk to each other through this.bus only) */
        this.bus = null;          // EventManager — the single inter-system channel
        this.codex = null;        // System 9: Vạn Hoa Đồ Giám (state + rules)
        this.codexModal = null;   // System 9: scroll UI + HUD button
        this.fishingModal = null; // Câu Cá Hồ Tiên (lands Linh Ngư on the bus)
        this.weather = null;      // System 8: Thiên Thời Tứ Thời (simulation)
        this.weatherView = null;  // System 8: ambient light / rain renderer
        this.codexBuffs = null;   // last aggregated codex buffs
        this.rainWatering = false;
        // Phase-2 systems
        this.alchemy = null;      // System 5: Lò Luyện Đan (furnace + elixir buffs)
        this.alchemyModal = null; // System 5: bronze cauldron UI + HUD medallion
        this.beastModal = null;   // System 6: Vườn Linh Thú (Spirit Beast Sanctuary)
        this.beasts = null;       // System 6: affinity, Linh Ngư bag, LocalStorage
        // Bí Cảnh (Secret Realms) expedition system
        this.activeRealmId = null; // set in create() from LocalStorage
        this.activeRealm = null;   // resolved realm definition
        this.realmModal = null;    // RealmModal overlay UI
        this.shopModal = null;     // Cửa Hàng Hoa Viên (Garden Shop) overlay UI
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
            'icon_codex_scroll',
        ];
        for (const a of assets) {
            this.load.image(a, `./assets/images/${a}.png`);
        }
        // Realm guardian NPCs — every realm's sprite is preloaded so swapping
        // realms swaps the fairy instantly (no 404 → fallback flash). The
        // DEFAULT_GARDEN fairy is already in the list above via npc_tien_nu.
        for (const realmId of Object.keys(REALMS)) {
            const npc = REALMS[realmId].npc;
            if (npc?.spriteKey && npc.spritePath && !this.textures.exists(npc.spriteKey)) {
                this.load.image(npc.spriteKey, npc.spritePath);
            }
        }
        // Hoa Các (Garden Shop) — ornate pagoda icon for the HUD button.
        this.load.image('icon_shop', './assets/ui/icon_shop.png');
        // Fishing art is kept in its own namespace and described by the
        // integration manifest, so the modal and preload can never drift.
        const fishingAssets = Object.values(FISHING_TEXTURES);
        for (const asset of fishingAssets) this.load.image(asset.key, asset.path);
        // Spirit Beast Sanctuary art — same pattern as fishing (manifest-driven)
        const beastAssets = Object.values(BEAST_ASSETS);
        for (const asset of beastAssets) this.load.image(asset.key, asset.path);
        // Lò Luyện Đan art — Bát Quái Lô + Trúc Cơ / Cửu Chuyển pills
        const alchemyAssets = Object.values(ALCHEMY_ASSETS);
        for (const asset of alchemyAssets) this.load.image(asset.key, asset.path);
        // Stage 1 — Linh Thổ premium soils (public/assets/tiles/). Loaded by
        // the SoilTypes manifest; a 404 falls back to the base tile at swap
        // time (see soilTextureKey()), so the grid never renders a missing key.
        for (const tex of SOIL_TEXTURES) {
            if (!this.textures.exists(tex.key)) this.load.image(tex.key, tex.path);
        }

        // Bí Cảnh (Secret Realms) — realm backgrounds, tiles, and exclusive
        // seed sprites. Loaded for every unlocked realm so switching is instant.
        for (const realmId of Object.keys(REALMS)) {
            const realm = REALMS[realmId];
            if (realm.backgroundKey && realm.backgroundPath && !this.textures.exists(realm.backgroundKey)) {
                this.load.image(realm.backgroundKey, realm.backgroundPath);
            }
            if (realm.tileTextureKey && realm.tileTexturePath && !this.textures.exists(realm.tileTextureKey)) {
                this.load.image(realm.tileTextureKey, realm.tileTexturePath);
            }
        }
        // Realm-exclusive seed sprites (Băng Liên, Tuyết Chi, …)
        for (const seed of REALM_SEEDS) {
            const expectedPath = `./assets/plants/${seed.sprite_key}.png`;
            if (!this.textures.exists(seed.sprite_key)) {
                this.load.image(seed.sprite_key, expectedPath);
            }
        }

        // Log any 404 failures so missing assets are immediately visible
        // in the browser console instead of silently falling back to canvas.
        this.load.on('loaderror', (file) => {
            console.error(`[GardenScene] 404 / load error: ${file.key} (${file.url}) — fallback texture will be generated`);
        });
        this.load.on('complete', () => {
            const fishingKeys = fishingAssets.map((asset) => asset.key);
            const beastKeys = beastAssets.map((asset) => asset.key);
            const alchemyKeys = alchemyAssets.map((asset) => asset.key);
            const realmNpcKeys = Object.values(REALMS).map((r) => r.npc?.spriteKey).filter(Boolean);
            const missing = [...assets, ...realmNpcKeys, 'icon_shop', ...fishingKeys, ...beastKeys, ...alchemyKeys].filter((k) => !this.textures.exists(k));
            if (missing.length) {
                console.warn(`[GardenScene] Assets missing after preload (fallbacks will be used): ${missing.join(', ')}`);
            } else {
                console.log(`[GardenScene] All ${assets.length + realmNpcKeys.length + 1 + fishingKeys.length + beastKeys.length + alchemyKeys.length} image assets loaded OK (no fallbacks triggered)`);
            }
        });
    }

    /* ============================ BOOT ============================ */
    create() {
        // Procedural textures first, then fallbacks for any asset that failed
        // to load (auto-fallback rule), so every texture key exists up front.
        buildExtraTextures(this);
        ensureFallbackTextures(this);

        /* ---------------- systems + the shared event bus ----------------
           One EventManager instance is created here and handed to every
           system/view; no system imports another one. Publish → subscribe is
           the only allowed channel between them (see src/systems/EventManager). */
        this.bus = new EventManager({ label: 'GardenScene' });

        // Initialize economy and dialog systems
        this.economy = new EconomySystem().bind(this.bus);
        this.economy.init();
        this.dialog = new DialogSystem();

        // System 9 — Vạn Hoa Đồ Giám: records blooms/harvests off the bus
        this.codex = new CodexManager().bind(this.bus);
        this.codexBuffs = this.codex.getBuffs();

        // System 8 — Thiên Thời Tứ Thời: day/night + spring rain simulation
        this.weather = new WeatherSystem().bind(this.bus);

        // System 5 — Lò Luyện Đan: learns herbs from harvest/watering facts on
        // the bus; its elixir buffs come back through ELIXIR_CONSUMED.
        this.alchemy = new AlchemyManager().bind(this.bus);

        // System 6 — Vườn Linh Thú: Linh Ngư bag + affinity, persisted locally.
        this.beasts = new BeastSystem({ bus: this.bus }).bind(this.bus);
        this.beasts.load();

        // Bí Cảnh (Secret Realms) — determine active realm before anything else
        // so the background, tiles, and saved plots all match.
        this.activeRealmId = loadActiveRealm();
        this.activeRealm = resolveRealm(this.activeRealmId);
        // Merge realm-exclusive seeds into SEED_BY_ID so the bloom system can
        // look them up by id (bloomTile, petal bursts, codex discovery, …).
        for (const [id, seed] of Object.entries(REALM_SEED_BY_ID)) {
            if (!SEED_BY_ID[id]) SEED_BY_ID[id] = seed;
        }

        // Background covers 1080x1920 — uses the active realm's background
        // (DEFAULT_GARDEN uses bg_manor_isometric; FROST_REALM uses bg_frost_realm).
        this.add.image(W / 2, H / 2, this.activeRealm.backgroundKey).setDisplaySize(W, H).setDepth(D.BG);

        this.audio = new AudioManager(this);
        this.input.once('pointerdown', () => {
            this.audio.ensure();
            this.audio.startAmbient();
        });

        this.createPlatform();
        this.createBridgeAndNpc();
        // Bí Cảnh: load per-realm saved plots from LocalStorage before building the grid
        this.savedPlots = loadRealmPlots(this.activeRealmId);
        this.createGrid();
        this.createHud();
        this.createActionBar();
        this.createDrawer();
        this.createModal();
        this.createDialogBox();

        // weather renderer (ambient wash + rain + moon) and the codex scroll
        this.weatherView = new WeatherView(this, this.weather, this.bus).create();
        this.createWeatherChip();
        this.codexModal = new CodexModal(this, { codex: this.codex, bus: this.bus, audio: this.audio }).create();
        this.fishingModal = new FishingModal(this, { audio: this.audio, bus: this.bus }).create();
        this.createFishingEntryPoint();
        this.alchemyModal = new AlchemyModal(this, { alchemy: this.alchemy, bus: this.bus, audio: this.audio }).create();
        this.beastModal = new BeastModal(this, {
            beasts: this.beasts.getBeasts(),
            beastSystem: this.beasts,
            bus: this.bus,
            audio: this.audio,
        }).create();
        this.createBeastEntryPoint();

        // Bí Cảnh (Secret Realms) — portal HUD button + realm selector modal
        this.realmModal = new RealmModal(this, {
            bus: this.bus,
            audio: this.audio,
            activeRealmId: this.activeRealmId,
            onSelectRealm: (realmId) => this.switchRealm(realmId),
        }).create();
        this.createRealmEntryPoint();

        this.createMist();
        this.createParticleEmitters();
        this.createBloomRadiance();
        this.setupGestures();
        this.subscribeToBus();

        this.updateHint();
        this.updateHud();
        this.updateWeatherHud();
        this.applyCodexBuffs();
        this.setupDialogInput();
    }

    /* ==================== SYSTEM WIRING (EventManager) ====================
       Everything below is a bus subscriber or publisher: GardenScene never
       calls into CodexManager/WeatherSystem internals to make another system
       react — it publishes facts and listens for them.                       */
    subscribeToBus() {
        const b = this.bus;
        // System 8 gameplay buff: rain waters every unwatered plot for free.
        b.on(EVENTS.RAIN_IRRIGATE, (p) => this.rainIrrigate(p), { owner: 'garden' });
        // Ambient lamp level (0..1) → stone lanterns + night dew effects.
        b.on(EVENTS.WEATHER_LAMP_LEVEL, (p) => this.onLampLevel(p), { owner: 'garden' });
        // Codex rewards: milestone harmony grants and tool skins.
        b.on(EVENTS.CODEX_MILESTONE, (p) => this.onCodexMilestone(p), { owner: 'garden' });
        // Any codex change refreshes the buff snapshot the scene reads.
        b.on(EVENTS.CODEX_BUFFS_CHANGED, () => this.applyCodexBuffs(), { owner: 'garden' });
        b.on(EVENTS.CODEX_ENTRY_UPDATED, () => this.applyCodexBuffs(), { owner: 'garden' });
        // UI intents coming from other systems (NPC dialog → codex scroll)
        b.on(EVENTS.CODEX_OPEN_REQUEST, () => this.openCodex(), { owner: 'garden' });
        // System 5 gameplay buffs: the furnace publishes, the garden applies.
        b.on(EVENTS.ELIXIR_CONSUMED, (p) => this.onElixirConsumed(p), { owner: 'garden' });
        b.on(EVENTS.ALCHEMY_BUFF_EXPIRED, (p) => this.onAlchemyBuffExpired(p), { owner: 'garden' });
        // Economy: every Đá Linh Khí movement (purchase, quick-water, harvest,
        // quest, ad) re-syncs the HUD badge + the drawer's owned/afford state.
        b.on(EVENTS.DIAMONDS_CHANGED, (p) => this.onDiamondsChanged(p), { owner: 'garden' });
        // Hòa Hợp movements (Cửa Hàng purchases/sales, milestone grants) refresh
        // the harmony badge the same way — one bus fact, one HUD reaction.
        b.on(EVENTS.CURRENCY_CHANGED, () => this.updateHud(), { owner: 'garden' });
        b.on(EVENTS.SEED_PURCHASED, () => this.refreshSeedCards(), { owner: 'garden' });
        // Câu Cá → Nuôi Thú: a landed Linh Ngư is already bagged by BeastSystem;
        // the scene only narrates it on the hint line.
        b.on(EVENTS.FISH_CAUGHT, (p) => {
            this.flashHint(`Câu được ${p.name ?? 'Linh Ngư'} ×${p.amount ?? 1} — mang cho linh thú mà Cho Ăn ✦`);
        }, { owner: 'garden' });
        b.on(EVENTS.BEAST_FED, (p) => {
            this.flashHint(`Cho ăn ${p.beast?.name ?? 'linh thú'} · Thân mật +${p.gained ?? 20} ✦`);
        }, { owner: 'garden' });
    }

    /** HUD reaction to a diamond balance change published by the economy. */
    onDiamondsChanged({ delta = 0 } = {}) {
        this.updateHud();
        this.refreshSeedCards();
        if (!this.stoneValue) return;
        this.tweens.killTweensOf(this.stoneValue);
        this.stoneValue.setScale(1);
        this.tweens.add({
            targets: this.stoneValue,
            scale: { from: delta < 0 ? 0.86 : 1.22, to: 1 },
            duration: 320,
            ease: 'Back.easeOut',
        });
        this.stoneValue.setColor(delta < 0 ? '#ffb0b0' : '#dfffe0');
        this.time.delayedCall(420, () => this.stoneValue?.setColor('#e8d4ff'));
    }

    /** Tear every system down with the scene (bus listeners included). */
    shutdown() {
        this.hideSoilModal();
        // Bí Cảnh: save plot state before the scene tears down (restart or exit)
        this.persistCurrentRealmPlots();
        this.realmModal?.destroy();
        this.beastModal?.destroy();
        this.fishingModal?.destroy();
        this.alchemyModal?.destroy();
        this.codexModal?.destroy();
        this.weatherView?.destroy();
        this.alchemy?.unbind();
        this.beasts?.unbind();
        this.economy?.unbind();
        this.codex?.unbind();
        this.weather?.unbind();
        this.bus?.clear();
        this.audio?.setRain?.(false);
    }

    /**
     * System 5 elixir buffs arrive over the bus — the scene never calls
     * alchemy.consume() for its own sake. Timed buffs show in the hint line;
     * the instant Vạn Thọ Linh Dịch waters the whole garden (mirrors the rain
     * irrigation buff pattern).
     */
    onElixirConsumed({ recipe = null, buff = null } = {}) {
        this.audio?.ensure?.();
        if (buff?.type === 'auto_water') {
            this.waterAll('van-tho-linh-dich');
            this.flashHint(`${recipe?.name ?? 'Vạn Thọ Linh Dịch'} — linh dịch tưới khắp hoa viên ✦`);
            return;
        }
        if (buff?.durationMs) {
            const minutes = Math.round(buff.durationMs / 60000);
            this.flashHint(`${buff.label}: ${recipe?.description ?? ''} (${minutes} phút) ✦`);
        }
    }

    /** A timed elixir buff ran out — let the gardener know on the hint line. */
    onAlchemyBuffExpired({ label = '' } = {}) {
        this.flashHint(`Linh đan ${label} đã tan — hoa viên trở về nhịp thường ✧`);
    }

    /** Re-read the aggregated codex buffs (harvest multipliers + skins). */
    applyCodexBuffs() {
        this.codexBuffs = this.codex ? this.codex.getBuffs() : null;
        if (this.codexModal) this.codexModal.updateBadge();
        this.applyCodexSkins();
    }

    /** Milestone rewards from the codex: +harmony grants and tool skins. */
    onCodexMilestone({ rewards = [], title }) {
        for (const r of rewards) {
            if (r.type === 'harmony' && r.amount) {
                this.economy.harmony += r.amount;
                this.bus.emit(EVENTS.CURRENCY_CHANGED, { source: 'codex-milestone', title });
            }
        }
        this.harmony = this.economy.harmony;
        this.updateHud();
        this.applyCodexSkins();
    }

    /**
     * Codex skins (06 roadmap #9): Liềm Ngọc Bích / Thùng Nước Khảm Vàng.
     * Applied to the bottom action bar so a collection milestone is visible.
     */
    applyCodexSkins() {
        const unlocked = {
            sickle_jade: this.codex?.hasSkin('sickle_jade') ?? false,
            bucket_gold: this.codex?.hasSkin('bucket_gold') ?? false,
        };
        if (unlocked.sickle_jade && this.harvestAllBtn) {
            this.harvestAllBtn.tint = 0x9fe8c8;
            if (this.harvestAllBtn.inner?.list?.[0]?.icon) this.harvestAllBtn.inner.list[0].icon.setTint(0xbff2d8);
        }
        if (unlocked.bucket_gold && this.waterBtn) {
            this.waterBtn.tint = 0xffe3a0;
            if (this.waterBtn.inner?.list?.[0]?.icon) this.waterBtn.inner.list[0].icon.setTint(0xffe9b0);
        }
        this.skins = unlocked;
        return unlocked;
    }

    /**
     * Ambient light eased by the weather view (0 = full day, 1 = deep night).
     * The garden reacts: every bloom's halo lifts, the island aura glows and
     * the stone runes read brighter — "đèn đá tự thắp sáng" without a relight.
     */
    onLampLevel({ level }) {
        const v = Phaser.Math.Clamp(level ?? 0, 0, 1);
        const prev = this.lampLevel ?? 0;
        this.lampLevel = v;
        if (Math.abs(v - prev) < 0.01) return;
        // island aura + runes brighten after dusk
        this.islandAura?.setAlpha(0.12 + v * 0.26).setTint(v > 0.5 ? 0x9fd8ff : 0x8f7ae0);
        // the fairy + her Hào Quang stay radiantly lit after dark (never dimmed)
        this.syncNpcNightRadiance(v);
        // blooms radiate more at night
        for (const tile of this.tiles.flat()) {
            const glow = tile.gridData.bloomGlow;
            if (!glow || !glow.active) continue;
            const nightGlow = this.codexBuffs?.nightGlowSeeds?.includes(tile.gridData.seedId);
            glow.setAlpha(0.18 + v * 0.2 + (nightGlow ? 0.12 : 0));
        }
    }

    /* Per-frame: advance the sky, then let the weather view ease toward it. */
    update(time, delta) {
        // Scene chatter (the hint line) steps aside whenever a full-screen
        // overlay owns the stage, so it can never read through a scroll.
        const blocked = this.uiBlocked();
        if (blocked !== this._overlayChrome) {
            this._overlayChrome = blocked;
            if (this.hintBg) this.hintBg.setVisible(!blocked);
            if (this.hintText) this.hintText.setVisible(!blocked);
        }
        if (!this.weather) return;
        const changes = this.weather.tick(delta);
        // System 5: the furnace + buff timers run on the wall clock; the
        // modal listens to the ALCHEMY_* bus events for its countdown UI.
        this.alchemy?.tick(delta);
        this.tickSoilWater(delta);
        this.weatherView?.update(delta);
        if (changes?.phaseChanged || changes?.conditionChanged) this.updateWeatherHud();
    }

    /* =========================== WEATHER HUD CHIP ===========================
       Compact "Tiên Giới Lịch" card under the hint bar: season · condition ·
       phase, plus the active buff line (rain irrigation / full-moon harmony). */
    createWeatherChip() {
        this.weatherChip = this.add.container(258, 302).setDepth(D.HUD);
        this.weatherChipBg = this.add.graphics();
        this.weatherChipTitle = this.add.text(-172, -18, '', {
            fontFamily: DIALOG_FONT, fontSize: '21px', color: '#efe0ff', fontStyle: 'bold',
            stroke: '#1b1140', strokeThickness: 4,
        });
        this.weatherChipBuff = this.add.text(-172, 8, '', {
            fontFamily: DIALOG_FONT, fontSize: '17px', color: '#aef4ff',
            stroke: '#1b1140', strokeThickness: 4,
        });
        this.weatherChip.add([this.weatherChipBg, this.weatherChipTitle, this.weatherChipBuff]);
        const zone = this.add.zone(0, 0, 400, 84).setInteractive();
        zone.on('pointerdown', () => {
            this.audio.click();
            const info = this.weather.getSummary();
            this.flashHint(`Thiên Thời: ${info} · ${this.weather.getAmbient().description}`);
        });
        this.weatherChip.add(zone);
        this.drawWeatherChip();
    }

    /** Small HUD entry point for the presentation-only fishing modal. */
    createFishingEntryPoint() {
        const button = this.add.container(700, 302).setDepth(D.HUD);
        const bg = this.add.graphics();
        bg.fillStyle(0x1a0f2e, 0.9).lineStyle(2, C.tealGlow ?? C.cyan, 0.8);
        bg.fillRoundedRect(-112, -34, 224, 68, 16).strokeRoundedRect(-112, -34, 224, 68, 16);
        const icon = this.add.image(-76, 0, FISHING_TEXTURES.bobber.key).setDisplaySize(58, 58);
        const label = this.add.text(-42, -2, 'Câu Cá', {
            fontFamily: DIALOG_FONT, fontSize: '23px', color: '#d7fff0', fontStyle: 'bold',
            stroke: '#123d4d', strokeThickness: 4,
        }).setOrigin(0, 0.5);
        const sub = this.add.text(-42, 21, 'Hồ Tiên', {
            fontFamily: DIALOG_FONT, fontSize: '16px', color: '#83d9c5',
            stroke: '#123d4d', strokeThickness: 3,
        }).setOrigin(0, 0.5);
        const zone = this.add.zone(0, 0, 224, 68).setInteractive({ useHandCursor: true });
        zone.on('pointerdown', () => {
            this.audio?.ensure?.();
            this.fishingModal?.open();
        });
        zone.on('pointerover', () => bg.lineStyle(3, 0xbaf5d8, 1).strokeRoundedRect(-112, -34, 224, 68, 16));
        zone.on('pointerout', () => bg.lineStyle(2, C.tealGlow ?? C.cyan, 0.8).strokeRoundedRect(-112, -34, 224, 68, 16));
        button.add([bg, icon, label, sub, zone]);
        this.fishingButton = button;
        this.tweens.add({ targets: button, y: { from: 302, to: 298 }, duration: 2200, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    }

    drawWeatherChip() {
        if (!this.weatherChipBg) return;
        const a = this.weather.getAmbient();
        const raining = a.condition === CONDITION.SPRING_RAIN;
        const bg = this.weatherChipBg;
        bg.clear();
        bg.fillStyle(0x1a0f2e, raining ? 0.9 : 0.82);
        bg.fillRoundedRect(-186, -34, 420, 68, 16);
        bg.lineStyle(2, raining ? C.cyan : C.gold, raining ? 0.85 : 0.55);
        bg.strokeRoundedRect(-186, -34, 420, 68, 16);
        // phase glyph: sun / dusk arc / moon
        const g = 152;
        bg.fillStyle(0x0b0c16, 0.6);
        bg.fillCircle(g, 0, 22);
        if (a.phase === PHASE.DAY) {
            bg.fillStyle(0xffd97a, 1);
            bg.fillCircle(g, 0, 11);
        } else if (a.phase === PHASE.DUSK) {
            bg.fillStyle(0xff9550, 1);
            bg.fillCircle(g, 3, 11);
            bg.fillStyle(0x1a0f2e, 1);
            bg.fillCircle(g, -13, 12);
        } else {
            bg.fillStyle(0xe6ecff, 1);
            bg.fillCircle(g, 0, 11);
            bg.fillStyle(0x0b0c16, 1);
            bg.fillCircle(g - 7, -4, 9);
        }
        if (raining) {
            bg.fillStyle(0xaef4ff, 0.95);
            for (let i = 0; i < 3; i++) bg.fillCircle(g - 12 + i * 12, 13 + (i % 2) * 4, 2.6);
        }
        this.weatherChipTitle.setText(`${a.season.name} · ${a.conditionLabel}`);
        const mod = this.weather.getModifiers();
        const buffs = [];
        if (mod.autoWater) buffs.push('Mưa tưới miễn phí ✦');
        if (mod.harmonyMult > 1) buffs.push(`Trăng tròn ×${mod.harmonyMult} ✿`);
        this.weatherChipBuff.setText(buffs.length ? buffs.join(' · ') : a.phaseLabel);
    }

    /** Refresh the chip when the sky or the weather changes. */
    updateWeatherHud() {
        this.drawWeatherChip();
    }

    /**
     * THE RAIN BUFF: every planted-but-unwatered plot becomes watered and
     * starts growing. Mirrors waterAll() but with no ad, no modal and the
     * gentler "mưa phùn" feedback (splash + soft blue sheen instead of drops).
     */
    rainIrrigate({ source = 'spring-rain' } = {}) {
        if (this.watering) return 0;
        const dry = this.tiles.flat().filter((t) => t.gridData.state === STATE.PLANTED && !t.gridData.watered);
        if (!dry.length) return 0;
        this.audio.ensure();
        this.audio.splash(0.1);
        dry.forEach((tile, i) => {
            const data = tile.gridData;
            data.watered = true;
            data.water = 1;
            data.rainWatered = true;
            tile.setTint(0xbfe6ff);
            this.bus.emit(EVENTS.TILE_WATERED, { row: data.row, col: data.col, source });
            const flash = this.add.image(tile.x, tile.y, 'glow')
                .setTint(0x9fd8ff).setAlpha(0.36).setScale(0.72, 0.44).setDepth(tile.depth + 4);
            this.tweens.add({ targets: flash, alpha: 0, scale: 1.2, duration: 700 + i * 24, onComplete: () => flash.destroy() });
            data.state = STATE.GROWING;
        });
        // Only the plots the rain just watered bloom here — a plot the player
        // watered with the can keeps its own (earlier) schedule, so the two
        // paths can never fight over the same tile.
        this.time.delayedCall(1200, () => {
            dry.forEach((tile, k) => {
                if (tile.active && tile.gridData.state === STATE.GROWING) {
                    this.time.delayedCall(plotBloomDelay(tile.gridData, k * this.bloomStaggerMs()), () => this.bloomTile(tile));
                }
            });
        });
        this.flashHint(`Mưa Phùn Linh Tuyền tưới ${dry.length} ô đất đang khô ✦`);
        return dry.length;
    }

    /**
     * Bloom stagger pacing. Codex growth buff and the Tụ Khí Đan elixir
     * (System 5, +20% bloom speed) both shorten the cascade — each system
     * publishes, the scene composes; neither knows the other exists.
     */
    bloomStaggerMs() {
        const codexMult = this.codexBuffs?.growthMult ?? 1;
        const alchemyMult = this.alchemy?.getBuffs()?.growthMult ?? 1;
        return Math.max(40, Math.round(90 * codexMult * alchemyMult));
    }


    /* ============ LINH ĐẢO PHÙ VÂN — floating celestial stone island ============ */
    createPlatform() {
        // Soft shadow the island casts on the water beneath it (~0.45 alpha),
        // with a slow shimmer as the water moves.
        this.islandShadow = this.add.image(540, 1452, 'island_shadow')
            .setDisplaySize(700, 172)
            .setAlpha(0.45)
            .setDepth(D.ISLAND_SHADOW);
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
            .setDepth(D.PLATFORM)
            .setScale(0.82);
        // celestial aura around the island — the weather view lifts this at
        // night ("đèn đá tự thắp sáng"), see onLampLevel()
        this.islandAura = this.add.image(540, 1180, 'glow')
            .setTint(0x8f7ae0).setAlpha(0.12).setScale(5.4, 3.0).setDepth(D.ISLAND_AURA);
        // island name, resting on the shadow like a reflection
        this.add.text(540, 1452, '· Linh Đảo Phù Vân ·', {
            fontFamily: DIALOG_FONT, fontSize: '24px', color: '#cfc0ff', fontStyle: 'italic',
            stroke: '#160f2e', strokeThickness: 5,
        }).setOrigin(0.5).setDepth(D.ISLAND_AURA + 1).setAlpha(0.9);
    }

    /* ====================== BRIDGE + NPC ====================== */
    /**
     * Config of the active realm's guardian NPC (sprite + label + aura tint).
     * Falls back to the default garden fairy for realms without an override.
     */
    getActiveNpcConfig() {
        return this.activeRealm?.npc ?? {
            name: 'Tiên Nữ Hoa Giang',
            spriteKey: 'npc_tien_nu',
            title: 'Người trấn giữ cầu kiều · Linh Đảo Phù Vân',
            auraTint: 0xc9b2ff,
        };
    }

    createBridgeAndNpc() {
        // NOTE: the active realm's background already contains the complete
        // scenery (pavilion, bridge, lake, mountains). Never layer duplicate
        // bridge/pavilion patches over it — any overlay at (150-350,700-900)
        // would produce a faux-checkerboard artifact.

        // Realm guardian NPC — hovering above the bottom-right LOWER bridge
        // deck (x: 890, y: 1345), body facing left toward the garden grid.
        // The sprite + label follow the realm (Tiên Nữ Hoa Giang on the island,
        // Băng Băng Tiên Tử in the Frost Realm — see RealmsData `npc`).
        const npc = this.getActiveNpcConfig();
        const npcTextureKey = this.textures.exists(npc.spriteKey) ? npc.spriteKey : 'npc_tien_nu';

        this.npcGroup = this.add.container(NPC_POS.x, NPC_POS.y).setDepth(D.NPC);
        const npcSprite = this.add.image(0, -44, npcTextureKey)
            .setDisplaySize(344, 274);
        this.npcSprite = npcSprite;

        /* ---- Hào Quang — radiant Celestial Aura ----
           TWO layers, both Phaser.BlendModes.ADD so the halo composites
           additively (light on top of the scene, never a dark disc):
           · halo    — the wide soft radial glow behind the fairy
           · core    — a tighter inner radiance right behind her silhouette
           Both breathe on a smooth sine yoyo (scale 0.95→1.08, alpha per
           layer). They are stored on the scene as this.npcAura / this.npcAuraCore
           and re-tinted per realm (lavender on the island, frost blue in Hàn Cốc).

           NIGHT IMMUNITY: the whole world below LAYERS.AMBIENT is darkened by
           WeatherView's multiply wash at midnight, but the NPC container rides
           D.NPC (200)… which is still BELOW 1100. To keep her radiantly lit
           after dusk the aura layers are mirrored ABOVE the wash while night
           light is active — see syncNpcNightRadiance(), driven by the lamp
           level. The sprite itself is bright art with additive halo — it reads
           self-illuminated against the darkened garden. */
        const auraTint = npc.auraTint ?? 0xc9b2ff;
        this.npcAura = this.add.image(0, -44, 'glow')
            .setBlendMode(Phaser.BlendModes.ADD)
            .setTint(auraTint)
            .setAlpha(0.5)
            .setScale(0.95);
        this.npcAuraCore = this.add.image(0, -44, 'glow')
            .setBlendMode(Phaser.BlendModes.ADD)
            .setTint(0xffffff)
            .setAlpha(0.28)
            .setScale(0.42);

        // Breathing halo: scale 0.95 → 1.08, alpha 0.5 → 0.85 (spec)
        this.npcAuraTween = this.tweens.add({
            targets: this.npcAura,
            scale: { from: 0.95, to: 1.08 },
            alpha: { from: 0.5, to: 0.85 },
            duration: 2400,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.easeInOut',
        });
        // Tighter inner core breathes slightly faster, subtler range
        this.tweens.add({
            targets: this.npcAuraCore,
            scale: { from: 0.38, to: 0.5 },
            alpha: { from: 0.22, to: 0.4 },
            duration: 1700,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.easeInOut',
        });

        // name tag
        this.npcName = this.add.text(0, 132, npc.name, {
            fontFamily: DIALOG_FONT, fontSize: '22px', color: '#dce8ff',
            align: 'center', stroke: '#1b1140', strokeThickness: 4,
        }).setOrigin(0.5);
        // interaction zone (generous, covers sprite + ribbons)
        const npcZone = this.add.zone(0, -20, 400, 360).setInteractive();
        npcZone.on('pointerdown', () => this.onNpcClick());

        this.npcGroup.add([this.npcAura, this.npcAuraCore, npcSprite, this.npcName, npcZone]);

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

        // Midnight radiance mirror (see syncNpcNightRadiance)
        this.syncNpcNightRadiance(this.lampLevel ?? 0);

        // Hoa Các entry button on the HUD (also opens via the NPC herself)
        this.createShopEntryPoint();
    }

    /**
     * Keep the fairy + her aura OUT of the night-time darken pass.
     * WeatherView multiplies everything below LAYERS.AMBIENT (1100) by the
     * night color, which would crush the aura's additive glow. When the lamp
     * level rises past dusk we re-add an ADD-blended copy of the halo + a soft
     * light pool ABOVE the wash (depth AMBIENT + 2), so the NPC keeps shining
     * like a lantern while the rest of the garden sleeps. At day the mirror
     * fades out (the world render below is already fully lit).
     */
    syncNpcNightRadiance(level = 0) {
        const v = Phaser.Math.Clamp(level ?? 0, 0, 1);
        const npc = this.getActiveNpcConfig();
        if (v <= 0.02) {
            if (this.npcNightGlow) {
                this.npcNightGlow.destroy();
                this.npcNightGlow = null;
            }
            return;
        }
        if (!this.npcNightGlow) {
            this.npcNightGlow = this.add.image(NPC_POS.x, NPC_POS.y - 44, 'glow')
                .setBlendMode(Phaser.BlendModes.ADD)
                .setDepth(LAYERS.AMBIENT + 2);
            this.tweens.add({
                targets: this.npcNightGlow,
                scale: { from: 1.0, to: 1.12 },
                alpha: { from: 0.5, to: 0.78 },
                duration: 2400,
                yoyo: true,
                repeat: -1,
                ease: 'Sine.easeInOut',
            });
        }
        this.npcNightGlow.setPosition(NPC_POS.x, NPC_POS.y - 44);
        this.npcNightGlow.setTint(npc.auraTint ?? 0xc9b2ff);
        this.npcNightGlow.setAlpha(0.1 + v * 0.42);
        this.npcNightGlow.setScale(1.7 + v * 0.5, 1.45 + v * 0.4);
    }

    onNpcClick() {
        this.audio.ensure();
        this.audio.chime(880, { gain: 0.06 });
        // Cửa Hàng Hoa Viên: tapping the realm guardian opens her shop modal
        // (Hoa Các). The quest dialog hub stays reachable from the shop
        // header's "Nhiệm Vụ" button, so nothing is lost.
        this.openGardenShop();
    }

    /* ====================== CỬA HÀNG HOA VIÊN (GARDEN SHOP) ====================== */
    /** HUD entry point — the "Hoa Các" pagoda button (right column stack:
     *  codex 322 → alchemy 462 → shop 602, clear of every other widget). */
    createShopEntryPoint() {
        const button = this.add.container(958, 602).setDepth(D.HUD);
        const bg = this.add.graphics();
        bg.fillStyle(0x1a0f2e, 0.9).lineStyle(2, 0xdfb15b, 0.85);
        bg.fillRoundedRect(-112, -34, 224, 68, 16).strokeRoundedRect(-112, -34, 224, 68, 16);
        const iconKey = this.textures.exists('icon_shop') ? 'icon_shop' : 'glow';
        const icon = this.add.image(-76, 0, iconKey);
        if (iconKey === 'icon_shop') icon.setDisplaySize(58, 58);
        else icon.setTint(0xdfb15b).setScale(0.42);
        const label = this.add.text(-42, -2, 'Hoa Các', {
            fontFamily: DIALOG_FONT, fontSize: '23px', color: '#ffe9c4', fontStyle: 'bold',
            stroke: '#3a2410', strokeThickness: 4,
        }).setOrigin(0, 0.5);
        const sub = this.add.text(-42, 21, 'Cửa Hàng', {
            fontFamily: DIALOG_FONT, fontSize: '16px', color: '#d8b98a',
            stroke: '#3a2410', strokeThickness: 3,
        }).setOrigin(0, 0.5);
        const zone = this.add.zone(0, 0, 224, 68).setInteractive({ useHandCursor: true });
        zone.on('pointerdown', () => {
            this.audio?.ensure?.();
            this.openGardenShop();
        });
        zone.on('pointerover', () => bg.lineStyle(3, 0xffe3a0, 1).strokeRoundedRect(-112, -34, 224, 68, 16));
        zone.on('pointerout', () => bg.lineStyle(2, 0xdfb15b, 0.85).strokeRoundedRect(-112, -34, 224, 68, 16));
        button.add([bg, icon, label, sub, zone]);
        this.shopButton = button;
        this.tweens.add({ targets: button, y: { from: 602, to: 598 }, duration: 2300, yoyo: true, repeat: -1, ease: 'Sine.easeInOut', delay: 300 });
    }

    /** Open the Cửa Hàng Hoa Viên modal (NPC tap + HUD button entry). */
    openGardenShop(tab = 'seeds') {
        this.audio?.ensure?.();
        if (!this.shopModal) {
            this.shopModal = new GardenShopModal(this, {
                economy: this.economy,
                bus: this.bus,
                audio: this.audio,
                realm: this.activeRealm,
                realmId: this.activeRealmId,
            }).create();
        }
        this.shopModal.open(tab);
    }

    /** Snapshot of the shop modal state (tests + debug). */
    getShopSnapshot() {
        return this.shopModal?.getSnapshot?.() ?? null;
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
        // Refresh the quest state from live game/economy data every time the
        // khung thoại opens, so the quest-list progress counters are always
        // current no matter which entry point opened it.
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
        const choice = this.dialog.getCurrentNode()?.choices?.[index];
        const node = this.dialog.choose(index);
        // A dialogue choice may request a system action. The request rides the
        // bus, so the dialog never has to know the codex (or vice versa).
        const action = node?.action || choice?.action;
        if (action === 'open_codex') {
            this.closeDialog();
            this.bus.emit(EVENTS.CODEX_OPEN_REQUEST, { from: choice ? 'dialog' : 'node' });
            return;
        }
        if (action === 'open_shop_seeds' || action === 'open_shop_sell') {
            this.closeDialog();
            this.openGardenShop(action === 'open_shop_sell' ? 'sell' : 'seeds');
            return;
        }
        if (node) {
            this.renderDialogNode(node);
        } else {
            this.closeDialog();
        }
    }

    /* ============================ GRID ============================ */
    createGrid() {
        this.tileHighlight = this.add.image(-400, -400, 'tile_highlight').setVisible(false).setDepth(D.TILES + 5);
        // Bí Cảnh: when the active realm uses uniform tiles (e.g. FROST_REALM),
        // every plot renders with the realm tile texture regardless of soil type.
        const realmTileKey = (realmHasUniformTile(this.activeRealmId) && this.textures.exists(this.activeRealm.tileTextureKey))
            ? this.activeRealm.tileTextureKey
            : null;
        for (let r = 0; r < ROWS; r++) {
            this.tiles[r] = [];
            for (let c = 0; c < COLS; c++) {
                const pos = IsoMath.gridToScreen(c, r, ORIGIN.x, ORIGIN.y);
                const saved = this.savedPlots?.[r]?.[c];
                const data = saved ? hydratePlotData(saved, r, c) : createPlotData(r, c);
                const texKey = realmTileKey ?? this.soilTextureKey(data.soilType);
                const tile = this.add.image(pos.x, pos.y, texKey)
                    .setInteractive(
                        new Phaser.Geom.Polygon(IsoMath.hitAreaPoints),
                        Phaser.Geom.Polygon.Contains
                    )
                    .setDepth(D.TILES + (r + c) * 7)
                    .setScale(1.02);
                tile.setOrigin(0.5, 32 / tile.height);
                tile.gridData = data;
                tile.on('pointerdown', () => this.handleTileClick(tile));
                tile.on('pointerover', () => this.hoverTile(tile, true));
                tile.on('pointerout', () => this.hoverTile(tile, false));
                this.tiles[r][c] = tile;
            }
        }
    }

    /* ============================ SOIL (Stage 1 Linh Thổ) ============================ */
    /**
     * Texture key for a soil id, falling back to the base tile when the
     * premium PNG failed to load (404 → never a missing-texture square).
     */
    soilTextureKey(soilType) {
        const soil = resolveSoil(soilType);
        return this.textures.exists(soil.textureKey) ? soil.textureKey : 'tile_soil';
    }

    /**
     * Swap a tile's soil texture. Premium tiles carry a visible side thickness
     * so they are taller than 64px; the origin is re-pinned so the diamond's
     * top face still sits on the 128x64 iso footprint and the hit polygon.
     */
    applySoilTexture(tile, soilType) {
        tile.setTexture(this.soilTextureKey(soilType));
        tile.setOrigin(0.5, 32 / tile.height);
        tile.setScale(1.02);
    }

    /** Plot upgrade — the click/modal entry point on an EMPTY plot. */
    openSoilUpgrade(tile) {
        const data = tile.gridData;
        if (data.state !== STATE.EMPTY) return false;
        const current = resolveSoil(data.soilType);
        const options = UPGRADEABLE_SOILS.filter((s) => s.tier > current.tier);
        if (!options.length) {
            this.flashHint(`${current.name} đã là linh thổ tối thượng ✦`);
            return false;
        }
        this.audio.ensure();
        this.audio.click();
        this.showSoilUpgradeModal(tile, options);
        return true;
    }

    /**
     * Deduct diamonds via the EconomySystem, record the new soil on the plot,
     * and play the level-up tween + particle burst. Returns the economy result.
     */
    upgradeSoil(tile, soilId) {
        const data = tile.gridData;
        const target = SOIL_TYPES[soilId];
        if (!target || data.state !== STATE.EMPTY) return { success: false, message: 'Ô đất phải trống để cải tạo' };
        const current = resolveSoil(data.soilType);
        if (target.tier <= current.tier) return { success: false, message: `${current.name} không thể đổi sang ${target.name}` };
        const pay = this.economy.spendDiamonds(target.upgradeCost, `soil-upgrade:${soilId}`);
        if (!pay.success) {
            this.audio.click(0);
            this.showNotice({
                title: 'Thiếu Đá Linh Khí',
                message: `${target.name} cần ${target.upgradeCost} 💎 — hiện có ${this.economy.spiritStones} 💎.`,
                tone: 'warn',
            });
            return pay;
        }
        data.soilType = target.id;
        data.watered = target.alwaysWatered;
        data.water = target.alwaysWatered ? 1 : 0;
        this.playSoilUpgradeFx(tile, target);
        this.bus.emit(EVENTS.CURRENCY_CHANGED, { source: 'soil-upgrade', harmony: this.economy.harmony, spiritStones: this.economy.spiritStones });
        this.bus.emit('garden:soil-upgraded', { row: data.row, col: data.col, soilType: target.id, cost: target.upgradeCost });
        this.updateHud();
        this.flashHint(`${target.name} ✦ ${target.description}`);
        return pay;
    }

    /** Gentle level-up: dip + texture swap + spring back, ring flash, spark burst. */
    playSoilUpgradeFx(tile, soil) {
        this.audio.chime(783.99, { gain: 0.09 });
        this.audio.chime(1174.66, { gain: 0.07, when: 0.12 });
        const ring = this.add.image(tile.x, tile.y, 'glow')
            .setTint(soil.glow).setAlpha(0.9).setScale(0.4, 0.25).setDepth(tile.depth + 4);
        this.tweens.add({ targets: ring, scale: { from: 0.4, to: 2.2 }, scaleY: 1.2, alpha: 0, duration: 700, ease: 'Cubic.easeOut', onComplete: () => ring.destroy() });
        this.tweens.add({
            targets: tile, scaleX: 0.92, scaleY: 0.92, alpha: 0.55, duration: 160, ease: 'Sine.easeIn',
            onComplete: () => {
                if (!tile.active) return;
                this.applySoilTexture(tile, soil.id);
                tile.setScale(0.92).setAlpha(0.55);
                this.tweens.add({ targets: tile, scaleX: 1.02, scaleY: 1.02, alpha: 1, duration: 420, ease: 'Back.easeOut' });
            },
        });
        this.sparks?.emitParticleAt(tile.x, tile.y - 20, 18);
        this.emitPetals?.(tile.x, tile.y - 20, 'flower_golden_amber', 8);
    }

    /** Soil pick card — one row per unlockable soil, priced in 💎. */
    showSoilUpgradeModal(tile, options) {
        this.hideSoilModal();
        const card = this.add.container(W / 2, 900).setDepth(D.MODAL + 2).setAlpha(0).setScale(0.9);
        const rowH = 118;
        const h = 150 + options.length * rowH;
        const g = this.add.graphics();
        g.fillStyle(C.panel, 0.98).lineStyle(3, C.gold, 1);
        g.fillRoundedRect(-380, -h / 2, 760, h, 22).strokeRoundedRect(-380, -h / 2, 760, h, 22);
        const title = this.add.text(0, -h / 2 + 44, `Cải Tạo Linh Thổ · Ô (${tile.gridData.row + 1},${tile.gridData.col + 1})`, {
            fontFamily: DIALOG_FONT, fontSize: '30px', color: '#ffe9a8', fontStyle: 'bold', stroke: '#3a1c5e', strokeThickness: 5,
        }).setOrigin(0.5);
        const items = [g, title];
        options.forEach((soil, i) => {
            const y = -h / 2 + 100 + i * rowH;
            const afford = this.economy.canAfford(soil.upgradeCost);
            const bg = this.add.graphics();
            bg.fillStyle(afford ? 0x2e1b52 : 0x1d1430, 1).lineStyle(2, afford ? C.gold : C.goldDim, 1);
            bg.fillRoundedRect(-350, y - 8, 700, rowH - 14, 16).strokeRoundedRect(-350, y - 8, 700, rowH - 14, 16);
            const icon = this.add.image(-290, y + 44, this.soilTextureKey(soil.id)).setScale(0.75);
            const name = this.add.text(-225, y + 12, `${soil.name} · ${soil.upgradeCost} 💎`, {
                fontFamily: DIALOG_FONT, fontSize: '25px', color: afford ? '#ffe9a8' : '#a08a70', fontStyle: 'bold',
            }).setOrigin(0, 0);
            const desc = this.add.text(-225, y + 48, soil.description, {
                fontFamily: DIALOG_FONT, fontSize: '18px', color: afford ? '#f8ead0' : '#8a7a68', wordWrap: { width: 560 }, lineSpacing: 2,
            }).setOrigin(0, 0);
            const zone = this.add.zone(0, y + 44, 700, rowH - 14).setInteractive({ useHandCursor: true });
            zone.on('pointerdown', (p, lx, ly, e) => {
                e?.stopPropagation?.();
                const res = this.upgradeSoil(tile, soil.id);
                this.hideSoilModal();
                if (!res.success) return;
            });
            items.push(bg, icon, name, desc, zone);
        });
        const closeTxt = this.add.text(0, h / 2 - 40, 'Đóng', {
            fontFamily: DIALOG_FONT, fontSize: '22px', color: '#fff7dd', fontStyle: 'bold',
        }).setOrigin(0.5);
        const closeZone = this.add.zone(0, h / 2 - 40, 200, 44).setInteractive({ useHandCursor: true });
        closeZone.on('pointerdown', (p, lx, ly, e) => { e?.stopPropagation?.(); this.audio.click(0); this.hideSoilModal(); });
        items.push(closeTxt, closeZone);
        card.add(items);
        this.soilModal = card;
        this.soilModalOpen = true;
        this.tweens.add({ targets: card, alpha: 1, scale: 1, duration: 240, ease: 'Back.easeOut' });
        return card;
    }

    hideSoilModal() {
        const card = this.soilModal;
        this.soilModal = null;
        this.soilModalOpen = false;
        if (!card) return;
        this.tweens.add({ targets: card, alpha: 0, scale: 0.9, duration: 160, onComplete: () => card.destroy() });
    }

    /** Serializable snapshot of every plot (soilType included) for save games. */
    serializePlots() {
        return this.tiles.map((row) => row.map((t) => ({
            row: t.gridData.row, col: t.gridData.col, state: t.gridData.state, seedId: t.gridData.seedId,
            soilType: t.gridData.soilType ?? DEFAULT_SOIL_ID, watered: !!t.gridData.watered, water: t.gridData.water ?? 0,
        })));
    }

    /**
     * Water drain tick — premium soils change how fast a growing plot dries:
     * Xích Viêm ×2, Hàn Ngọc never (pinned at 1 and always flagged watered).
     */
    tickSoilWater(delta) {
        if (!this.tiles?.length) return;
        for (const tile of this.tiles.flat()) {
            const data = tile.gridData;
            if (!data) continue;
            const soil = resolveSoil(data.soilType);
            if (soil.alwaysWatered) {
                if (!data.watered || data.water !== 1) { data.watered = true; data.water = 1; }
                continue;
            }
            if (data.state !== STATE.GROWING && data.state !== STATE.PLANTED) continue;
            const next = drainPlotWater(data, delta);
            if (next === data.water) continue;
            data.water = next;
            if (next <= 0 && data.watered) {
                data.watered = false;
                if (data.state === STATE.GROWING) tile.clearTint();
            }
        }
    }

    /** The soil tile under a stage-space point, or null when off the grid. */
    tileAt(x, y) {
        const { gridX: c, gridY: r } = IsoMath.screenToGrid(x, y, ORIGIN.x, ORIGIN.y);
        if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return null;
        return this.tiles[r]?.[c] ?? null;
    }

    /** True when a full-screen overlay (drawer / dialog / codex / alchemy / fishing / beast / realm / shop / ad) is up. */
    uiBlocked() {
        return !!(this.drawerOpen || this.dialogVisible || this.adWatching || this.soilModalOpen || this.codexModal?.isOpen() || this.fishingModal?.isOpen() || this.alchemyModal?.isOpen() || this.beastModal?.isOpen() || this.realmModal?.isOpen() || this.shopModal?.isOpen());
    }

    /** Open the presentation-only fishing pier UI. */
    openFishing() {
        this.fishingModal?.open();
    }

    closeFishing() {
        this.fishingModal?.close();
        return !!(this.drawerOpen || this.dialogVisible || this.adWatching
            || this.codexModal?.isOpen() || this.alchemyModal?.isOpen() || this.beastModal?.isOpen());
    }

    /** Open the Vườn Linh Thú sanctuary UI. */
    openBeasts() {
        this.beastModal?.open();
    }

    closeBeasts() {
        this.beastModal?.close();
        return !!(this.drawerOpen || this.dialogVisible || this.adWatching
            || this.codexModal?.isOpen() || this.fishingModal?.isOpen() || this.alchemyModal?.isOpen());
    }

    /** HUD entry point for the Spirit Beast Sanctuary (Vườn Linh Thú). */
    createBeastEntryPoint() {
        const button = this.add.container(700, 392).setDepth(D.HUD);
        const bg = this.add.graphics();
        bg.fillStyle(0x1a0f2e, 0.9).lineStyle(2, 0x4fd1a5, 0.8);
        bg.fillRoundedRect(-112, -34, 224, 68, 16).strokeRoundedRect(-112, -34, 224, 68, 16);
        const beastIconKey = BEAST_ASSETS.spirit_fox?.key ?? 'beast_spirit_fox';
        let icon;
        if (this.textures.exists(beastIconKey)) {
            icon = this.add.image(-76, 0, beastIconKey).setDisplaySize(58, 58);
        } else {
            // fallback: jade-tinted glow when beast texture is missing (e.g. headless tests)
            icon = this.add.image(-76, 0, 'glow').setTint(0x4fd1a5).setAlpha(0.85).setScale(0.42);
        }
        const label = this.add.text(-42, -2, 'Linh Thú', {
            fontFamily: DIALOG_FONT, fontSize: '23px', color: '#d7fff0', fontStyle: 'bold',
            stroke: '#123d4d', strokeThickness: 4,
        }).setOrigin(0, 0.5);
        const sub = this.add.text(-42, 21, 'Vườn', {
            fontFamily: DIALOG_FONT, fontSize: '16px', color: '#83d9c5',
            stroke: '#123d4d', strokeThickness: 3,
        }).setOrigin(0, 0.5);
        const zone = this.add.zone(0, 0, 224, 68).setInteractive({ useHandCursor: true });
        zone.on('pointerdown', () => {
            this.audio?.ensure?.();
            this.beastModal?.open();
        });
        zone.on('pointerover', () => bg.lineStyle(3, 0xbaf5d8, 1).strokeRoundedRect(-112, -34, 224, 68, 16));
        zone.on('pointerout', () => bg.lineStyle(2, 0x4fd1a5, 0.8).strokeRoundedRect(-112, -34, 224, 68, 16));
        button.add([bg, icon, label, sub, zone]);
        this.beastButton = button;
        this.tweens.add({ targets: button, y: { from: 392, to: 388 }, duration: 2200, yoyo: true, repeat: -1, ease: 'Sine.easeInOut', delay: 200 });
    }

    /** HUD entry point for Bí Cảnh (Secret Realms) — portal button. */
    createRealmEntryPoint() {
        const button = this.add.container(300, 392).setDepth(D.HUD);
        const bg = this.add.graphics();
        bg.fillStyle(0x1a0f2e, 0.9).lineStyle(2, 0x7ff7ff, 0.8);
        bg.fillRoundedRect(-112, -34, 224, 68, 16).strokeRoundedRect(-112, -34, 224, 68, 16);
        const icon = this.add.text(-80, 0, '⛩', {
            fontFamily: 'Arial', fontSize: '40px', color: '#7ff7ff',
        }).setOrigin(0.5);
        const label = this.add.text(-42, -2, 'Bí Cảnh', {
            fontFamily: DIALOG_FONT, fontSize: '23px', color: '#d7f0ff', fontStyle: 'bold',
            stroke: '#12303d', strokeThickness: 4,
        }).setOrigin(0, 0.5);
        const realmName = this.activeRealm?.name ?? 'Linh Đảo';
        const sub = this.add.text(-42, 21, realmName.substring(0, 12), {
            fontFamily: DIALOG_FONT, fontSize: '15px', color: '#83c9d9',
            stroke: '#12303d', strokeThickness: 3,
        }).setOrigin(0, 0.5);
        const zone = this.add.zone(0, 0, 224, 68).setInteractive({ useHandCursor: true });
        zone.on('pointerdown', () => {
            this.audio?.ensure?.();
            this.realmModal?.open();
        });
        zone.on('pointerover', () => bg.lineStyle(3, 0xbaf0f8, 1).strokeRoundedRect(-112, -34, 224, 68, 16));
        zone.on('pointerout', () => bg.lineStyle(2, 0x7ff7ff, 0.8).strokeRoundedRect(-112, -34, 224, 68, 16));
        button.add([bg, icon, label, sub, zone]);
        this.realmButton = button;
        this.realmButtonSub = sub;
        this.tweens.add({ targets: button, y: { from: 392, to: 388 }, duration: 2400, yoyo: true, repeat: -1, ease: 'Sine.easeInOut', delay: 400 });
    }

    /**
     * Switch to a different realm: save current plots, fade-to-white transition,
     * then restart GardenScene with the new realm's background/tiles/saved data.
     */
    switchRealm(realmId) {
        if (realmId === this.activeRealmId) {
            this.realmModal?.close();
            return;
        }
        // Save current realm's plot state before switching
        this.persistCurrentRealmPlots();
        // Close the modal
        this.realmModal?.close();
        // Smooth fade-to-white transition overlay
        const fade = this.add.rectangle(W / 2, H / 2, W, H, 0xffffff, 0).setDepth(9999);
        this.tweens.add({
            targets: fade,
            alpha: 1,
            duration: 600,
            ease: 'Cubic.easeIn',
            onComplete: () => {
                // Persist the new active realm and restart the scene
                saveActiveRealm(realmId);
                this.scene.restart();
            },
        });
    }

    /** Serialize the current grid's plot data and save to the active realm's LocalStorage slot. */
    persistCurrentRealmPlots() {
        if (!this.tiles || !this.tiles.length) return;
        // Inline serialize (mirrors PlotData.serializePlotData — no sprites)
        const plots = [];
        for (let r = 0; r < ROWS; r++) {
            plots[r] = [];
            for (let c = 0; c < COLS; c++) {
                const tile = this.tiles[r]?.[c];
                if (!tile) { plots[r][c] = null; continue; }
                const d = tile.gridData;
                plots[r][c] = {
                    row: d.row, col: d.col,
                    state: d.state,
                    seedId: d.seedId,
                    soilType: d.soilType ?? 'HOANG_THO',
                    watered: !!d.watered,
                    water: d.water ?? 0,
                    rainWatered: !!d.rainWatered,
                    plantedAt: d.plantedAt ?? 0,
                };
            }
        }
        saveRealmPlots(this.activeRealmId, plots);
    }

    /** Open the Vạn Hoa Đồ Giám scroll (also callable from tests / NPC dialog). */
    openCodex() {
        this.codexModal?.open();
    }

    closeCodex() {
        this.codexModal?.close();
    }

    hoverTile(tile, on) {
        const data = tile.gridData;
        const canPlant = this.activeTool === TOOL.SEED && this.selectedSeed && data.state === STATE.EMPTY;
        const canHarvest = this.activeTool !== TOOL.SEED && data.state === STATE.BLOOMING;
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
        if (this.uiBlocked()) return;
        this.audio.ensure();
        const data = tile.gridData;

        /* ---- SICKLE (Thu Hoạch): harvest mature plants ONLY, then stop. ----
           Never falls through to planting, never re-seeds the cleared plot. */
        if (this.activeTool === TOOL.SICKLE) {
            if (data.state === STATE.BLOOMING) {
                this.harvestTile(tile);
            } else {
                this.tweens.add({ targets: tile, scale: { from: 1.0, to: 1.05 }, yoyo: true, duration: 90 });
                this.audio.click(0);
                this.flashHint(data.state === STATE.EMPTY
                    ? 'Liềm chỉ thu hoạch — chọn hạt giống để gieo vào ô trống ✧'
                    : 'Hoa chưa nở — tưới nước rồi quay lại thu hoạch ✧');
            }
            return;
        }

        /* ---- SEED (gieo hạt): plant on EMPTY plots ONLY. ---- */
        if (this.activeTool === TOOL.SEED && this.selectedSeed) {
            if (data.state === STATE.EMPTY) {
                this.tryPlantSeed(tile);
            } else if (data.state === STATE.BLOOMING) {
                this.audio.click(0);
                this.flashHint('Ô này đã nở hoa — dùng Liềm Thu Hoạch ✦ để thu hoạch');
            } else {
                this.tweens.add({ targets: tile, scale: { from: 1.0, to: 1.06 }, yoyo: true, duration: 90 });
                this.audio.click();
            }
            return;
        }

        /* ---- NONE: a tap on a bloom is a quick single harvest; nothing is planted. ---- */
        if (data.state === STATE.BLOOMING) {
            this.harvestTile(tile);
            return;
        }
        if (data.state !== STATE.EMPTY) {
            this.tweens.add({ targets: tile, scale: { from: 1.0, to: 1.06 }, yoyo: true, duration: 90 });
            this.audio.click();
            return;
        }
        // Empty plot, no tool armed: offer the Linh Thổ upgrade (falls back to
        // the seed hint when the plot is already at the top tier).
        if (!this.openSoilUpgrade(tile)) this.flashHint('Hãy mở Ngăn Hạt Giống và chọn một loài hoa ✦');
    }

    /**
     * Economy gate in front of plantSeed(): premium seeds are consumed from
     * the inventory, and when the packet is empty one is bought on the spot
     * (diamonds deducted by the economy, which announces DIAMONDS_CHANGED).
     * If the gardener cannot afford it, a notice is shown and NOTHING is planted.
     */
    tryPlantSeed(tile) {
        const seed = this.selectedSeed;
        if (!seed || tile.gridData.state !== STATE.EMPTY) return false;
        // Bí Cảnh: realm-exclusive seeds are always free in their home realm
        const isRealmSeed = !!REALM_SEED_BY_ID[seed.id];
        if (isRealmSeed && canPlantInRealm(seed.id, this.activeRealmId)) {
            this.plantSeed(tile);
            this.refreshSeedCards();
            return true;
        }
        if (!this.economy.consumeSeed(seed.id)) {
            const cost = this.economy.getSeedCost(seed.id);
            const buy = this.economy.purchaseSeed(seed.id);
            if (!buy.success) {
                this.audio.click(0);
                this.showNotice({
                    title: 'Thiếu Đá Linh Khí',
                    message: `${seed.name} cần ${cost} 💎 mỗi hạt — hiện có ${this.economy.spiritStones} 💎.\nThu hoạch thêm hoa hoặc xem quảng cáo để nhận Đá Linh Khí.`,
                    tone: 'warn',
                });
                return false;
            }
            this.economy.consumeSeed(seed.id);
            this.flashHint(`Đã mua 1 hạt ${seed.name} (-${cost} 💎) và gieo ngay ✦`);
        }
        this.plantSeed(tile);
        this.refreshSeedCards();
        return true;
    }

    /* ============================ TOOLS ============================ */
    /** Switch the active plot tool (SEED / SICKLE / NONE) and refresh chrome. */
    setTool(tool) {
        const next = Object.values(TOOL).includes(tool) ? tool : TOOL.NONE;
        this.activeTool = next;
        if (next !== TOOL.SEED) this.selectedSeed = null;
        this.harvestAllBtn?.setActive?.(next === TOOL.SICKLE);
        this.tileHighlight?.setVisible(false);
        if (next === TOOL.SICKLE) this.showToolChip('icon_sickle', 'Liềm Thu Hoạch');
        else if (next === TOOL.NONE) this.hideChip();
        this.updateHint();
        return next;
    }

    /**
     * Sickle button: arm the SICKLE tool and reap every mature bloom now.
     * A second tap with nothing left to harvest puts the sickle away.
     */
    onSickleButton() {
        this.audio.ensure();
        const blooming = this.tiles.flat().filter((t) => t.gridData.state === STATE.BLOOMING).length;
        if (this.activeTool === TOOL.SICKLE && blooming === 0) {
            this.audio.click();
            this.setTool(TOOL.NONE);
            return;
        }
        this.setTool(TOOL.SICKLE);
        if (blooming > 0) this.harvestAll();
        else this.flashHint('Liềm đã sẵn sàng — chạm hoặc vuốt qua hoa đã nở để thu hoạch ✦');
    }

    /* ============================ HARVEST (NEW) ============================ */
    harvestTile(tile) {
        const data = tile.gridData;
        if (data.state !== STATE.BLOOMING) return;
        const seedId = data.seedId;

        this.audio.ensure();
        this.audio.chime(1046.5, { gain: 0.08 });
        this.audio.pluck(880, { gain: 0.06 });

        /* Reward = base economy × codex buffs (System 9) × sky buffs (System 8).
           The three systems never import each other: the scene aggregates the
           multipliers it was given by each and hands one object to the economy. */
        const night = !!this.weather?.isNight();
        const codexBonus = this.codex?.getHarvestBonus(seedId, { night }) ?? {};
        const skyMod = this.weather?.getModifiers() ?? { harmonyMult: 1, reason: 'none' };
        const soil = resolveSoil(data.soilType);
        const reward = this.economy.harvestFlower(seedId, {
            harmonyBonus: codexBonus.harmonyBonus ?? 0,
            stoneBonus: codexBonus.stoneBonus ?? 0,
            harmonyMult: (codexBonus.harmonyMult ?? 1) * (skyMod.harmonyMult ?? 1),
            yieldMult: soilYieldMult(data.soilType, seedId),
        });
        const newQuests = this.economy.checkQuests();

        // The publish is what lets System 9 record the harvest — the scene never
        // calls codex.recordHarvest() directly.
        this.bus.emit(EVENTS.FLOWER_HARVESTED, {
            seedId,
            row: data.row,
            col: data.col,
            harmony: reward.harmony,
            spiritStones: reward.spiritStones,
            rainWatered: !!data.rainWatered,
            nightGlow: !!codexBonus.nightGlow,
            sky: skyMod.reason,
        });
        this.bus.emit(EVENTS.CURRENCY_CHANGED, { source: 'harvest', harmony: this.economy.harmony, spiritStones: this.economy.spiritStones });

        // Visual: sparkle burst + reward popup
        const seed = SEED_BY_ID[seedId];
        this.emitPetals(tile.x, tile.y - 26, seedId, codexBonus.nightGlow ? 20 : 14);
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

        // Floating reward text (buff sources named so the systems feel connected)
        const credits = [];
        if (reward.harmonyBonus) credits.push(`Đồ Giám +${reward.harmonyBonus}✿`);
        if (reward.stoneBonus) credits.push(`Thành thạo +${reward.stoneBonus}💎`);
        if (reward.harmonyMult > 1) {
            credits.push(skyMod.reason === 'full-moon' ? `Trăng Tròn ×${reward.harmonyMult}✿` : `×${reward.harmonyMult}✿`);
        }
        if ((reward.yieldMult ?? 1) > 1) credits.push(`${soil.name} ×${reward.yieldMult.toFixed(reward.yieldMult % 1 ? 1 : 0)}💎`);
        const rewardText = `+${reward.harmony} ✿  +${reward.spiritStones} 💎${credits.length ? `\n${credits.join(' · ')}` : ''}`;
        const pop = this.add.text(tile.x, tile.y - 60, rewardText, {
            fontFamily: DIALOG_FONT, fontSize: credits.length ? '24px' : '28px', color: '#ffe9a8', fontStyle: 'bold',
            stroke: '#3a1c5e', strokeThickness: 6, align: 'center', lineSpacing: 2,
        }).setOrigin(0.5).setDepth(D.PETALS + 3);
        this.tweens.add({
            targets: pop, y: tile.y - 130, alpha: 0, duration: 1100, ease: 'Cubic.easeOut',
            onComplete: () => pop.destroy(),
        });

        // Reset plot instantly
        data.state = STATE.EMPTY;
        data.seedId = null;
        data.watered = soil.alwaysWatered;
        data.water = soil.alwaysWatered ? 1 : 0;
        data.rainWatered = false;
        data.plantSprites = null;
        data.bloomSprite = null;
        data.bloomGlow = null;
        tile.clearTint();
        this.bloomCount--;

        // Update HUD
        this.harmony = this.economy.harmony;
        this.spiritStones = this.economy.spiritStones;
        this.updateHud();

        // Quest completion celebration (published so any system can react)
        if (newQuests.length > 0) {
            for (const q of newQuests) {
                this.bus.emit(EVENTS.QUEST_COMPLETED, { id: q.id, name: q.name, reward: q.reward });
            }
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
                }).setOrigin(0.5).setDepth(D.TOAST - 20).setScale(0.5).setAlpha(0);
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
        this.tweens.add({ targets: tile, scale: { from: 1.02, to: 1.06, yoyo: true }, duration: 120 });

        this.updateHud();
        this.updateHint();
        const idx = this.tiles.flat().indexOf(tile);
        this.audio.chime(660 + (idx % 5) * 60, { gain: 0.05 });
        this.bus.emit(EVENTS.TILE_PLANTED, { seedId: seed.id, row: data.row, col: data.col, soilType: data.soilType });

        // Soil perks at planting time: Hàn Ngọc plots are born watered (and
        // start growing at once); Tức Nhưỡng rolls a 10% instant-mature chance.
        const soil = resolveSoil(data.soilType);
        if (rollInstantMature(data.soilType)) {
            data.watered = true;
            data.water = 1;
            data.state = STATE.GROWING;
            this.flashHint(`${soil.name} ✦ ${seed.name} lập tức trưởng thành!`);
            this.time.delayedCall(320, () => { if (tile.active) this.bloomTile(tile); });
        } else if (soil.alwaysWatered) {
            data.watered = true;
            data.water = 1;
            data.state = STATE.GROWING;
            tile.setTint(0xaee8ff);
            this.bus.emit(EVENTS.TILE_WATERED, { row: data.row, col: data.col, source: 'soil:han-ngoc' });
            this.time.delayedCall(plotBloomDelay(data, 1200), () => { if (tile.active) this.bloomTile(tile); });
        }
    }

    /* ============================ SEARCH DRAWER ============================ */
    /**
     * Bí Cảnh: the seed list available in the active realm's drawer.
     * DEFAULT_GARDEN shows all standard seeds; other realms show only their
     * exclusive seeds (Băng Liên, Tuyết Chi, …).
     */
    getDrawerSeeds() {
        if (this.activeRealmId === REALM_IDS.DEFAULT_GARDEN) {
            return SEED_CATALOG;
        }
        const realmSeeds = getSeedsForRealm(this.activeRealmId);
        // Ensure searchText is populated for search filtering
        for (const seed of realmSeeds) {
            if (!seed.searchText) {
                seed.searchText = normalizeText([
                    seed.id, seed.name, seed.english, seed.colorName,
                    seed.color_hex, seed.sprite_key, ...(seed.search_keywords ?? []),
                ].join(' '));
            }
        }
        return realmSeeds;
    }

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

        // seed cards — Bí Cảnh: use realm-aware seed list
        const drawerSeeds = this.getDrawerSeeds();
        this.drawerSeeds = drawerSeeds;
        this.seedCards = drawerSeeds.map((seed, i) => this.createSeedCard(seed, i));
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
        // Bí Cảnh: realm-exclusive seeds are always free in their home realm
        const isRealmSeed = !!REALM_SEED_BY_ID[seed.id];
        const cost = isRealmSeed ? 0 : this.economy.getSeedCost(seed.id);
        const premium = cost > 0 && !isRealmSeed;
        const costLabel = isRealmSeed ? 'Bí Cảnh ✦' : (premium ? `${cost} 💎` : 'Miễn phí');
        const sub = this.add.text(0, 88, `${seed.colorName} · ${costLabel}`, {
            fontFamily: 'Georgia, serif', fontSize: '19px', color: '#b9a3dd',
        }).setOrigin(0.5);
        name.setY(56);

        // owned count (premium) / unlimited (starter) + a "Mua" button that
        // deducts diamonds through the economy (DIAMONDS_CHANGED → HUD)
        const owned = this.add.text(premium ? -w / 2 + 16 : 0, 110, '', {
            fontFamily: DIALOG_FONT, fontSize: '17px', color: '#e6d8ff', fontStyle: 'bold',
        }).setOrigin(premium ? 0 : 0.5, 0.5);
        container.add([bg, glow, flower, name, sub, owned]);

        const zone = this.add.zone(0, -14, w, h - 44).setInteractive();
        zone.on('pointerdown', (pointer, lx, ly, event) => { event?.stopPropagation?.(); this.selectSeed(seed); });
        container.add(zone);

        let buyBtn = null;
        let buyBg = null;
        let buyLabel = null;
        if (premium) {
            buyBtn = this.add.container(w / 2 - 46, 110);
            buyBg = this.add.graphics();
            buyLabel = this.add.text(0, 0, `+ Mua`, {
                fontFamily: DIALOG_FONT, fontSize: '16px', color: '#fff7dd', fontStyle: 'bold',
            }).setOrigin(0.5);
            const buyZone = this.add.zone(0, 0, 76, 36).setInteractive({ useHandCursor: true });
            buyZone.on('pointerdown', (pointer, lx, ly, event) => { event?.stopPropagation?.(); this.buySeed(seed); });
            buyBtn.add([buyBg, buyLabel, buyZone]);
            container.add(buyBtn);
        }

        const refresh = () => {
            // Bí Cảnh: realm seeds are always unlimited in their home realm
            if (isRealmSeed) {
                owned.setText('∞ Bí Cảnh độc quyền');
                return;
            }
            const n = this.economy.getInventoryCount(seed.id);
            if (!premium) {
                owned.setText('∞ không giới hạn');
                return;
            }
            const affordable = this.economy.canAfford(cost);
            owned.setText(`Sở hữu: ${n}`).setColor(n > 0 ? '#dfffe0' : '#ffb0b0');
            if (buyBg) {
                buyBg.clear();
                buyBg.fillStyle(affordable ? 0x7a4a1e : 0x3a3050, 0.98);
                buyBg.lineStyle(2, affordable ? 0xffe3a0 : 0x6a5a80, 1);
                buyBg.fillRoundedRect(-36, -17, 72, 34, 12);
                buyBg.strokeRoundedRect(-36, -17, 72, 34, 12);
                buyLabel.setColor(affordable ? '#fff7dd' : '#9a8cb0');
            }
        };
        refresh();

        return { container, seed, bg, draw, refresh, owned, buyBtn };
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
        const seeds = this.drawerSeeds ?? SEED_CATALOG;
        seeds.forEach((seed, i) => {
            const card = this.seedCards[i];
            if (!card) return;
            const match = !q || seed.searchText.includes(q);
            card.container.setVisible(match);
            if (match) card.draw(this.selectedSeed?.id === seed.id);
        });
    }

    /**
     * Pick a seed from the drawer. Premium seeds you do not own yet are bought
     * right here (diamonds deducted, DIAMONDS_CHANGED published); if the
     * purchase fails nothing is selected and a notice explains why.
     */
    selectSeed(seed) {
        this.audio.ensure();
        this.audio.click();
        // Bí Cảnh: realm-exclusive seeds are always free in their home realm
        const isRealmSeed = !!REALM_SEED_BY_ID[seed.id];
        if (isRealmSeed && canPlantInRealm(seed.id, this.activeRealmId)) {
            this.selectedSeed = seed;
            this.activeTool = TOOL.SEED;
            this.harvestAllBtn?.setActive?.(false);
            this.seedCards.forEach((c) => c.draw(c.seed.id === seed.id));
            this.refreshSeedCards();
            this.time.delayedCall(200, () => this.closeDrawer());
            this.showSelectedChip(seed);
            this.updateHint();
            return true;
        }
        if (!this.economy.isFreeSeed(seed.id) && this.economy.getInventoryCount(seed.id) <= 0) {
            const buy = this.economy.purchaseSeed(seed.id);
            if (!buy.success) {
                this.showNotice({
                    title: 'Thiếu Đá Linh Khí',
                    message: `${seed.name} giá ${buy.cost} 💎 — hiện có ${buy.have ?? this.economy.spiritStones} 💎.\nThu hoạch hoa hoặc xem quảng cáo để tích lũy thêm.`,
                    tone: 'warn',
                });
                this.refreshSeedCards();
                return false;
            }
            this.flashHint(`Đã mua ${seed.name} (-${buy.cost} 💎) ✦`);
        }
        this.selectedSeed = seed;
        this.activeTool = TOOL.SEED;
        this.harvestAllBtn?.setActive?.(false);
        this.seedCards.forEach((c) => c.draw(c.seed.id === seed.id));
        this.refreshSeedCards();
        this.time.delayedCall(200, () => this.closeDrawer());
        this.showSelectedChip(seed);
        this.updateHint();
        return true;
    }

    /** Buy one more packet of a premium seed from its drawer card. */
    buySeed(seed) {
        this.audio.ensure();
        const buy = this.economy.purchaseSeed(seed.id);
        if (!buy.success) {
            this.audio.click(0);
            this.showNotice({
                title: 'Thiếu Đá Linh Khí',
                message: `${seed.name} giá ${buy.cost} 💎 — hiện có ${buy.have ?? this.economy.spiritStones} 💎.`,
                tone: 'warn',
            });
            return buy;
        }
        this.audio.chime(1046.5, { gain: 0.07 });
        this.flashHint(buy.cost > 0 ? `Đã mua ${seed.name} (-${buy.cost} 💎) · sở hữu ${buy.owned} ✦` : `Nhận ${seed.name} miễn phí ✦`);
        this.refreshSeedCards();
        return buy;
    }

    /** Re-read owned counts + affordability on every drawer card. */
    refreshSeedCards() {
        if (!this.seedCards) return;
        for (const card of this.seedCards) card.refresh?.();
    }

    showSelectedChip(seed) {
        this.showToolChip(seed.sprite_key, seed.name, 74);
    }

    /** Bottom chip naming the active tool (seed flower or the sickle). */
    showToolChip(textureKey, label, size = 74) {
        if (!this.selectedChip) return;
        if (this.textures.exists(textureKey)) this.chipIcon.setTexture(textureKey).setDisplaySize(size, size);
        this.chipText.setText(label);
        this.tweens.killTweensOf(this.selectedChip);
        this.selectedChip.setVisible(true).setAlpha(0).setScale(0.8);
        this.tweens.add({
            targets: this.selectedChip, alpha: 1, scale: 1, duration: 280, ease: 'Back.easeOut',
        });
    }

    hideChip() {
        if (!this.selectedChip || !this.selectedChip.visible) return;
        this.tweens.killTweensOf(this.selectedChip);
        this.tweens.add({
            targets: this.selectedChip, alpha: 0, scale: 0.8, duration: 180,
            onComplete: () => this.selectedChip.setVisible(false),
        });
    }

    /** ✕ on the chip: drop the seed / put the sickle away. */
    clearSelection() {
        this.audio.click();
        this.setTool(TOOL.NONE);
    }

    /* ============================ HUD ============================ */
    createHud() {
        // Title block sits SAFE_TOP (30px) lower so a phone notch / status bar
        // never overlaps "HOA VIÊN TIÊN CẢNH" (index.html also pads the shell
        // with env(safe-area-inset-top) for devices that report one).
        this.safeTop = SAFE_TOP;
        this.hudTitle = this.add.text(40, 44 + SAFE_TOP, 'HOA VIÊN TIÊN CẢNH', {
            fontFamily: 'Georgia, serif', fontSize: '46px', color: '#ffe9c4', fontStyle: 'bold',
            stroke: '#3a1c5e', strokeThickness: 8,
        }).setDepth(D.HUD);
        this.hudSubtitle = this.add.text(44, 102 + SAFE_TOP, 'Floral Manor · Cổ Phong Garden', {
            fontFamily: 'Georgia, serif', fontSize: '24px', color: '#c9b2f0',
            stroke: '#1b1140', strokeThickness: 5,
        }).setDepth(D.HUD);

        // Harmony badge
        const hud = this.add.container(860, 72).setDepth(D.HUD);
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
        const stoneHud = this.add.container(860, 162).setDepth(D.HUD);
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
            .setStrokeStyle(2, C.gold, 0.5).setDepth(D.HINT);
        this.hintText = this.add.text(W / 2, 218, '', {
            fontFamily: 'Georgia, serif', fontSize: '26px', color: '#efe0ff',
            align: 'center', stroke: '#1b1140', strokeThickness: 6,
        }).setOrigin(0.5).setDepth(D.HINT + 1);
    }

    updateHint() {
        if (!this.hintText) return;
        if (this.activeTool === TOOL.SICKLE && !this.drawerOpen) {
            this.hintText.setText('🌾 Liềm Thu Hoạch — chạm/vuốt qua hoa đã nở để thu hoạch · ✕ để cất liềm');
            this.hintText.setColor('#ffe9a8');
            this.hintBg.setSize(1000, 52);
        } else if (this.activeTool === TOOL.SEED && this.selectedSeed && !this.drawerOpen) {
            this.hintText.setText('✨ Đã chọn: ' + this.selectedSeed.name + ' — chạm/kéo vào ô đất trống để gieo · Liềm ✦ để thu hoạch');
            this.hintText.setColor('#ffe9a8');
            this.hintBg.setSize(1020, 52);
        } else if (this.drawerOpen) {
            this.hintText.setText('🔍 Gõ từ khóa (tim · vang · xanh · gold · blue) rồi chọn hạt giống');
            this.hintText.setColor('#d8c3f2');
            this.hintBg.setSize(1000, 52);
        } else {
            this.hintText.setText('Ngăn Hạt Giống ⬇ · NPC nhận nhiệm vụ · Đồ Giám ↗ để xem hoa đã sưu tập');
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
        let armed = false; // "active tool" state (e.g. the sickle is in hand)
        const drawRing = (hover) => {
            ring.clear();
            if (armed) {
                ring.lineStyle(6, C.goldLight, 0.55);
                ring.strokeCircle(0, 0, BTN_VISUAL_RADIUS + 8);
            }
            ring.fillStyle(baseColor, 0.96);
            ring.lineStyle(4, hover || armed ? C.goldLight : hoverStroke, 1);
            ring.fillCircle(0, 0, BTN_VISUAL_RADIUS);
            ring.strokeCircle(0, 0, BTN_VISUAL_RADIUS);
            ring.fillStyle(innerColor, 0.8);
            ring.fillCircle(0, 0, BTN_INNER_RADIUS);
        };
        drawRing(false);
        const setActive = (on) => {
            armed = !!on;
            drawRing(false);
        };

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

        return { outer, inner, zone, ring, label: text, radius: BTN_VISUAL_RADIUS, hitRadius: TOUCH_ZONE_RADIUS, press, release, setActive, isActive: () => armed };
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
                onTap: () => this.onSickleButton(),
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

        const grayBtn = this.makeModalButton(W / 2, 1072, 'Tưới Ngay · 1 💎', false);
        const goldBtn = this.makeModalButton(W / 2, 1152, '▶ Xem Quảng Cáo · Miễn phí +3 Hòa Hợp', true);
        goldBtn.zone.on('pointerdown', (p, lx, ly, e) => { e?.stopPropagation?.(); this.watchAd(); });
        grayBtn.zone.on('pointerdown', (p, lx, ly, e) => { e?.stopPropagation?.(); this.quickWater(); });
        this.quickWaterBtn = grayBtn;
        const closeX = this.add.text(W / 2 + 380, 600, '✕', {
            fontFamily: 'Arial', fontSize: '42px', color: '#ffb0b0',
        }).setOrigin(0.5).setInteractive();
        closeX.on('pointerdown', (p, lx, ly, e) => { e?.stopPropagation?.(); this.closeModal(false); });
        // panel shield: taps inside the card never reach the dim
        const shield = this.add.zone(W / 2, 870, 820, 620).setInteractive();
        shield.on('pointerdown', (p, lx, ly, e) => e?.stopPropagation?.());
        dim.on('pointerdown', (p, lx, ly, e) => { e?.stopPropagation?.(); if (!this.adWatching) this.closeModal(false); });

        this.adTimerText = this.add.text(W / 2, 830, '', {
            fontFamily: 'Georgia, serif', fontSize: '38px', color: '#aef4ff', fontStyle: 'bold',
            stroke: '#0a2830', strokeThickness: 8,
        }).setOrigin(0.5);

        this.modal.add([dim, panel, shield, title, desc, vip, grayBtn.container, goldBtn.container, closeX, this.adTimerText]);
    }

    /** Plots a watering pass would actually grow (planted, not yet blooming). */
    getWaterablePlots() {
        return this.tiles.flat().filter((t) => t.gridData.state === STATE.PLANTED || t.gridData.state === STATE.GROWING);
    }

    /**
     * Instant quick-water (fast-forward growth) — a PREMIUM action.
     * Costs 1–2 Đá Linh Khí depending on the batch size; when the gardener
     * cannot afford it a notice is shown and nothing grows. The rewarded ad,
     * spring rain and the Vạn Thọ elixir remain the free paths.
     * @returns {boolean} true if the watering pass started
     */
    quickWater() {
        this.audio.ensure();
        if (this.watering) {
            this.flashHint('Đang tưới — chờ đợt tưới hiện tại kết thúc ✧');
            return false;
        }
        const plots = this.getWaterablePlots();
        if (!plots.length) {
            this.audio.click();
            this.closeModal(false);
            this.flashHint('Không có mầm nào cần tưới ✧');
            return false;
        }
        const cost = this.economy.getQuickWaterCost(plots.length);
        if (!this.economy.canAfford(cost)) {
            this.audio.click(0);
            this.showNotice({
                title: 'Thiếu Đá Linh Khí',
                message: `Tưới nhanh ${plots.length} ô cần ${cost} 💎 — hiện có ${this.economy.spiritStones} 💎.\nXem quảng cáo để tưới miễn phí, hoặc thu hoạch hoa để nhận thêm Đá Linh Khí.`,
                tone: 'warn',
            });
            return false;
        }
        const pay = this.economy.payQuickWater(plots.length);
        if (!pay.success) {
            this.showNotice({ title: 'Thiếu Đá Linh Khí', message: pay.message, tone: 'warn' });
            return false;
        }
        this.closeModal(false);
        this.waterAll('quick-water');
        this.flashHint(`Tưới nhanh ${plots.length} ô · -${pay.cost} 💎 Đá Linh Khí ✦`);
        return true;
    }

    /* ============================ NOTICE DIALOG ============================
       Small centred card (above every modal) for economy refusals such as
       "not enough Đá Linh Khí". Tap anywhere on it or wait to dismiss.       */
    showNotice({ title = 'Thông báo', message = '', tone = 'info', durationMs = 3600 } = {}) {
        this.hideNotice();
        const warn = tone === 'warn';
        const card = this.add.container(W / 2, 940).setDepth(D.TOAST + 5).setAlpha(0).setScale(0.9);
        const g = this.add.graphics();
        g.fillStyle(0x121016, 0.98);
        g.lineStyle(4, warn ? 0xffb0b0 : C.gold, 1);
        g.fillRoundedRect(-380, -170, 760, 340, 26);
        g.strokeRoundedRect(-380, -170, 760, 340, 26);
        g.lineStyle(2, C.goldDim, 0.7);
        g.strokeRoundedRect(-364, -154, 728, 308, 20);
        const icon = this.add.image(-300, -100, 'icon_spirit_stone').setDisplaySize(64, 64);
        const t = this.add.text(-250, -100, title, {
            fontFamily: DIALOG_FONT, fontSize: '32px', color: warn ? '#ffd0b0' : '#ffe9a8', fontStyle: 'bold',
            stroke: '#3a1c5e', strokeThickness: 5,
        }).setOrigin(0, 0.5);
        const m = this.add.text(0, 6, message, {
            fontFamily: DIALOG_FONT, fontSize: '23px', color: '#f8ead0', align: 'center',
            wordWrap: { width: 680 }, lineSpacing: 6,
        }).setOrigin(0.5);
        const okBg = this.add.graphics();
        okBg.fillStyle(0x7a4a1e, 0.98).lineStyle(3, 0xffe3a0, 1);
        okBg.fillRoundedRect(-110, 108, 220, 46, 23).strokeRoundedRect(-110, 108, 220, 46, 23);
        const ok = this.add.text(0, 131, 'Đã hiểu', {
            fontFamily: DIALOG_FONT, fontSize: '22px', color: '#fff7dd', fontStyle: 'bold',
        }).setOrigin(0.5);
        const zone = this.add.zone(0, 0, 760, 340).setInteractive();
        zone.on('pointerdown', (p, lx, ly, e) => { e?.stopPropagation?.(); this.hideNotice(); });
        card.add([g, icon, t, m, okBg, ok, zone]);
        this.notice = card;
        this.noticeTitle = title;
        this.noticeText = `${title} — ${message}`;
        this.tweens.add({ targets: card, alpha: 1, scale: 1, duration: 240, ease: 'Back.easeOut' });
        this.audio?.chime?.(392, { gain: 0.05 });
        this.noticeTimer?.remove();
        this.noticeTimer = this.time.delayedCall(durationMs, () => this.hideNotice());
        return card;
    }

    hideNotice() {
        this.noticeTimer?.remove();
        this.noticeTimer = null;
        const card = this.notice;
        if (!card) return;
        this.notice = null;
        this.tweens.add({ targets: card, alpha: 0, scale: 0.94, duration: 160, onComplete: () => card.destroy() });
    }

    isNoticeVisible() {
        return !!this.notice;
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
        return { container, zone, label: t };
    }

    openModal() {
        this.audio.ensure();
        this.audio.click();
        // price the quick-water for the current batch before showing the card
        const n = this.getWaterablePlots().length;
        const cost = this.economy.getQuickWaterCost(Math.max(1, n));
        const affordable = this.economy.canAfford(cost);
        this.quickWaterBtn?.label?.setText(`Tưới Ngay · ${cost} 💎${affordable ? '' : '  (thiếu Đá Linh Khí)'}`)
            .setColor(affordable ? '#e6d8ff' : '#ffb0b0');
        this.modal.setVisible(true).setAlpha(0);
        this.tweens.add({ targets: this.modal, alpha: 1, duration: 200 });
    }

    /**
     * @param {boolean} waterNow  legacy flag: when true the pass is the FREE
     *   reward path (ad / elixir) — the paid tap goes through quickWater().
     */
    closeModal(waterNow) {
        this.tweens.add({
            targets: this.modal, alpha: 0, duration: 180,
            onComplete: () => this.modal.setVisible(false),
        });
        if (waterNow) this.waterAll('rewarded-ad');
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
                        this.economy.addDiamonds(2, 'rewarded-ad');
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
            if (this.uiBlocked()) return;
            this.gestureActive = true;
            this.gestureStartX = pointer.x;
            this.gestureStartY = pointer.y;
            // Remember the plot under the finger: the TAP already handled it
            // (handleTileClick), so touch jitter on the same plot must never
            // re-process it — that was the "harvest → instant re-seed" bug.
            this.lastDragTile = this.tileAt(pointer.x, pointer.y);
        });

        this.input.on('pointermove', (pointer) => {
            // the codex scroll drags its own body instead of planting seeds
            if (this.codexModal?.isOpen()) {
                this.codexModal.handleDragMove(pointer);
                return;
            }
            if (!this.gestureActive) return;
            if (this.uiBlocked()) return;

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

            // Tool-scoped gestures — one tool, one verb, never both:
            if (this.activeTool === TOOL.SEED) {
                // Drag-to-Plant: only EMPTY plots, only with a seed in hand
                if (this.selectedSeed && data.state === STATE.EMPTY) this.tryPlantSeed(tile);
            } else if (this.activeTool === TOOL.SICKLE) {
                // Swipe-to-Harvest: only BLOOMING plots; the plot is cleared and
                // left EMPTY — nothing is re-seeded behind the sickle.
                if (data.state === STATE.BLOOMING) this.harvestTile(tile);
            }
        });

        this.input.on('pointerup', () => {
            this.gestureActive = false;
            this.lastDragTile = null;
            this.codexModal?.handleDragEnd();
        });
    }

    /* ============================ WATER & BLOOM ============================ */
    waterAll(source = 'watering-can') {
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
            data.water = 1;
            data.rainWatered = false;
            tile.setTint(0xaee8ff);
            this.waterDropOnTile(tile, i);
            data.state = STATE.GROWING;
            growIndex++;
            this.bus.emit(EVENTS.TILE_WATERED, { row: data.row, col: data.col, source });
        });

        // The codex growth buff (Xuân Phù) shortens the bloom cascade.
        const stagger = this.bloomStaggerMs();
        this.time.delayedCall(650, () => {
            let k = 0;
            plantable.forEach((tile) => {
                const data = tile.gridData;
                if (data.state === STATE.GROWING) {
                    // Xích Viêm (+40% growth) blooms earlier in the cascade.
                    this.time.delayedCall(plotBloomDelay(data, k * stagger), () => this.bloomTile(tile));
                    k++;
                }
            });
        });

        this.time.delayedCall(700 + growIndex * stagger, () => {
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
        if (resolveSoil(data.soilType).alwaysWatered) { data.watered = true; data.water = 1; }
        this.bloomCount++;

        // Record bloom in economy
        this.economy.recordBloom(data.seedId);
        const newQuests = this.economy.checkQuests();

        /* Published BEFORE the VFX so subscribers (the codex, then the modal)
           can celebrate the discovery inside the same frame. */
        this.bus.emit(EVENTS.FLOWER_BLOOMED, {
            seedId: data.seedId,
            row: data.row,
            col: data.col,
            discovered: this.codex?.isDiscovered(data.seedId) ?? false,
            night: !!this.weather?.isNight(),
            rainWatered: !!data.rainWatered,
        });

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

        // per-bloom permanent glow — brighter at night (System 8 "hoa dạ quang
        // phát sáng dịu mắt"), and brighter still for codex Thiên Hương blooms.
        const nightBoost = this.lampLevel ?? 0;
        const glowBase = 0.18 + nightBoost * 0.2 + (this.codexBuffs?.nightGlowSeeds?.includes(data.seedId) ? 0.12 : 0);
        const glow = this.add.image(tile.x, tile.y - 28, 'glow')
            .setTint(seed.petals).setAlpha(glowBase).setScale(1.5 + nightBoost * 0.3, 1.1 + nightBoost * 0.24)
            .setDepth(tile.depth + 9);
        data.bloomGlow = glow;
        this.tweens.add({ targets: glow, alpha: glowBase + 0.12, duration: 1400, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });

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

        // Quest completion check — announced on the bus like every other reward
        if (newQuests.length > 0) {
            for (const q of newQuests) {
                this.bus.emit(EVENTS.QUEST_COMPLETED, { id: q.id, name: q.name, reward: q.reward });
            }
            this.showQuestCompletion(newQuests);
            this.bus.emit(EVENTS.CURRENCY_CHANGED, { source: 'quest', harmony: this.economy.harmony, spiritStones: this.economy.spiritStones });
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
        }).setOrigin(0.5).setDepth(D.TOAST - 30).setScale(0.5).setAlpha(0);
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
        }).setDepth(D.MIST);
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
        }).setDepth(D.MIST + 1);
    }

    createBloomRadiance() {
        this.add.image(W / 2, 1100, 'glow').setTint(0x3a2a72).setAlpha(0.25).setScale(5.4, 3.2).setDepth(D.ISLAND_AURA - 1);
    }
}
