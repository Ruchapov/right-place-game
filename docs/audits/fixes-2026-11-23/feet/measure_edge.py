"""Видимая верхняя кромка пола на готовых слоях карт относительно верха клетки сетки.

Для каждой клетки стояния (клетка '#' или '=' с воздухом над ней и над ним) берём
столбцы в средней половине клетки (x*64+16 .. x*64+47), в каждом — первую сверху
строку в окне [верх клетки − 24, верх клетки + 40), где альфа ≥ ALPHA. Медиана по
столбцам — кромка этой клетки. Отдельно: '#'-пол, '='-полка, «ступень» ('#'-клетка,
у которой соседняя клетка стояния слева или справа на ряд выше/ниже).
"""
import json, re, sys, statistics
from pathlib import Path
import numpy as np
from PIL import Image

ROOT = Path(r'D:/dev/telegram-game')
ART = ROOT / 'public/assets/maps/art'
TS = 64
ALPHA = 200

def manifests():
    out = {}
    for f in ['mapArtManifest.ts', 'mapArtManifestNewSix.ts', 'mapArtManifestCryptFoundry.ts']:
        txt = (ROOT / 'src/explore' / f).read_text(encoding='utf-8')
        for m in re.finditer(r"'(map_[^']+\.txt)':\s*\{(.*?)\},?\s*\n", txt):
            name, body = m.group(1), m.group(2)
            slices = re.findall(r"\{ file: '([^']+)', x: (\d+), width: (\d+) \}", body)
            if not slices:
                fm = re.search(r"file: '([^']+)'", body)
                slices = [(fm.group(1), '0', '0')]
            out[name] = [(a, int(b)) for a, b, _ in slices]
    return out

def load_alpha(slices):
    parts = []
    for file, x in slices:
        im = Image.open(ART / file).convert('RGBA')
        parts.append((x, np.asarray(im)[:, :, 3]))
    w = max(x + a.shape[1] for x, a in parts)
    h = max(a.shape[0] for _, a in parts)
    full = np.zeros((h, w), np.uint8)
    for x, a in parts:
        full[: a.shape[0], x: x + a.shape[1]] = a
    return full

def main():
    mans = manifests()
    want = sys.argv[1:] or None
    report = {}
    for name, slices in sorted(mans.items()):
        letter = re.match(r'map_([A-Z]\d?)_', name).group(1)
        if want and letter not in want:
            continue
        grid = (ROOT / 'public/assets/maps' / name).read_text(encoding='utf-8').replace('\r', '').split('\n')
        grid = [r for r in grid if r]
        A = load_alpha(slices)
        H, W = len(grid), max(len(r) for r in grid)
        g = lambda x, y: grid[y][x] if 0 <= y < H and 0 <= x < len(grid[y]) else '#'
        stand = {}
        for y in range(1, H):
            for x in range(W):
                if g(x, y) in '#=' and g(x, y - 1) not in '#=' and g(x, y - 2) not in '#=':
                    stand[(x, y)] = g(x, y)
        res = {'#': [], '=': [], 'step': []}
        for (x, y), ch in stand.items():
            top = y * TS
            vals = []
            for cx in range(x * TS + 16, x * TS + 48):
                col = A[max(0, top - 24): top + 40, cx]
                idx = np.nonzero(col >= ALPHA)[0]
                if len(idx):
                    vals.append(int(idx[0]) + max(0, top - 24) - top)
            if len(vals) < 8:
                continue
            edge = statistics.median(vals)
            kind = ch
            if ch == '#':
                for dx in (-1, 1):
                    for dy in (-1, 1):
                        if (x + dx, y + dy) in stand and (x + dx, y) not in stand:
                            kind = 'step'
            res[kind].append(edge)
        report[letter] = res
        def s(v):
            if not v:
                return '—'
            q = np.percentile(v, [10, 50, 90])
            return f'n={len(v):3d} p10={q[0]:5.1f} med={q[1]:5.1f} p90={q[2]:5.1f}'
        print(f'{letter:3s} пол#: {s(res["#"])} | полка=: {s(res["="])} | ступень: {s(res["step"])}')
    json.dump(report, open(Path(__file__).with_name('edges.json'), 'w'))

main()
