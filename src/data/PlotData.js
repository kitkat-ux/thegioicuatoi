/**
 * PlotData — the pure-logic record behind every soil tile's `gridData`.
 *
 * GardenScene owns the sprites; this module owns the numbers so the soil
 * multipliers (growth timers, water drain, yield) can be unit tested without
 * Phaser. Everything here is side-effect free.
 */
import { SEED_BY_ID } from './seedCatalog.js';
import {
    DEFAULT_SOIL_ID,
    resolveSoil,
    soilGrowthMs,
    soilWaterDrain,
    soilIsWatered,
} from './SoilTypes.js';

export const PLOT_STATE = { EMPTY: 'EMPTY', PLANTED: 'PLANTED', GROWING: 'GROWING', BLOOMING: 'BLOOMING' };

/** Base water drain: a freshly watered plot on common loam dries out in 90s. */
export const BASE_WATER_DRAIN_PER_MS = 1 / 90000;

/** Fresh plot record (what createGrid() hands each tile). */
export function createPlotData(row, col, soilType = DEFAULT_SOIL_ID) {
    return {
        row,
        col,
        state: PLOT_STATE.EMPTY,
        seedId: null,
        soilType: resolveSoil(soilType).id,
        watered: false,
        water: 0,          // 0..1 moisture level (drains over time)
        rainWatered: false,
        plantedAt: 0,
        plantSprites: null,
        bloomSprite: null,
        bloomGlow: null,
    };
}

/**
 * Backward-compatible hydration of a saved plot: legacy saves have no
 * soilType / water fields. Unknown soils fall back to HOANG_THO.
 */
export function hydratePlotData(saved = {}, row = saved.row ?? 0, col = saved.col ?? 0) {
    const fresh = createPlotData(row, col, saved.soilType);
    const state = Object.values(PLOT_STATE).includes(saved.state) ? saved.state : PLOT_STATE.EMPTY;
    const seedId = saved.seedId && SEED_BY_ID[saved.seedId] ? saved.seedId : null;
    return {
        ...fresh,
        state: seedId ? state : PLOT_STATE.EMPTY,
        seedId,
        watered: soilIsWatered(!!saved.watered, fresh.soilType),
        water: soilIsWatered(!!saved.watered, fresh.soilType) ? Math.min(1, Math.max(0, saved.water ?? 1)) : 0,
        rainWatered: !!saved.rainWatered,
        plantedAt: saved.plantedAt ?? 0,
    };
}

/** The persistable slice of a plot record (no sprites). */
export function serializePlotData(data) {
    return {
        row: data.row,
        col: data.col,
        state: data.state,
        seedId: data.seedId,
        soilType: data.soilType ?? DEFAULT_SOIL_ID,
        watered: !!data.watered,
        water: data.water ?? 0,
        rainWatered: !!data.rainWatered,
        plantedAt: data.plantedAt ?? 0,
    };
}

/** True when the plot is effectively watered (own flag OR always-wet soil). */
export function isPlotWatered(data) {
    return soilIsWatered(data.watered, data.soilType);
}

/**
 * Bloom timer for this plot's seed on its soil (ms). Extra multipliers
 * (codex Xuân Phù, alchemy Tụ Khí Đan, …) are composed by the caller.
 */
export function plotGrowthMs(data, extraMult = 1) {
    const seed = SEED_BY_ID[data.seedId];
    const base = seed?.growthMs ?? 15000;
    return Math.max(1, Math.round(soilGrowthMs(base, data.soilType) * extraMult));
}

/** Soil-scaled bloom cascade delay for the watering pass. */
export function plotBloomDelay(data, baseDelayMs) {
    return Math.max(0, Math.round(baseDelayMs * resolveSoil(data.soilType).growthMult));
}

/**
 * Advance the moisture level by `deltaMs`. Returns a NEW water level;
 * always-watered soils stay pinned at 1. Only GROWING / PLANTED plots drain.
 */
export function drainPlotWater(data, deltaMs) {
    if (resolveSoil(data.soilType).alwaysWatered) return 1;
    if (data.state !== PLOT_STATE.GROWING && data.state !== PLOT_STATE.PLANTED) return data.water ?? 0;
    const drain = soilWaterDrain(BASE_WATER_DRAIN_PER_MS, data.soilType) * Math.max(0, deltaMs);
    return Math.max(0, (data.water ?? 0) - drain);
}

/** Milliseconds until a fully watered plot on this soil is bone dry (Infinity when it never dries). */
export function plotDryOutMs(soilType) {
    const drain = soilWaterDrain(BASE_WATER_DRAIN_PER_MS, soilType);
    return drain > 0 ? Math.round(1 / drain) : Infinity;
}
