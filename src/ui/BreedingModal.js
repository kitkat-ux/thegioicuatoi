/**
 * BreedingModal — classical Guofeng pollination workshop.
 *
 * The widget owns presentation only. BreedingManager remains the authority for
 * rules; the optional inventoryProvider lets the modal stay decoupled from a
 * GardenScene or EconomySystem.
 */
import Phaser from 'phaser';
import { EVENTS } from '../systems/EventManager.js';
import { DIALOG_FONT } from '../systems/DialogSystem.js';
import { createModalBlocker, hideModalChrome, makeCloseLayer, showModalChrome } from './modalInput.js';

const W = 920;
const H = 1180;
const GOLD = 0xdfb15b;
const INK = 0x25143b;

export class BreedingModal {
    constructor(scene, { breeding, bus = null, inventoryProvider = () => [], audio = null } = {}) {
        if (!scene) throw new TypeError('BreedingModal requires a Phaser scene');
        if (!breeding) throw new TypeError('BreedingModal requires a BreedingManager');
        this.scene = scene; this.breeding = breeding; this.bus = bus;
        this.inventoryProvider = inventoryProvider; this.audio = audio;
        this.nodes = []; this.selected = [null, null]; this.query = ''; this.opened = false;
        this.disposers = [];
    }

    create() {
        const s = this.scene;
        /* modal depth contract (HUD punch-through fix, see modalInput.js):
           blocker 9000 · window 9500 (this root) · close 9999 */
        this.root = s.add.container(540, 960).setDepth(9500).setVisible(false);
        this.shade = createModalBlocker(s, { x: 540, y: 960, width: 1080, height: 1920, color: 0x110a22, alpha: 0.76 });
        const panel = s.add.graphics();
        panel.fillStyle(0xf4e5c2, 1).fillRoundedRect(-W / 2, -H / 2, W, H, 26);
        panel.lineStyle(8, GOLD, 1).strokeRoundedRect(-W / 2, -H / 2, W, H, 26);
        panel.lineStyle(2, 0x8a5fa8, 0.8).strokeRoundedRect(-W / 2 + 18, -H / 2 + 18, W - 36, H - 36, 18);
        this.title = s.add.text(0, -H / 2 + 58, 'Linh Hoa Dị Biến', { fontFamily: DIALOG_FONT, fontSize: '42px', color: '#4b2864', fontStyle: 'bold' }).setOrigin(.5);
        this.subtitle = s.add.text(0, -H / 2 + 108, 'Ghép đôi hoa trưởng thành · 15% cơ hội đột biến', { fontFamily: DIALOG_FONT, fontSize: '22px', color: '#795b49' }).setOrigin(.5);
        // close × — top-level at LAYERS.MODAL_CLOSE (9999), world-positioned
        this.closeButton = makeCloseLayer(s, s.add.text(540 + W / 2 - 48, 960 - H / 2 + 35, '×', { fontSize: '44px', color: '#5d356f' }).setOrigin(.5).setInteractive({ useHandCursor: true }));
        this.closeButton.on('pointerdown', () => this.close());
        this.search = s.add.dom(0, -H / 2 + 165, 'input', { width: '530px', height: '48px', fontSize: '22px', padding: '8px 16px', border: '2px solid #b89158', borderRadius: '22px', background: '#fffaf0', color: '#33224a' }, '').setOrigin(.5);
        this.search.node.placeholder = 'Tìm hoa trưởng thành...';
        this.search.node.addEventListener('input', () => { this.query = this.search.node.value; this.refreshList(); });
        this.list = s.add.container(-W / 2 + 58, -H / 2 + 205);
        this.slotA = this.makeSlot(-215, -H / 2 + 335, 'Cha A');
        this.slotB = this.makeSlot(215, -H / 2 + 335, 'Cha B');
        this.preview = s.add.text(0, -H / 2 + 465, '◇  Chọn hai linh hoa để xem điềm lai tạo  ◇', { fontFamily: DIALOG_FONT, fontSize: '24px', color: '#633d70', align: 'center', wordWrap: { width: 700 } }).setOrigin(.5);
        this.action = s.add.text(0, -H / 2 + 535, 'Thỉnh Linh Lai Tạo', { fontFamily: DIALOG_FONT, fontSize: '27px', color: '#fff7dd', backgroundColor: '#8a5fa8', padding: { left: 30, right: 30, top: 13, bottom: 13 } }).setOrigin(.5).setInteractive({ useHandCursor: true });
        this.action.on('pointerdown', () => this.attempt());
        this.hint = s.add.text(0, -H / 2 + 620, '', { fontFamily: DIALOG_FONT, fontSize: '20px', color: '#795b49', align: 'center' }).setOrigin(.5);
        this.root.add([panel, this.title, this.subtitle, this.search, this.list, this.slotA, this.slotB, this.preview, this.action, this.hint]);
        this.disposers.push(this.bus?.on(EVENTS.BREEDING_SUCCESS, (data) => this.showSuccess(data), { owner: this }) ?? (() => {}));
        this.refreshList();
        return this;
    }

    makeSlot(x, y, label) {
        const c = this.scene.add.container(x, y);
        const g = this.scene.add.graphics().fillStyle(0xfff8e9, 1).lineStyle(3, 0xb89158, 1).fillRoundedRect(-165, -72, 330, 144, 16).strokeRoundedRect(-165, -72, 330, 144, 16);
        const t = this.scene.add.text(0, 0, label, { fontFamily: DIALOG_FONT, fontSize: '25px', color: '#74506d', align: 'center', wordWrap: { width: 285 } }).setOrigin(.5);
        c.add([g, t]); c.label = t; return c;
    }

    refreshList() {
        if (!this.list) return;
        this.list.removeAll(true);
        const flowers = this.breeding.getMatureFlowers(this.inventoryProvider(), this.query);
        flowers.slice(0, 8).forEach((flower, i) => {
            const y = i * 63;
            const row = this.scene.add.text(0, y, `✿  ${flower.name ?? flower.seedId ?? flower.id}`, { fontFamily: DIALOG_FONT, fontSize: '22px', color: '#3d2851', backgroundColor: '#ead9b8', padding: { left: 16, right: 16, top: 10, bottom: 10 }, fixedWidth: W - 116 }).setInteractive({ useHandCursor: true });
            row.on('pointerdown', () => this.select(flower)); this.list.add(row);
        });
        if (!flowers.length) this.list.add(this.scene.add.text(0, 0, 'Chưa có hoa trưởng thành phù hợp.', { fontFamily: DIALOG_FONT, fontSize: '22px', color: '#876e63' }));
    }

    select(flower) {
        const slot = this.selected[0] ? 1 : 0;
        this.selected[slot] = flower;
        if (this.selected[0] && this.selected[1] && this.selected[0] === this.selected[1]) this.selected[1] = null;
        const labels = [this.slotA.label, this.slotB.label];
        this.selected.forEach((f, i) => labels[i].setText(f ? (f.name ?? f.seedId ?? f.id) : `Cha ${i ? 'B' : 'A'}`));
        this.updatePreview();
    }

    updatePreview() {
        const [a, b] = this.selected;
        const recipe = a && b ? this.breeding.findRecipe(a, b) : null;
        this.preview.setText(recipe ? `✦ Điềm lành: ${recipe.result.name}\nTỷ lệ đột biến cơ bản: 15%` : '◇  Chọn hai linh hoa thuộc cùng một gia phả để xem điềm lai tạo  ◇');
        this.action.setAlpha(a && b && recipe ? 1 : .55);
    }

    attempt() {
        if (!this.selected[0] || !this.selected[1]) return;
        const result = this.breeding.crossPollinate(this.selected[0], this.selected[1]);
        if (!result.success) { this.hint.setText('Linh khí chưa hội tụ. Hãy thử lại vào kỳ trăng sau.'); return; }
        // EventManager normally calls showSuccess; this fallback also works with a
        // manager configured without a bus.
        if (!this.bus) this.showSuccess(result);
    }

    showSuccess(data) {
        this.hint.setText(`✧ Lai tạo thành công: ${data.result.name} · Hạt giống mới đã khám phá ✧`).setColor('#7a4a1e');
        this.scene.tweens.add({ targets: [this.preview, this.action], alpha: { from: .2, to: 1 }, scale: { from: .9, to: 1.08 }, duration: 420, yoyo: true, repeat: 2, ease: 'Sine.easeInOut' });
        this.audio?.pluck?.(880, { gain: .12 });
    }

    open() {
        this.opened = true;
        showModalChrome(this.scene, { blocker: this.shade, window: this.root, close: this.closeButton }, { popScale: 0 });
        this.refreshList();
        return this;
    }
    close() {
        this.opened = false;
        hideModalChrome(this.scene, { blocker: this.shade, window: this.root, close: this.closeButton }, { popScale: 0 });
        return this;
    }
    isOpen() { return this.opened; }
    destroy() {
        this.disposers.forEach((off) => off());
        this.shade?.destroy();
        this.closeButton?.destroy();
        this.root?.destroy(true);
        this.shade = this.closeButton = null;
        this.opened = false;
    }
}

export default BreedingModal;
