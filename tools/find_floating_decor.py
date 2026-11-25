"""Висящий декор на слоях карт (23.11.2026) — поиск, только чтение.

    python tools/find_floating_decor.py              все карты, текущие слои (public)
    python tools/find_floating_decor.py A F          выбранные
    python tools/find_floating_decor.py --pristine   нетронутые слои (до чистки зон
                                                     ловушек, game-export/trap-clean)

Кусок декора — связная область непрозрачных пикселей (альфа > 0, 8-связность)
в ПУСТЫХ клетках сетки (trap_rules.components). Висит, если ни один его пиксель
не ближе SUPPORT_PX к опоре: тверди ('#', '='), кромке травы болота или бахроме
платформы. Опора может быть снизу (стоит на полу), сбоку (на стене) или сверху
(свисает с потолка) — так держатся факелы, цепи и вьюн. Мелочь (меньше MIN_AREA
пикселей или ярче MIN_ALPHA ни разу) — пыль и отблески, не предмет.

Тот же отбор вызывает clean_trap_decor.py (floating_labels) и стирает найденное.
"""
import sys
from pathlib import Path

import numpy as np
from scipy import ndimage

sys.path.insert(0, str(Path(__file__).resolve().parent))
import trap_rules as R  # noqa: E402

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

SUPPORT_PX = 2
MIN_AREA = 24
MIN_ALPHA = 96
PRISTINE = Path(r'D:\dev\right-place-art\game-export\trap-clean\pristine')


def floating_labels(rgba, grid, letter):
    """(метки областей, список висящих: (метка, x0, y0, x1, y1, площадь))."""
    labels, n, fringe, opaque = R.components(rgba, grid, letter)
    solid = ~R.empty_pixels(grid)
    support = solid | R.grass_band(grid, letter) | fringe
    near = ndimage.binary_dilation(support, structure=np.ones((3, 3), bool), iterations=SUPPORT_PX)
    alpha = rgba[:, :, 3]
    out = []
    for i, sl in enumerate(ndimage.find_objects(labels), start=1):
        if sl is None:
            continue
        m = labels[sl] == i
        if fringe[sl][m].any():
            continue
        area = int(m.sum())
        if area < MIN_AREA or int(alpha[sl][m].max()) < MIN_ALPHA:
            continue
        if near[sl][m].any():
            continue
        out.append((i, sl[1].start, sl[0].start, sl[1].stop, sl[0].stop, area))
    return labels, out


def main():
    pristine = '--pristine' in sys.argv
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    letters = args or sorted({p.name.split('_')[1] for p in R.MAPS.glob('map_*_slots.json')})
    total = 0
    for letter in letters:
        txt, _ = R.map_files(letter)
        grid = R.load_grid(txt)
        rgba = R.layer_rgba(txt, grid, art_dir=PRISTINE if pristine else None)
        _, fl = floating_labels(rgba, grid, letter)
        total += len(fl)
        print(f'== {letter}: висящих {len(fl)}')
        for (_i, x0, y0, x1, y1, area) in fl:
            print(f'   клетка ({x0 // R.TS},{y0 // R.TS})  px [{x0},{y0}..{x1},{y1}]  {x1 - x0}×{y1 - y0}  площадь {area}')
    print(f'итого: {total}')


if __name__ == '__main__':
    main()
