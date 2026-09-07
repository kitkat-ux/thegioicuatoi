/**
 * IsoMath — 2.5D isometric projection for the 6x6 soil grid.
 * Spec: TILE_WIDTH 128, TILE_HEIGHT 64 (2:1 diamond).
 * gridX = column (moves to lower-right), gridY = row (moves to lower-left).
 *
 * Pure math: no Phaser import, so it is unit-testable in plain Node.
 */
export class IsoMath {
    static TILE_WIDTH = 128;
    static TILE_HEIGHT = 64;

    /** Diamond polygon vertices in texture space, in [x,y,...] pairs. */
    static hitAreaPoints = [64, 0, 128, 32, 64, 64, 0, 32];

    static gridToScreen(gridX, gridY, originX = 540, originY = 950) {
        const screenX = originX + (gridX - gridY) * (this.TILE_WIDTH / 2);
        const screenY = originY + (gridX + gridY) * (this.TILE_HEIGHT / 2);
        return { x: screenX, y: screenY };
    }

    static screenToGrid(screenX, screenY, originX = 540, originY = 950) {
        const adjustedX = screenX - originX;
        const adjustedY = screenY - originY;
        const fx = adjustedX / (this.TILE_WIDTH / 2);
        const fy = adjustedY / (this.TILE_HEIGHT / 2);
        // Correct inverse of the forward projection (average of the two axes)
        const gridX = Math.round((fy + fx) / 2);
        const gridY = Math.round((fy - fx) / 2);
        return { gridX, gridY };
    }
}
