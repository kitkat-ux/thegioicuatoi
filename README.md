# PROJECT FLORAL MANOR: 2.5D GUOFENG GARDEN SIMULATION

A 2.5D isometric Chinese Fantasy (Cổ phong / Tiên hiệp) garden simulation built with
**Phaser 3 + Vite**. Players manage an ethereal water-manor estate, search a seed
catalog, plant flowers onto a 6x6 isometric soil grid, and trigger estate-wide blooms
with the one-click water (VIP rewarded) button.

## Play & Build

```bash
npm install
npm run dev        # dev server (port 5173, 1080x1920 portrait, Scale.FIT)
npm run build      # production build -> dist/
npm run preview    # serve the production build
```

## Architecture

```
index.html                     # 1080x1920 portrait shell
public/assets/images/          # game art (AI-generated + keyed to clean RGBA)
  bg_manor_isometric.png       #   2.5D isometric Xianxia water manor (1080x1920)
  tile_soil.png                #   2:1 isometric soil diamond (128x64)
  flower_{purple,golden,cyan,emerald,rare}.png
  icon_{seed_drawer,water_bucket,search,sickle,spirit_stone}.png
  icon_codex_scroll.png        #   Flora Codex medallion (black-screen keyed, 192px)
  npc_tien_nu.png              #   flying fairy (green-screen keyed, true alpha)
  npc_tien_nu_portrait.png     #   square head/torso crop for the dialog header
  bridge_pavilion.png          #   upper bridge pavilion decoration
src/
  main.js                      # Phaser.Game config (Scale.FIT + CENTER_BOTH, DOM container)
  core/IsoMath.js              # pure iso projection math (unit-tested)
  core/Layers.js               # the single render-depth plan (LAYERS.*)
  data/seedCatalog.js          # flower catalog from 04_LEVEL_DATA_LEVEL_01.md
  data/codexLore.js            # Codex biographies, poems, mastery tiers, milestones (VN copy)
  vfx/TextureFactory.js        # procedural island/VFX textures + load fallbacks
  vfx/WeatherView.js           # System 8 renderer: ambient wash, moon, rain, ripples
  ui/CodexModal.js             # System 9 UI: HUD medallion + scrollable rice-paper codex
  audio/AudioManager.js        # WebAudio pentatonic guzheng/flute/chimes + rain bed
  systems/EventManager.js      # the game bus (on/once/off/offOwner/wildcard/history) + EVENTS
  systems/EconomySystem.js     # spirit stones, inventory, quests (unit-tested)
  systems/DialogSystem.js      # NPC dialogue tree + quest rows (unit-tested)
  systems/CodexManager.js      # System 9 state: discoveries, mastery, rewards, buffs (unit-tested)
  systems/WeatherSystem.js     # System 8 state: phases, seasons, rain, full moon (unit-tested)
  scenes/GardenScene.js        # grid, island, NPC, dialog, drawer, watering, bus wiring
scripts/
  process-assets.mjs           # green/black chroma-key + trim + verify pipeline
  verify-asset-standards.mjs   # 07 catalog gate: RGBA, true alpha, corners, budgets
  test-logic.mjs               # IsoMath + search + economy + dialog + bus/systems tests
  runtime-test.mjs             # headless Phaser boot + full gameplay test
  render-test.mjs              # Phaser.CANVAS render path + pixel proofs
  verify-assets.mjs            # HTTP 200 check for every preloaded asset
  debug-overlay.mjs            # alignment composite over the real background
```

## Feature Map (per spec docs)

- **01 GDD** — 6x6 isometric grid of soil, seed search & select, tap-to-plant,
  one-click water growth phase, bloom → Harmony Points.
- **02 Art** — all assets in the 2.5D Guofeng aesthetic. The NPC fairy sprite
  (`npc_tien_nu`) is chroma-keyed from a green screen into a clean 4-channel
  PNG with true alpha (no faux checkerboard). Any asset that fails to load is
  auto-replaced by a procedural Canvas fallback
  (`TextureFactory.ensureFallbackTextures`).
- **03 Tech** — `IsoMath` projection (128x64 tiles, origin 540,950) with a
  corrected `screenToGrid` inverse; interactive diamond hit areas.
- **04 Level 01** — 5-flower catalog with Vietnamese/English/Chinese keywords,
  diacritic-insensitive real-time search ("tim", "vang", "xanh", "gold", "blue").
- **05 Audio/VFX/Monetization** — procedural pentatonic WebAudio (no audio files),
  petal-burst particle emitters, ethereal mist, bloom radiance, and a rewarded-ad
  modal that waters all tiles at once (+3 Harmony).
- **Linh Đảo Phù Vân** — the grid rides a floating celestial stone island:
  jade top surface, jagged 2.5D rock underside with glowing runes and hanging
  vines, plus a soft elliptical shadow (~0.45 alpha) on the water beneath.
- **Tiên Nữ Hoa Giang** — the flying fairy NPC hovers over the bottom-right
  lower bridge deck (890, 1345), facing the grid, with a sinusoidal idle
  float (yoyo −4..+4 px) and a quest-aware dialog (khung thoại) structured as
  Header (portrait + title) / Body (180px scrollable quest list) / Footer
  (response buttons pinned to the bottom). All dialog text uses the Unicode
  font stack `system-ui, -apple-system, sans-serif` for seamless Vietnamese
  diacritics.
- **Bottom action bar** — Seeds · Ornate Sickle · Water Can: ~20% smaller
  visuals (86px rings) with generous invisible 172px touch hitboxes, gentle
  idle breathing, and press feedback (0.9× on pointerdown, bounce to 1.0×).
- **System 8 · Thiên Thời Tứ Thời (`WeatherSystem` + `WeatherView`)** — a
  105 s day/dusk/night cycle (45/22/38 s) drifts through the four seasons.
  Xuân rains (Mưa Phùn Linh Tuyền): falling streaks, water ripples, splash
  crowns over the island and a filtered-noise rain bed, and *every unwatered
  seeded plot is watered for free* (`RAIN_IRRIGATE` → `GardenScene.rainIrrigate`).
  Full-moon nights (every 4th day) double Harmony (`harmonyMult 2`) and boost
  night-glow blooms. Light is applied by one full-screen wash eased with
  `lerp` (never snapped) so the garden fades rather than flickers.
- **System 9 · Vạn Hoa Đồ Giám (`CodexManager` + `CodexModal`)** — the jade-roller
  scroll behind the HUD medallion (958, 322) records every species, writes a
  poem on first bloom, tracks mastery per flower (Mộc Dịch → Linh Cản → Thiên
  Hương at 3/8/15 harvests) and grants titles, skins and flat buffs
  (+Harmony, +Spirit Stones, growth speed, night glow, `harmonyMult`).
  It only ever learns from gameplay facts published on the bus
  (`FLOWER_BLOOMED` / `FLOWER_HARVESTED`) — it never reads the scene.
- **Event bus** — `EventManager` (`gameBus`) is the single channel between
  systems and views (`on/once/off/offOwner/wildcard/suspend/history/clear`).
  Systems never import each other; the scene composes their modifiers and
  hands one object to the economy. `npm run test:logic` enforces that rule.
- **Render-depth plan** — `src/core/Layers.js` is the only place depths are
  defined. `LAYERS.AMBIENT` (1100) is the divider: the island, tiles, FX and
  weather sit below it (so night dims them), and every piece of UI — hint bar,
  HUD, action bar, drawer, dialogs, modals, codex, toasts — sits above it (so
  ambient light can never dim a button). `npm run test:render` proves it at the
  pixel level; `npm run test:runtime` proves the depth ordering.
- **Desktop presentation** — the 9:16 stage is letterboxed by `Scale.FIT` +
  `CENTER_BOTH` in WebGL, and the page shell centres the canvas with a
  flex `margin:auto` box whose background matches the Phaser
  `backgroundColor` (`#0b0c16`), so the FIT bars are invisible instead of a
  white frame, and `scale.refresh()`/`updateCenter()` re-seat the canvas after
  every window resize.
- **06 Roadmap** — `06_EXPANDED_SYSTEMS_ROADMAP.md` details the 10 future
  systems (multi-biome realms, zen fishing, beast ranching, flower breeding,
  alchemy crafting, visitor orders, Feng Shui buffs, dynamic weather, flora
  codex, idle automation).

## Testing

```bash
npm run test:logic    # IsoMath round-trip + search filter + economy + dialog (assertions)
npm run test:runtime  # headless Phaser boot of the real scene + full gameplay loop
npm run test:render   # Phaser.CANVAS render-path check + real-asset composite proof
npm run verify:assets # HTTP 200 check for every preloaded asset (zero 404s)
npm run verify:format # 07 asset-standards gate (RGBA, true alpha, key residue, budgets)
npm run overlay       # render layout check composite onto the background
npm test              # test:logic + verify:format + test:runtime
```

The runtime suite boots the actual `GardenScene` in `Phaser.HEADLESS` (jsdom +
@napi-rs/canvas) and drives: drawer open → search filter → seed select → plant →
one-click water → staggered bloom → rewarded ad → harmony gain, asserting tile
state transitions with zero console errors. It also drives the Phase-1 systems:
codex discovery through the bus only, the scroll's open/close + masked
scroll-clamp behaviour, the HUD medallion badge, depth ordering against
`LAYERS.AMBIENT`, dry plots auto-watered by `forceRain`, dusk→night tinting, and
the full-moon × codex reward composition — plus `npm run test:render` compares
the night frame with the wash on/off to prove the world dims while the UI does
not. It also verifies the older systems:
NPC placement at the lower bridge deck with the ±4px sinusoidal float, the
floating-island shadow, the 86px/172px button hitboxes with press feedback,
and the dialog Header/Body(180px scroll)/Footer structure with live quest rows.
