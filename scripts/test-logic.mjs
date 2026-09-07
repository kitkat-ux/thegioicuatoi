// Pure-logic smoke tests (no browser needed): isometric math + search filter.
import { IsoMath } from '../src/core/IsoMath.js';
import { SEED_CATALOG, normalizeText, SEED_BY_ID } from '../src/data/seedCatalog.js';

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
check('empty query -> all 4', filter('').length === 4);
check('garbage query -> none', filter('zzzz').length === 0);

// --- Catalog integrity ---
check('catalog has 4 seeds', SEED_CATALOG.length === 4);
check('sprite keys exist in catalog', ['flower_purple', 'flower_golden', 'flower_cyan', 'flower_emerald'].every(
    (k) => SEED_CATALOG.some((s) => s.sprite_key === k)
));
check('SEED_BY_ID complete', ['flower_cyan_orchid', 'flower_purple_wisteria', 'flower_golden_amber', 'flower_emerald_bamboo'].every(
    (id) => SEED_BY_ID[id]
));

console.log(fails === 0 ? '\nALL TESTS PASSED' : `\n${fails} TEST(S) FAILED`);
process.exit(fails === 0 ? 0 : 1);
