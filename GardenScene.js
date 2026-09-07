import { IsoMath } from './IsoMath.js';

export default class GardenScene extends Phaser.Scene {
    constructor() {
        super({ key: 'GardenScene' });
        this.gridSize = { rows: 6, cols: 6 };
        this.tiles = [];
        this.selectedSeed = null;
    }

    create() {
        this.add.image(540, 960, 'bg_manor_isometric').setDisplaySize(1080, 1920);
        this.createIsometricGrid();
        this.createSeedCatalogUI();
        this.createActionBar();
    }

    createIsometricGrid() {
        for (let r = 0; r < this.gridSize.rows; r++) {
            this.tiles[r] = [];
            for (let c = 0; c < this.gridSize.cols; c++) {
                const pos = IsoMath.gridToScreen(c, r, 540, 950);
                const tile = this.add.image(pos.x, pos.y, 'tile_soil')
                    .setInteractive(new Phaser.Geom.Polygon([
                        64, 0, 128, 32, 64, 64, 0, 32
                    ]), Phaser.Geom.Polygon.Contains);

                tile.gridData = { row: r, col: c, state: 'EMPTY', flower: null };
                tile.on('pointerdown', () => this.handleTileClick(tile));
                this.tiles[r][c] = tile;
            }
        }
    }

    handleTileClick(tile) {
        if (!this.selectedSeed) return;
        if (tile.gridData.state === 'EMPTY') {
            tile.gridData.state = 'PLANTED';
            tile.gridData.flower = this.selectedSeed;
            
            const plantSprite = this.add.image(tile.x, tile.y - 20, this.selectedSeed.sprite_key)
                .setScale(0.1)
                .setDepth(tile.y);
            
            this.tweens.add({
                targets: plantSprite,
                scale: 1,
                duration: 350,
                ease: 'Back.easeOut'
            });
        }
    }

    oneClickWaterAll() {
        for (let r = 0; r < this.gridSize.rows; r++) {
            for (let c = 0; c < this.gridSize.cols; c++) {
                const tile = this.tiles[r][c];
                if (tile.gridData.state === 'PLANTED') {
                    tile.gridData.state = 'BLOOMING';
                    this.showSparkleParticles(tile.x, tile.y);
                }
            }
        }
    }
}
