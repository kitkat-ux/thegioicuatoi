# GAME DESIGN DOCUMENT: CORE MECHANICS

## 1. Core Gameplay Loop
1. **Plot Selection:** Player inspects an isometric grid of tilled soil patches ($6 \times 8$ grid) located in the center of an ancient pavilion estate.
2. **Search & Select Seed:** Player opens the seed drawer, uses the search bar (filtering by color, name, or keyword) to pick a specific floral species.
3. **Grid Planting (Floral Art):** Player taps or drags seeds onto specific soil tiles to create color-coordinated floral art patterns.
4. **Care & Growth (1-Tap Care):** Player taps the "Water" or "One-Click Water" button to trigger an estate-wide growth phase.
5. **Bloom & Harmony:** Flowers mature into vibrant blooms, yielding Garden Harmony Points and unlocking rarer celestial seeds.

## 2. Grid Coordinates & Coordinate System
- Layout: 2.5D Isometric Diamond Grid.
- Tile Width: 128px, Tile Height: 64px.
- States per Tile: `EMPTY_SOIL` $\rightarrow$ `PLANTED_SEED` $\rightarrow$ `GROWING_SPROUT` $\rightarrow$ `BLOOMING_FLOWER`.

## 3. Seed Catalog & Filtering Matrix
| Category | Flower Name | Bloom Color | Growth Duration | Aesthetic Role |
| :--- | :--- | :--- | :--- | :--- |
| Celestial Blue | Tinh Trạch U Đàm | Glowing Cyan/Blue | 15s | Water borders, contrast lines |
| Lavender Violet | Hồng Hà Tiên Chi | Radiant Purple | 20s | Background filling, shadows |
| Golden Amber | Đới Ngọc Kim Huyên | Vibrant Yellow/Gold | 25s | Floral mosaic centerpieces |
| Jade Green | Trúc Bích Thanh Hoa | Emerald Green | 10s | Foliage, structural boundaries |
