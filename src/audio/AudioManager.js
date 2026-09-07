/**
 * AudioManager — procedural WebAudio soundscape.
 * - Pentatonic Guzheng (plucked string) & Dizi (flute) synth built from
 *   the C pentatonic scale (C D E G A).
 * - Chimes, water splash, soil dig, bamboo click and a dreamy ambient pad.
 * - Phaser sound is intentionally NOT used: everything is synthesized so
 *   the game ships with zero audio assets.
 */
export const PENTATONIC = [523.25, 587.33, 659.25, 783.99, 880.0]; // C5 D5 E5 G5 A5

export default class AudioManager {
    constructor(scene) {
        this.scene = scene;
        this.ctx = null;
        this.master = null;
        this.padOsc = null;
        this.padGain = null;
        this.muted = false;
        this.ambientStarted = false;
        // per-flower chime index (pentatonic walk)
        this.chimeIndex = 0;
        this._warned = false;
    }

    /** Must be called from a user gesture to satisfy autoplay policies. */
    ensure() {
        if (this.ctx) {
            if (this.ctx.state === 'suspended') this.ctx.resume();
            return true;
        }
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) {
            if (!this._warned) {
                console.warn('[Audio] WebAudio unsupported — silent mode');
                this._warned = true;
            }
            return false;
        }
        try {
            this.ctx = new AC();
            this.master = this.ctx.createGain();
            this.master.gain.value = 0.9;
            this.master.connect(this.ctx.destination);
            return true;
        } catch (e) {
            console.warn('[Audio] failed to init AudioContext', e);
            return false;
        }
    }

    setMuted(m) {
        this.muted = m;
        if (this.master) {
            this.master.gain.setTargetAtTime(m ? 0 : 0.9, this.ctx.currentTime, 0.05);
        }
    }

    /* ---------------- synth voices ---------------- */

    /** Plucked guzheng-style string with noise attack. */
    pluck(freq, { gain = 0.16, when = 0, dur = 1.6, type = 'triangle' } = {}) {
        if (!this.ctx || this.muted) return;
        const t0 = this.ctx.currentTime + when;
        // body
        const osc = this.ctx.createOscillator();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, t0);
        osc.frequency.exponentialRampToValueAtTime(freq * 0.995, t0 + dur);
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0, t0);
        g.gain.linearRampToValueAtTime(gain, t0 + 0.008);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        osc.connect(g).connect(this.master);
        osc.start(t0);
        osc.stop(t0 + dur + 0.05);
        // pluck transient
        const n = this.ctx.createBufferSource();
        n.buffer = this._noise(0.05, 6000);
        const ng = this.ctx.createGain();
        ng.gain.setValueAtTime(gain * 0.4, t0);
        ng.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.05);
        const f = this.ctx.createBiquadFilter();
        f.type = 'bandpass';
        f.frequency.value = freq * 2.2;
        f.Q.value = 1.4;
        n.connect(f).connect(ng).connect(this.master);
        n.start(t0);
    }

    /** Soft dizi flute note with vibrato. */
    flute(freq, { gain = 0.07, when = 0, dur = 1.4 } = {}) {
        if (!this.ctx || this.muted) return;
        const t0 = this.ctx.currentTime + when;
        const osc = this.ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, t0);
        const vib = this.ctx.createOscillator();
        vib.frequency.value = 5.2;
        const vibGain = this.ctx.createGain();
        vibGain.gain.setValueAtTime(0, t0);
        vibGain.gain.linearRampToValueAtTime(freq * 0.008, t0 + 0.6);
        vib.connect(vibGain).connect(osc.frequency);
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0, t0);
        g.gain.linearRampToValueAtTime(gain, t0 + 0.14);
        g.gain.setValueAtTime(gain, t0 + dur - 0.5);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        const lp = this.ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 2400;
        osc.connect(g).connect(lp).connect(this.master);
        osc.start(t0);
        osc.stop(t0 + dur + 0.1);
        vib.start(t0);
        vib.stop(t0 + dur + 0.1);
    }

    /** Glassy magical chime (bell-like partial stack). */
    chime(freq, { gain = 0.12, when = 0 } = {}) {
        if (!this.ctx || this.muted) return;
        const t0 = this.ctx.currentTime + when;
        const partials = [1, 2.76, 5.4];
        const amps = [1, 0.35, 0.12];
        partials.forEach((p, i) => {
            const osc = this.ctx.createOscillator();
            osc.type = 'sine';
            osc.frequency.value = freq * p;
            const g = this.ctx.createGain();
            const dur = 1.8 - i * 0.4;
            g.gain.setValueAtTime(0, t0);
            g.gain.linearRampToValueAtTime(gain * amps[i], t0 + 0.006);
            g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
            osc.connect(g).connect(this.master);
            osc.start(t0);
            osc.stop(t0 + dur + 0.05);
        });
    }

    /** Water splash: filtered noise burst + droplet pings. */
    splash(when = 0) {
        if (!this.ctx || this.muted) return;
        const t0 = this.ctx.currentTime + when;
        const n = this.ctx.createBufferSource();
        n.buffer = this._noise(0.65, 12000);
        const f = this.ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.setValueAtTime(3000, t0);
        f.frequency.exponentialRampToValueAtTime(300, t0 + 0.55);
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0, t0);
        g.gain.linearRampToValueAtTime(0.22, t0 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.6);
        n.connect(f).connect(g).connect(this.master);
        n.start(t0);
        // droplets
        for (let i = 0; i < 6; i++) {
            this.chime(1400 + Math.random() * 900, { gain: 0.035, when: when + 0.05 + i * 0.09 + Math.random() * 0.04 });
        }
    }

    /** Soil dig / plant thump. */
    dig(when = 0) {
        if (!this.ctx || this.muted) return;
        const t0 = this.ctx.currentTime + when;
        const n = this.ctx.createBufferSource();
        n.buffer = this._noise(0.18, 700);
        const f = this.ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.value = 420;
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0.28, t0);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.17);
        n.connect(f).connect(g).connect(this.master);
        n.start(t0);
    }

    /** Bamboo slip click for search bar taps. */
    click(when = 0) {
        if (!this.ctx || this.muted) return;
        const t0 = this.ctx.currentTime + when;
        const osc = this.ctx.createOscillator();
        osc.type = 'square';
        osc.frequency.setValueAtTime(900, t0);
        osc.frequency.exponentialRampToValueAtTime(320, t0 + 0.05);
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0.05, t0);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.06);
        osc.connect(g).connect(this.master);
        osc.start(t0);
        osc.stop(t0 + 0.08);
    }

    /** Dreamy ambient pad + slow pentatonic melody. */
    startAmbient() {
        if (!this.ensure() || this.ambientStarted) return;
        this.ambientStarted = true;
        const t0 = this.ctx.currentTime;
        const padGain = this.ctx.createGain();
        padGain.gain.setValueAtTime(0, t0);
        padGain.gain.linearRampToValueAtTime(0.045, t0 + 3);
        const lp = this.ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 620;
        lp.connect(padGain).connect(this.master);
        for (const [freq, detune] of [[261.63, -4], [329.63, 4], [392.0, -2], [440.0, 3]]) {
            const osc = this.ctx.createOscillator();
            osc.type = 'sine';
            osc.frequency.value = freq;
            osc.detune.value = detune;
            osc.connect(lp);
            osc.start();
        }
        this.padOsc = null;
        this.padGain = padGain;
        this._scheduleMelody();
    }

    _scheduleMelody() {
        if (!this.ctx || this.muted === undefined) return;
        this._melodyTimer = setInterval(() => {
            if (!this.ctx) return;
            const scale = [0, 1, 2, 3, 4, 3, 2, 1, 0, 2, 4, 3];
            const idx = Math.floor(Math.random() * scale.length);
            let freq = PENTATONIC[scale[idx]];
            if (idx % 3 === 0) freq /= 2;
            if (Math.random() < 0.55) this.flute(freq, { gain: 0.05, dur: 2.4, when: 0 });
            if (Math.random() < 0.5) this.pluck(freq * 2, { gain: 0.05, dur: 2.0 });
            if (Math.random() < 0.3) this.chime(freq * 3, { gain: 0.025 });
        }, 4200);
    }

    _noise(dur, cutoff) {
        const ctx = this.ctx;
        const len = Math.floor(ctx.sampleRate * dur);
        const buf = ctx.createBuffer(1, len, ctx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
        return buf;
    }

    destroy() {
        if (this._melodyTimer) clearInterval(this._melodyTimer);
        if (this.padGain) this.padGain.disconnect();
        if (this.ctx) this.ctx.close();
        this.ctx = null;
    }
}
