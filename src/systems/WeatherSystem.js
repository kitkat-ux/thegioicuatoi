/**
 * WeatherSystem — System 8: THIÊN THỜI TỨ THỜI (Khí Vận & Chu Kỳ Tiết Khí)
 * Dynamic weather + day/night lighting, per 06_EXPANDED_SYSTEMS_ROADMAP.md #8.
 *
 *   · Chu kỳ ngày/đêm nhẹ nhàng  → a 3-phase ambient cycle (Ngày · Hoàng Hôn ·
 *     Ban Đêm) whose tint/alpha the scene paints over the garden.
 *   · Mưa Xuân ("Mưa Phùn Linh Tuyền") → spring rain that AUTOMATICALLY puts
 *     every unwatered plot into the watered state (the weather buff).
 *   · Đêm Trăng Tròn → every `moonCycle`-th night doubles the Harmony Points
 *     earned from harvesting.
 *
 * This module is the *simulation*: pure state + rules, no Phaser and no DOM,
 * so it is unit-testable in plain Node (like EconomySystem). It never touches
 * tiles or textures itself — it publishes facts on the EventManager bus and the
 * scene / vfx view react. That keeps weather a first-class system instead of a
 * pile of tweens living inside GardenScene.
 */
import { EVENTS } from './EventManager.js';

export const PHASE = {
    DAY: 'day',
    DUSK: 'dusk',
    NIGHT: 'night',
};

export const PHASE_LABEL = {
    [PHASE.DAY]: 'Ban Ngày',
    [PHASE.DUSK]: 'Hoàng Hôn',
    [PHASE.NIGHT]: 'Ban Đêm',
};

export const CONDITION = {
    CLEAR: 'clear',
    SPRING_RAIN: 'spring_rain',
};

export const CONDITION_LABEL = {
    [CONDITION.CLEAR]: 'Nắng Đẹp',
    [CONDITION.SPRING_RAIN]: 'Mưa Phùn Linh Tuyền',
};

/** The four tiết (seasons). Only spring rolls rain by default. */
export const SEASONS = [
    { key: 'xuan', name: 'Xuân', rainChance: 0.7, tint: 0x9fe8c8 },
    { key: 'ha', name: 'Hạ', rainChance: 0.0, tint: 0xffd97a },
    { key: 'thu', name: 'Thu', rainChance: 0.0, tint: 0xffb77a },
    { key: 'dong', name: 'Đông', rainChance: 0.0, tint: 0xbfd8ff },
];

/**
 * Ambient light per phase. `tint`/`alpha` are consumed by WeatherView as a
 * MULTIPLY wash; `glow` scales bloom radiance, `lamp` lights the stone lantern
 * runes / island aura at night ("đèn đá tự thắp sáng").
 */
export const AMBIENT = {
    // Day is intentionally alpha 0: the wash only ever *adds* atmosphere, so
    // midday stays pixel-clean (no haze over the island, no muddied shadows).
    [PHASE.DAY]: {
        tint: 0xfff3d9, alpha: 0.0, glow: 1.0, lamp: 0.0, contrast: 1.0,
        description: 'Nắng hoa viên — linh khí tuần hòa, đất nhanh khô.',
    },
    [PHASE.DUSK]: {
        tint: 0xff9550, alpha: 0.32, glow: 1.15, lamp: 0.35, contrast: 0.96,
        description: 'Hoàng hôn ngả vàng — hoa ngậm hương chờ đêm.',
    },
    [PHASE.NIGHT]: {
        tint: 0x3d5a9e, alpha: 0.58, glow: 1.5, lamp: 1.0, contrast: 0.9,
        description: 'Ban đêm — đèn đá tự sáng, hoa dạ quang dịu mắt.',
    },
};

export const WEATHER_DEFAULTS = {
    /** milliseconds per phase — one full day cycle is ~105s of play */
    phaseMs: { [PHASE.DAY]: 45000, [PHASE.DUSK]: 22000, [PHASE.NIGHT]: 38000 },
    phaseOrder: [PHASE.DAY, PHASE.DUSK, PHASE.NIGHT],
    /** how many day-cycles one season lasts (2 → spring on days 1-2) */
    seasonCycleLength: 2,
    /** every Nth night is a full moon (Đêm Trăng Tròn → x2 Harmony) */
    moonCycle: 4,
    /** rain duration window (ms) */
    rainMs: { min: 20000, max: 38000 },
    /** rain is rolled once per phase change (only when the season allows it) */
    rainChanceScale: 1,
    /** the weather buff: rain waters every unwatered plot (06 roadmap #8) */
    autoWaterWhileRaining: true,
    /** full-moon harmony multiplier */
    fullMoonHarmonyMult: 2,
    /** rain dampens light so plots dry slower (scene hint text + mood) */
    rainHarmonyBonus: 0,
    /** deterministic RNG seed so the cycle is reproducible in tests */
    seed: 20260907,
    /** start the day at dawn-ish daylight */
    startPhase: PHASE.DAY,
};

/** tiny deterministic PRNG (mulberry32) — reproducible weather in tests */
export function makeRng(seed = 1) {
    let a = seed >>> 0;
    return function rng() {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export class WeatherSystem {
    constructor(config = {}) {
        this.config = { ...WEATHER_DEFAULTS, ...config };
        this.init();
    }

    init() {
        const c = this.config;
        this.phase = c.startPhase;
        this.phaseElapsed = 0;
        this.phaseDuration = c.phaseMs[this.phase];
        this.cycleCount = 0;
        this.dayCount = 1;
        this.seasonIndex = 0;
        this.condition = CONDITION.CLEAR;
        this.conditionElapsed = 0;
        this.conditionDuration = 0;
        this.isFullMoon = false;
        this.rainRollDone = false;
        this.timeOfDay = this._phaseProgress(); // 0..1 across the whole cycle
        this.rng = makeRng(c.seed);
        this.bus = null;
        this.log = []; // last few transitions (debug + tests)
    }

    /* ------------------------------ bus wiring ----------------------------- */

    /** Publish weather facts on the shared EventManager bus. */
    bind(bus) {
        this.bus = bus || null;
        return this;
    }

    unbind() {
        this.bus = null;
        return this;
    }

    _publish(event, payload) {
        if (this.bus && typeof this.bus.emit === 'function') this.bus.emit(event, payload);
    }

    /* -------------------------------- clock -------------------------------- */

    totalCycleMs() {
        const { phaseMs, phaseOrder } = this.config;
        return phaseOrder.reduce((sum, p) => sum + phaseMs[p], 0);
    }

    /** 0..1 progress through the current phase. */
    _phaseProgress() {
        return Math.min(1, Math.max(0, this.phaseElapsed / Math.max(1, this.phaseDuration)));
    }

    /** Elapsed ms since the start of the day cycle (for HUD/serialization). */
    cycleElapsedMs() {
        const { phaseOrder, phaseMs } = this.config;
        let ms = 0;
        for (const p of phaseOrder) {
            if (p === this.phase) return ms + this.phaseElapsed;
            ms += phaseMs[p];
        }
        return ms;
    }

    /**
     * Advance the simulation.
     * @param {number} deltaMs real frame delta (clamped by the caller)
     * @returns {{phaseChanged:boolean, conditionChanged:boolean, from?:string, to?:string}}
     */
    tick(deltaMs = 0) {
        const result = { phaseChanged: false, conditionChanged: false };
        const dt = Math.max(0, Math.min(deltaMs || 0, 250)); // clamp tab-stall jumps
        if (!dt) {
            this.timeOfDay = this._phaseProgress();
            return result;
        }

        this.phaseElapsed += dt;
        if (this.condition !== CONDITION.CLEAR) {
            this.conditionElapsed += dt;
            if (this.conditionElapsed >= this.conditionDuration) this._endCondition('duration', result);
        }
        if (this.phaseElapsed >= this.phaseDuration) {
            this._advancePhase(result);
        }
        this.timeOfDay = this._phaseProgress();
        return result;
    }

    _advancePhase(result) {
        const c = this.config;
        const order = c.phaseOrder;
        const from = this.phase;
        const idx = order.indexOf(from);
        this.phaseElapsed -= this.phaseDuration;

        let nextIdx = idx + 1;
        if (nextIdx >= order.length) {
            nextIdx = 0;
            this.cycleCount++;
            this.dayCount++;
        }
        this.phase = order[nextIdx];
        this.phaseDuration = c.phaseMs[this.phase];

        // wrap into a new day → new season (tiết) and a new full-moon check
        const wrapped = nextIdx === 0;
        if (wrapped) {
            // one season spans `seasonCycleLength` day-cycles (day N carries
            // cycleCount N-1, so spring covers days 1-2 with the default 2)
            this.seasonIndex =
                Math.floor(this.cycleCount / c.seasonCycleLength) % SEASONS.length;
        }
        this.isFullMoon = this.phase === PHASE.NIGHT && this.dayCount % c.moonCycle === 0;

        // every phase change re-rolls the weather (rain only in allowed seasons)
        this._endCondition('phase', result);
        this.rainRollDone = false;
        this._rollWeather('phase-change', result);

        result.phaseChanged = true;
        result.from = from;
        result.to = this.phase;
        this._record({ type: 'phase', from, to: this.phase, day: this.dayCount, season: this.season.key, fullMoon: this.isFullMoon });
        this._publish(EVENTS.WEATHER_PHASE_CHANGED, {
            from,
            to: this.phase,
            label: PHASE_LABEL[this.phase],
            day: this.dayCount,
            season: this.season,
            fullMoon: this.isFullMoon,
        });
    }

    get season() {
        return SEASONS[this.seasonIndex % SEASONS.length];
    }

    /* ------------------------------- weather ------------------------------ */

    /** Roll for spring rain (Mưa Phùn Linh Tuyền) if the season allows it. */
    _rollWeather(reason, result = {}) {
        if (this.rainRollDone) return false;
        const chance = this.season.rainChance * this.config.rainChanceScale;
        if (chance <= 0 || this.condition !== CONDITION.CLEAR) return false;
        this.rainRollDone = true;
        if (this.rng() > chance) return false;
        return this._startCondition(CONDITION.SPRING_RAIN, reason, result);
    }

    _startCondition(condition, reason = 'manual', result = {}) {
        if (this.condition === condition) return false;
        const { rainMs } = this.config;
        this.condition = condition;
        this.conditionElapsed = 0;
        this.conditionDuration =
            rainMs.min + Math.floor(this.rng() * Math.max(1, rainMs.max - rainMs.min));
        result.conditionChanged = true;
        this._record({ type: 'condition', to: condition, reason, ms: this.conditionDuration });
        this._publish(EVENTS.WEATHER_CHANGED, {
            condition,
            label: CONDITION_LABEL[condition],
            reason,
            durationMs: this.conditionDuration,
        });
        if (condition === CONDITION.SPRING_RAIN) {
            this._publish(EVENTS.RAIN_STARTED, {
                name: 'Mưa Phùn Linh Tuyền',
                season: this.season.name,
                durationMs: this.conditionDuration,
                autoWater: this.isAutoWaterActive(),
            });
            if (this.isAutoWaterActive()) {
                this._publish(EVENTS.RAIN_IRRIGATE, { source: 'spring-rain', season: this.season.key });
            }
        }
        return true;
    }

    _endCondition(reason, result = {}) {
        if (this.condition === CONDITION.CLEAR) return false;
        const ended = this.condition;
        this.condition = CONDITION.CLEAR;
        this.conditionElapsed = 0;
        this.conditionDuration = 0;
        result.conditionChanged = true;
        this._record({ type: 'condition-end', from: ended, reason });
        this._publish(EVENTS.WEATHER_CHANGED, { condition: CONDITION.CLEAR, label: CONDITION_LABEL.clear, reason });
        if (ended === CONDITION.SPRING_RAIN) {
            this._publish(EVENTS.RAIN_ENDED, { reason, soilBonus: this.soilMoisture() });
        }
        return true;
    }

    _record(entry) {
        this.log.push({ ...entry, atDay: this.dayCount, phase: this.phase });
        while (this.log.length > 24) this.log.shift();
    }

    /* ------------------------------- queries ------------------------------ */

    getPhase() {
        return this.phase;
    }

    getCondition() {
        return this.condition;
    }

    isRaining() {
        return this.condition === CONDITION.SPRING_RAIN;
    }

    isNight() {
        return this.phase === PHASE.NIGHT;
    }

    isDusk() {
        return this.phase === PHASE.DUSK;
    }

    isDay() {
        return this.phase === PHASE.DAY;
    }

    isFullMoonNight() {
        return this.isFullMoon && this.phase === PHASE.NIGHT;
    }

    /** The rain buff: while it rains, unwatered soil is watered for free. */
    isAutoWaterActive() {
        return this.config.autoWaterWhileRaining && this.isRaining();
    }

    /** 0..1 — how moist the garden currently is (used by hints/VFX). */
    soilMoisture() {
        if (this.isRaining()) return 1;
        if (this.phase === PHASE.NIGHT) return 0.55;
        if (this.phase === PHASE.DUSK) return 0.35;
        return 0.15;
    }

    /** Ambient light the renderer should converge to. */
    getAmbient() {
        const base = AMBIENT[this.phase] || AMBIENT[PHASE.DAY];
        const raining = this.isRaining();
        return {
            phase: this.phase,
            phaseLabel: PHASE_LABEL[this.phase],
            condition: this.condition,
            conditionLabel: CONDITION_LABEL[this.condition],
            season: this.season,
            tint: raining ? 0x6f8bb4 : base.tint,
            alpha: raining ? Math.min(0.72, base.alpha + 0.1) : base.alpha,
            glow: raining ? base.glow * 1.1 : base.glow,
            lamp: raining ? Math.max(0.35, base.lamp) : base.lamp,
            moon: this.isFullMoonNight() ? 1 : this.phase === PHASE.NIGHT ? 0.55 : 0,
            moonPhase: this.isFullMoonNight() ? 'full' : this.phase === PHASE.NIGHT ? 'crescent' : 'none',
            description: raining
                ? 'Mưa phùn rơi trên mặt hồ, đất tự ngậm ẩm ✦'
                : base.description,
        };
    }

    /**
     * Gameplay modifiers. GardenScene folds these into harvest + bloom timing.
     * `harmonyMult` composes with the codex multiplier, so weather and codex
     * never need to know about each other.
     */
    getModifiers() {
        return {
            harmonyMult: this.isFullMoonNight() ? this.config.fullMoonHarmonyMult : 1,
            autoWater: this.isAutoWaterActive(),
            glowMult: this.getAmbient().glow,
            reason: this.isFullMoonNight() ? 'full-moon' : this.isRaining() ? 'rain' : 'none',
        };
    }

    /** One-line HUD summary. */
    getSummary() {
        const a = this.getAmbient();
        const moon = this.isFullMoonNight() ? ' · Trăng Tròn ✦' : '';
        return `${a.conditionLabel} · ${a.phaseLabel} · Tiết ${this.season.name}${moon}`;
    }

    /* ------------------------- deterministic controls ---------------------- */

    /** Jump straight to a phase (tests, dev tools, story beats). */
    forcePhase(phase) {
        if (!AMBIENT[phase]) return false;
        const from = this.phase;
        this.phase = phase;
        this.phaseElapsed = 0;
        this.phaseDuration = this.config.phaseMs[phase];
        this.isFullMoon = phase === PHASE.NIGHT && this.dayCount % this.config.moonCycle === 0;
        this.timeOfDay = 0;
        if (from !== phase) {
            this._record({ type: 'phase', from, to: phase, forced: true });
            this._publish(EVENTS.WEATHER_PHASE_CHANGED, {
                from, to: phase, label: PHASE_LABEL[phase], forced: true, day: this.dayCount,
                season: this.season, fullMoon: this.isFullMoon,
            });
        }
        return true;
    }

    /** Force a weather condition on or off (`true` → spring rain). */
    forceRain(on) {
        if (on) {
            const started = this._startCondition(CONDITION.SPRING_RAIN, 'forced', {});
            this.rainRollDone = true;
            return started || this.isRaining();
        }
        return this._endCondition('forced', {});
    }

    /* ---------------------------- persistence ----------------------------- */

    serialize() {
        return {
            phase: this.phase,
            phaseElapsed: Math.round(this.phaseElapsed),
            condition: this.condition,
            conditionElapsed: Math.round(this.conditionElapsed),
            conditionDuration: this.conditionDuration,
            dayCount: this.dayCount,
            cycleCount: this.cycleCount,
            seasonIndex: this.seasonIndex,
            isFullMoon: this.isFullMoon,
        };
    }

    deserialize(data) {
        if (!data) return this;
        this.phase = AMBIENT[data.phase] ? data.phase : this.phase;
        this.phaseDuration = this.config.phaseMs[this.phase];
        this.phaseElapsed = Math.min(data.phaseElapsed ?? 0, this.phaseDuration);
        this.dayCount = data.dayCount ?? this.dayCount;
        this.cycleCount = data.cycleCount ?? this.cycleCount;
        this.seasonIndex = data.seasonIndex ?? this.seasonIndex;
        this.isFullMoon = !!data.isFullMoon;
        if (data.condition === CONDITION.SPRING_RAIN) {
            this.condition = CONDITION.SPRING_RAIN;
            this.conditionDuration = data.conditionDuration || this.config.rainMs.min;
            this.conditionElapsed = Math.min(data.conditionElapsed ?? 0, this.conditionDuration);
            this.rainRollDone = true;
        }
        this.timeOfDay = this._phaseProgress();
        return this;
    }
}

export default WeatherSystem;
