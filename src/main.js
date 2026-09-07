import Phaser from 'phaser';
import GardenScene from './scenes/GardenScene.js';

const W = 1080;
const H = 1920;

new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game-container',
    width: W,
    height: H,
    backgroundColor: '#120b22',
    dom: { createContainer: true },
    scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH,
        width: W,
        height: H,
    },
    render: {
        antialias: true,
        pixelArt: false,
        roundPixels: false,
    },
    scene: [GardenScene],
});
