# PROJECT FLORAL MANOR: 2.5D GUOFENG GARDEN SIMULATION

## 1. Project Overview
A 2.5D Isometric Chinese Fantasy (Cổ phong / Tiên hiệp) garden simulation game built with Phaser 3 / HTML5 Canvas. Players manage a floating ethereal estate, search flower varieties, and plant seeds onto an isometric grid to cultivate blooming floral art patterns.

## 2. Architecture & File Structure
- `01_GDD_CORE_MECHANICS.md`: Isometric grid planting, seed search & filter engine, floral mosaic pattern system.
- `02_ART_GENERATION_PROMPTS.md`: Image generation prompts for Arena.ai (Isometric estate background, floral sprites, UI).
- `03_TECH_SPEC_ENGINE_CODE.md`: Isometric math projection ($x, y \rightarrow screenX, screenY$), tilemap controller, and search algorithm.
- `04_LEVEL_DATA_LEVEL_01.md`: Flower catalog database with color hex codes and target plot layout.
- `05_AUDIO_VFX_MONETIZATION.md`: Guzheng ambient BGM, bloom sparkles, and "One-tap Water" rewarded ad flow.

## 3. Autonomous Execution for Arena.ai
1. Generate 2.5D isometric art assets via `02_ART_GENERATION_PROMPTS.md`.
2. Scaffold Phaser 3 engine with isometric coordinate projection based on `03_TECH_SPEC_ENGINE_CODE.md`.
3. Ingest flower catalog data from `04_LEVEL_DATA_LEVEL_01.md`.
4. Implement audio, particle VFX, and deploy playable preview.
