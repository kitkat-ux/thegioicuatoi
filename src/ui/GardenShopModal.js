/**
 * GardenShopModal — Cửa Hàng Hoa Viên (the Garden Shop of the realm guardian).
 *
 * Opened by tapping the NPC herself or the "Hoa Các" HUD button. A dark
 * Guofeng modal (#121016, gold filigree border) with the NPC greeting header
 * ("Tiên hữu ghé thăm Hoa Các, cần tìm bảo giống gì?") and two functional tabs:
 *
 *   · Kỳ Hoa Dị Thảo  — buy seeds with Đá Linh Khí 💎 or Hòa Hợp ✿
 *                       (standard seeds + the active realm's exclusives,
 *                       e.g. Băng Liên inside Băng Phong Hàn Cốc)
 *   · Tiên Thiên Đổi Báu — sell harvested flowers back for Hòa Hợp + Đá
 *
 * Every transaction runs through EconomySystem (spendDiamonds /
 * spendHarmony / purchaseSeed / sellFlower), which publishes
 * DIAMONDS_CHANGED on the bus so the HUD badges re-sync themselves;
 * `onTransaction` additionally lets the scene refresh harmony + drawer cards.
 *
 * Input contract (see modalInput.js): a panel shield + guarded() handlers
 * stop pointer propagation on every widget, and the backdrop only closes on
 * taps geometrically OUTSIDE the panel — inside taps can never slam it shut.
 */
import { LAYERS } from '../core/Layers.js';
import { DIALOG_FONT } from '../systems/DialogSystem.js';
import { SEED_CATALOG } from '../data/seedCatalog.js';
import {
    REALM_SEEDS, REALM_SEED_BY_ID, getSeedsForRealm, resolveRealm,
} from '../data/RealmsData.js';
import {
    bindBackdropClose, createPanelShield, guarded, localRectToWorld,
} from './modalInput.js';

const STAGE_W = 1080;
const STAGE_H = 1920;
const PANEL_W = 940;
const PANEL_H = 1290;
const PANEL_X = (STAGE_W - PANEL_W) / 2;
const PANEL_Y = (STAGE_H - PANEL_H) / 2 - 40;

const BODY = {
    top: PANEL_Y + 330,
    bottom: PANEL_Y + PANEL_H - 130,
    get h() { return this.bottom - this.top; },
};
const ROW_W = PANEL_W - 110;
const ROW_H = 150;
const ROW_GAP = 12;

/** Dark Guofeng theme matching the realm/beast/alchemy modals. */
const T = {
    bg: 0x121016,
    bgHex: '#121016',
    card: 0x1c1724,
    cardDeep: 0x0d0a12,
    gold: 0xdfb15b,
    goldLight: 0xffe3a0,
    goldDim: 0x8a6a3a,
    cyan: 0x7ff7ff,
    jade: 0x4fd1a5,
    text: '#f8ead0',
    textGold: '#ffe9a8',
    textMuted: '#b9a3dd',
    textSoft: '#d8c3f2',
};

const TABS = {
    seeds: {
        id: 'seeds',
        label: 'Kỳ Hoa Dị Thảo',
        sub: 'Mua hạt giống',
    },
    sell: {
        id: 'sell',
        label: 'Tiên Thiên Đổi Báu',
        sub: 'Đổi hoa lấy báu',
    },
};

const addText = (scene, x, y, value, style = {}) => scene.add.text(x, y, value, {
    fontFamily: DIALOG_FONT,
    ...style,
});

export class GardenShopModal {
    /**
     * @param {Phaser.Scene} scene  the GardenScene
     * @param {{
     *   economy: EconomySystem,
     *   bus?: EventManager,
     *   audio?: AudioManager,
     *   realmId?: string,
     *   onTransaction?: () => void,
     * }} opts
     */
    constructor(scene, opts = {}) {
        if (!scene) throw new TypeError('GardenShopModal requires a Phaser scene');
        if (!opts.economy) throw new TypeError('GardenShopModal requires an EconomySystem');
        this.scene = scene;
        this.economy = opts.economy;
        this.bus = opts.bus ?? null;
        this.audio = opts.audio ?? null;
        this.realmId = opts.realmId ?? 'DEFAULT_GARDEN';
        this.realm = resolveRealm(this.realmId);
        this.onTransaction = opts.onTransaction ?? null;
        this.root = null;
        this.visible = false;
        this.activeTab = 'seeds';
        this.scroll = 0;
        this.scrollMax = 0;
        this.rows = [];
        this.disposers = [];
    }

    /* ============================== CREATE ============================== */
    create() {
        if (this.root) return this;
        const s = this.scene;

        this.root = s.add.container(0, 0).setDepth(LAYERS.SHOP).setVisible(false);

        /* ---- backdrop (tap outside the panel closes) ---- */
        this.shade = s.add.rectangle(STAGE_W / 2, STAGE_H / 2, STAGE_W, STAGE_H, 0x05030c, 0.82)
            .setInteractive();
        bindBackdropClose(this.shade, () => this.getPanelWorldRect(), () => this.close());
        this.root.add(this.shade);

        /* ---- panel: dark lacquer + gold filigree double frame ---- */
        const panel = s.add.graphics();
        panel.fillStyle(T.bg, 0.985);
        panel.lineStyle(6, T.gold, 1);
        panel.fillRoundedRect(PANEL_X, PANEL_Y, PANEL_W, PANEL_H, 30);
        panel.strokeRoundedRect(PANEL_X, PANEL_Y, PANEL_W, PANEL_H, 30);
        panel.lineStyle(2, T.goldDim, 0.55);
        panel.strokeRoundedRect(PANEL_X + 16, PANEL_Y + 16, PANEL_W - 32, PANEL_H - 32, 24);
        // corner filigree ticks
        panel.lineStyle(2, T.goldLight, 0.5);
        const tick = 34;
        for (const [cx, cy, dx, dy] of [
            [PANEL_X + 16, PANEL_Y + 16, 1, 1],
            [PANEL_X + PANEL_W - 16, PANEL_Y + 16, -1, 1],
            [PANEL_X + 16, PANEL_Y + PANEL_H - 16, 1, -1],
            [PANEL_X + PANEL_W - 16, PANEL_Y + PANEL_H - 16, -1, -1],
        ]) {
            panel.lineBetween(cx, cy + dy * 10, cx + dx * tick, cy + dy * 10);
            panel.lineBetween(cx + dx * 10, cy, cx + dx * 10, cy + dy * tick);
        }
        this.root.add(panel);

        // Panel shield: inside taps stop here, never reach the dim.
        this.panelShield = createPanelShield(s, PANEL_X + PANEL_W / 2, PANEL_Y + PANEL_H / 2, PANEL_W, PANEL_H);
        this.root.add(this.panelShield);

        /* ---- header: pagoda icon + NPC greeting ---- */
        const npc = this.realm.npc ?? { name: 'Tiên Nữ Hoa Giang', auraTint: 0xc9b2ff };
        const headerIconKey = s.textures.exists('icon_shop') ? 'icon_shop' : 'glow';
        const headerGlow = s.add.image(PANEL_X + 96, PANEL_Y + 96, 'glow')
            .setTint(0xdfb15b).setAlpha(0.4).setScale(1.5);
        const headerIcon = s.add.image(PANEL_X + 96, PANEL_Y + 96, headerIconKey);
        if (headerIconKey === 'icon_shop') headerIcon.setDisplaySize(116, 116);
        else headerIcon.setTint(0xdfb15b).setScale(0.62);
        this.root.add([headerGlow, headerIcon]);

        const title = addText(s, PANEL_X + PANEL_W / 2 + 20, PANEL_Y + 48, '⛩ HOA CÁC ⛩', {
            fontSize: '42px', color: T.textGold, fontStyle: 'bold',
            stroke: '#3a1c5e', strokeThickness: 8,
        }).setOrigin(0.5);
        const npcName = addText(s, PANEL_X + 190, PANEL_Y + 96, `${npc.name} — Chúa Hoa Các`, {
            fontSize: '22px', color: T.textSoft, fontStyle: 'bold',
            stroke: T.bgHex, strokeThickness: 4,
        }).setOrigin(0, 0.5);
        const greeting = addText(s, PANEL_X + 190, PANEL_Y + 130,
            '"Tiên hữu ghé thăm Hoa Các, cần tìm bảo giống gì?"', {
                fontSize: '21px', color: '#d8b98a', fontStyle: 'italic',
                wordWrap: { width: PANEL_W - 320 }, stroke: T.bgHex, strokeThickness: 3,
            }).setOrigin(0, 0.5);
        this.root.add([title, npcName, greeting]);

        /* ---- close ✕ ---- */
        const closeBtn = s.add.container(PANEL_X + PANEL_W - 50, PANEL_Y + 50);
        const closeBg = s.add.graphics();
        closeBg.fillStyle(T.card, 0.98);
        closeBg.lineStyle(3, T.gold, 0.9);
        closeBg.fillRoundedRect(-30, -30, 60, 60, 16);
        closeBg.strokeRoundedRect(-30, -30, 60, 60, 16);
        const closeLabel = addText(s, 0, 0, '✕', {
            fontFamily: 'Arial', fontSize: '34px', color: '#ffb0b0',
        }).setOrigin(0.5);
        const closeZone = s.add.zone(0, 0, 60, 60).setInteractive();
        closeZone.on('pointerdown', guarded(() => this.close()));
        closeBtn.add([closeBg, closeLabel, closeZone]);
        this.root.add(closeBtn);

        /* ---- quest hub: hand the gardener back to the NPC's quest dialog ---- */
        const questBtn = s.add.container(PANEL_X + PANEL_W - 178, PANEL_Y + 50);
        const questBg = s.add.graphics();
        questBg.fillStyle(T.card, 0.98);
        questBg.lineStyle(2, T.cyan, 0.85);
        questBg.fillRoundedRect(-82, -30, 164, 60, 16);
        questBg.strokeRoundedRect(-82, -30, 164, 60, 16);
        const questLabel = addText(s, 0, 0, '📜 Nhiệm Vụ', {
            fontSize: '20px', color: '#aef4ff', fontStyle: 'bold',
            stroke: T.bgHex, strokeThickness: 3,
        }).setOrigin(0.5);
        const questZone = s.add.zone(0, 0, 164, 60).setInteractive({ useHandCursor: true });
        questZone.on('pointerdown', guarded(() => {
            this.audio?.click?.();
            this.close();
            this.scene.openDialog?.();
        }));
        questBtn.add([questBg, questLabel, questZone]);
        this.root.add(questBtn);

        /* ---- tabs ---- */
        this.tabButtons = {};
        const tabIds = Object.keys(TABS);
        const tabW = 400;
        const tabGap = 30;
        const tabX0 = PANEL_X + PANEL_W / 2 - (tabW * tabIds.length + tabGap * (tabIds.length - 1)) / 2 + tabW / 2;
        tabIds.forEach((id, i) => {
            const cx = tabX0 + i * (tabW + tabGap);
            const cy = PANEL_Y + 236;
            const btn = s.add.container(cx, cy);
            const bg = s.add.graphics();
            const label = addText(s, 0, -12, TABS[id].label, {
                fontSize: '24px', color: T.textGold, fontStyle: 'bold',
                stroke: T.bgHex, strokeThickness: 4,
            }).setOrigin(0.5);
            const sub = addText(s, 0, 18, TABS[id].sub, {
                fontSize: '17px', color: T.textMuted,
                stroke: T.bgHex, strokeThickness: 3,
            }).setOrigin(0.5);
            const zone = s.add.zone(0, 0, tabW, 84).setInteractive({ useHandCursor: true });
            zone.on('pointerdown', guarded(() => {
                this.audio?.click?.();
                this.setTab(id);
            }));
            btn.add([bg, label, sub, zone]);
            this.root.add(btn);
            this.tabButtons[id] = { container: btn, bg };
        });

        /* ---- body: masked, scrollable row list ---- */
        this.content = s.add.container(0, 0);
        const maskG = s.make.graphics({ add: false });
        maskG.fillStyle(0xffffff, 1);
        maskG.fillRect(PANEL_X + 40, BODY.top, ROW_W + 30, BODY.h);
        this.bodyMask = maskG.createGeometryMask();
        this.content.setMask(this.bodyMask);
        this.root.add(this.content);

        // scroll affordances (above the mask, below the footer)
        this.fade = s.add.graphics();
        this.scrollHint = addText(s, PANEL_X + PANEL_W - 66, BODY.bottom - 22, '⇕', {
            fontSize: '26px', color: T.textMuted,
        }).setOrigin(0.5).setVisible(false);
        this.root.add([this.fade, this.scrollHint]);

        // drag surface for the body scroll
        const bodyZone = s.add.zone(PANEL_X + PANEL_W / 2, (BODY.top + BODY.bottom) / 2, ROW_W + 40, BODY.h)
            .setInteractive();
        bodyZone.on('pointerdown', (pointer, lx, ly, event) => {
            event?.stopPropagation?.();
            this.dragging = { y: pointer.y, from: this.scroll };
        });
        this.root.add(bodyZone);

        this.moveHandler = (p) => {
            if (!this.dragging || !this.visible) return;
            this.setScroll(this.dragging.from + (this.dragging.y - p.y));
        };
        this.releaseHandler = () => { this.dragging = null; };
        this.wheelHandler = (p, over, dx, dy) => {
            if (!this.visible) return;
            this.setScroll(this.scroll + dy * 0.6);
        };
        s.input.on('pointermove', this.moveHandler);
        s.input.on('pointerup', this.releaseHandler);
        s.input.on('wheel', this.wheelHandler);

        /* ---- footer: live balances ---- */
        this.footerBg = s.add.graphics();
        this.harmonyText = addText(s, PANEL_X + 60, PANEL_Y + PANEL_H - 76, '', {
            fontSize: '25px', color: T.textGold, fontStyle: 'bold',
            stroke: T.bgHex, strokeThickness: 4,
        }).setOrigin(0, 0.5);
        this.stonesText = addText(s, PANEL_X + PANEL_W - 60, PANEL_Y + PANEL_H - 76, '', {
            fontSize: '25px', color: '#e8d4ff', fontStyle: 'bold',
            stroke: T.bgHex, strokeThickness: 4,
        }).setOrigin(1, 0.5);
        this.root.add([this.footerBg, this.harmonyText, this.stonesText]);

        /* ---- react to economy movements published on the bus ---- */
        if (this.bus) {
            this.disposers.push(
                this.bus.on('economy:diamonds-changed', () => this.refresh(), { owner: 'garden-shop' }),
                this.bus.on('economy:currency-changed', () => this.refresh(), { owner: 'garden-shop' }),
                this.bus.on('economy:seed-purchased', () => this.refresh(), { owner: 'garden-shop' }),
            );
        }

        this.setTab(this.activeTab, true);
        return this;
    }

    /* ============================== TABS + ROWS ============================== */
    setTab(tabId, force = false) {
        if (!TABS[tabId]) tabId = 'seeds';
        if (!force && this.activeTab === tabId) return;
        this.activeTab = tabId;
        for (const [id, btn] of Object.entries(this.tabButtons)) {
            const active = id === tabId;
            btn.bg.clear();
            btn.bg.fillStyle(active ? 0x3a2810 : T.card, 0.98);
            btn.bg.lineStyle(active ? 4 : 2, active ? T.goldLight : T.goldDim, active ? 1 : 0.7);
            btn.bg.fillRoundedRect(-200, -42, 400, 84, 20);
            btn.bg.strokeRoundedRect(-200, -42, 400, 84, 20);
        }
        this.rebuildRows();
    }

    /** Seeds shown in the shop: standard catalog + active realm exclusives. */
    getShopSeeds() {
        const realmSeeds = getSeedsForRealm(this.realmId) ?? [];
        const seen = new Set();
        const list = [];
        for (const seed of [...SEED_CATALOG, ...realmSeeds]) {
            if (seen.has(seed.id)) continue;
            seen.add(seed.id);
            list.push(seed);
        }
        return list;
    }

    /** Đá Linh Khí price of a seed in the shop (realm seeds price off harmony). */
    seedStonesPrice(seedId) {
        if (REALM_SEED_BY_ID[seedId]) return Math.ceil(this.economy.getSeedHarmonyPrice(seedId) / 2);
        return this.economy.getSeedCost(seedId);
    }

    rebuildRows() {
        for (const row of this.rows) row.destroy();
        this.rows = [];
        this.scroll = 0;

        if (this.activeTab === 'seeds') {
            this.getShopSeeds().forEach((seed, i) => {
                const row = this.buildSeedRow(seed);
                row.setY(BODY.top + i * (ROW_H + ROW_GAP));
                this.rows.push(row);
                this.content.add(row);
            });
        } else {
            const sellable = [...SEED_CATALOG, ...REALM_SEEDS]
                .filter((seed) => (this.economy.getInventoryCount(seed.id) ?? 0) > 0);
            if (sellable.length) {
                sellable.forEach((seed, i) => {
                    const row = this.buildSellRow(seed);
                    row.setY(BODY.top + i * (ROW_H + ROW_GAP));
                    this.rows.push(row);
                    this.content.add(row);
                });
            } else {
                const empty = addText(this.scene, PANEL_X + PANEL_W / 2, BODY.top + 160,
                    'Kho hoa trống — thu hoạch rồi đến đây đổi báu ✿', {
                        fontSize: '24px', color: T.textMuted, fontStyle: 'italic',
                        align: 'center', wordWrap: { width: ROW_W - 60 },
                    }).setOrigin(0.5);
                this.rows.push(empty);
                this.content.add(empty);
            }
        }

        const contentBottom = BODY.top + Math.max(1, this.rows.length) * (ROW_H + ROW_GAP);
        this.scrollMax = Math.max(0, contentBottom - BODY.bottom);
        this.setScroll(0);
        this.refresh();
    }

    buildSeedRow(seed) {
        const s = this.scene;
        const container = s.add.container(PANEL_X + 55, 0);

        const bg = s.add.graphics();
        const draw = (selected) => {
            bg.clear();
            bg.fillStyle(selected ? 0x2e2440 : T.card, 0.96);
            bg.lineStyle(2, selected ? T.goldLight : T.goldDim, selected ? 1 : 0.7);
            bg.fillRoundedRect(0, 0, ROW_W, ROW_H, 18);
            bg.strokeRoundedRect(0, 0, ROW_W, ROW_H, 18);
        };
        draw(false);

        const isRealmSeed = !!REALM_SEED_BY_ID[seed.id];
        const thumbKey = s.textures.exists(seed.sprite_key) ? seed.sprite_key : 'glow';
        const glow = s.add.image(66, ROW_H / 2, 'glow').setTint(seed.petals).setAlpha(0.4).setScale(0.85);
        const thumb = s.add.image(66, ROW_H / 2, thumbKey).setDisplaySize(92, 92);
        if (thumbKey === 'glow') thumb.setTint(seed.petals).setScale(0.5);

        const nameColor = seed.rarity === 'legendary' ? '#ffe9a8' : seed.rarity === 'epic' ? '#aef4ff' : T.text;
        const name = addText(s, 130, 30, seed.name, {
            fontSize: '24px', color: nameColor, fontStyle: 'bold',
            stroke: T.bgHex, strokeThickness: 4,
        }).setOrigin(0, 0.5);
        const realmLabel = isRealmSeed ? ` · Bí Cảnh ${this.realm.name}` : ` · ${seed.colorName}`;
        const sub = addText(s, 130, 62, `${seed.english ?? ''}${realmLabel}`, {
            fontSize: '17px', color: T.textMuted,
            wordWrap: { width: 330 }, stroke: T.bgHex, strokeThickness: 3,
        }).setOrigin(0, 0.5);
        const owned = addText(s, 130, 104, '', {
            fontSize: '18px', color: '#dfffe0', fontStyle: 'bold',
            stroke: T.bgHex, strokeThickness: 3,
        }).setOrigin(0, 0.5);
        container.add([bg, glow, thumb, name, sub, owned]);

        /* ---- price buttons: 💎 stones (left) · ✿ harmony (right) ---- */
        const stonesPrice = this.seedStonesPrice(seed.id);
        const harmonyPrice = this.economy.getSeedHarmonyPrice(seed.id);
        const makePriceButton = (cx, symbol, price, tint, handler, affordKey) => {
            const btn = s.add.container(cx, ROW_H / 2);
            const btnBg = s.add.graphics();
            const label = addText(s, 0, 0, `${symbol} ${price}`, {
                fontSize: '20px', color: '#fff7dd', fontStyle: 'bold',
                stroke: T.bgHex, strokeThickness: 3,
            }).setOrigin(0.5);
            const zone = s.add.zone(0, 0, 150, 54).setInteractive({ useHandCursor: true });
            zone.on('pointerdown', guarded((pointer, lx, ly, event) => handler(event)));
            btn.add([btnBg, label, zone]);
            container.add(btn);
            return { btn, btnBg, label, affordKey };
        };

        const buyStones = () => this.buySeed(seed, 'stones');
        const buyHarmony = () => this.buySeed(seed, 'harmony');

        const stonesBtn = makePriceButton(ROW_W - 350, '💎', stonesPrice, T.gold, buyStones, 'stones');
        const harmonyBtn = makePriceButton(ROW_W - 180, '✿', harmonyPrice, 0xffd97a, buyHarmony, 'harmony');

        container.setData('seedId', seed.id);
        container.setData('buttons', [stonesBtn, harmonyBtn]);
        container.setData('ownedText', owned);
        container.setData('drawBg', draw);
        container.setData('seed', seed);
        return container;
    }

    buildSellRow(seed) {
        const s = this.scene;
        const container = s.add.container(PANEL_X + 55, 0);

        const bg = s.add.graphics();
        bg.fillStyle(T.card, 0.96);
        bg.lineStyle(2, T.goldDim, 0.7);
        bg.fillRoundedRect(0, 0, ROW_W, ROW_H, 18);
        bg.strokeRoundedRect(0, 0, ROW_W, ROW_H, 18);

        const thumbKey = s.textures.exists(seed.sprite_key) ? seed.sprite_key : 'glow';
        const glow = s.add.image(66, ROW_H / 2, 'glow').setTint(seed.petals).setAlpha(0.4).setScale(0.85);
        const thumb = s.add.image(66, ROW_H / 2, thumbKey).setDisplaySize(92, 92);
        if (thumbKey === 'glow') thumb.setTint(seed.petals).setScale(0.5);

        const name = addText(s, 130, 30, seed.name, {
            fontSize: '24px', color: T.text, fontStyle: 'bold',
            stroke: T.bgHex, strokeThickness: 4,
        }).setOrigin(0, 0.5);
        const value = this.economy.getSeedSellValue(seed.id);
        const sub = addText(s, 130, 62, `Đổi báu: +${value.harmony} ✿${value.stones ? ` +${value.stones} 💎` : ''} / hoa`, {
            fontSize: '17px', color: '#d8b98a',
            stroke: T.bgHex, strokeThickness: 3,
        }).setOrigin(0, 0.5);
        const owned = addText(s, 130, 104, '', {
            fontSize: '18px', color: '#dfffe0', fontStyle: 'bold',
            stroke: T.bgHex, strokeThickness: 3,
        }).setOrigin(0, 0.5);
        container.add([bg, glow, thumb, name, sub, owned]);

        const sellOneBtn = s.add.container(ROW_W - 330, ROW_H / 2);
        const sellOneBg = s.add.graphics();
        const sellOneLabel = addText(s, 0, 0, 'Đổi 1', {
            fontSize: '20px', color: '#fff7dd', fontStyle: 'bold',
            stroke: T.bgHex, strokeThickness: 3,
        }).setOrigin(0.5);
        const sellOneZone = s.add.zone(0, 0, 140, 54).setInteractive({ useHandCursor: true });
        sellOneZone.on('pointerdown', guarded(() => this.sellSeed(seed, 1)));
        sellOneBtn.add([sellOneBg, sellOneLabel, sellOneZone]);

        const sellAllBtn = s.add.container(ROW_W - 160, ROW_H / 2);
        const sellAllBg = s.add.graphics();
        const sellAllLabel = addText(s, 0, 0, 'Đổi hết', {
            fontSize: '20px', color: '#fff7dd', fontStyle: 'bold',
            stroke: T.bgHex, strokeThickness: 3,
        }).setOrigin(0.5);
        const sellAllZone = s.add.zone(0, 0, 140, 54).setInteractive({ useHandCursor: true });
        sellAllZone.on('pointerdown', guarded(() => this.sellSeed(seed, Infinity)));
        sellAllBtn.add([sellAllBg, sellAllLabel, sellAllZone]);

        container.add([sellOneBtn, sellAllBtn]);
        container.setData('seedId', seed.id);
        container.setData('ownedText', owned);
        container.setData('sellButtons', [
            { btnBg: sellOneBg, label: sellOneLabel },
            { btnBg: sellAllBg, label: sellAllLabel },
        ]);
        return container;
    }

    /* ============================== TRANSACTIONS ============================== */
    buySeed(seed, currency) {
        const economy = this.economy;
        const isRealmSeed = !!REALM_SEED_BY_ID[seed.id];
        const stonesPrice = this.seedStonesPrice(seed.id);
        let result;
        if (currency === 'harmony') {
            result = isRealmSeed
                ? (() => {
                    const pay = economy.spendHarmony(economy.getSeedHarmonyPrice(seed.id), 'shop:seed-harmony');
                    if (!pay.success) return { success: false, cost: pay.cost, have: pay.have, message: pay.message };
                    const owned = economy.grantSeed(seed.id);
                    return { success: true, cost: pay.cost, owned, message: `Mua thành công! (-${pay.cost} ✿ Hòa Hợp)` };
                })()
                : economy.purchaseSeedWithHarmony(seed.id);
        } else {
            result = isRealmSeed
                ? (() => {
                    const pay = economy.spendDiamonds(stonesPrice, 'shop:seed-stones');
                    if (!pay.success) return { success: false, cost: pay.cost, have: pay.have, message: pay.message };
                    const owned = economy.grantSeed(seed.id);
                    return { success: true, cost: pay.cost, owned, message: `Mua thành công! (-${pay.cost} 💎 Đá Linh Khí)` };
                })()
                : economy.purchaseSeed(seed.id);
        }

        if (!result.success) {
            this.audio?.click?.(0);
            this.toast(result.message || 'Giao dịch thất bại', 0xffb0b0);
            this.scene.showNotice?.({
                title: currency === 'harmony' ? 'Thiếu Hòa Hợp' : 'Thiếu Đá Linh Khí',
                message: result.message,
                tone: 'warn',
            });
            this.refresh();
            return result;
        }
        this.audio?.chime?.(1046.5, { gain: 0.07 });
        this.toast(`${result.message} · ${seed.name}`, 0xdfb15b);
        this.refresh();
        this.onTransaction?.();
        return result;
    }

    sellSeed(seed, qty) {
        const result = this.economy.sellFlower(seed.id, qty);
        if (!result.success) {
            this.audio?.click?.(0);
            this.toast(result.message, 0xffb0b0);
            this.refresh();
            return result;
        }
        this.audio?.chime?.(783.99, { gain: 0.07 });
        this.audio?.chime?.(1174.66, { gain: 0.05, when: 0.1 });
        this.toast(`Tiên Thiên Đổi Báu · +${result.harmony} ✿${result.spiritStones ? ` +${result.spiritStones} 💎` : ''} (${seed.name} ×${result.sold})`, 0x4fd1a5);
        this.rebuildRows();
        this.onTransaction?.();
        return result;
    }

    /* ============================== REFRESH ============================== */
    /** Re-read balances, owned counts and affordability on every visible row. */
    refresh() {
        if (!this.root) return;
        this.harmonyText.setText(`✿ Hòa Hợp: ${this.economy.harmony}`);
        this.stonesText.setText(`💎 Đá Linh Khí: ${this.economy.spiritStones}`);
        this.footerBg.clear();
        this.footerBg.fillStyle(T.cardDeep, 0.96);
        this.footerBg.lineStyle(2, T.goldDim, 0.6);
        this.footerBg.fillRoundedRect(PANEL_X + 34, PANEL_Y + PANEL_H - 116, PANEL_W - 68, 76, 18);
        this.footerBg.strokeRoundedRect(PANEL_X + 34, PANEL_Y + PANEL_H - 116, PANEL_W - 68, 76, 18);

        for (const row of this.rows) {
            const seedId = row.getData?.('seedId');
            if (!seedId) continue; // the empty-state text row
            const ownedText = row.getData('ownedText');
            const owned = this.economy.getInventoryCount(seedId);
            if (ownedText) ownedText.setText(`Sở hữu: ${owned}`).setColor(owned > 0 ? '#dfffe0' : '#9a8cb0');

            const buttons = row.getData('buttons');
            if (buttons) {
                for (const { btnBg, label, affordKey } of buttons) {
                    const price = affordKey === 'harmony'
                        ? this.economy.getSeedHarmonyPrice(seedId)
                        : this.seedStonesPrice(seedId);
                    const balance = affordKey === 'harmony' ? this.economy.harmony : this.economy.spiritStones;
                    const afford = price === 0 || balance >= price;
                    btnBg.clear();
                    btnBg.fillStyle(afford ? 0x7a4a1e : 0x3a3050, 0.98);
                    btnBg.lineStyle(2, afford ? T.goldLight : 0x6a5a80, afford ? 1 : 0.8);
                    btnBg.fillRoundedRect(-75, -27, 150, 54, 16);
                    btnBg.strokeRoundedRect(-75, -27, 150, 54, 16);
                    label.setColor(afford ? '#fff7dd' : '#9a8cb0');
                }
            }
            const sellButtons = row.getData('sellButtons');
            if (sellButtons) {
                const afford = owned > 0;
                for (const { btnBg, label } of sellButtons) {
                    btnBg.clear();
                    btnBg.fillStyle(afford ? 0x1f4a38 : 0x3a3050, 0.98);
                    btnBg.lineStyle(2, afford ? 0x7dffb6 : 0x6a5a80, afford ? 1 : 0.8);
                    btnBg.fillRoundedRect(-70, -27, 140, 54, 16);
                    btnBg.strokeRoundedRect(-70, -27, 140, 54, 16);
                    label.setColor(afford ? '#dffff0' : '#9a8cb0');
                }
            }
        }
    }

    /* ============================== SCROLL ============================== */
    setScroll(value) {
        this.scroll = Math.max(0, Math.min(value, this.scrollMax));
        this.content.setY(-this.scroll);
        const canScroll = this.scrollMax > 0;
        const atEnd = this.scroll >= this.scrollMax - 0.5;
        this.scrollHint.setVisible(canScroll);
        this.fade.setVisible(canScroll && !atEnd);
        if (canScroll && !atEnd) {
            this.fade.clear();
            this.fade.fillGradientStyle(T.bg, T.bg, T.bg, T.bg, 0, 0, 0.95, 0.95);
            this.fade.fillRect(PANEL_X + 40, BODY.bottom - 34, ROW_W + 30, 34);
        }
        return this.scroll;
    }

    /* ============================== LIFECYCLE ============================== */
    /** Transient banner inside the panel (deliberately below the header). */
    toast(message, tint = 0xdfb15b) {
        if (!this.root) return;
        const s = this.scene;
        const y = PANEL_Y + 296;
        const banner = addText(s, PANEL_X + PANEL_W / 2, y, message, {
            fontSize: '22px', color: '#ffe9a8', fontStyle: 'bold',
            align: 'center', wordWrap: { width: PANEL_W - 160 },
            stroke: '#3a1c5e', strokeThickness: 5,
        }).setOrigin(0.5).setScale(0.8).setAlpha(0);
        const glow = s.add.image(PANEL_X + PANEL_W / 2, y, 'glow')
            .setTint(tint).setAlpha(0.3).setScale(3.2, 0.9);
        this.root.add([glow, banner]);
        s.tweens.add({
            targets: [banner, glow], alpha: { from: 0, to: 1 }, scale: { from: 0.85, to: 1 },
            duration: 220, ease: 'Back.easeOut',
            onComplete: () => {
                s.tweens.add({
                    targets: [banner, glow], alpha: 0, delay: 1400, duration: 380,
                    onComplete: () => { banner.destroy(); glow.destroy(); },
                });
            },
        });
    }

    open(tab = 'seeds') {
        if (!this.root) this.create();
        if (TABS[tab]) this.setTab(tab, this.activeTab === tab);
        this.visible = true;
        this.audio?.click?.();
        this.refresh();
        this.root.setVisible(true).setAlpha(0).setScale(0.94);
        this.scene.tweens.killTweensOf(this.root);
        this.scene.tweens.add({
            targets: this.root,
            alpha: 1,
            scale: 1,
            duration: 280,
            ease: 'Back.easeOut',
        });
        return this;
    }

    close() {
        if (!this.root || !this.visible) return this;
        this.visible = false;
        this.dragging = null;
        this.audio?.click?.();
        this.scene.tweens.killTweensOf(this.root);
        this.scene.tweens.add({
            targets: this.root,
            alpha: 0,
            scale: 0.95,
            duration: 190,
            ease: 'Cubic.easeIn',
            onComplete: () => this.root?.setVisible(false).setScale(1),
        });
        return this;
    }

    toggle() { return this.visible ? this.close() : this.open(); }
    isOpen() { return this.visible; }

    getPanelWorldRect() {
        return localRectToWorld(this.root, PANEL_X, PANEL_Y, PANEL_W, PANEL_H);
    }

    /** Layout + state snapshot for the test suite / debug overlays. */
    getSnapshot() {
        return {
            open: this.visible,
            activeTab: this.activeTab,
            rowCount: this.rows.length,
            scroll: this.scroll,
            scrollMax: this.scrollMax,
            bodyMaxH: BODY.h,
            balance: {
                harmony: this.economy?.harmony ?? 0,
                spiritStones: this.economy?.spiritStones ?? 0,
            },
            depth: this.root?.depth ?? LAYERS.SHOP,
            aboveAmbient: (this.root?.depth ?? LAYERS.SHOP) > LAYERS.AMBIENT,
        };
    }

    destroy() {
        const s = this.scene;
        if (this.bus) for (const off of this.disposers) off();
        this.disposers = [];
        if (this.moveHandler) s.input?.off?.('pointermove', this.moveHandler);
        if (this.releaseHandler) s.input?.off?.('pointerup', this.releaseHandler);
        if (this.wheelHandler) s.input?.off?.('wheel', this.wheelHandler);
        this.moveHandler = this.releaseHandler = this.wheelHandler = null;
        for (const row of this.rows) row.destroy();
        this.rows = [];
        this.root?.destroy(true);
        this.root = null;
        this.visible = false;
    }
}

export default GardenShopModal;
