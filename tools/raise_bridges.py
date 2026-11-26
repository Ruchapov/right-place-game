"""Поднять мосты (26.11.2026, «Правки 26.11 (мосты)», docs/maps.md).

    python tools/raise_bridges.py          рабочие копии + отчёт
    python tools/raise_bridges.py --dry    только отчёт

Пакет Codex не правится (правило CLAUDE.md): рабочая копия кладётся рядом с
пакетом — D:\\dev\\right-place-art\\maps\\swamp\\new-two\\bridges-2026-11-26\\<ключ>\\
(world-overlay.png, <ключ>.txt, report.json, previews/). Её берёт
build_map_art_new_six.mjs (WORK_BRIDGES, закреплена sha256).

Мост — полоса '=' в ряду row, x0..x1. Его рисунок — связные области непрозрачных
пикселей слоя (8-связность), целиком лежащие в коробке моста: x0−½..x1+1+½
клетки, row−½..row+1 клетки (бревно с подвесом); области, касающиеся края коробки
(камень ступеней), не трогаются — так в слое не остаётся обрезков и не задет
камень. Найденное едет вверх на dy клеток, старое место прозрачное. Проверки:
после переноса в коробке нет ни одного непрозрачного пикселя старого моста, на
новом месте под ним не было ничего непрозрачного (иначе — стоп).
"""
import hashlib
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

ROOT = Path(__file__).resolve().parent.parent
ART = Path(r'D:\dev\right-place-art')
PACK = ART / 'maps' / 'swamp' / 'new-two' / 'handoff-2026-11'
WORK = ART / 'maps' / 'swamp' / 'new-two' / 'bridges-2026-11-26'
T = 64

# Мосты: ключ пакета → [(ряд, x0, x1, на сколько клеток вверх)].
BRIDGES = {
    # Y «Затопленный погост», настил над пещерой с лестницами (скриншот 26.11):
    # на ступенях (38,12) и (57,12) прыжок к мосту упирался в его край головой.
    'swamp-yards': [(11, 39, 56, 1)],
}


def sha(p):
    return hashlib.sha256(Path(p).read_bytes()).hexdigest()


def move_bridge(img, grid, row, x0, x1, dy):
    a = img[:, :, 3]
    bx0, bx1 = int((x0 - 0.5) * T), int((x1 + 1.5) * T)
    by0, by1 = int((row - 0.5) * T), int((row + 1) * T)
    box = np.zeros(a.shape, bool)
    box[by0:by1, bx0:bx1] = True
    lab, n = ndimage.label(a > 0, structure=np.ones((3, 3)))
    in_box = set(np.unique(lab[box])) - {0}
    edge = np.zeros(a.shape, bool)
    edge[by0:by1, bx0] = edge[by0:by1, bx1 - 1] = True
    edge[by0, bx0:bx1] = edge[by1 - 1, bx0:bx1] = True
    on_edge = set(np.unique(lab[edge])) - {0}
    # Области, выходящие за коробку, — не мост (камень ступеней, трава).
    outside = set(np.unique(lab[~box])) - {0}
    take = sorted(in_box - on_edge - outside)
    mask = np.isin(lab, take)
    if not mask.any():
        raise SystemExit(f'мост ряд {row} x {x0}..{x1}: в слое ничего не нашлось')
    ys, xs = np.nonzero(mask)
    shift = dy * T
    if ys.min() - shift < 0:
        raise SystemExit('мост уходит за верх карты')
    dest = np.zeros_like(mask)
    dest[ys - shift, xs] = True
    clash = dest & ~mask & (a > 0)
    if clash.any():
        raise SystemExit(f'на новом месте моста уже нарисовано {int(clash.sum())} px — стоп')
    pix = img[ys, xs].copy()
    img[ys, xs] = 0
    img[ys - shift, xs] = pix
    for x in range(x0, x1 + 1):
        if grid[row][x] != '=' or grid[row - dy][x] != '.':
            raise SystemExit(f'сетка: ({x},{row}) не "=" или ({x},{row - dy}) не воздух')
        grid[row][x] = '.'
        grid[row - dy][x] = '='
    left = (img[by0:by1, bx0:bx1, 3] > 0) & mask[by0:by1, bx0:bx1]
    return {'row': row, 'x0': x0, 'x1': x1, 'dy': dy, 'regions': len(take), 'pixels': int(mask.sum()),
            'bbox': [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())], 'leftover': int(left.sum())}


def main():
    dry = '--dry' in sys.argv
    out = {}
    for key, bridges in BRIDGES.items():
        src = PACK / key
        img = np.array(Image.open(src / 'world-overlay.png').convert('RGBA'))
        grid = [list(r) for r in (src / f'{key}.txt').read_text(encoding='utf-8').split('\n') if r.strip()]
        rep = [move_bridge(img, grid, *b) for b in bridges]
        for r in rep:
            print(f"{key}: мост ряд {r['row']} x {r['x0']}..{r['x1']} вверх на {r['dy']} — областей {r['regions']}, "
                  f"{r['pixels']} px, рамка {r['bbox']}, обрезков на старом месте {r['leftover']}")
            if r['leftover']:
                raise SystemExit('на старом месте остались пиксели моста')
        if dry:
            continue
        dst = WORK / key
        (dst / 'previews').mkdir(parents=True, exist_ok=True)
        Image.fromarray(img).save(dst / 'world-overlay.png', optimize=False)
        (dst / f'{key}.txt').write_text('\n'.join(''.join(r) for r in grid) + '\n', encoding='utf-8')
        for r in rep:
            x0, x1 = (r['x0'] - 4) * T, (r['x1'] + 5) * T
            y0, y1 = (r['row'] - r['dy'] - 4) * T, (r['row'] + 7) * T
            old = Image.open(src / 'world-overlay.png').convert('RGBA').crop((x0, y0, x1, y1))
            new = Image.fromarray(img).crop((x0, y0, x1, y1))
            pv = Image.new('RGBA', (old.width * 2 + 16, old.height), (40, 44, 52, 255))
            for i, im in enumerate((old, new)):
                bg = Image.new('RGBA', im.size, (60, 70, 90, 255))
                bg.alpha_composite(im)
                pv.paste(bg, (i * (old.width + 16), 0))
            pv.convert('RGB').save(dst / 'previews' / f"row{r['row']}_x{r['x0']}.jpg", quality=85)
        files = {n: sha(dst / n) for n in ('world-overlay.png', f'{key}.txt')}
        out[key] = {'bridges': rep, 'sha256': files}
        (dst / 'report.json').write_text(json.dumps(out[key], ensure_ascii=False, indent=2), encoding='utf-8')
        print(f'{key}: рабочая копия {dst}', json.dumps(files))


if __name__ == '__main__':
    main()
