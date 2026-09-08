// Pure-logic smoke tests (no browser needed): isometric math + search filter + economy + dialog.
import fs from 'fs';
import path from 'path';
import { IsoMath } from '../src/core/IsoMath.js';
import { LAYERS } from '../src/core/Layers.js';
import { SEED_CATALOG, normalizeText, SEED_BY_ID } from '../src/data/seedCatalog.js';
import { CODEX_LORE, MASTERY_TIERS, CODEX_MILESTONES, FULL_COLLECTION_POEM } from '../src/data/codexLore.js';
import { EconomySystem, SEED_RARITY, QUESTS, ECONOMY_DEFAULTS } from '../src/systems/EconomySystem.js';
import { DialogSystem, NPC_DIALOGUE, DIALOG_FONT } from '../src/systems/DialogSystem.js';
import { EventManager, EVENTS } from '../src/systems/EventManager.js';
import { CodexManager } from '../src/systems/CodexManager.js';
import { AlchemyManager, ALCHEMY_RECIPES, HERB_BY_SEED } from '../src/systems/AlchemyManager.js';
import {
    WeatherSystem, PHASE, CONDITION, AMBIENT, SEASONS, WEATHER_DEFAULTS,
} from '../src/systems/WeatherSystem.js';

let fails = 0;
const check = (name, cond) => {
    console.log((cond ? 'PASS' : 'FAIL') + '  ' + name);
    if (!cond) fails++;
};

// --- IsoMath round-trip ---
const ORIGIN = { x: 540, y: 950 };
let ok = true;
for (let r = 0; r < 6; r++) {
    for (let c = 0; c < 6; c++) {
        const s = IsoMath.gridToScreen(c, r, ORIGIN.x, ORIGIN.y);
        const g = IsoMath.screenToGrid(s.x, s.y, ORIGIN.x, ORIGIN.y);
        if (g.gridX !== c || g.gridY !== r) ok = false;
    }
}
check('IsoMath 6x6 round-trip (grid->screen->grid)', ok);

const p00 = IsoMath.gridToScreen(0, 0, 540, 950);
const p55 = IsoMath.gridToScreen(5, 5, 540, 950);
check('corner A (0,0) = (540,950)', p00.x === 540 && p00.y === 950);
check('corner B (5,5) = (540,1270)', p55.x === 540 && p55.y === 1270);
check('tile width step = 64', IsoMath.gridToScreen(1, 0).x - p00.x === 64);
check('tile height step = 32', IsoMath.gridToScreen(1, 0).y - p00.y === 32);

// --- Seed search filtering (normalized, diacritic-insensitive) ---
const filter = (q) => SEED_CATALOG.filter((s) => s.searchText.includes(normalizeText(q))).map((s) => s.id);
check('search "tim" -> purple', JSON.stringify(filter('tim')) === JSON.stringify(['flower_purple_wisteria']));
check('search "Tim" case-insensitive -> purple', JSON.stringify(filter('Tim')) === JSON.stringify(['flower_purple_wisteria']));
check('search "tím" diacritic-insensitive -> purple', JSON.stringify(filter('tím')) === JSON.stringify(['flower_purple_wisteria']));
check('search "vang" -> gold', JSON.stringify(filter('vang')) === JSON.stringify(['flower_golden_amber']));
check('search "xanh" -> cyan', JSON.stringify(filter('xanh')) === JSON.stringify(['flower_cyan_orchid']));
check('search "gold" -> gold', JSON.stringify(filter('gold')) === JSON.stringify(['flower_golden_amber']));
check('search "blue" -> cyan', JSON.stringify(filter('blue')) === JSON.stringify(['flower_cyan_orchid']));
check('search "green" -> emerald', JSON.stringify(filter('green')) === JSON.stringify(['flower_emerald_bamboo']));
check('empty query -> all 5', filter('').length === 5);
check('garbage query -> none', filter('zzzz').length === 0);
check('search "nguyet" -> rare', JSON.stringify(filter('nguyet')) === JSON.stringify(['flower_rare_nguyet_cuc']));
check('search "galaxy" -> rare', filter('galaxy').includes('flower_rare_nguyet_cuc'));

// --- Catalog integrity ---
check('catalog has 5 seeds', SEED_CATALOG.length === 5);
check('sprite keys exist in catalog', ['flower_purple', 'flower_golden', 'flower_cyan', 'flower_emerald', 'flower_rare'].every(
    (k) => SEED_CATALOG.some((s) => s.sprite_key === k)
));
check('SEED_BY_ID complete', ['flower_cyan_orchid', 'flower_purple_wisteria', 'flower_golden_amber', 'flower_emerald_bamboo', 'flower_rare_nguyet_cuc'].every(
    (id) => SEED_BY_ID[id]
));
check('rare seed has legendary rarity', SEED_BY_ID['flower_rare_nguyet_cuc'].rarity === 'legendary');

// --- EconomySystem ---
const eco = new EconomySystem();
eco.init();
check('economy starts with 10 spirit stones', eco.spiritStones === 10);
check('economy starts with 5 cyan seeds in inventory', eco.getInventoryCount('flower_cyan_orchid') === 5);
check('economy starts with 5 emerald seeds in inventory', eco.getInventoryCount('flower_emerald_bamboo') === 5);
check('economy starts with 0 harmony', eco.harmony === 0);

// Harvest yields
const reward1 = eco.harvestFlower('flower_cyan_orchid');
check('harvest common yields 1 spirit stone', reward1.spiritStones === 1);
check('harvest yields 2 harmony', reward1.harmony === 2);
check('spirit stones increased to 11', eco.spiritStones === 11);
check('harmony increased to 2', eco.harmony === 2);

const reward2 = eco.harvestFlower('flower_golden_amber');
check('harvest rare yields 3 spirit stones', reward2.spiritStones === 3);

const reward3 = eco.harvestFlower('flower_rare_nguyet_cuc');
check('harvest legendary yields 5 spirit stones', reward3.spiritStones === 5);

// Seed purchasing
check('cyan seed costs 0', eco.getSeedCost('flower_cyan_orchid') === 0);
check('purple seed costs 5', eco.getSeedCost('flower_purple_wisteria') === 5);
check('rare seed costs 25', eco.getSeedCost('flower_rare_nguyet_cuc') === 25);

const purchaseResult1 = eco.purchaseSeed('flower_purple_wisteria');
check('purchase purple succeeds', purchaseResult1.success === true);
check('purchase purple costs 5', purchaseResult1.cost === 5);
check('inventory has 1 purple seed', eco.getInventoryCount('flower_purple_wisteria') === 1);

const beforeStones = eco.spiritStones;
const purchaseResult2 = eco.purchaseSeed('flower_rare_nguyet_cuc');
check('cannot afford rare seed (too expensive)', purchaseResult2.success === false);
check('stones unchanged after failed purchase', eco.spiritStones === beforeStones);

// Quest system
check('quests array has 6 quests', QUESTS.length === 6);
eco.stats.totalBlooms = 1;
const quests1 = eco.checkQuests();
check('first_bloom quest triggers at 1 bloom', quests1.some(q => q.id === 'first_bloom'));

eco.stats.totalBlooms = 10;
const quests2 = eco.checkQuests();
check('green_thumb quest triggers at 10 blooms', quests2.some(q => q.id === 'green_thumb'));

// Quests don't re-trigger
const quests3 = eco.checkQuests();
check('quests do not re-trigger', quests3.length === 0);

// Serialization
const serialized = eco.serialize();
check('serialize returns spiritStones', serialized.spiritStones !== undefined);
check('serialize returns completedQuests array', Array.isArray(serialized.completedQuests));

const eco2 = new EconomySystem();
eco2.deserialize(serialized);
check('deserialize restores spiritStones', eco2.spiritStones === eco.spiritStones);

// Rarity mapping
check('SEED_RARITY maps cyan to common', SEED_RARITY['flower_cyan_orchid'] === 'common');
check('SEED_RARITY maps purple to uncommon', SEED_RARITY['flower_purple_wisteria'] === 'uncommon');
check('SEED_RARITY maps rare to legendary', SEED_RARITY['flower_rare_nguyet_cuc'] === 'legendary');

// --- DialogSystem ---
const dialog = new DialogSystem();
check('dialog starts with default greeting', dialog.currentNodeId === 'greeting_default');

const firstNode = dialog.startDialogue();
check('startDialogue returns a node', firstNode !== null);
check('first visit with no blooms shows first_visit', dialog.currentNodeId === 'greeting_first_visit');

dialog.updateQuestState({ totalBlooms: 1, hasFirstBloom: true, completedQuests: new Set(['first_bloom']) });
const questNode = dialog.startDialogue();
check('quest-aware greeting after first bloom', dialog.currentNodeId === 'quest_completed_first_bloom');

// Dialogue navigation
dialog.updateQuestState({ totalBlooms: 0, hasFirstBloom: false, completedQuests: new Set() });
dialog.startDialogue(); // greeting_first_visit
check('can navigate to quest_offer', dialog.choose(0) !== null);
check('current node is quest_offer', dialog.currentNodeId === 'quest_offer');

// quest_offer choices: 0=quest_details, 1=explain_stones, 2=farewell
const farewell = dialog.choose(2); // "Ta hiểu rồi." -> farewell
check('farewell node has no choices', farewell && farewell.choices.length === 0);
check('isFinished returns true at farewell', dialog.isFinished() === true);

// Test goBack
dialog.goBack();
check('goBack returns to quest_offer', dialog.currentNodeId === 'quest_offer');

// NPC_DIALOGUE integrity
check('NPC_DIALOGUE has greeting_default', NPC_DIALOGUE.greeting_default !== undefined);
check('NPC_DIALOGUE has farewell', NPC_DIALOGUE.farewell !== undefined);
check('NPC_DIALOGUE has explain_rare_seed', NPC_DIALOGUE.explain_rare_seed !== undefined);
check('all nodes have text', Object.values(NPC_DIALOGUE).every(n => n.text.length > 0));
check('no node contains stray CJK glyphs (Vietnamese-only text)', Object.values(NPC_DIALOGUE).every(n => !/[\u4e00-\u9fff]/.test(n.text)));
check('quest_details node flags questList rendering', NPC_DIALOGUE.quest_details.questList === true);

// Unicode font stack for the dialog (khung thoại)
check('DIALOG_FONT is the Unicode system stack', DIALOG_FONT === 'system-ui, -apple-system, sans-serif');

// Quest-list rows (dialog body) — live progress + completion
const qdialog = new DialogSystem();
qdialog.updateQuestState({
    totalBlooms: 4,
    maxSimultaneousBlooms: 12,
    totalStonesEarned: 9,
    rareBlooms: 0,
    totalHarvests: 3,
    completedQuests: new Set(['first_bloom']),
});
const rows = qdialog.getQuestRows();
check('quest rows: one per quest (6)', rows.length === 6);
check('quest rows: first_bloom done via completedQuests', rows.find(r => r.id === 'first_bloom')?.done === true);
check('quest rows: green_thumb progress 4/10 not done', (() => {
    const r = rows.find(q => q.id === 'green_thumb');
    return r && r.done === false && r.progress === 4 && r.target === 10;
})());
check('quest rows: full_garden tracks maxSimultaneousBlooms 12/36', (() => {
    const r = rows.find(q => q.id === 'full_garden');
    return r && r.progress === 12 && r.target === 36;
})());
check('quest rows: stone_collector 9/50', (() => {
    const r = rows.find(q => q.id === 'stone_collector');
    return r && r.progress === 9 && r.target === 50;
})());
check('quest rows: completion by value (green_thumb at 10 blooms)', (() => {
    const d2 = new DialogSystem();
    d2.updateQuestState({ totalBlooms: 10, completedQuests: new Set() });
    return d2.getQuestRows().find(q => q.id === 'green_thumb')?.done === true;
})());



/* ==========================================================================
   PHASE 1 — EventManager (the single inter-system channel)
   ========================================================================== */
{
    const bus = new EventManager({ label: 'test' });
    let hits = [];
    const off = bus.on('a:b', (p) => hits.push(['exact', p.v]));
    bus.on('a:*', (p, ev) => hits.push(['wild:' + ev, p.v]));
    bus.on('a:b', () => hits.push(['second', 0]), { owner: 'group' });
    let onceCount = 0;
    bus.once('a:once', () => onceCount++);

    bus.emit('a:b', { v: 1 });
    check('EventManager: exact + wildcard listeners both fire', hits.length === 3);
    check('EventManager: wildcard receives the concrete event name', hits.some((h) => h[0] === 'wild:a:b'));
    bus.emit('a:once', {});
    bus.emit('a:once', {});
    check('EventManager: once delivers exactly once', onceCount === 1);
    hits = [];
    off();
    bus.emit('a:b', { v: 2 });
    check('EventManager: unsubscribe handle removes only its listener', hits.length === 2 && !hits.some((h) => h[0] === 'exact'));
    check('EventManager: offOwner drops a group of listeners', bus.offOwner('group') === 1 && bus.listenerCount('a:b') === 1);
    check('EventManager: listenerCount is accurate', bus.listenerCount('a:b') === 1);

    // an exception in one handler must not stop the others (or the frame)
    let afterBad = 0;
    bus.on('boom', () => { throw new Error('bad listener'); }, { owner: 'bad' });
    bus.on('boom', () => { afterBad++; });
    const origError = console.error;
    console.error = () => {};
    bus.emit('boom', {});
    console.error = origError;
    check('EventManager: handler exceptions are contained', afterBad === 1 && bus.errorCount === 1);
    check('EventManager: history records emissions', bus.wasEmitted('boom') && bus.emitCount >= 4);
    bus.setSuspended(true);
    const before = bus.emitCount;
    bus.emit('boom', {});
    check('EventManager: suspend halts delivery', bus.emitCount === before);
    bus.setSuspended(false);
    bus.clear();
    check('EventManager: clear drops all listeners', bus.listenerCount('boom') === 0);
    check('EVENTS registry covers the phase-1 channels', [
        EVENTS.FLOWER_BLOOMED, EVENTS.FLOWER_HARVESTED, EVENTS.TILE_WATERED, EVENTS.TILE_PLANTED,
        EVENTS.WEATHER_PHASE_CHANGED, EVENTS.WEATHER_CHANGED, EVENTS.WEATHER_LAMP_LEVEL,
        EVENTS.RAIN_STARTED, EVENTS.RAIN_ENDED, EVENTS.RAIN_IRRIGATE,
        EVENTS.CODEX_SPECIES_DISCOVERED, EVENTS.CODEX_ENTRY_UPDATED, EVENTS.CODEX_MILESTONE,
        EVENTS.CODEX_BUFFS_CHANGED, EVENTS.CODEX_OPEN_REQUEST, EVENTS.QUEST_COMPLETED,
    ].every((n) => typeof n === 'string' && n.includes(':')));

    // systems really talk through the bus (no direct calls): codex bound to bus
    const bus2 = new EventManager();
    const codex = new CodexManager().bind(bus2);
    bus2.emit(EVENTS.FLOWER_BLOOMED, { seedId: 'flower_cyan_orchid' });
    bus2.emit(EVENTS.FLOWER_HARVESTED, { seedId: 'flower_cyan_orchid' });
    check('CodexManager learns species from the bus alone', codex.isDiscovered('flower_cyan_orchid') && codex.getEntry('flower_cyan_orchid').harvests === 1);
}

/* ==========================================================================
   PHASE 1 — System 9: Vạn Hoa Đồ Giám (CodexManager)
   ========================================================================== */
{
    const loreSeeds = Object.keys(CODEX_LORE);
    check('Codex lore covers every catalog flower', SEED_CATALOG.every((s) => loreSeeds.includes(s.id)));
    check('Codex lore: every species has biography + 4-line poem', loreSeeds.every((id) => {
        const l = CODEX_LORE[id];
        return l.biography?.length > 40 && Array.isArray(l.poem?.lines) && l.poem.lines.length === 4;
    }));
    check('Codex lore: every species has a mastery verse', loreSeeds.every((id) => CODEX_LORE[id].verse?.lines?.length === 2));
    check('Codex lore: Vietnamese-only text (no stray CJK)', !/[\u4e00-\u9fff]/.test(JSON.stringify(CODEX_LORE) + JSON.stringify(FULL_COLLECTION_POEM)));
    check('Codex lore: poem lines rhyme-free of markup', Object.values(CODEX_LORE).every((l) => l.poem.lines.every((line) => !/[<>{}[\]]/.test(line))));
    check('Codex mastery tiers ascend 3 → 8 → 15 harvests',
        MASTERY_TIERS.map((t) => t.atHarvests).join() === '3,8,15');
    check('Codex milestones cover 1..5 species', CODEX_MILESTONES.map((m) => m.at).join() === '1,2,3,4,5');
    check('Codex milestones grant the two tool skins',
        CODEX_MILESTONES.some((m) => m.effect?.skin === 'sickle_jade') &&
        CODEX_MILESTONES.some((m) => m.effect?.skin === 'bucket_gold'));

    const codex = new CodexManager();
    check('Codex starts empty', codex.getDiscoveredCount() === 0 && codex.getTitle() === null);
    check('Codex has one page per catalog species', codex.size() === 5 && codex.getPages().length === 5);

    // first bloom = discovery + poem
    codex.recordBloom('flower_cyan_orchid');
    let page = codex.getPages().find((p) => p.seedId === 'flower_cyan_orchid');
    check('Codex: first bloom discovers the species', page.discovered === true && codex.getDiscoveredCount() === 1);
    check('Codex: discovery unlocks the poem', page.poem !== null && page.poem.lines.length === 4);
    check('Codex: verse stays locked until mastery tier 2', page.verse === null);
    check('Codex: bloom + harvest counters', codex.totalBlooms === 1);
    check('Codex: first milestone grants the +3 harmony reward', codex.unlockedMilestones.has('first_page'));

    // harvests drive mastery tiers
    for (let i = 0; i < 3; i++) codex.recordHarvest('flower_cyan_orchid');
    page = codex.getPages().find((p) => p.seedId === 'flower_cyan_orchid');
    check('Codex: 3 harvests unlock tier 1 (Mộc Dịch)', page.tiersUnlocked.includes('moc_dich'));
    check('Codex: tier 1 adds +1 harmony for that species only',
        codex.getHarvestBonus('flower_cyan_orchid').harmonyBonus === 1 &&
        codex.getHarvestBonus('flower_purple_wisteria').harmonyBonus === 0);
    for (let i = 0; i < 5; i++) codex.recordHarvest('flower_cyan_orchid'); // total 8
    page = codex.getPages().find((p) => p.seedId === 'flower_cyan_orchid');
    check('Codex: 8 harvests unlock tier 2 (Linh Căn) + the verse', page.tiersUnlocked.includes('linh_can') && page.verse !== null);
    check('Codex: tier 2 adds +1 spirit stone', codex.getHarvestBonus('flower_cyan_orchid').stoneBonus === 1);

    // discovery milestones + aggregated buffs
    for (const id of ['flower_purple_wisteria', 'flower_golden_amber', 'flower_emerald_bamboo']) codex.recordBloom(id);
    check('Codex: 4 species → title Ngự Hoa Tiên Sử', codex.getTitle() === 'Ngự Hoa Tiên Sử');
    check('Codex: 4 species grants the jade sickle skin', codex.hasSkin('sickle_jade'));
    const buffs4 = codex.getBuffs();
    check('Codex: harmony multiplier aggregates from milestones', Math.abs(buffs4.harmonyMult - 1.27) < 1e-9);
    check('Codex: growth multiplier only improves (<=1)', buffs4.growthMult === 0.85);
    check('Codex: flat stone bonus from Bách Thảo Tri Âm', buffs4.stoneFlat === 1);
    for (let i = 0; i < 15; i++) codex.recordHarvest('flower_cyan_orchid');
    check('Codex: 15 harvests unlock tier 3 (Thiên Hương) night glow',
        codex.getBuffs().nightGlowSeeds.includes('flower_cyan_orchid'));
    check('Codex: tier 3 harmony bonus stacks on tier 1', codex.getHarvestBonus('flower_cyan_orchid').harmonyBonus === 3);

    codex.recordBloom('flower_rare_nguyet_cuc');
    const finalBuffs = codex.getBuffs();
    check('Codex: full collection unlocks gold bucket skin', codex.hasSkin('bucket_gold') && codex.fullPoemUnlocked);
    check('Codex: full collection title is Vạn Hoa Chủ Biên', codex.getTitle() === 'Vạn Hoa Chủ Biên');
    check('Codex: growth buff capped at 0.7 (30% faster)', finalBuffs.growthMult === 0.7);
    check('Codex: progress reports 5/5 complete', codex.getProgress().discovered === 5 && codex.getProgress().complete === true);
    check('Codex: active buff list is human-readable', codex.getActiveBuffs().length >= 4 &&
        codex.getActiveBuffs().every((b) => b.label && b.detail && b.source));

    // persistence round-trip
    const saved = codex.serialize();
    const revived = new CodexManager().deserialize(saved);
    check('Codex: serialize/deserialize preserves discovery + tiers',
        revived.getDiscoveredCount() === 5 &&
        revived.getEntry('flower_cyan_orchid').tiersUnlocked.join() === codex.getEntry('flower_cyan_orchid').tiersUnlocked.join());
    check('Codex: serialize/deserialize preserves titles + skins',
        revived.getTitle() === 'Vạn Hoa Chủ Biên' && revived.hasSkin('bucket_gold') && revived.fullPoemUnlocked);
    check('Codex: unknown seeds are ignored safely', codex.recordBloom('not_a_flower') === null && codex.recordHarvest('not_a_flower') === null);
}

/* ==========================================================================
   PHASE 1 — System 8: Thiên Thời Tứ Thời (WeatherSystem)
   ========================================================================== */
{
    const total = Object.values(WEATHER_DEFAULTS.phaseMs).reduce((a, b) => a + b, 0);
    check('Weather: day/dusk/night cycle sums to one day', total === 45000 + 22000 + 38000);
    check('Weather: each phase has a distinct ambient tint', new Set([AMBIENT.day.tint, AMBIENT.dusk.tint, AMBIENT.night.tint]).size === 3);
    check('Weather: night is the darkest wash', AMBIENT.night.alpha > AMBIENT.dusk.alpha && AMBIENT.dusk.alpha > AMBIENT.day.alpha);
    check('Weather: only spring rolls rain by default', SEASONS.filter((s) => s.rainChance > 0).map((s) => s.key).join() === 'xuan');

    const w = new WeatherSystem();
    check('Weather: starts in the day phase, clear skies', w.getPhase() === PHASE.DAY && w.getCondition() === CONDITION.CLEAR);
    const order = [];
    for (let i = 0; i < Math.ceil(total / 250); i++) {
        const r = w.tick(250);
        if (r.phaseChanged) order.push(w.getPhase());
    }
    check('Weather: cycle order is day → dusk → night → day', order.slice(0, 2).join() === [PHASE.DUSK, PHASE.NIGHT].join());
    check('Weather: one day advances the day counter', w.dayCount === 2);
    check('Weather: tick() clamps huge deltas (no catch-up storms)', (() => {
        const w2 = new WeatherSystem();
        w2.tick(9_999_999); // e.g. a backgrounded tab resuming
        // only 250ms is simulated, so the day phase cannot skip ahead
        return w2.getPhase() === PHASE.DAY && w2.phaseElapsed === 250;
    })());

    // spring rain + the watering buff
    const bus = new EventManager();
    const w3 = new WeatherSystem().bind(bus);
    const seen = [];
    bus.on('weather:*', (p, ev) => seen.push(ev));
    bus.on(EVENTS.RAIN_IRRIGATE, (p) => seen.push('irrigate:' + p.source));
    const started = w3.forceRain(true);
    check('Weather: rain can be forced on', started && w3.isRaining() && w3.getCondition() === CONDITION.SPRING_RAIN);
    check('Weather: rain publishes rain-started on the bus', seen.includes(EVENTS.RAIN_STARTED));
    check('Weather: rain publishes the irrigation buff fact', seen.includes('irrigate:spring-rain'));
    check('Weather: rain means unwatered soil is auto-watered', w3.isAutoWaterActive() && w3.getModifiers().autoWater === true);
    check('Weather: rain tints the scene cooler + darker', (() => {
        const a = w3.getAmbient();
        return a.condition === CONDITION.SPRING_RAIN && a.alpha > AMBIENT[a.phase].alpha;
    })());
    w3.forceRain(false);
    check('Weather: clearing the sky ends the buff', !w3.isRaining() && !w3.isAutoWaterActive() && seen.includes(EVENTS.RAIN_ENDED));

    // full moon
    const w4 = new WeatherSystem();
    w4.dayCount = WEATHER_DEFAULTS.moonCycle;
    w4.forcePhase(PHASE.NIGHT);
    check('Weather: every Nth night is a full moon', w4.isFullMoonNight() === true);
    check('Weather: full moon doubles Harmony Points', w4.getModifiers().harmonyMult === WEATHER_DEFAULTS.fullMoonHarmonyMult);
    check('Weather: full-moon ambient shows a round moon', w4.getAmbient().moonPhase === 'full' && w4.getAmbient().moon === 1);
    const w5 = new WeatherSystem();
    w5.dayCount = 2;
    w5.forcePhase(PHASE.NIGHT);
    check('Weather: ordinary nights do not double harmony', w5.getModifiers().harmonyMult === 1 && w5.getAmbient().moonPhase === 'crescent');

    // deterministic rain rolls
    const rollA = new WeatherSystem({ seed: 7, phaseOrder: [PHASE.DAY] , phaseMs: { [PHASE.DAY]: 10 } });
    const rollB = new WeatherSystem({ seed: 7, phaseOrder: [PHASE.DAY], phaseMs: { [PHASE.DAY]: 10 } });
    let rainA = 0, rainB = 0;
    for (let i = 0; i < 40; i++) { rollA.tick(20); if (rollA.isRaining()) rainA++; rollB.tick(20); if (rollB.isRaining()) rainB++; }
    check('Weather: seeded RNG makes the cycle reproducible', rainA === rainB && rainA > 0);

    // season pacing + persistence
    const w6 = new WeatherSystem();
    for (let i = 0; i < Math.ceil((total * 3) / 250); i++) w6.tick(250);
    check('Weather: seasons advance after seasonCycleLength days', w6.season.key !== 'xuan');
    const snap = w6.serialize();
    const w7 = new WeatherSystem().deserialize(snap);
    check('Weather: serialize/deserialize restores phase + condition', w7.getPhase() === w6.getPhase() && w7.dayCount === w6.dayCount);
    check('Weather: summary names the season + condition for the HUD', /Tiết/.test(w7.getSummary()) && w7.getSummary().length > 8);
    check('Weather: soil moisture is drier by day, soaked by rain', (() => {
        const w8 = new WeatherSystem();
        const dry = w8.soilMoisture();
        w8.forcePhase(PHASE.NIGHT);
        const night = w8.soilMoisture();
        w8.forceRain(true);
        return dry < night && night < w8.soilMoisture() && w8.soilMoisture() === 1;
    })());

    // economy integration: modifiers actually change a harvest
    const eco = new EconomySystem();
    eco.init();
    const plain = eco.harvestFlower('flower_cyan_orchid');
    const buffed = eco.harvestFlower('flower_cyan_orchid', { harmonyBonus: 1, stoneBonus: 2, harmonyMult: 2 });
    check('Economy: base harvest math unchanged', plain.harmony === 2 && plain.spiritStones === 1);
    check('Economy: codex + weather modifiers apply on top', buffed.harmony === 6 && buffed.spiritStones === 3);
}

/* ==========================================================================
   DESKTOP CENTERING FIX + maintained visual anchors (source-level guards)
   ========================================================================== */
{
    const root = path.resolve(new URL('.', import.meta.url).pathname, '..');
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    const main = fs.readFileSync(path.join(root, 'src/main.js'), 'utf8');
    const scene = fs.readFileSync(path.join(root, 'src/scenes/GardenScene.js'), 'utf8');
    const css = html.replace(/\s+/g, ' ');

    check('CSS: html/body are a full-viewport flex centering box',
        /html,\s*body\s*{[^}]*display:\s*flex[^}]*justify-content:\s*center[^}]*align-items:\s*center/.test(css));
    check('CSS: html/body sized to the viewport (100vw/100vh)', /width:\s*100vw/.test(css) && /height:\s*100vh/.test(css));
    check('CSS: letterbox background is #0b0c16', /background-color:\s*#0b0c16/.test(css));
    check('CSS: page overflow hidden (no scrollbar nudge off-center)', /overflow:\s*hidden/.test(css));
    check('CSS: #game-container + canvas use margin: auto !important',
        /#game-container,\s*canvas\s*{\s*margin:\s*auto\s*!important/.test(css));
    check('CSS: wrapper/canvas display overrides are marked !important',
        /display:\s*block\s*!important/.test(css) && /display:\s*flex\s*!important/.test(css));
    check('CSS: wrapper stays flex so vertical centering survives margin:auto',
        /#game-container\s*{[^}]*display:\s*flex\s*!important/.test(css));
    check('CSS: DOM container re-centers with inset:0 + margin:auto',
        /\.phaser-container\s*{[^}]*position:\s*absolute\s*!important/.test(css.replace(/\s+/g, ' ')) &&
        /\.phaser-container\s*{[^}]*margin:\s*auto\s*!important/.test(css.replace(/\s+/g, ' ')));
    check('CSS: html/body margin+padding reset to 0', /html,\s*body\s*{[^}]*margin:\s*0\s*;\s*padding:\s*0/.test(css));

    check('Config: Scale.FIT enforced', /mode:\s*Phaser\.Scale\.FIT/.test(main));
    check('Config: CENTER_BOTH autoCenter enforced', /autoCenter:\s*Phaser\.Scale\.CENTER_BOTH/.test(main));
    check('Config: 9:16 design size declared in the scale block', /width:\s*W/.test(main) && /height:\s*H/.test(main) && /const W = 1080/.test(main) && /const H = 1920/.test(main));
    check('Config: canvas letterbox color matches the page background', /'#0b0c16'/.test(main));
    check('Config: parent is the centering wrapper', /parent:\s*'game-container'/.test(main));
    check('Config: scale is re-asserted after resizes (flex layout settles late)',
        /scale\.refresh\(\)/.test(main) && /scale\.updateCenter\(\)/.test(main));

    // visual anchors that must NOT move
    check('Anchor: Tiên Nữ Hoa Giang still at (890, 1345)', /NPC_POS = \{ x: 890, y: 1345 \}/.test(scene));
    check('Anchor: 6x6 grid preserved', /const ROWS = 6;/.test(scene) && /const COLS = 6;/.test(scene));
    check('Anchor: three bottom action buttons preserved', /createActionBar\(\)/.test(scene) && /x: 160,/.test(scene) && /x: 540,/.test(scene) && /x: 920,/.test(scene));
    check('Anchor: 2.5D stone terrace (platform) still keyed to the grid centre', /'platform'\)/.test(scene) && /1110/.test(scene));

    // layer plan: world below the ambient wash, UI above it
    check('Layers: ambient wash sits above the world (tiles, petals, rain)',
        LAYERS.AMBIENT > LAYERS.TILES && LAYERS.AMBIENT > LAYERS.PETALS && LAYERS.AMBIENT > LAYERS.RAIN);
    check('Layers: every UI layer stays lit above the wash',
        [LAYERS.HUD, LAYERS.BAR, LAYERS.CHIP, LAYERS.HINT, LAYERS.DRAWER, LAYERS.DIALOG, LAYERS.MODAL, LAYERS.CODEX]
            .every((d) => d > LAYERS.AMBIENT));
    check('Layers: codex scroll is the topmost reading surface', LAYERS.CODEX > LAYERS.DIALOG && LAYERS.CODEX > LAYERS.MODAL);
}

/* ==========================================================================
   Phase-1 module contracts (files exist and are used by the scene)
   ========================================================================== */
{
    const root = path.resolve(new URL('.', import.meta.url).pathname, '..');
    const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
    const scene = read('src/scenes/GardenScene.js');
    for (const rel of ['src/systems/EventManager.js', 'src/systems/CodexManager.js', 'src/systems/WeatherSystem.js', 'src/ui/CodexModal.js', 'src/vfx/WeatherView.js', 'src/core/Layers.js', 'src/data/codexLore.js']) {
        check(`Phase 1 module present: ${rel}`, fs.existsSync(path.join(root, rel)) && read(rel).length > 500);
    }
    check('Scene publishes through the bus (no codex/weather cross-imports)',
        /new EventManager\(/.test(scene) && /this\.bus\.emit\(EVENTS\.FLOWER_BLOOMED/.test(scene) && /this\.bus\.emit\(EVENTS\.FLOWER_HARVESTED/.test(scene));
    check('Scene subscribes to the rain irrigation buff', /b\.on\(EVENTS\.RAIN_IRRIGATE/.test(scene) && /rainIrrigate\(/.test(scene));
    check('Scene ticks the weather clock every frame', /update\(time, delta\)/.test(scene) && /this\.weather\.tick\(delta\)/.test(scene));
    check('Codex buffs feed the economy (harvest modifiers)', /getHarvestBonus\(/.test(scene) && /harmonyMult:/.test(scene));
    check('HUD carries the codex scroll button + weather chip', /createWeatherChip\(\)/.test(scene) && /new CodexModal\(/.test(scene));
    check('Weather view owns ambient tint + rain particles',
        /setBlendMode\(Phaser\.BlendModes\.MULTIPLY\)/.test(read('src/vfx/WeatherView.js')) &&
        /'rain_streak'/.test(read('src/vfx/WeatherView.js')) &&
        /'ripple'/.test(read('src/vfx/WeatherView.js')));
    check('No system imports another system (bus-only coupling)',
        !/from '\.\/CodexManager\.js'/.test(read('src/systems/WeatherSystem.js')) &&
        !/from '\.\/WeatherSystem\.js'/.test(read('src/systems/CodexManager.js')) &&
        !/from '\.\/CodexModal\.js'/.test(read('src/systems/CodexManager.js')) &&
        !/from '\.\/AlchemyManager\.js'/.test(read('src/systems/BreedingManager.js')) &&
        !/from '\.\/BreedingManager\.js'/.test(read('src/systems/AlchemyManager.js')));
}

/* ==========================================================================
   PHASE 2 — System 5: Lò Luyện Đan (AlchemyManager)
   ========================================================================== */
{
    check('EVENTS registry exposes the stable ELIXIR_CONSUMED channel', EVENTS.ELIXIR_CONSUMED === 'ELIXIR_CONSUMED');
    check('Alchemy recipe table carries the three spec recipes in order',
        ALCHEMY_RECIPES.map((r) => r.id).join() === 'tu_khi_dan,tay_tui_dan,van_tho_linh_dich');
    check('U Đàm drops from the cyan orchid harvest', HERB_BY_SEED.flower_cyan_orchid === 'u_dam');
    check('Huyết Kế drops from the wisteria harvest', HERB_BY_SEED.flower_purple_wisteria === 'huyet_ke');

    let t = 0;
    const alch = new AlchemyManager({ now: () => t, random: () => 0.5 });
    alch.grant({ u_dam: 1 });
    const started = alch.craft('tu_khi_dan');
    check('Craft deducts the full ingredient set (3 U Đàm + 1 Linh Dịch)',
        started.success === true && alch.getHerb('u_dam') === 0 && alch.getHerb('linh_dich') === 0);
    t = started.endsAt + 1;
    const resolved = alch.tick(16);
    check('Furnace resolves at the 45s deadline (roll 0.5 < 0.85)',
        resolved.craftResolved?.success === true && alch.getElixir('tu_khi_dan') === 1);
    t += 1000;
    const consumed = alch.consume('tu_khi_dan');
    check('Consumed Tụ Khí Đan grants +20% bloom speed for 10 minutes',
        consumed.success === true && consumed.buff.durationMs === 600_000
        && Math.abs(alch.getBuffs().growthMult - 1 / 1.2) < 1e-12);
    t += 600_001;
    alch.tick(16);
    check('Timed elixir buff expires after its 10 minutes', alch.getBuffs().active.length === 0);

    // bus-only coupling: gameplay facts feed the herbs, ELIXIR_CONSUMED leaves
    const bus3 = new EventManager();
    const alch2 = new AlchemyManager({ now: () => t }).bind(bus3);
    let elixirEvent = null;
    bus3.on(EVENTS.ELIXIR_CONSUMED, (p) => { elixirEvent = p; });
    bus3.emit(EVENTS.FLOWER_HARVESTED, { seedId: 'flower_cyan_orchid' });
    bus3.emit(EVENTS.TILE_WATERED, { row: 0, col: 0, source: 'watering-can' });
    check('Alchemistry learns herbs from bus facts alone',
        alch2.getHerb('u_dam') === 3); // starter 2 + 1 harvest
    alch2.grantElixir('van_tho_linh_dich', 1);
    alch2.consume('van_tho_linh_dich');
    check('Vạn Thọ Linh Dịch publishes auto_water on ELIXIR_CONSUMED',
        elixirEvent?.buff?.type === 'auto_water' && elixirEvent?.buff?.expiresAt === null);

    check('Alchemy state round-trips through serialize/deserialize', (() => {
        const alch3 = new AlchemyManager({ now: () => t }).deserialize(JSON.parse(JSON.stringify(alch.serialize())));
        return alch3.getElixir('tu_khi_dan') === 0 && alch3.stats.totalConsumed === 1;
    })());

    const root = path.resolve(new URL('.', import.meta.url).pathname, '..');
    const read2 = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
    const scene2 = read2('src/scenes/GardenScene.js');
    check('Scene ticks the furnace each frame and applies ELIXIR_CONSUMED',
        /this\.alchemy\?\.tick\(delta\)/.test(scene2) && /b\.on\(EVENTS\.ELIXIR_CONSUMED/.test(scene2));
    check('Scene composes the elixir growth buff into the bloom stagger',
        /getBuffs\(\)\?\.growthMult/.test(scene2));
    check('Alchemy modal wired with HUD medallion (no scene layout changes)',
        /new AlchemyModal\(this,/.test(scene2) && read2('src/ui/AlchemyModal.js').length > 500);
}

/* ==========================================================================
   Critical bugfix pass — diamond economy, tool separation, modal propagation
   ========================================================================== */
{
    const bus = new EventManager({ label: 'eco-test' });
    const eco = new EconomySystem().bind(bus);
    eco.init();
    const diamondEvents = [];
    bus.on(EVENTS.DIAMONDS_CHANGED, (p) => diamondEvents.push(p));
    const refused = [];
    bus.on(EVENTS.DIAMONDS_INSUFFICIENT, (p) => refused.push(p));

    // premium seed purchase deducts + announces
    const before = eco.spiritStones;
    const buy = eco.purchaseSeed('flower_purple_wisteria');
    check('Economy: premium seed purchase deducts diamonds', buy.success && eco.spiritStones === before - 5);
    check('Economy: purchase publishes DIAMONDS_CHANGED with the new balance',
        diamondEvents.length === 1 && diamondEvents[0].diamonds === before - 5 && diamondEvents[0].delta === -5 && diamondEvents[0].reason === 'seed-purchase');
    check('Economy: SEED_PURCHASED carries the owned count', bus.wasEmitted(EVENTS.SEED_PURCHASED, (p) => p.seedId === 'flower_purple_wisteria' && p.owned === 1));

    // refusal path: nothing deducted, refusal announced
    const b2 = eco.spiritStones;
    const fail = eco.purchaseSeed('flower_rare_nguyet_cuc');
    check('Economy: unaffordable seed is refused without touching the balance', fail.success === false && eco.spiritStones === b2);
    check('Economy: refusal publishes DIAMONDS_INSUFFICIENT (dialog hook)', refused.length === 1 && refused[0].cost === 25 && refused[0].reason === 'seed-purchase');

    // consumeSeed: free seeds unlimited, premium seeds need a packet
    check('Economy: starter seeds are unlimited', [1, 2, 3, 4, 5, 6, 7].every(() => eco.consumeSeed('flower_cyan_orchid')));
    check('Economy: premium seed packet is consumed on planting', eco.consumeSeed('flower_purple_wisteria') === true && eco.getInventoryCount('flower_purple_wisteria') === 0);
    check('Economy: empty premium packet cannot be planted for free', eco.consumeSeed('flower_purple_wisteria') === false);

    // quick-water pricing
    check('Economy: quick-water costs 1 💎 for a small batch', eco.getQuickWaterCost(1) === 1 && eco.getQuickWaterCost(12) === 1);
    check('Economy: quick-water costs 2 💎 for a big batch', eco.getQuickWaterCost(13) === 2 && eco.getQuickWaterCost(36) === 2);
    check('Economy: quick-water is never free', ECONOMY_DEFAULTS.quickWaterCost >= 1);
    const b3 = eco.spiritStones;
    const pay = eco.payQuickWater(4);
    check('Economy: paying for quick-water deducts 1 💎', pay.success && pay.cost === 1 && eco.spiritStones === b3 - 1);
    eco.spiritStones = 0;
    const broke = eco.payQuickWater(4);
    check('Economy: quick-water refused at 0 💎 (no instant growth)', broke.success === false && /Không đủ Đá Linh Khí/.test(broke.message));
    check('Economy: addDiamonds credits + announces', (() => {
        const n = diamondEvents.length;
        eco.addDiamonds(2, 'rewarded-ad');
        return eco.spiritStones === 2 && diamondEvents.length === n + 1 && diamondEvents[n].reason === 'rewarded-ad';
    })());
    check('Economy: unbound economy still works (bus optional)', (() => {
        const e = new EconomySystem();
        e.init();
        return e.purchaseSeed('flower_purple_wisteria').success && e.spiritStones === 5;
    })());

    const root = path.resolve(new URL('.', import.meta.url).pathname, '..');
    const read3 = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
    const scene3 = read3('src/scenes/GardenScene.js');
    check('Scene: SICKLE tool branch returns before any planting logic',
        /if \(this\.activeTool === TOOL\.SICKLE\) \{[\s\S]*?return;\s*\}\s*\n\s*\/\* ---- SEED/.test(scene3));
    check('Scene: sickle swipe never plants, seed drag never harvests',
        /activeTool === TOOL\.SEED\)[\s\S]{0,200}tryPlantSeed\(tile\)/.test(scene3) && /activeTool === TOOL\.SICKLE\)[\s\S]{0,260}harvestTile\(tile\)/.test(scene3));
    check('Scene: HUD listens for DIAMONDS_CHANGED', /b\.on\(EVENTS\.DIAMONDS_CHANGED/.test(scene3));
    check('Scene: title block padded by the 30px mobile safe area', /const SAFE_TOP = 30;/.test(scene3) && /44 \+ SAFE_TOP/.test(scene3));
    check('Scene: quick-water is paid through the economy', /payQuickWater\(/.test(scene3) && /showNotice\(/.test(scene3));
    check('index.html: shell pads env(safe-area-inset-top)', /padding-top:\s*env\(safe-area-inset-top/.test(read3('index.html')));

    for (const rel of ['src/ui/AlchemyModal.js', 'src/ui/FishingModal.js', 'src/ui/BeastModal.js']) {
        const src = read3(rel);
        check(`${rel}: backdrop close is guarded + panel shield stops propagation`,
            /bindBackdropClose\(/.test(src) && /createPanelShield\(/.test(src) && /guarded\(/.test(src));
    }
    const beast = read3('src/ui/BeastModal.js');
    check('BeastModal: dark Guofeng theme (#121016 + gold frame)', /0x121016/.test(beast) && /lineStyle\(6, T\.gold, 1\)/.test(beast));
    check('BeastModal: beasts shown one at a time (tabs + carousel), never stacked', /makeTab\(/.test(beast) && /step\(delta\)/.test(beast) && /setVisible\(false\)/.test(beast));
    const beastSys = read3('src/systems/BeastSystem.js');
    const beastManifest = read3('src/data/BeastAssetManifest.js');
    check('BeastSystem: four sanctuary beasts (Bạch Hồ, Ngọc Thỏ, Thanh Loan, Huyền Quy)',
        /Cửu Vĩ Bạch Hồ/.test(beastSys) && /Ngọc Thỏ/.test(beastSys) && /Thanh Loan/.test(beastSys) && /Huyền Quy/.test(beastSys)
        && /qingluan/.test(beastSys) && /xuanwu/.test(beastSys)
        && /beast_qingluan/.test(beastManifest) && /beast_xuanwu/.test(beastManifest));
    check('BeastSystem: Cho Ăn spends 1 Linh Ngư for +20 Thân Mật and persists via StateStore',
        /feedAffinity: 20/.test(beastSys) && /linhNgu/.test(beastSys) && /class StateStore/.test(beastSys)
        && /BEAST_FED/.test(beastSys) && /FISH_CAUGHT/.test(beastSys));
    const alchUi = read3('src/ui/AlchemyModal.js');
    check('AlchemyModal: bagua furnace + Trúc Cơ / Cửu Chuyển pill sprites',
        /furnace_bagua/.test(alchUi) && /pill_tier1/.test(alchUi) && /pill_tier3/.test(alchUi)
        && /Trúc Cơ Đan/.test(alchUi) && /Cửu Chuyển Thần Đan/.test(alchUi));
    check('Scene wires BeastSystem + fishing catch onto the shared bus',
        /new BeastSystem\(/.test(scene3) && /FISH_CAUGHT/.test(scene3) && /beastSystem: this\.beasts/.test(scene3));
    const modalInput = read3('src/ui/modalInput.js');
    check('modalInput: stopPropagation is what the shield calls', /stopPropagation\(\)/.test(modalInput));
}

// --- Stage 1: Soil types (Linh Thổ) ---
{
    const {
        SOIL_TYPES, SOIL_ORDER, SOIL_TEXTURES, resolveSoil, soilGrowthMs, soilWaterDrain, soilIsWatered,
        soilYieldMult, applySoilYield, rollInstantMature, soilUpgradeCost, normalizePlotData,
    } = await import('../src/data/SoilTypes.js');
    const { createPlotData, hydratePlotData, serializePlotData, plotGrowthMs, plotBloomDelay, drainPlotWater, plotDryOutMs, BASE_WATER_DRAIN_PER_MS } = await import('../src/data/PlotData.js');

    check('SoilTypes: 4 soils in canonical order', JSON.stringify(SOIL_ORDER) === JSON.stringify(['HOANG_THO', 'HAN_NGOC_THO', 'XICH_VIEM_THO', 'TUC_NHUONG']));
    check('SoilTypes: upgrade costs 20 / 30 / 50 💎', SOIL_TYPES.HAN_NGOC_THO.upgradeCost === 20 && SOIL_TYPES.XICH_VIEM_THO.upgradeCost === 30 && SOIL_TYPES.TUC_NHUONG.upgradeCost === 50);
    check('SoilTypes: textures point at public/assets/tiles', SOIL_TEXTURES.length === 3 && SOIL_TEXTURES.every((t) => t.path.startsWith('./assets/tiles/') && fs.existsSync(path.join('public', t.path.replace('./', '')))));
    check('SoilTypes: legacy/unknown soil falls back to HOANG_THO', resolveSoil(undefined).id === 'HOANG_THO' && resolveSoil('BOGUS').id === 'HOANG_THO');
    check('SoilTypes: normalizePlotData backfills soilType', normalizePlotData({ state: 'EMPTY' }).soilType === 'HOANG_THO');
    check('Hàn Ngọc: always watered, zero drain', soilIsWatered(false, 'HAN_NGOC_THO') && soilWaterDrain(1, 'HAN_NGOC_THO') === 0 && !soilIsWatered(false, 'HOANG_THO'));
    check('Hàn Ngọc: +10% cold herb yield only', Math.abs(soilYieldMult('HAN_NGOC_THO', 'flower_cyan_orchid') - 1.1) < 1e-9 && soilYieldMult('HAN_NGOC_THO', 'flower_golden_amber') === 1);
    check('Xích Viêm: +40% growth speed (timer ×1/1.4)', soilGrowthMs(14000, 'XICH_VIEM_THO') === 10000);
    check('Xích Viêm: doubles water drain', soilWaterDrain(3, 'XICH_VIEM_THO') === 6);
    check('Tức Nhưỡng: 2x harvest drop', applySoilYield(3, 'TUC_NHUONG', 'flower_purple_wisteria') === 6 && applySoilYield(1, 'HOANG_THO', 'flower_purple_wisteria') === 1);
    check('Tức Nhưỡng: 10% instant mature (deterministic rng)', rollInstantMature('TUC_NHUONG', () => 0.05) && !rollInstantMature('TUC_NHUONG', () => 0.5) && !rollInstantMature('HOANG_THO', () => 0));
    check('soilUpgradeCost: valid targets priced, same/base rejected', soilUpgradeCost('HOANG_THO', 'TUC_NHUONG') === 50 && soilUpgradeCost('HOANG_THO', 'HOANG_THO') === null && soilUpgradeCost('HOANG_THO', 'NOPE') === null);

    // PlotData
    const fresh = createPlotData(2, 3);
    check('PlotData: fresh plot defaults to HOANG_THO / EMPTY / dry', fresh.soilType === 'HOANG_THO' && fresh.state === 'EMPTY' && fresh.watered === false && fresh.water === 0);
    const legacy = hydratePlotData({ row: 1, col: 1, state: 'PLANTED', seedId: 'flower_cyan_orchid', watered: true });
    check('PlotData: legacy save (no soilType) hydrates to HOANG_THO and keeps its seed', legacy.soilType === 'HOANG_THO' && legacy.seedId === 'flower_cyan_orchid' && legacy.state === 'PLANTED' && legacy.watered === true);
    const jade = hydratePlotData({ row: 0, col: 0, state: 'EMPTY', soilType: 'HAN_NGOC_THO' });
    check('PlotData: Hàn Ngọc save hydrates 100% watered', jade.watered === true && jade.water === 1);
    check('PlotData: serialize round-trips soilType', serializePlotData(jade).soilType === 'HAN_NGOC_THO' && !('plantSprites' in serializePlotData(jade)));
    const fire = { ...createPlotData(0, 0, 'XICH_VIEM_THO'), seedId: 'flower_cyan_orchid', state: 'GROWING', watered: true, water: 1 };
    check('PlotData: growth timer applies soil multiplier (15000 → 10714)', plotGrowthMs(fire) === Math.round(15000 / 1.4) && plotGrowthMs({ ...fire, soilType: 'HOANG_THO' }) === 15000);
    check('PlotData: bloom cascade delay scaled per soil', plotBloomDelay(fire, 1400) === 1000 && plotBloomDelay({ ...fire, soilType: 'HOANG_THO' }, 1400) === 1400);
    const dt = 10000;
    const baseLoss = BASE_WATER_DRAIN_PER_MS * dt;
    check('PlotData: Xích Viêm drains twice as fast as Hoàng Thổ', Math.abs((1 - drainPlotWater(fire, dt)) - 2 * baseLoss) < 1e-9 && Math.abs((1 - drainPlotWater({ ...fire, soilType: 'HOANG_THO' }, dt)) - baseLoss) < 1e-9);
    check('PlotData: Hàn Ngọc never drains', drainPlotWater({ ...fire, soilType: 'HAN_NGOC_THO' }, 10 * 60 * 1000) === 1 && plotDryOutMs('HAN_NGOC_THO') === Infinity);
    check('PlotData: empty plot does not drain', drainPlotWater({ ...fire, state: 'EMPTY', water: 0.5 }, dt) === 0.5);
    check('PlotData: dry-out time halves on Xích Viêm', plotDryOutMs('XICH_VIEM_THO') * 2 === plotDryOutMs('HOANG_THO'));

    // Economy: yieldMult flows into harvest stones; spendDiamonds is the upgrade gate
    const e2 = new EconomySystem();
    e2.init();
    const r2 = e2.harvestFlower('flower_purple_wisteria', { yieldMult: 2 });
    check('Economy: yieldMult 2 doubles harvest stones', r2.spiritStones === 2 * ECONOMY_DEFAULTS.harvestYield.uncommon && r2.yieldMult === 2);
    const rHi = e2.harvestFlower('flower_cyan_orchid', { yieldMult: 1.1, rng: () => 0.05 });
    const rLo = e2.harvestFlower('flower_cyan_orchid', { yieldMult: 1.1, rng: () => 0.5 });
    check('Economy: +10% yield on a 1-stone bloom pays a 2nd stone 10% of the time', rHi.spiritStones === 2 && rLo.spiritStones === 1);
    e2.addDiamonds(30, 'test-grant');
    const before = e2.spiritStones;
    const ok20 = e2.spendDiamonds(SOIL_TYPES.HAN_NGOC_THO.upgradeCost, 'soil-upgrade:HAN_NGOC_THO');
    check('Economy: soil upgrade deducts exactly 20 💎', ok20.success === true && e2.spiritStones === before - 20);
    const poor = new EconomySystem(); poor.init();
    check('Economy: cannot afford Tức Nhưỡng at 10 💎', poor.spendDiamonds(SOIL_TYPES.TUC_NHUONG.upgradeCost, 'soil-upgrade').success === false && poor.spiritStones === 10);

    // Scene wiring (static)
    const sceneSoil = fs.readFileSync(path.resolve('src/scenes/GardenScene.js'), 'utf8');
    check('Scene: preloads SOIL_TEXTURES, upgrades via economy.spendDiamonds, swaps texture with tween + particles',
        /SOIL_TEXTURES/.test(sceneSoil) && /spendDiamonds\(target\.upgradeCost/.test(sceneSoil)
        && /applySoilTexture/.test(sceneSoil) && /emitParticleAt\(tile\.x, tile\.y - 20, 18\)/.test(sceneSoil)
        && /tickSoilWater\(delta\)/.test(sceneSoil) && /yieldMult: soilYieldMult/.test(sceneSoil) && /hydratePlotData/.test(sceneSoil));
}

// --- Bí Cảnh (Secret Realms) expedition system ---
{
    const {
        REALMS, REALM_IDS, REALM_ORDER, REALM_SEEDS, REALM_SEED_BY_ID,
        resolveRealm, getSeedsForRealm, canPlantInRealm,
        realmHasUniformTile, getUnlockedRealms,
    } = await import('../src/data/RealmsData.js');

    check('RealmsData: 2 realms defined', Object.keys(REALMS).length === 2);
    check('RealmsData: REALM_ORDER has 2 entries', REALM_ORDER.length === 2);
    check('RealmsData: DEFAULT_GARDEN is first in order', REALM_ORDER[0] === 'DEFAULT_GARDEN');
    check('RealmsData: FROST_REALM is second in order', REALM_ORDER[1] === 'FROST_REALM');

    // Realm definitions
    check('RealmsData: DEFAULT_GARDEN has correct background key', REALMS.DEFAULT_GARDEN.backgroundKey === 'bg_manor_isometric');
    check('RealmsData: FROST_REALM has frost background key', REALMS.FROST_REALM.backgroundKey === 'bg_frost_realm');
    check('RealmsData: FROST_REALM has uniform tile', REALMS.FROST_REALM.tileTextureKey === 'tile_frost_soil');
    check('RealmsData: DEFAULT_GARDEN has no uniform tile', REALMS.DEFAULT_GARDEN.tileTextureKey === null);
    check('RealmsData: FROST_REALM has 2 exclusive seeds', REALMS.FROST_REALM.exclusiveSeeds.length === 2);
    check('RealmsData: DEFAULT_GARDEN has no exclusive seeds', REALMS.DEFAULT_GARDEN.exclusiveSeeds.length === 0);

    // resolveRealm
    check('RealmsData: resolveRealm returns correct realm', resolveRealm('FROST_REALM').id === 'FROST_REALM');
    check('RealmsData: resolveRealm falls back to DEFAULT_GARDEN for unknown', resolveRealm('BOGUS').id === 'DEFAULT_GARDEN');

    // realmHasUniformTile
    check('RealmsData: realmHasUniformTile true for FROST_REALM', realmHasUniformTile('FROST_REALM') === true);
    check('RealmsData: realmHasUniformTile false for DEFAULT_GARDEN', realmHasUniformTile('DEFAULT_GARDEN') === false);

    // REALM_SEEDS
    check('RealmsData: 2 realm-exclusive seeds', REALM_SEEDS.length === 2);
    check('RealmsData: Băng Liên seed exists', !!REALM_SEED_BY_ID['flower_bang_lien']);
    check('RealmsData: Tuyết Chi seed exists', !!REALM_SEED_BY_ID['flower_tuyet_chi']);
    check('RealmsData: Băng Liên belongs to FROST_REALM', REALM_SEED_BY_ID['flower_bang_lien'].realmId === 'FROST_REALM');

    // getSeedsForRealm
    check('RealmsData: DEFAULT_GARDEN returns empty (uses standard catalog)', getSeedsForRealm('DEFAULT_GARDEN').length === 0);
    check('RealmsData: FROST_REALM returns 2 exclusive seeds', getSeedsForRealm('FROST_REALM').length === 2);

    // canPlantInRealm
    check('RealmsData: standard seeds plantable in DEFAULT_GARDEN', canPlantInRealm('flower_cyan_orchid', 'DEFAULT_GARDEN') === true);
    check('RealmsData: standard seeds NOT plantable in FROST_REALM', canPlantInRealm('flower_cyan_orchid', 'FROST_REALM') === false);
    check('RealmsData: Băng Liên plantable in FROST_REALM', canPlantInRealm('flower_bang_lien', 'FROST_REALM') === true);
    check('RealmsData: Băng Liên NOT plantable in DEFAULT_GARDEN', canPlantInRealm('flower_bang_lien', 'DEFAULT_GARDEN') === false);

    // getUnlockedRealms
    const unlocked = getUnlockedRealms();
    check('RealmsData: both realms unlocked', unlocked.length === 2);
    check('RealmsData: first unlocked is DEFAULT_GARDEN', unlocked[0].id === 'DEFAULT_GARDEN');

    // Realm-specific NPC guardians (Task: realm NPCs + radiant aura)
    check('RealmsData: DEFAULT_GARDEN NPC is Tiên Nữ Hoa Giang', REALMS.DEFAULT_GARDEN.npc?.name === 'Tiên Nữ Hoa Giang');
    check('RealmsData: DEFAULT_GARDEN NPC sprite is the default fairy', REALMS.DEFAULT_GARDEN.npc?.spriteKey === 'npc_tien_nu');
    check('RealmsData: FROST_REALM NPC is Băng Băng Tiên Tử', REALMS.FROST_REALM.npc?.name === 'Băng Băng Tiên Tử');
    check('RealmsData: FROST_REALM NPC sprite is npc_frost_fairy.png', REALMS.FROST_REALM.npc?.spriteKey === 'npc_frost_fairy'
        && REALMS.FROST_REALM.npc?.spritePath === './assets/npc/npc_frost_fairy.png');
    check('RealmsData: every realm defines an aura tint for its guardian',
        Object.values(REALMS).every((r) => Number.isInteger(r.npc?.auraTint)));

    // Scene wiring (static checks)
    const sceneRealm = fs.readFileSync(path.resolve('src/scenes/GardenScene.js'), 'utf8');
    check('Scene: imports RealmsData', /from '\.\.\/data\/RealmsData\.js'/.test(sceneRealm));
    check('Scene: imports RealmModal', /from '\.\.\/ui\/RealmModal\.js'/.test(sceneRealm));
    check('Scene: creates RealmModal', /new RealmModal\(/.test(sceneRealm));
    check('Scene: has switchRealm method', /switchRealm\(realmId\)/.test(sceneRealm));
    check('Scene: has createRealmEntryPoint', /createRealmEntryPoint\(\)/.test(sceneRealm));
    check('Scene: persists plots on shutdown', /persistCurrentRealmPlots\(\)/.test(sceneRealm));
    check('Scene: loads realm plots before grid', /loadRealmPlots\(this\.activeRealmId\)/.test(sceneRealm));
    check('Scene: uses realm-aware background', /this\.activeRealm\.backgroundKey/.test(sceneRealm));
    check('Scene: seed drawer uses getDrawerSeeds', /getDrawerSeeds\(\)/.test(sceneRealm));
    // Realm NPC swap + radiant Celestial Aura (Hào Quang)
    check('Scene: reads the realm NPC config (getActiveNpcConfig)', /getActiveNpcConfig\(\)/.test(sceneRealm));
    check('Scene: swaps the NPC sprite from the realm config', /npcTextureKey = this\.textures\.exists\(npc\.spriteKey\) \? npc\.spriteKey : 'npc_tien_nu'/.test(sceneRealm));
    check('Scene: labels the NPC with the realm name', /this\.npcName = this\.add\.text\(0, 132, npc\.name/.test(sceneRealm));
    check('Scene: celestial aura uses additive blending (BlendModes.ADD)', /npcAura[\s\S]{0,220}BlendModes\.ADD/.test(sceneRealm));
    check('Scene: aura breathes (scale 0.95 → 1.08, alpha 0.5 → 0.85)', /scale: \{ from: 0\.95, to: 1\.08 \}/.test(sceneRealm) && /alpha: \{ from: 0\.5, to: 0\.85 \}/.test(sceneRealm));
    check('Scene: NPC keeps a midnight radiance mirror above the ambient wash', /syncNpcNightRadiance/.test(sceneRealm) && /LAYERS\.AMBIENT \+ 2/.test(sceneRealm));
    check('Scene: realm NPC sprite is preloaded for every realm', /REALMS\[realmId\]\.npc[\s\S]{0,160}load\.image\(npc\.spriteKey, npc\.spritePath\)/.test(sceneRealm));
}

// --- Cửa Hàng Hoa Viên (Garden Shop) ---
{
    // Dialogue route into the shop
    check('Dialog: shop_greeting node exists with the NPC greeting', typeof NPC_DIALOGUE.shop_greeting?.text === 'string'
        && NPC_DIALOGUE.shop_greeting.text.includes('Tiên hữu ghé thăm Hoa Các, cần tìm bảo giống gì?'));
    check('Dialog: shop_greeting offers both tabs via actions',
        NPC_DIALOGUE.shop_greeting.choices.some((c) => c.action === 'open_shop_seeds')
        && NPC_DIALOGUE.shop_greeting.choices.some((c) => c.action === 'open_shop_sell'));
    check('Dialog: greeting_default routes to Hoa Các', NPC_DIALOGUE.greeting_default.choices.some((c) => c.next === 'shop_greeting'));
    check('Dialog: every greeting_default choice has a target node', NPC_DIALOGUE.greeting_default.choices.every((c) => !!NPC_DIALOGUE[c.next]));

    // Shop UI module + scene entry points (static)
    const shopSrc = fs.readFileSync(path.resolve('src/ui/GardenShopModal.js'), 'utf8');
    check('Shop: modal module exists with both tabs', /Kỳ Hoa Dị Thảo/.test(shopSrc) && /Tiên Thiên Đổi Báu/.test(shopSrc));
    check('Shop: modal uses the dark Guofeng panel (#121016) + gold border', /0x121016/.test(shopSrc) && /0xdfb15b/.test(shopSrc));
    check('Shop: modal stops pointer propagation (shield + guarded)', /createPanelShield/.test(shopSrc) && /guarded\(/.test(shopSrc) && /bindBackdropClose/.test(shopSrc));
    const sceneShop = fs.readFileSync(path.resolve('src/scenes/GardenScene.js'), 'utf8');
    check('Scene: NPC tap + HUD button both open the Garden Shop', /onNpcClick\(\)[\s\S]{0,400}openGardenShop\(\)/.test(sceneShop) && /createShopEntryPoint\(\)/.test(sceneShop));
    check('Scene: registers GardenShopModal and blocks UI while open', /new GardenShopModal\(/.test(sceneShop) && /shopModal\?\.isOpen\(\)/.test(sceneShop));

    // Shop economy (live)
    const eco = new EconomySystem();
    eco.init();
    check('Shop economy: purple seed has a Hòa Hợp price', eco.getSeedHarmonyPrice('flower_purple_wisteria') === 8);
    check('Shop economy: Băng Liên has a Hòa Hợp price (realm exclusive)', eco.getSeedHarmonyPrice('flower_bang_lien') === 12);
    check('Shop economy: sell table pays purple 3✿ +1💎', JSON.stringify(eco.getSeedSellValue('flower_purple_wisteria')) === JSON.stringify({ harmony: 3, stones: 1 }));

    const bought = eco.purchaseSeedWithHarmony('flower_purple_wisteria');
    check('Shop economy: fresh economy (0✿) cannot afford the 8✿ seed', bought.success === false && eco.getInventoryCount('flower_purple_wisteria') === 0);
    {
        const e2 = new EconomySystem();
        e2.init();
        e2.harmony = 30;
        const r = e2.purchaseSeedWithHarmony('flower_purple_wisteria');
        check('Shop economy: harmony purchase costs 8✿ and stocks the packet', r.success === true && e2.harmony === 22 && e2.getInventoryCount('flower_purple_wisteria') === 1);
    }
    {
        // sell flow round trip: stock → sell → currencies in
        const e4 = new EconomySystem();
        e4.init();
        e4.inventory.flower_golden_amber = 3;
        const s1 = e4.sellFlower('flower_golden_amber', 1);
        check('Shop economy: selling 1 golden amber pays +5✿ +1💎', s1.success === true && s1.harmony === 5 && s1.spiritStones === 1 && e4.getInventoryCount('flower_golden_amber') === 2);
        const s2 = e4.sellFlower('flower_golden_amber', Infinity);
        check('Shop economy: selling the rest pays the full batch', s2.sold === 2 && s2.harmony === 10 && s2.spiritStones === 2 && e4.getInventoryCount('flower_golden_amber') === 0);
        const s3 = e4.sellFlower('flower_golden_amber', 1);
        check('Shop economy: selling with an empty bag is refused', s3.success === false && s3.sold === 0);
        const h = e4.spendHarmony(e4.harmony, 'test');
        check('Shop economy: spendHarmony drains the balance exactly', h.success === true && e4.harmony === 0);
    }
    {
        // grantSeed: the realm-seed purchase path credits the inventory + bus
        const e5 = new EconomySystem().bind({ emit: (name, payload) => { e5._last = { name, payload }; } });
        e5.init();
        e5.grantSeed('flower_bang_lien');
        check('Shop economy: grantSeed stocks a realm seed and announces it',
            e5.getInventoryCount('flower_bang_lien') === 1 && e5._last.name === 'economy:seed-purchased');
    }
}

console.log(fails === 0 ? '\nALL TESTS PASSED' : `\n${fails} TEST(S) FAILED`);
process.exit(fails === 0 ? 0 : 1);
