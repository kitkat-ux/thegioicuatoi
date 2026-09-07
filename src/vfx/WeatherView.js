/**
 * WeatherView — the render half of System 8 (Thiên Thời Tứ Thời).
 *
 * WeatherSystem holds the *state* (which phase, is it raining, is the moon
 * full). WeatherView turns that state into light and particles inside a scene:
 *
 *   · Ambient wash  — one tinted image above the world layer that
 *                     eases (lerp, never snaps) between Ngày / Hoàng Hôn / Ban Đêm.
 *   · Mưa Phùn Linh Tuyền — a gentle slanted rain curtain falling over the lake
 *                     and the island, with light expanding ripple rings on the
 *                     water and small splash crowns on the soil.
 *   · Moon          — rises at night; full moon = round disc, otherwise carved
 *                     to a crescent with an earth-shade overlay.
 *   · Rain haze     — a few slow mist puffs so the rain reads as weather.
 *
 * It never mutates game logic: it reads `weather.getAmbient()` each frame and
 * exchanges facts only through the EventManager bus, so gameplay effects such
 * as "rain waters unwatered soil" live in GardenScene (which owns the tiles).
 */
import Phaser from 'phaser';
import { LAYERS } from '../core/Layers.js';
import { EVENTS } from '../systems/EventManager.js';

const W = 1080;
const H = 1920;

/* Water bands of Thanh Khê Hoa Uyển in the 1080x1920 painting: the lake below
   the floating island, and the wider shore toward the foot of the frame. */
const LAKE_BAND = { x0: 20, x1: W - 20, y0: 1408, y1: 1888 };
const GRID_BAND = { x0: 230, x1: 850, y0: 946, y1: 1300 };

export class WeatherView {
    /**
     * @param {Phaser.Scene} scene
     * @param {import('../systems/WeatherSystem.js').WeatherSystem} weather
     * @param {import('../systems/EventManager.js').EventManager} [bus]
     */
    constructor(scene, weather, bus) {
        this.scene = scene;
        this.weather = weather;
        this.bus = bus || null;
        this.disposers = [];
        this.enabled = true;
        this.raining = false;

        // eased ambient state (what is actually on screen right now)
        this.current = { r: 1, g: 1, b: 1, alpha: 0 };
        this.target = { r: 1, g: 1, b: 1, alpha: 0 };
        this.easeMs = 2600; // "subtle scene tinting" — a slow, soft cross-fade
        this.moonAlpha = 0;
        this.targetMoon = 0;
        this.targetFullMoon = false;
        this.lampLevel = 0;
        this.lampTarget = 0;
    }

    create() {
        const s = this.scene;

        /* ---------------- moon + halo (sky layer, behind the garden) ---------------- */
        const MOON = { x: 236, y: 470, size: 206 };
        this.moon = s.add.image(MOON.x, MOON.y, 'moon')
            .setDisplaySize(MOON.size, MOON.size)
            .setAlpha(0)
            .setDepth(LAYERS.MOON);
        this.moonShade = s.add.image(MOON.x - 34, MOON.y - 26, 'moon_shade')
            .setDisplaySize(MOON.size - 10, MOON.size - 10)
            .setAlpha(0)
            .setBlendMode(Phaser.BlendModes.MULTIPLY)
            .setDepth(LAYERS.MOON + 1);
        this.moonHalo = s.add.image(MOON.x, MOON.y, 'glow')
            .setTint(0xdfe8ff)
            .setScale(2.9, 2.9)
            .setAlpha(0)
            .setBlendMode(Phaser.BlendModes.ADD)
            .setDepth(LAYERS.MOON - 1);
        s.tweens.add({
            targets: this.moonHalo,
            scale: { from: 2.82, to: 3.06 },
            duration: 4200,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.easeInOut',
        });

        /* ---------------- rain curtain over the lake + island ---------------- */
        this.rain = s.add.particles(0, 0, 'rain_streak', {
            x: { min: -110, max: W + 110 },
            y: { min: -220, max: -40 },
            speedY: { min: 620, max: 900 },
            speedX: { min: -74, max: -26 },
            lifespan: 2650,
            alpha: { start: 0.62, end: 0.16 },
            scale: { x: { min: 0.7, max: 1.15 }, y: { min: 0.75, max: 1.5 } },
            tint: [0xbfe8ff, 0xdff2ff, 0xa8d8ff],
            blendMode: Phaser.BlendModes.ADD,
            frequency: 90,
            quantity: 2,
            emitting: false,
        }).setDepth(LAYERS.RAIN);

        /* ---------------- light ripple rings on the water ---------------- */
        this.ripples = s.add.particles(0, 0, 'ripple', {
            x: { min: LAKE_BAND.x0, max: LAKE_BAND.x1 },
            y: { min: LAKE_BAND.y0, max: LAKE_BAND.y1 },
            lifespan: { min: 900, max: 1500 },
            scale: { start: 0.16, end: 1.05 },
            alpha: { start: 0.5, end: 0 },
            tint: [0xbfefff, 0xd9f6ff],
            blendMode: Phaser.BlendModes.ADD,
            frequency: 210,
            quantity: 1,
            emitting: false,
        }).setDepth(LAYERS.WATER_FX);

        /* ---------------- splash crowns on the soil (the free-watering tell) ------- */
        this.splash = s.add.particles(0, 0, 'rain_splash', {
            x: { min: GRID_BAND.x0, max: GRID_BAND.x1 },
            y: { min: GRID_BAND.y0, max: GRID_BAND.y1 },
            lifespan: 520,
            alpha: { start: 0.5, end: 0 },
            scale: { start: 0.5, end: 1.1 },
            tint: 0xcdeffd,
            blendMode: Phaser.BlendModes.ADD,
            frequency: 330,
            quantity: 1,
            emitting: false,
        }).setDepth(LAYERS.WATER_FX + 1);

        /* ---------------- slow rain haze over the lake ---------------- */
        this.haze = s.add.particles(0, 0, 'mist', {
            x: { min: -120, max: W + 120 },
            y: { min: 1330, max: 1520 },
            speedX: { min: 14, max: 40 },
            speedY: { min: -4, max: 4 },
            lifespan: 6400,
            scale: { start: 1.3, end: 2.3 },
            alpha: { start: 0.1, end: 0 },
            tint: 0x9fc8e8,
            frequency: 1300,
            emitting: false,
        }).setDepth(LAYERS.WATER_FX - 1);

        /* ---------------- ambient wash (the day/dusk/night light) ----------------
           MULTIPLY keeps the *island* legible while it darkens: dst*(1-a)+dst*src*a.
           The Canvas renderer fallback (used by headless tests only) has no
           multiply composite, so there the wash reads as a translucent veil —
           depth/layering checks stay valid, the browser (WebGL) shows the real
           tinting. */
        this.wash = s.add.image(W / 2, H / 2, 'wash')
            .setDisplaySize(W, H)
            .setDepth(LAYERS.AMBIENT)
            .setBlendMode(Phaser.BlendModes.MULTIPLY)
            .setAlpha(0)
            .setTint(0xffffff);
        // A whisper of additive lift at night so shadows stay luminous rather
        // than muddy — the art direction asks for ethereal soft light.
        this.lift = s.add.image(W / 2, H / 2, 'wash')
            .setDisplaySize(W, H)
            .setDepth(LAYERS.AMBIENT - 1)
            .setBlendMode(Phaser.BlendModes.ADD)
            .setAlpha(0)
            .setTint(0x2f4278);

        this.bindBus();
        this.sync({ instant: true });
        return this;
    }

    /** All communication with the rest of the game goes through the bus. */
    bindBus() {
        if (!this.bus) return this;
        this.disposers.push(
            this.bus.on(EVENTS.RAIN_STARTED, () => this.startRainFx(), { owner: 'weather-view' }),
            this.bus.on(EVENTS.RAIN_ENDED, () => this.stopRainFx(), { owner: 'weather-view' }),
            this.bus.on(EVENTS.WEATHER_PHASE_CHANGED, () => this.sync(), { owner: 'weather-view' }),
        );
        return this;
    }

    /* ------------------------------- emitters ------------------------------ */

    startRainFx() {
        if (!this.rain) return this;
        this.rain.start();
        this.ripples.start();
        this.splash.start();
        this.haze.start();
        this.raining = true;
        this.scene.audio?.setRain?.(true);
        return this;
    }

    stopRainFx() {
        if (!this.rain) return this;
        this.rain.stop();
        this.ripples.stop();
        this.splash.stop();
        this.haze.stop();
        this.raining = false;
        this.scene.audio?.setRain?.(false);
        return this;
    }

    /** UI can mute ambience (e.g. while a full-screen modal wants contrast). */
    setEnabled(on) {
        this.enabled = !!on;
        this.sync();
        return this;
    }

    /* -------------------------- ambient light model ------------------------ */

    /**
     * Re-read the simulation and move the easing targets.
     * @param {{instant?:boolean}} [opts] snap straight to the target (boot)
     */
    sync({ instant = false } = {}) {
        if (!this.weather) return this;
        const a = this.weather.getAmbient();
        const rgb = hexToRgb(a.tint);
        this.target.r = rgb.r;
        this.target.g = rgb.g;
        this.target.b = rgb.b;
        this.target.alpha = this.enabled ? a.alpha : 0;
        this.targetMoon = a.moon;
        this.targetFullMoon = a.moonPhase === 'full';
        this.lampTarget = this.enabled ? a.lamp : 0;
        if (instant) {
            this.current.r = this.target.r;
            this.current.g = this.target.g;
            this.current.b = this.target.b;
            this.current.alpha = this.target.alpha;
            this.moonAlpha = this.targetMoon;
            this.lampLevel = this.lampTarget;
            this.applyWash();
            this.applyMoon();
        }
        return this;
    }

    /** Per-frame ease toward the phase target. Called from GardenScene.update. */
    update(deltaMs) {
        if (!this.weather) return;
        const dt = Math.max(0, Math.min(deltaMs || 0, 250));
        const k = 1 - Math.exp(-dt / this.easeMs);
        const c = this.current;
        let moved = false;
        for (const key of ['r', 'g', 'b', 'alpha']) {
            const next = c[key] + (this.target[key] - c[key]) * k;
            if (Math.abs(next - c[key]) > 1e-5) moved = true;
            c[key] = next;
        }
        if (moved) this.applyWash();

        if (Math.abs(this.moonAlpha - this.targetMoon) > 1e-4) {
            this.moonAlpha += (this.targetMoon - this.moonAlpha) * k;
            this.applyMoon();
        }
        if (Math.abs(this.lampLevel - this.lampTarget) > 1e-4) {
            this.lampLevel += (this.lampTarget - this.lampLevel) * k;
            this.publishLamp();
        }
        if (this.weather.isRaining() && !this.raining) this.startRainFx();
        if (!this.weather.isRaining() && this.raining) this.stopRainFx();
    }

    applyWash() {
        const { r, g, b, alpha } = this.current;
        this.wash.setTint(rgbToHex(r, g, b)).setAlpha(alpha);
        this.lift.setAlpha(alpha * 0.14);
    }

    applyMoon() {
        const a = this.moonAlpha;
        this.moon.setAlpha(a * 0.95);
        this.moonHalo.setAlpha(a * 0.3);
        // full moon → no shade overlay; otherwise carve a crescent
        this.moonShade.setAlpha(this.targetFullMoon ? 0 : a * 0.86);
    }

    publishLamp() {
        const payload = { level: this.lampLevel, phase: this.weather.getPhase() };
        if (this.bus) this.bus.emit(EVENTS.WEATHER_LAMP_LEVEL, payload);
    }

    /** 0..1 night-lamp strength — GardenScene uses it for bloom radiance. */
    getLampLevel() {
        return this.lampLevel;
    }

    isRaining() {
        return this.raining;
    }

    /** Snapshot for the test suite / debug HUD. */
    getState() {
        const w = this.weather;
        return {
            phase: w?.getPhase?.() ?? null,
            condition: w?.getCondition?.() ?? null,
            isNight: w?.isNight?.() ?? false,
            raining: !!this.raining,
            washAlpha: this.current.alpha,
            washColor: rgbToHex(this.current.r, this.current.g, this.current.b),
            moonAlpha: this.moonAlpha,
            lampLevel: this.lampLevel,
            depths: {
                rain: this.rain?.depth ?? LAYERS.AMBIENT,
                ambient: this.wash?.depth ?? LAYERS.AMBIENT,
            },
        };
    }

    destroy() {
        if (this.bus) for (const off of this.disposers) off();
        this.disposers = [];
        for (const e of [this.rain, this.ripples, this.splash, this.haze]) e?.destroy?.();
        for (const o of [this.wash, this.lift, this.moon, this.moonShade, this.moonHalo]) o?.destroy?.();
    }
}

/* ------------------------------ color helpers ----------------------------- */

/** 0xRRGGBB (or '#rrggbb') → normalized rgb channels. */
export function hexToRgb(hex) {
    const n = typeof hex === 'string' ? parseInt(hex.replace('#', ''), 16) : hex | 0;
    return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
}

/** normalized rgb channels → 0xRRGGBB integer for setTint(). */
export function rgbToHex(r, g, b) {
    const cl = (v) => Math.max(0, Math.min(255, Math.round((v ?? 0) * 255)));
    return (cl(r) << 16) | (cl(g) << 8) | cl(b);
}

export default WeatherView;
