import Phaser from 'phaser';
import GardenScene from './scenes/GardenScene.js';

const W = 1080;
const H = 1920;

/* Letterbox / page shell color. Kept identical to the `background-color`
   declared in index.html so the FIT bars are invisible against the page. */
const LETTERBOX = '#0b0c16';

/**
 * Phaser game config.
 *
 * Scale policy (desktop centering fix):
 *  - `mode: FIT`        → keep the 9:16 stage aspect, scale to the largest
 *                         box that fits the parent.
 *  - `autoCenter: CENTER_BOTH` → Phaser centers by writing inline
 *                         marginLeft/marginTop on the canvas.
 * The page CSS mirrors that with `margin: auto !important` on the canvas,
 * which (a) neutralises those inline offsets so the flex parent cannot
 * double-offset the stage, and (b) keeps the canvas centered on BOTH axes
 * at any window size. See the comment block in index.html.
 */
const config = {
    type: Phaser.AUTO,
    parent: 'game-container',
    backgroundColor: LETTERBOX,
    dom: { createContainer: true },
    scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH,
        width: W,
        height: H,
        parent: 'game-container',
    },
    render: {
        antialias: true,
        pixelArt: false,
        roundPixels: false,
    },
    scene: [GardenScene],
};

const game = new Phaser.Game(config);

/* The flex wrapper can change size without Phaser noticing (split-screen
   resizes, mobile browser chrome collapsing, font/scrollbar settling).
   Re-run the scale + centering pass on the next frame after any of those. */
let resizePending = false;
const queueScaleRefresh = () => {
    if (resizePending) return;
    resizePending = true;
    requestAnimationFrame(() => {
        resizePending = false;
        // ScaleManager.destroy() nulls `game`/`canvas` — bail out after teardown.
        const scale = game && game.scale;
        if (!scale || !scale.game || !scale.canvas) return;
        scale.refresh();
        // CENTER_BOTH writes the margins inside refresh(); re-assert in case the
        // flex wrapper had not been laid out yet on the first pass.
        scale.updateCenter();
    });
};
window.addEventListener('resize', queueScaleRefresh, { passive: true });
window.addEventListener('orientationchange', queueScaleRefresh, { passive: true });
document.addEventListener('fullscreenchange', queueScaleRefresh);
game.events.once('ready', queueScaleRefresh);

export default game;
