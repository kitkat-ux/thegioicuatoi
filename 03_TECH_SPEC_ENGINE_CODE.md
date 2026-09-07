# TECHNICAL SPECIFICATION & ISOMETRIC CONTROLLER

## 1. Coordinate Projection Engine (`IsoMath.js`)

```javascript
export class IsoMath {
    static TILE_WIDTH = 128;
    static TILE_HEIGHT = 64;

    static gridToScreen(gridX, gridY, originX = 540, originY = 900) {
        const screenX = originX + (gridX - gridY) * (this.TILE_WIDTH / 2);
        const screenY = originY + (gridX + gridY) * (this.TILE_HEIGHT / 2);
        return { x: screenX, y: screenY };
    }

    static screenToGrid(screenX, screenY, originX = 540, originY = 900) {
        const adjustedX = screenX - originX;
        const adjustedY = screenY - originY;
        const gridX = Math.floor((adjustedX / (this.TILE_WIDTH / 2) + adjustedY / (this.TILE_HEIGHT / 2)) / 2);
        const gridY = Math.floor((adjustedY / (this.TILE_HEIGHT / 2) - adjustedX / (this.TILE_WIDTH / 2)) / 2);
        return { gridX, gridY };
    }
}
