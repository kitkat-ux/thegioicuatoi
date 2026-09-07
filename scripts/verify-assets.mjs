// Asset integrity over HTTP: boots nothing — just verifies that every asset
// the game preloads (the list in GardenScene.preload) is actually served with
// HTTP 200 and zero 404s, so the procedural canvas fallbacks never trigger.
//
// Usage:
//   node scripts/verify-assets.mjs [baseUrl]     (default http://localhost:4173)
//
// The asset list is extracted from src/scenes/GardenScene.js so this check can
// never drift from what the game actually loads.
import fs from 'fs';

const BASE = (process.argv[2] || 'http://localhost:4173').replace(/\/$/, '');
const sceneSrc = fs.readFileSync('src/scenes/GardenScene.js', 'utf8');

const match = sceneSrc.match(/const assets = \[([\s\S]*?)\]/);
if (!match) {
    console.error('FAIL could not find the preload asset list in GardenScene.js');
    process.exit(1);
}
const assets = [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);

// Every public image must also exist on disk
const files = fs.readdirSync('public/assets/images').filter((f) => f.endsWith('.png'));

let fails = 0;
const results = [];

async function check(url, label) {
    try {
        const res = await fetch(url, { method: 'GET', redirect: 'follow' });
        const ok = res.status === 200;
        if (!ok) fails++;
        results.push({ label, url, status: res.status, type: res.headers.get('content-type') || '' });
    } catch (e) {
        fails++;
        results.push({ label, url, status: `ERR ${e.message}`, type: '' });
    }
}

// index page
await check(`${BASE}/`, 'index.html');

for (const key of assets) {
    const rel = `./assets/images/${key}.png`;
    const onDisk = fs.existsSync(`public/assets/images/${key}.png`);
    if (!onDisk) {
        fails++;
        results.push({ label: key, url: rel, status: 'MISSING ON DISK', type: '' });
        continue;
    }
    await check(`${BASE}/assets/images/${key}.png`, key);
}

for (const r of results) {
    const ok = r.status === 200;
    console.log(`${ok ? '200' : 'FAIL'}  ${String(r.status).padEnd(18)} ${r.label.padEnd(24)} ${r.url}  ${r.type}`);
}

// any public png not in the preload list (informational)
const preloaded = new Set(assets.map((a) => `${a}.png`));
const unreferenced = files.filter((f) => !preloaded.has(f));
if (unreferenced.length) {
    console.log(`\nnote: files present but not preloaded (loaded dynamically or unused): ${unreferenced.join(', ')}`);
}

console.log(`\n${assets.length} preloaded assets + index checked — ${fails} failure(s), ${assets.filter((a) => true).length - fails >= 0 ? '' : ''}404 count must be zero`);
const notFound = results.filter((r) => r.status === 404).length;
console.log(`404s: ${notFound}`);

if (fails > 0 || notFound > 0) {
    console.error('ASSET VERIFICATION FAILED');
    process.exit(1);
}
console.log('ASSET VERIFICATION PASSED — all assets HTTP 200, zero 404s (no canvas fallbacks will trigger)');
