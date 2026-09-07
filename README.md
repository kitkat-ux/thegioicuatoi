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
public/assets/images/          # game art (AI-generated + processed)
  bg_manor_isometric.png       #   2.5D isometric Xianxia water manor (1080x1920)
  tile_soil.png                #   2:1 isometric soil diamond (128x64)
  flower_{purple,golden,cyan,emerald}.png
  icon_{seed_drawer,water_bucket,search}.png
src/
  main.js                      # Phaser.Game config (Scale.FIT, DOM container)
  core/IsoMath.js              # pure iso projection math (unit-tested)
  data/seedCatalog.js          # flower catalog from 04_LEVEL_DATA_LEVEL_01.md
  vfx/TextureFactory.js        # procedural canvas textures + load fallbacks
  audio/AudioManager.js        # WebAudio pentatonic guzheng/flute/chimes
  scenes/GardenScene.js        # grid, search drawer, planting, watering, modal
scripts/
  process-assets.mjs           # background-key + trim + resize pipeline (sharp)
  test-logic.mjs               # IsoMath + search filter unit tests
  runtime-test.mjs             # headless Phaser boot + full gameplay test
  debug-overlay.mjs            # alignment composite over the real background
```

## Feature Map (per spec docs)

- **01 GDD** — 6x6 isometric grid of soil, seed search & select, tap-to-plant,
  one-click water growth phase, bloom → Harmony Points.
- **02 Art** — all assets generated in the 2.5D Guofeng aesthetic; any asset that
  fails to load is auto-replaced by a procedural Canvas fallback
  (`TextureFactory.ensureFallbackTextures`).
- **03 Tech** — `IsoMath` projection (128x64 tiles, origin 540,950) with a
  corrected `screenToGrid` inverse; interactive diamond hit areas.
- **04 Level 01** — 4-flower catalog with Vietnamese/English/Chinese keywords,
  diacritic-insensitive real-time search ("tim", "vang", "xanh", "gold", "blue").
- **05 Audio/VFX/Monetization** — procedural pentatonic WebAudio (no audio files),
  petal-burst particle emitters, ethereal mist, bloom radiance, and a rewarded-ad
  modal that waters all tiles at once (+3 Harmony).
- **Phases 1–5 of the build directive** — repo ingested, project scaffolded,
  assets generated, mechanics implemented, `npm run build` verified, tile
  coords aligned to the pavilion estate, live preview served.

## Testing

```bash
npm run test:logic    # IsoMath round-trip + search filter (18 assertions)
npm run test:runtime  # headless Phaser boot of the real scene + full gameplay loop
npm run overlay       # render layout check composite onto the background
```

The runtime suite boots the actual `GardenScene` in `Phaser.HEADLESS` (jsdom +
@napi-rs/canvas) and drives: drawer open → search filter → seed select → plant →
one-click water → staggered bloom → rewarded ad → harmony gain, asserting tile
state transitions with zero console errors.
