"""Замер слоя карт у ловушек (17.11.2026) -> src/explore/trapTints.ts.

    python tools/measure_trap_tint.py          все карты
    python tools/measure_trap_tint.py --check  только сравнить с файлом

Что меряет (по ГОТОВОМУ слою карты в public — после clean_trap_decor.py):
  * горгулья — средний цвет кладки стены за головой: клетки (x-dir, y) и
    (x-dir, y-1), непрозрачные пиксели слоя (альфа > 200) без самых тёмных 25%
    (швы), по всем горгульям пула карты;
  * сталактит — средний цвет НИЖНЕЙ стороны потолка над ним (26.11.2026; до
    этого — вся клетка, светлая лицевая кладка, и сталактит выходил светлее
    тени под платформой): нижние UNDERSIDE_ROWS строк клеток (x, ceil),
    (x+1, ceil); обломки красятся тем же цветом;
  * пила — видимый верх пола под рельсом: в каждом столбце рельса (шаг 4 px)
    первая строка с альфой > 128 от верха клетки пола −24 до +40 px; медиана —
    насколько видимый пол ниже линии клетки (px). По ней игра топит рельс в пол.
  * яркость серого камня самих ассетов (кадр 0 горгульи, сталактит, обломки):
    средняя яркость пикселей с насыщенностью < 0.22 и альфой > 200 — по ней
    шейдер stoneTint.ts переносит светотень ассета на цвет кладки.

Пересобрал слой, переставил ловушки — запустить снова.
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
import trap_rules as R  # noqa: E402

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

OUT = R.ROOT / 'src' / 'explore' / 'trapTints.ts'
TRAPS = R.ROOT / 'public' / 'assets' / 'objects' / 'traps'
ARCHIVE = Path(r'D:\dev\right-place-art\archive\game-assets-old\sheets-full-2026-11-16\objects\traps')
T = R.TS


UNDERSIDE_ROWS = 20


def mean_rgb(rgba, cells, rows=None):
    px = []
    H, W = rgba.shape[:2]
    for cx, cy in cells:
        if not (0 <= cx * T < W and 0 <= cy * T < H):
            continue
        y0 = cy * T if rows is None else (cy + 1) * T - rows
        blk = rgba[y0:(cy + 1) * T, cx * T:(cx + 1) * T].reshape(-1, 4)
        px.append(blk[blk[:, 3] > 200, :3])
    px = np.concatenate(px) if px else np.zeros((0, 3))
    if len(px) < 100:
        return None
    # Без самых тёмных 25% — это швы и щели кладки, а не камень. У нижней
    # стороны потолка (rows) тень — и есть то, под что красим: берём всё.
    if rows is None:
        lum = px @ np.array([0.299, 0.587, 0.114])
        px = px[lum >= np.percentile(lum, 25)]
    return [int(round(v)) for v in px.mean(0)]


def stone_lum(img):
    a = np.asarray(img.convert('RGBA')).reshape(-1, 4).astype(float) / 255
    a = a[a[:, 3] > 200 / 255]
    rgb = a[:, :3]
    mx, mn = rgb.max(1), rgb.min(1)
    sat = (mx - mn) / np.maximum(mx, 1e-4)
    st = rgb[sat < 0.22]
    return round(float((st @ np.array([0.299, 0.587, 0.114])).mean()), 4)


def saw_sink(rgba, saw):
    floor = (saw['y'] + 1) * T
    offs = []
    for cx in range(saw['x0'], saw['x1'] + 1):
        for x in range(cx * T + 2, (cx + 1) * T, 4):
            col = rgba[floor - 24:floor + 40, x, 3]
            hit = np.where(col > 128)[0]
            if len(hit):
                offs.append(int(hit[0]) - 24)
    return int(np.median(offs)) if offs else 0


def measure():
    out = {}
    for slots_path in sorted(R.MAPS.glob('map_*_slots.json')):
        letter = slots_path.name.split('_')[1]
        txt, _ = R.map_files(letter)
        slots = json.loads(slots_path.read_text(encoding='utf-8'))
        if not (slots.get('gargoyles') or slots.get('stalactites') or slots.get('saws')):
            continue
        grid = R.load_grid(txt)
        rgba = R.layer_rgba(txt, grid)
        e = {}
        g = slots.get('gargoyles') or []
        if g:
            cells = [(t['x'] - t['dir'], t['y'] - k) for t in g for k in range(R.GARGOYLE_WALL_H)]
            e['gargoyle'] = mean_rgb(rgba, cells)
        st = slots.get('stalactites') or []
        if st:
            cells = [(cx, t['ceil']) for t in st for cx in (t['x'], t['x'] + 1)]
            e['stalactite'] = mean_rgb(rgba, cells, UNDERSIDE_ROWS)
        sw = slots.get('saws') or []
        if sw:
            e['sawSink'] = {f"{t['x0']},{t['y']}": saw_sink(rgba, t) for t in sw}
        out[txt.name] = e
    src = {
        'gargoyle': stone_lum(Image.open(ARCHIVE / 'Gargoyle_Fire.png').crop((0, 0, 277, 254))),
        'stalactite': stone_lum(Image.open(TRAPS / 'Stalactite_Full.png')),
        'rubble': stone_lum(Image.open(TRAPS / 'Stalactite_Rubble.png')),
    }
    return out, src


def render(out, src):
    lines = ['// СГЕНЕРИРОВАНО tools/measure_trap_tint.py — руками не править.',
             '//',
             '// Слой карты у ловушек (17.11.2026): средний цвет кладки за головой горгульи',
             '// и нижней стороны потолка над сталактитом (0..255; им красит stoneTint.ts), и насколько',
             '// видимый верх пола ниже линии клетки под рельсом пилы (px; ключ «x0,y»).',
             '// TRAP_SRC_LUM — средняя яркость серого камня самих ассетов.',
             'export type TrapTint = { gargoyle?: [number, number, number]; stalactite?: [number, number, number]; sawSink?: Record<string, number> }',
             '',
             f"export const TRAP_SRC_LUM = {{ gargoyle: {src['gargoyle']}, stalactite: {src['stalactite']}, rubble: {src['rubble']} }}",
             '',
             'export const TRAP_TINTS: Record<string, TrapTint> = {']
    for name, e in out.items():
        parts = []
        for k in ('gargoyle', 'stalactite'):
            if e.get(k):
                parts.append(f"{k}: [{', '.join(str(v) for v in e[k])}]")
        if e.get('sawSink'):
            parts.append('sawSink: { ' + ', '.join(f"'{k}': {v}" for k, v in e['sawSink'].items()) + ' }')
        lines.append(f"  '{name}': {{ {', '.join(parts)} }},")
    lines += ['}', '']
    return '\n'.join(lines)


def main():
    out, src = measure()
    text = render(out, src)
    for name, e in out.items():
        print(name, e)
    print('src lum', src)
    if '--check' in sys.argv:
        same = OUT.exists() and OUT.read_text(encoding='utf-8') == text
        print('trapTints.ts', 'совпадает' if same else 'РАСХОДИТСЯ')
        sys.exit(0 if same else 1)
    OUT.write_text(text, encoding='utf-8')


if __name__ == '__main__':
    main()
