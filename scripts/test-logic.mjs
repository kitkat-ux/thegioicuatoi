// Pure-logic smoke tests (no browser needed): isometric math + search filter + economy + dialog.
import { IsoMath } from '../src/core/IsoMath.js';
import { SEED_CATALOG, normalizeText, SEED_BY_ID } from '../src/data/seedCatalog.js';
import { EconomySystem, SEED_RARITY, QUESTS, ECONOMY_DEFAULTS } from '../src/systems/EconomySystem.js';
import { DialogSystem, NPC_DIALOGUE, DIALOG_FONT } from '../src/systems/DialogSystem.js';

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

console.log(fails === 0 ? '\nALL TESTS PASSED' : `\n${fails} TEST(S) FAILED`);
process.exit(fails === 0 ? 0 : 1);
