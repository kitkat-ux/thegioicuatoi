#!/usr/bin/env python3
"""
clean_alpha.py — turn black-plate sprite art into genuine 32-bit RGBA PNGs.

The asset pipeline (07_VISUAL_ASSET_CATALOG.md) requires keyed sprites to be
true 32-bit RGBA with REAL transparency — never a faux checkerboard, never an
opaque black plate. AI-generated sprite plates come back as RGB art painted on
a pure solid flat black (#000000) studio background; this script keys that
background out and writes a clean RGBA file in place.

How it works
------------
1. DETECT the solid black background: the 8px border ring is sampled and its
   median max-channel must be near-black, otherwise the file is rejected
   (it is not a black-key plate — keying it would eat real art).
2. FLOOD-FILL the background from every border pixel through all *connected*
   near-black pixels. Connectivity matters: a black dress / dark shadow that
   lives INSIDE the subject is never reached, so it stays fully opaque. Only
   the true surrounding plate is cut.
3. FEATHER the resulting binary matte with a 1px gaussian blur so cut edges
   are soft and antialiased (no hard jaggies, no black halo).
4. UN-PREMULTIPLY the 1px edge band: the generator composited the subject
   onto black, so edge pixels are darkened by the plate (c_obs = c_true * a).
   Dividing by alpha restores the true edge colour and kills the dark fringe.
5. TRIM to the subject's bounding box (plus a small margin) and downscale
   with Lanczos if a --max-edge budget is given.
6. OVERWRITE the target as an optimized 32-bit RGBA PNG (or write to --out).

Usage
-----
    python3 scripts/clean_alpha.py <input.png> [more.png ...] [--out FILE|DIR]
                                    [--max-edge N] [--feather 1.0]
                                    [--bg-threshold T] [--margin M]

    # key the realm seed + NPC plates (budgets: plants <= 768px, NPCs <= 720px)
    python3 scripts/clean_alpha.py tmp_gen/seed_da_da_cuc_raw.png \
        --out public/assets/plants/seed_da_da_cuc.png --max-edge 768

Requires: pillow, numpy  (pip install pillow numpy)
"""

from __future__ import annotations

import argparse
import os
import sys
from collections import deque

import numpy as np
from PIL import Image, ImageFilter

# A border-ring pixel is "plate" when its strongest channel is below this
# (auto-raised to bg_median + BG_SLACK when the plate is not perfectly black).
DEFAULT_BG_THRESHOLD = 40
BG_SLACK = 16
BG_PLATE_MAX_MEDIAN = 34  # border ring median must be at least this black
BORDER_RING = 8           # px ring used to detect / seed the plate


def detect_plate(max_ch: np.ndarray) -> float:
    """Median max-channel of the 8px border ring — how black the plate is."""
    h, w = max_ch.shape
    ring = np.ones_like(max_ch, dtype=bool)
    ring[BORDER_RING:h - BORDER_RING, BORDER_RING:w - BORDER_RING] = False
    return float(np.median(max_ch[ring]))


def flood_background(is_plate: np.ndarray) -> np.ndarray:
    """Boolean mask of plate pixels REACHABLE from the image border.

    BFS over the 4-neighbour grid. Enclosed dark regions inside the subject
    are never reached, so they survive as fully opaque art.
    """
    h, w = is_plate.shape
    visited = np.zeros_like(is_plate, dtype=bool)
    dq = deque()

    def seed(x: int, y: int) -> None:
        if is_plate[y, x] and not visited[y, x]:
            visited[y, x] = True
            dq.append((x, y))

    for x in range(w):
        seed(x, 0)
        seed(x, h - 1)
    for y in range(h):
        seed(0, y)
        seed(w - 1, y)

    while dq:
        x, y = dq.popleft()
        if x > 0 and is_plate[y, x - 1] and not visited[y, x - 1]:
            visited[y, x - 1] = True
            dq.append((x - 1, y))
        if x < w - 1 and is_plate[y, x + 1] and not visited[y, x + 1]:
            visited[y, x + 1] = True
            dq.append((x + 1, y))
        if y > 0 and is_plate[y - 1, x] and not visited[y - 1, x]:
            visited[y - 1, x] = True
            dq.append((x, y - 1))
        if y < h - 1 and is_plate[y + 1, x] and not visited[y + 1, x]:
            visited[y + 1, x] = True
            dq.append((x, y + 1))
    return visited


def clean_alpha(src: str, dst: str, max_edge: int | None, feather: float,
                bg_threshold: int, margin: int) -> dict:
    img = Image.open(src)
    if img.mode != 'RGB':
        img = img.convert('RGB')
    rgb = np.asarray(img, dtype=np.float32)
    h, w = rgb.shape[:2]
    max_ch = rgb.max(axis=2)

    # 1. detect the solid black plate ------------------------------------
    plate_median = detect_plate(max_ch)
    if plate_median > BG_PLATE_MAX_MEDIAN:
        raise ValueError(
            f'border ring median max-channel {plate_median:.0f} is not a '
            f'black plate (needs <= {BG_PLATE_MAX_MEDIAN}); refusing to key')

    # 2. flood-fill the connected background ------------------------------
    thresh = max(bg_threshold, int(plate_median) + BG_SLACK)
    is_plate = max_ch < thresh
    bg = flood_background(is_plate)
    bg_ratio = float(bg.mean())
    if bg_ratio < 0.02:
        raise ValueError('keyed background is under 2% of the frame — '
                         'this does not look like a black-plate sprite')

    # 3. binary matte -> 1px feathered alpha -------------------------------
    keep = (~bg).astype(np.uint8) * 255
    alpha = np.asarray(
        Image.fromarray(keep, mode='L').filter(ImageFilter.GaussianBlur(feather)),
        dtype=np.float32,
    )
    # the blur must never resurrect the plate: clamp pure background to 0
    alpha[bg & (alpha < 200)] = np.minimum(alpha, 96)[bg & (alpha < 200)]

    # 4. un-premultiply the edge band (c_obs = c_true * a) -----------------
    a_safe = np.maximum(alpha, 1.0) / 255.0
    scale = np.where(alpha > 4, 1.0 / a_safe, 1.0)      # only lift real edges
    scale = np.minimum(scale, 4.0)                       # cap the correction
    out_rgb = np.clip(rgb * scale[..., None], 0, 255)

    # fully cut pixels carry zeroed colour (clean 32-bit RGBA)
    dead = alpha <= 0.5
    out_rgb[dead] = 0.0
    alpha[dead] = 0.0

    # 5. trim to content + budget ------------------------------------------
    ys, xs = np.where(alpha > 0.5)
    if len(xs) == 0:
        raise ValueError('no visible content left after keying')
    x0, x1 = max(int(xs.min()) - margin, 0), min(int(xs.max()) + margin + 1, w)
    y0, y1 = max(int(ys.min()) - margin, 0), min(int(ys.max()) + margin + 1, h)
    out_rgb = out_rgb[y0:y1, x0:x1]
    alpha = alpha[y0:y1, x0:x1]

    if max_edge and max(out_rgb.shape[:2]) > max_edge:
        s = max_edge / max(out_rgb.shape[:2])
        nh, nw = max(1, round(out_rgb.shape[0] * s)), max(1, round(out_rgb.shape[1] * s))
        stack = np.dstack([out_rgb, alpha[..., None]]).astype(np.uint8)
        resized = Image.fromarray(stack, mode='RGBA').resize((nw, nh), Image.LANCZOS)
        arr = np.asarray(resized, dtype=np.float32)
        out_rgb, alpha = arr[..., :3], arr[..., 3]

    rgba = np.dstack([out_rgb, alpha]).astype(np.uint8)
    Image.fromarray(rgba, mode='RGBA').save(dst, format='PNG', optimize=True)

    total = rgba.shape[0] * rgba.shape[1]
    return {
        'src': src,
        'dst': dst,
        'size': f'{rgba.shape[1]}x{rgba.shape[0]}',
        'threshold': thresh,
        'bg_ratio': bg_ratio,
        'transparent': float((rgba[..., 3] == 0).mean()),
        'semi': float(((rgba[..., 3] > 0) & (rgba[..., 3] < 255)).mean()),
        'bytes': os.path.getsize(dst),
    }


def main() -> int:
    ap = argparse.ArgumentParser(description='Key black-plate sprites to true RGBA')
    ap.add_argument('inputs', nargs='+', help='input PNG(s) painted on #000000')
    ap.add_argument('--out', help='output FILE (single input) or DIR (multi)')
    ap.add_argument('--max-edge', type=int, default=None,
                    help='downscale so max(width, height) <= N (e.g. 768 sprites, 720 NPCs)')
    ap.add_argument('--feather', type=float, default=1.0, help='edge feather radius in px')
    ap.add_argument('--bg-threshold', type=int, default=DEFAULT_BG_THRESHOLD,
                    help='max-channel below this counts as plate')
    ap.add_argument('--margin', type=int, default=4, help='padding kept around the trimmed subject')
    args = ap.parse_args()

    outs = []
    if args.out and os.path.isdir(args.out):
        outs = [os.path.join(args.out, os.path.basename(p)) for p in args.inputs]
    elif args.out:
        if len(args.inputs) != 1:
            ap.error('--out as a file needs exactly one input')
        outs = [args.out]
    else:
        outs = list(args.inputs)

    failures = 0
    for src, dst in zip(args.inputs, outs):
        try:
            r = clean_alpha(src, dst, args.max_edge, args.feather,
                            args.bg_threshold, args.margin)
            print(f"OK    {src} -> {r['dst']}  {r['size']}  "
                  f"plate {r['bg_ratio'] * 100:.0f}% keyed (thresh {r['threshold']})  "
                  f"alpha: {r['transparent'] * 100:.0f}% cut / {r['semi'] * 100:.1f}% feathered  "
                  f"{r['bytes'] / 1024:.0f}KB")
        except Exception as e:  # noqa: BLE001 — report and keep going
            failures += 1
            print(f'FAIL  {src}: {e}', file=sys.stderr)

    if failures:
        print(f'\n{failures} file(s) could not be keyed', file=sys.stderr)
        return 1
    print('\nCLEAN ALPHA OK — every target is a genuine 32-bit RGBA PNG '
          'with true transparency')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
