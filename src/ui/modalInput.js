/**
 * modalInput — shared pointer plumbing for every overlay (Alchemy, Fishing,
 * Beast, water modal).
 *
 * THE BUG THIS FIXES (mobile): each overlay closes when its full-screen dim
 * receives `pointerdown`. Nothing inside the panel captured the event, so on
 * touch devices a tap on a button / tab / empty panel area could reach the
 * dim and slam the modal shut ("modal auto-close").
 *
 * Two layers of defence, both cheap:
 *  1. `createPanelShield()` — an invisible interactive zone the exact size of
 *     the panel, inserted right above the panel art and below every widget.
 *     Any tap that lands inside the panel but misses a widget hits the shield,
 *     which calls `event.stopPropagation()` so the dim underneath never sees it.
 *  2. `bindBackdropClose()` — the dim itself only closes when the pointer is
 *     geometrically OUTSIDE the panel's world rect. Even if hit-testing ever
 *     hands the dim an inside tap (scaled open/close tweens, stale render
 *     lists on the first touch frame), it is swallowed instead of closing.
 *
 * Phaser passes the propagation container as the 4th argument of every
 * GameObject pointer event: `(pointer, localX, localY, event)`.
 */

/** Swallow a Phaser pointer event so nothing beneath (e.g. the backdrop) sees it. */
export function swallowPointerEvent(event) {
    if (event && typeof event.stopPropagation === 'function') event.stopPropagation();
}

/** Wrap a handler so it always stops propagation before running. */
export function guarded(handler) {
    return (pointer, localX, localY, event) => {
        swallowPointerEvent(event);
        return handler?.(pointer, localX, localY, event);
    };
}

/**
 * Invisible interactive shield covering the panel rect (container-local
 * coords, centre origin). Add it to the overlay container right after the
 * panel graphics and BEFORE the buttons so widgets stay on top of it.
 */
export function createPanelShield(scene, cx, cy, w, h) {
    const zone = scene.add.zone(cx, cy, w, h).setOrigin(0.5).setInteractive();
    zone.on('pointerdown', (pointer, lx, ly, event) => swallowPointerEvent(event));
    zone.on('pointerup', (pointer, lx, ly, event) => swallowPointerEvent(event));
    zone.on('pointermove', (pointer, lx, ly, event) => swallowPointerEvent(event));
    zone.isPanelShield = true;
    return zone;
}

/**
 * World-space rect of a container-local rect (top-left `lx,ly`, size `w,h`).
 * Accounts for the container's position + scale (open/close tweens scale the
 * root), which is enough for a camera at scroll (0,0) — the whole game runs
 * on a fixed 1080×1920 stage.
 */
export function localRectToWorld(container, lx, ly, w, h) {
    const sx = container?.scaleX ?? 1;
    const sy = container?.scaleY ?? 1;
    const ox = container?.x ?? 0;
    const oy = container?.y ?? 0;
    return { x: ox + lx * sx, y: oy + ly * sy, width: w * sx, height: h * sy };
}

/** True when the pointer's world position lies inside `rect`. */
export function pointerInRect(pointer, rect) {
    if (!pointer || !rect) return false;
    const x = pointer.worldX ?? pointer.x;
    const y = pointer.worldY ?? pointer.y;
    return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
}

/**
 * Backdrop-close with an inside-panel guard.
 * @param {Phaser.GameObjects.GameObject} dim  the interactive full-screen shade
 * @param {() => {x:number,y:number,width:number,height:number}} getPanelRect  world rect of the panel
 * @param {(pointer) => void} onClose
 */
export function bindBackdropClose(dim, getPanelRect, onClose) {
    dim.on('pointerdown', (pointer, lx, ly, event) => {
        if (pointerInRect(pointer, getPanelRect())) {
            // tap landed inside the panel: never treat it as "tap outside to close"
            swallowPointerEvent(event);
            return;
        }
        swallowPointerEvent(event);
        onClose?.(pointer);
    });
    return dim;
}

export default { swallowPointerEvent, guarded, createPanelShield, localRectToWorld, pointerInRect, bindBackdropClose };
