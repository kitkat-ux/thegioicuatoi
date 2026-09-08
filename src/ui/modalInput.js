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
import { LAYERS } from '../core/Layers.js';

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

/* ======================================================================
 * THE MODAL DEPTH CONTRACT (HUD punch-through fix)
 *
 * Game HUD entry buttons (Hoa Các, Bí Cảnh, Linh Thú, Luyện Đan, Câu Cá)
 * sit at LAYERS.HUD_BUTTONS (2000). Every modal then owns three strictly
 * higher, scene-level tiers — they MUST be top-level display objects, not
 * children of one container, because only scene depth can order them:
 *
 *   LAYERS.MODAL_BLOCKER (9000)  full-screen dark backdrop, interactive —
 *                                a click can never fall through to the HUD
 *   LAYERS.MODAL_WINDOW (9500)   the modal window (panel + widgets)
 *   LAYERS.MODAL_CLOSE (9999)    the close button (always on top)
 * ==================================================================== */

/**
 * Full-screen interactive dark blocker at LAYERS.MODAL_BLOCKER (9000).
 * Starts hidden; pair it with showModalChrome()/hideModalChrome().
 */
export function createModalBlocker(scene, { x, y, width, height, color = 0x05030c, alpha = 0.8 } = {}) {
    const blocker = scene.add.rectangle(x, y, width, height, color, alpha)
        .setDepth(LAYERS.MODAL_BLOCKER)
        .setInteractive();
    blocker.setVisible(false);
    return blocker;
}

/** Top-level modal close button plate at LAYERS.MODAL_CLOSE (9999). Starts hidden. */
export function makeCloseLayer(scene, closeObject) {
    closeObject.setDepth(LAYERS.MODAL_CLOSE);
    closeObject.setVisible(false);
    return closeObject;
}

/**
 * Reveal the modal trio (blocker → window → close) with the standard choreo:
 * the blocker fades in, the window pops from `popScale`, the close button
 * fades in on top. Safe against interrupted tweens (kills them first).
 */
export function showModalChrome(scene, chrome, { duration = 240, popScale = 0.94, ease = 'Back.easeOut' } = {}) {
    const parts = [chrome.blocker, chrome.window, chrome.close].filter(Boolean);
    scene.tweens.killTweensOf(parts);
    if (chrome.blocker) {
        chrome.blocker.setVisible(true).setAlpha(0);
        scene.tweens.add({ targets: chrome.blocker, alpha: 1, duration: Math.min(duration, 220) });
    }
    if (chrome.window) {
        chrome.window.setVisible(true).setAlpha(0);
        if (popScale) chrome.window.setScale(popScale);
        const props = { alpha: 1 };
        if (popScale) props.scale = 1;
        scene.tweens.add({ targets: chrome.window, ...props, duration, ease });
    }
    if (chrome.close) {
        chrome.close.setVisible(true).setAlpha(0);
        scene.tweens.add({ targets: chrome.close, alpha: 1, duration: Math.min(duration, 200) });
    }
}

/**
 * Hide the modal trio. `onHidden` fires once the window has fully folded away
 * (the moment callers traditionally treat as "closed").
 */
export function hideModalChrome(scene, chrome, { duration = 200, popScale = 0.94, onHidden } = {}) {
    const parts = [chrome.blocker, chrome.window, chrome.close].filter(Boolean);
    scene.tweens.killTweensOf(parts);
    const tail = [chrome.blocker, chrome.close].filter(Boolean);
    if (tail.length) {
        scene.tweens.add({
            targets: tail,
            alpha: 0,
            duration,
            onComplete: () => tail.forEach((o) => o.setVisible(false)),
        });
    }
    if (chrome.window) {
        const props = { alpha: 0 };
        if (popScale) props.scale = popScale;
        scene.tweens.add({
            targets: chrome.window,
            ...props,
            duration,
            onComplete: () => {
                chrome.window.setVisible(false);
                if (popScale) chrome.window.setScale(1);
                onHidden?.();
            },
        });
    }
}

export default { swallowPointerEvent, guarded, createPanelShield, localRectToWorld, pointerInRect, bindBackdropClose, createModalBlocker, makeCloseLayer, showModalChrome, hideModalChrome };
