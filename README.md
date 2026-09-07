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
  npc_tien_nu.png              #   flying fairy (green-screen keyed, true alpha)
  npc_tien_nu_portrait.png     #   square head/torso crop for the dialog header
  bridge_pavilion.png          #   upper bridge pavilion decoration
src/
  main.js                      # Phaser.Game config (Scale.FIT, DOM container)
  core/IsoMath.js              # pure iso projection math (unit-tested)
  data/seedCatalog.js          # flower catalog from 04_LEVEL_DATA_LEVEL_01.md
  vfx/TextureFactory.js        # procedural island/VFX textures + load fallbacks
  audio/AudioManager.js        # WebAudio pentatonic guzheng/flute/chimes
  systems/EconomySystem.js     # spirit stones, inventory, quests (unit-tested)
  systems/DialogSystem.js      # NPC dialogue tree + quest rows (unit-tested)
  scenes/GardenScene.js        # grid, island, NPC, dialog, drawer, watering
scripts/
  process-assets.mjs           # green/black chroma-key + trim + verify pipeline
  test-logic.mjs               # IsoMath + search + economy + dialog unit tests
  runtime-test.mjs             # headless Phaser boot + full gameplay test
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
npm run overlay       # render layout check composite onto the background
```

The runtime suite boots the actual `GardenScene` in `Phaser.HEADLESS` (jsdom +
@napi-rs/canvas) and drives: drawer open → search filter → seed select → plant →
one-click water → staggered bloom → rewarded ad → harmony gain, asserting tile
state transitions with zero console errors. It also verifies the new systems:
NPC placement at the lower bridge deck with the ±4px sinusoidal float, the
floating-island shadow, the 86px/172px button hitboxes with press feedback,
and the dialog Header/Body(180px scroll)/Footer structure with live quest rows.
