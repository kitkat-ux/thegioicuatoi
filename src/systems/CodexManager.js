/**
 * CodexManager — System 9: VẠN HOA ĐỒ GIÁM (Flora Codex / Bách Thảo Đồ Giám).
 *
 * Pure data + rules module (no Phaser, no DOM) so it is unit-testable in plain
 * Node, exactly like EconomySystem / DialogSystem.
 *
 * What it records
 *  - which flower species the player has successfully grown (discovered),
 *  - bloom + harvest counts per species, first-bloom timestamps, best streak,
 *  - which lore poems have been unlocked (the scroll writes a poem on the
 *    first bloom of a species, and a second "đề thi" verse at mastery tier 2),
 *  - collection milestones → titles, tool skins and codex-wide buffs,
 *  - per-species mastery buffs (Mộc Dịch / Linh Căn / Thiên Hương).
 *
 * How it talks to the rest of the game: ONLY through the EventManager bus.
 * `bind(bus)` subscribes to FLOWER_BLOOMED / FLOWER_HARVESTED and publishes
 * CODEX_* events; GardenScene applies the resulting rewards and buffs.
 */
import {
    CODEX_LORE,
    CODEX_MILESTONES,
    MASTERY_TIERS,
    FULL_COLLECTION_POEM,
} from '../data/codexLore.js';
import { EVENTS } from './EventManager.js';

export class CodexManager {
    constructor({
        lore = CODEX_LORE,
        tiers = MASTERY_TIERS,
        milestones = CODEX_MILESTONES,
        fullPoem = FULL_COLLECTION_POEM,
    } = {}) {
        this.lore = lore;
        this.tiers = tiers;
        this.milestones = milestones;
        this.fullPoem = fullPoem;
        this.bus = null;
        this._disposers = [];
        this.init();
    }

    /** Fresh scroll: one empty page per known species. */
    init() {
        this.entries = {};
        for (const seedId of Object.keys(this.lore)) this._newEntry(seedId);
        this.totalBlooms = 0;
        this.totalHarvests = 0;
        this.unlockedMilestones = new Set();
        this.titles = [];
        this.skins = new Set();
        this.fullPoemUnlocked = false;
        this.revision = 0; // bumped on every mutation (UI refresh signal)
    }

    _newEntry(seedId) {
        return (this.entries[seedId] = {
            seedId,
            discovered: false,
            blooms: 0,
            harvests: 0,
            tiersUnlocked: [],
            firstBloomAt: null,
            lastBloomAt: null,
            poemUnlocked: false,
            verseUnlocked: false,
        });
    }

    /* ----------------------------- bus wiring ----------------------------- */

    /**
     * Listen to the game bus. Discovery/harvest bookkeeping becomes automatic.
     * @param {import('./EventManager.js').EventManager} bus
     */
    bind(bus) {
        this.unbind();
        if (!bus) return this;
        this.bus = bus;
        this._disposers.push(
            bus.on(EVENTS.FLOWER_BLOOMED, (p) => this.recordBloom(p.seedId), { owner: 'codex' }),
            bus.on(EVENTS.FLOWER_HARVESTED, (p) => this.recordHarvest(p.seedId), { owner: 'codex' }),
        );
        return this;
    }

    unbind() {
        if (this.bus) for (const off of this._disposers) off();
        this._disposers = [];
        this.bus = null;
        return this;
    }

    _publish(event, payload) {
        if (this.bus && typeof this.bus.emit === 'function') this.bus.emit(event, payload);
    }

    /* ------------------------------- records ------------------------------ */

    has(seedId) {
        return !!this.entries[seedId];
    }

    isDiscovered(seedId) {
        const e = this.entries[seedId];
        return !!e && e.discovered === true;
    }

    /** First successful bloom of a species = discovery. */
    recordBloom(seedId) {
        if (!this.has(seedId)) return null;
        const entry = this.entries[seedId];
        entry.blooms++;
        entry.lastBloomAt = Date.now();
        this.totalBlooms++;
        this.revision++;

        const discoveredNow = !entry.discovered;
        if (discoveredNow) {
            entry.discovered = true;
            entry.firstBloomAt = entry.lastBloomAt;
            entry.poemUnlocked = true; // the scroll writes the poem on first bloom
        }
        this._checkTier(entry);
        if (discoveredNow) {
            this._publish(EVENTS.CODEX_SPECIES_DISCOVERED, {
                seedId,
                lore: this.getLore(seedId),
                discovered: this.getDiscoveredCount(),
                total: this.size(),
            });
        }
        // milestones may flip on discovery count; publish after so the UI
        // refresh that follows already carries the new buffs.
        this._checkMilestones();
        this._publish(EVENTS.CODEX_ENTRY_UPDATED, { seedId, entry: { ...entry }, discoveredNow });
        return entry;
    }

    /** Harvests drive the per-species mastery tiers (and the second verse). */
    recordHarvest(seedId) {
        if (!this.has(seedId)) return null;
        const entry = this.entries[seedId];
        entry.harvests++;
        this.totalHarvests++;
        if (!entry.discovered) {
            // harvesting without a recorded bloom still counts as knowledge
            entry.discovered = true;
            entry.firstBloomAt = Date.now();
            entry.poemUnlocked = true;
            this._checkMilestones();
        }
        this._checkTier(entry);
        this._checkMilestones();
        this.revision++;
        this._publish(EVENTS.CODEX_ENTRY_UPDATED, { seedId, entry: { ...entry } });
        return entry;
    }

    /** Unlock every mastery tier the entry now qualifies for. */
    _checkTier(entry) {
        let changed = false;
        for (const tier of this.tiers) {
            if (entry.tiersUnlocked.includes(tier.key)) continue;
            if (entry.harvests >= tier.atHarvests) {
                entry.tiersUnlocked.push(tier.key);
                if (tier.key === 'linh_can') entry.verseUnlocked = true;
                changed = true;
            }
        }
        if (changed) this._publish(EVENTS.CODEX_BUFFS_CHANGED, { reason: 'tier', seedId: entry.seedId });
        return changed;
    }

    /** Unlock collection milestones; returns true if any newly unlocked. */
    _checkMilestones() {
        const count = this.getDiscoveredCount();
        let any = false;
        for (const m of this.milestones) {
            if (this.unlockedMilestones.has(m.id) || count < m.at) continue;
            this.unlockedMilestones.add(m.id);
            this.titles.push(m.title);
            if (m.effect?.skin) this.skins.add(m.effect.skin);
            if (m.effect?.poem) this.fullPoemUnlocked = true;
            any = true;
            this.revision++;
            this._publish(EVENTS.CODEX_MILESTONE, {
                id: m.id,
                title: m.title,
                rewardText: m.rewardText,
                rewards: codexMilestoneRewards(m),
            });
        }
        return any;
    }

    /* ------------------------------- queries ------------------------------ */

    size() {
        return Object.keys(this.entries).length;
    }

    getDiscoveredCount() {
        let n = 0;
        for (const id of Object.keys(this.entries)) if (this.entries[id].discovered) n++;
        return n;
    }

    getLore(seedId) {
        return this.lore[seedId] || null;
    }

    getEntry(seedId) {
        return this.entries[seedId] || null;
    }

    /**
     * Every species page for the modal UI, in catalog order, merged with its
     * lore + tier/poem state. Locked pages are returned too (shown as blanks).
     */
    getPages() {
        return Object.keys(this.entries).map((seedId) => {
            const entry = this.entries[seedId];
            const lore = this.lore[seedId] || {};
            return {
                ...entry,
                lore,
                unlockedTiers: this.tiers.filter((t) => entry.tiersUnlocked.includes(t.key)),
                nextTier: this.tiers.find((t) => !entry.tiersUnlocked.includes(t.key)) || null,
                poem: entry.poemUnlocked ? lore.poem || null : null,
                verse: entry.verseUnlocked ? lore.verse || null : null,
            };
        });
    }

    /** Tier definition lookup. */
    getTier(key) {
        return this.tiers.find((t) => t.key === key) || null;
    }

    /** Milestone rows for the modal (with unlocked flags). */
    getMilestoneRows() {
        return this.milestones.map((m) => ({ ...m, unlocked: this.unlockedMilestones.has(m.id) }));
    }

    /** Highest granted title (or null while the scroll is empty). */
    getTitle() {
        return this.titles.length ? this.titles[this.titles.length - 1] : null;
    }

    hasSkin(skinKey) {
        return this.skins.has(skinKey);
    }

    /**
     * Aggregated buffs actually consumed by GardenScene.
     * growthMult < 1 means faster growth (delay multiplier).
     */
    getBuffs() {
        const buffs = {
            harmonyMult: 1,
            growthMult: 1,
            harmonyBonusBySeed: {},
            stoneBonusBySeed: {},
            nightGlowSeeds: [],
            skins: [...this.skins],
            titles: [...this.titles],
        };
        for (const m of this.milestones) {
            if (!this.unlockedMilestones.has(m.id)) continue;
            const fx = m.effect || {};
            if (fx.harmonyMult) buffs.harmonyMult += fx.harmonyMult;
            if (fx.growthMult) buffs.growthMult = Math.min(buffs.growthMult, fx.growthMult);
            if (fx.stoneBonus) buffs.stoneFlat = (buffs.stoneFlat || 0) + fx.stoneBonus;
        }
        for (const seedId of Object.keys(this.entries)) {
            const entry = this.entries[seedId];
            let harmony = 0;
            let stones = 0;
            for (const key of entry.tiersUnlocked) {
                const tier = this.getTier(key);
                if (!tier) continue;
                harmony += tier.effect.harmonyBonus || 0;
                stones += tier.effect.stoneBonus || 0;
                if (tier.effect.nightGlow && !buffs.nightGlowSeeds.includes(seedId)) {
                    buffs.nightGlowSeeds.push(seedId);
                }
            }
            if (harmony) buffs.harmonyBonusBySeed[seedId] = harmony;
            if (stones) buffs.stoneBonusBySeed[seedId] = stones;
        }
        return buffs;
    }

    /** Flat, human-readable buff list for the "Buff kích hoạt" section. */
    getActiveBuffs() {
        const out = [];
        const buffs = this.getBuffs();
        if (buffs.harmonyMult > 1) {
            out.push({
                id: 'harmony_mult',
                label: 'Hương Ước',
                detail: `+${Math.round((buffs.harmonyMult - 1) * 100)}% Điểm Hòa Hợp mỗi lần thu hoạch`,
                source: 'Số loài đã sưu tập',
            });
        }
        if (buffs.stoneFlat) {
            out.push({
                id: 'stone_flat',
                label: 'Linh Mạch',
                detail: `+${buffs.stoneFlat} 💎 Đá Linh Khí mỗi lần thu hoạch`,
                source: 'Mốc Bách Thảo Tri Âm',
            });
        }
        if (buffs.growthMult < 1) {
            out.push({
                id: 'growth',
                label: 'Xuân Phù',
                detail: `Hoa nở nhanh hơn ${Math.round((1 - buffs.growthMult) * 100)}%`,
                source: 'Mốc sưu tập cao',
            });
        }
        for (const seedId of Object.keys(buffs.harmonyBonusBySeed)) {
            const lore = this.lore[seedId] || {};
            out.push({
                id: `seed_harmony_${seedId}`,
                label: `${lore.scrollTitle || seedId} · Mộc Dịch/Thiên Hương`,
                detail: `+${buffs.harmonyBonusBySeed[seedId]} ✿ cho loài này`,
                source: 'Thành thạo thu hoạch',
            });
        }
        for (const seedId of Object.keys(buffs.stoneBonusBySeed)) {
            const lore = this.lore[seedId] || {};
            out.push({
                id: `seed_stone_${seedId}`,
                label: `${lore.scrollTitle || seedId} · Linh Căn`,
                detail: `+${buffs.stoneBonusBySeed[seedId]} 💎 cho loài này`,
                source: 'Thành thạo thu hoạch',
            });
        }
        if (buffs.nightGlowSeeds.length) {
            out.push({
                id: 'night_glow',
                label: 'Dạ Quang',
                detail: 'Hoa Thiên Hương tự tỏa sáng dịu mắt khi đêm xuống',
                source: 'Thành thạo bậc 3',
            });
        }
        if (this.fullPoemUnlocked) {
            out.push({
                id: 'full_poem',
                label: 'Vạn Hoa Ca',
                detail: 'Trục thư đã chép đủ năm loài — bài thơ đầy đủ hiển thị cuối cuộn',
                source: 'Hoàn thành sưu tập',
            });
        }
        return out;
    }

    /**
     * Per-harvest modifiers GardenScene folds into the economy reward.
     * @returns {{harmonyBonus:number, stoneBonus:number, harmonyMult:number, nightGlow:boolean}}
     */
    getHarvestBonus(seedId, { night = false } = {}) {
        const buffs = this.getBuffs();
        return {
            harmonyBonus: buffs.harmonyBonusBySeed[seedId] || 0,
            stoneBonus: (buffs.stoneBonusBySeed[seedId] || 0) + (buffs.stoneFlat || 0),
            harmonyMult: buffs.harmonyMult,
            nightGlow: buffs.nightGlowSeeds.includes(seedId) && night,
        };
    }

    /** Growth-delay multiplier for a bloom sequence (1 = default). */
    getGrowthMultiplier() {
        return this.getBuffs().growthMult;
    }

    /** Progress summary for the HUD button / modal header. */
    getProgress() {
        const discovered = this.getDiscoveredCount();
        return {
            discovered,
            total: this.size(),
            blooms: this.totalBlooms,
            harvests: this.totalHarvests,
            title: this.getTitle(),
            complete: discovered === this.size(),
            percent: this.size() ? Math.round((discovered / this.size()) * 100) : 0,
        };
    }

    /* ---------------------------- persistence ---------------------------- */

    serialize() {
        return {
            revision: this.revision,
            totalBlooms: this.totalBlooms,
            totalHarvests: this.totalHarvests,
            unlockedMilestones: [...this.unlockedMilestones],
            titles: [...this.titles],
            skins: [...this.skins],
            fullPoemUnlocked: this.fullPoemUnlocked,
            entries: Object.fromEntries(
                Object.keys(this.entries).map((id) => [id, { ...this.entries[id] }]),
            ),
        };
    }

    deserialize(data) {
        if (!data) return this;
        this.init();
        this.revision = data.revision ?? 0;
        this.totalBlooms = data.totalBlooms ?? 0;
        this.totalHarvests = data.totalHarvests ?? 0;
        this.unlockedMilestones = new Set(data.unlockedMilestones ?? []);
        this.titles = [...(data.titles ?? [])];
        this.skins = new Set(data.skins ?? []);
        this.fullPoemUnlocked = !!data.fullPoemUnlocked;
        for (const [seedId, saved] of Object.entries(data.entries ?? {})) {
            if (!this.entries[seedId]) this._newEntry(seedId);
            Object.assign(this.entries[seedId], saved);
        }
        return this;
    }
}

/** Reward descriptors carried on the CODEX_MILESTONE event payload. */
export function codexMilestoneRewards(milestone) {
    const rewards = [];
    if (milestone.harmony) rewards.push({ type: 'harmony', amount: milestone.harmony });
    if (milestone.effect?.skin) rewards.push({ type: 'skin', key: milestone.effect.skin });
    if (milestone.effect?.poem) rewards.push({ type: 'poem', key: 'wan_hoa_ca' });
    return rewards;
}

export default CodexManager;
