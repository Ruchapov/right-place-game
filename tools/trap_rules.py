"""Общие правила ловушек (13.11.2026; 14.11.2026 — горгулья на столбе, свои
правила сталактита) — для place_traps.py, clean_trap_decor.py и check_map_slots.py.

Одна копия правил на расстановку и на проверку: разойдутся — скрипт будет
ставить то, что проверка бракует, или наоборот. Модуль только считает, файлов
не пишет.

Ловушки (координаты — клетки сетки, y — ряд стояния, пол под ним в y+1):
  hazard      [x, y]                               шип, клетка (x, y)
  gargoyles   {x, y, dir, plate: [px, y]}          горгулья В СТЕНЕ (17.11.2026;
              14.11 стояла на столбе — «палка посреди прохода», отменено): x —
              клетка прохода у стены, в столбце x-dir — «#» на рядах y и y-1
              (стена от пола не ниже 2 клеток); голова вделана в стену, смотрит
              в dir и занимает клетки x, x+dir на рядах y-1..y (свободно — y-2..y).
              Плита — клетки px, px+1 на том же ряду
  stalactites {x, y, ceil}                          столб x, x+1; ceil — ряд
              потолка «#», над полом (y - ceil) клеток воздуха, 3..9
  saws        {x0, x1, y}                           рельс x0..x1, 4..6 клеток

Зоны, где не должно быть декора (клетки):
  шип        (x, y)
  горгулья   голова — 2x3: столбцы x, x+dir, ряды y-2..y; плита (px, y),
             (px+1, y) и клетки над ними
  сталактит  столбцы x, x+1, ряды ceil+1 .. ceil+3, и клетки пола (x, y), (x+1, y)
  пила       клетки рельса и клетки над ними
"""
import math
import re
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MAPS = ROOT / 'public' / 'assets' / 'maps'
ART = MAPS / 'art'
TS = 64

# Числа (14.11.2026, третья правка). Декор расстановку не ограничивает: он
# стирается из слоя в зонах ловушек при сборке (tools/clean_trap_decor.py), а
# проверка считает декор по уже очищенному слою с допуском 0.
#
# НАПОЛЬНЫЕ ловушки (горгулья с плитой, пила) — «след» на полу: клетка столба и
# плита у горгульи, рельс у пилы. Шипы — существующий пул, сами не проверяются,
# но от них держатся напольные.
SPACING_ANY = 4       # между любыми ловушками на ряду (шипы тоже), клеток
SPACING_SAME = 6      # между ловушками одного вида
WINDOW, WINDOW_MAX = 14, 2   # не больше 2 НОВЫХ напольных на 14 клеток ряда (шипы не в счёт)
START_MIN = 10        # от старта (и сталактит)
ENEMY_MIN = 3         # от точек врагов
POINT_MIN = 4         # от сундуков, NPC, босса, обелиска
BREAKABLE_MIN = 2     # от бочек и кувшинов
EDGE_MIN = 2          # от края площадки (столб, плита, рельс)
HAZARD_EDGE_MIN = 2   # шипы, как в check_map_slots.py (TRAP_EDGE_MIN)
# Сталактит пол не занимает: в шаг напольных не входит. Свои правила.
STAL_SPACING = 4      # от другого сталактита
STAL_BELOW_PAD = 1    # не прямо над шипом, пилой, плитой, горгульей, сундуком, точкой врага (±1)
DECOR_ALPHA = 32      # пиксель декора — альфа больше этого
DECOR_TOL = 0         # пикселей декора в клетке зоны (на очищенном слое)
SWAMP_GRASS_PX = 6    # болото: кромка травы над полом, которую чистка оставляет
SWAMP_MAPS = ('B2', 'C2', 'W', 'Y')
GARGOYLE_FLOOR = 7    # ровный пол от стены в сторону огня
GARGOYLE_WALL_H = 2
GARGOYLE_HEAD_POINT_MIN = 2   # от клетки под головой до сундука, врага, бочки
GARGOYLE_PLATE_ENEMY_MIN = 2  # плита от точки врага (у прочих ловушек ENEMY_MIN 3)   # стена «#» в столбце x-dir от пола вверх, клеток (17.11.2026)
GARGOYLE_FREE_H = 3   # свободно над полом у головы (ряды y-2..y)
POST_CEIL_MAX = 9     # столб до потолка, если потолок не выше этого над полом
POST_FREE_H = 3       # иначе столб высотой столько клеток
PLATE_DIST = (2, 8)   # плита от стены (17.11.2026: было 4..8 от столба)
STAL_H = (3, 9)       # высота потолка над полом
STAL_ZONE_ROWS = 3    # столб сталактита от потолка вниз (зона декора)
SAW_LEN = (4, 6)
SAW_FLOOR = 8
GARGOYLE_MAX, SAW_MAX = 3, 3
SPIKES_PER_RUN = 7
POOL_MULT = 1.5
# Цель за забег по видам (14.11.2026).
GARGOYLE_TARGET = {'B': 3, 'D': 3, 'F': 3}       # остальные 2
STAL_TARGET = {'B2': 2, 'Y': 2}                  # остальные 3
SAW_TARGET = {'C': 3, 'D': 3, 'F': 3, 'B2': 1, 'Y': 1}   # остальные 2


def load_grid(path):
    return [list(r.rstrip('\r')) for r in path.read_text(encoding='utf-8').split('\n') if r.rstrip('\r')]


def map_files(letter):
    txts = list(MAPS.glob(f'map_{letter}_*.txt'))
    if len(txts) != 1:
        raise SystemExit(f'{letter}: ожидался один .txt, нашлось {[p.name for p in txts]}')
    return txts[0], MAPS / f'map_{letter}_slots.json'


def per_run(letter, n_hazard):
    """Цель за забег по видам."""
    return {
        'spikes': min(SPIKES_PER_RUN, n_hazard),
        'stalactites': STAL_TARGET.get(letter, 3),
        'gargoyles': GARGOYLE_TARGET.get(letter, 2),
        'saws': SAW_TARGET.get(letter, 2),
    }


# --- Декор: слой карты + живой декор из кода ---

def _manifest_text():
    src = ROOT / 'src' / 'explore'
    return ''.join((src / f).read_text(encoding='utf-8') for f in
                   ('mapArtManifest.ts', 'mapArtManifestCryptFoundry.ts', 'mapArtManifestNewSix.ts'))


def _entry_line(txt_name):
    m = re.search(r"'" + re.escape(txt_name) + r"': \{(.*)\},?\r?\n", _manifest_text())
    if not m:
        raise SystemExit(f'{txt_name}: нет строки в манифестах слоёв (src/explore/mapArt*.ts)')
    return m.group(1)


def map_letter(txt_path):
    return Path(txt_path).name.split('_')[1]


def grass_band(grid, letter):
    """Болото: нижние SWAMP_GRASS_PX пикселей пустой клетки над твердью — кромка
    травы пола, не декор (чистка её оставляет). У прочих карт — пусто."""
    import numpy as np
    H, W = len(grid), len(grid[0])
    band = np.zeros((H * TS, W * TS), bool)
    if letter not in SWAMP_MAPS:
        return band
    for y in range(H - 1):
        for x in range(W):
            if grid[y][x] not in '#=' and grid[y + 1][x] in '#=':
                band[(y + 1) * TS - SWAMP_GRASS_PX:(y + 1) * TS, x * TS:(x + 1) * TS] = True
    return band


def layer_rgba(txt_path, grid, art_dir=None):
    """Слой карты целиком (RGBA, numpy) из частей манифеста."""
    from PIL import Image
    import numpy as np
    H, W = len(grid), len(grid[0])
    rgba = np.zeros((H * TS, W * TS, 4), np.uint8)
    for f, x, _w in slices_of(txt_path):
        a = np.array(Image.open((art_dir or ART) / f).convert('RGBA'))
        rgba[:a.shape[0], int(x):int(x) + a.shape[1]] = a
    return rgba


def slices_of(txt_path):
    return re.findall(r"\{ file: '([^']+)', x: (\d+), width: (\d+) \}", _entry_line(Path(txt_path).name))


def sway_items(txt_path):
    """Качающиеся стебли манифеста слоя: (x, y, w, h) — левый верх и размер."""
    return [tuple(float(v) for v in t) for t in re.findall(
        r"sprite: '[a-z]+', x: (-?[\d.]+), y: (-?[\d.]+), w: ([\d.]+), h: ([\d.]+)", _entry_line(Path(txt_path).name))]


def flame_points(txt_path):
    """Фитили живого огня (liveDecorManifest.ts): (x, y, w, h) — низ пламени и пятно."""
    live = (ROOT / 'src' / 'explore' / 'liveDecorManifest.ts').read_text(encoding='utf-8')
    m = re.search(r"'" + re.escape(Path(txt_path).name) + r"': \[(.*?)\],?\r?\n", live)
    if not m:
        return []
    return [tuple(float(v) for v in t) for t in re.findall(r"x: ([\d.]+), y: ([\d.]+), w: ([\d.]+), h: ([\d.]+)", m.group(1))]


def flame_rect(f):
    x, y, w, h = f
    w3, h3 = w * 3, h * 3   # живое пламя выше и шире стёртого пятна
    return (x - w3 / 2, y - h3, w3, h3)


def cleared_live(txt_path):
    """Живой декор, стёртый чисткой (src/explore/trapDecorCleared.ts):
    {'flames': {(x, y)}, 'sway': {(x, y)}, 'chains': {(x, y)}}."""
    p = ROOT / 'src' / 'explore' / 'trapDecorCleared.ts'
    out = {'flames': set(), 'sway': set(), 'chains': set()}
    if not p.exists():
        return out
    t = p.read_text(encoding='utf-8')
    name = "'" + Path(txt_path).name + "': ["
    for kind, key in (('flames', 'CLEARED_FLAMES'), ('sway', 'CLEARED_SWAY'), ('chains', 'CLEARED_CHAINS')):
        i = t.find('export const ' + key)
        if i < 0:
            continue
        block = t[i:t.find('\n}', i)]
        for line in block.splitlines():
            if line.strip().startswith(name):
                for x, y in re.findall(r"\[(-?[\d.]+), (-?[\d.]+)\]", line[line.index(': [') + 2:]):
                    out[kind].add((float(x), float(y)))
    return out


# Связная область непрозрачных пикселей в пустых клетках шире FRINGE_W клеток или
# выше FRINGE_H — не предмет, а кромка платформы (болотная бахрома корней под
# платформой тянется во всю её длину). Её чистка не трогает, а проверка декором
# не считает — как кромку травы. Предметы декора меньше.
FRINGE_W, FRINGE_H = 4, 3


def empty_pixels(grid):
    import numpy as np
    H, W = len(grid), len(grid[0])
    empty = np.array([[grid[y][x] not in '#=' for x in range(W)] for y in range(H)])
    return np.repeat(np.repeat(empty, TS, 0), TS, 1)


def components(rgba, grid, letter):
    """(метки, число, маска кромки платформы) по непрозрачным (альфа > 0)
    пикселям пустых клеток, без кромки травы болота; 8-связность."""
    import numpy as np
    from scipy import ndimage
    opaque = (rgba[:, :, 3] > 0) & empty_pixels(grid) & ~grass_band(grid, letter)
    labels, n = ndimage.label(opaque, structure=np.ones((3, 3), bool))
    big = [i for i, sl in enumerate(ndimage.find_objects(labels), start=1)
           if sl is not None and (sl[1].stop - sl[1].start > FRINGE_W * TS or sl[0].stop - sl[0].start > FRINGE_H * TS)]
    fringe = np.isin(labels, big) if big else np.zeros(labels.shape, bool)
    return labels, n, fringe, opaque


def decor_pixels(txt_path, grid):
    """Маска пикселей декора (numpy bool, H*TS × W*TS): непрозрачные (альфа >
    DECOR_ALPHA) пиксели слоя в ПУСТЫХ клетках сетки, кроме кромки травы болота,
    плюс прямоугольники живого декора (стебли, пламя), которых чистка не стёрла."""
    import numpy as np
    H, W = len(grid), len(grid[0])
    rgba = layer_rgba(txt_path, grid)
    px = rgba[:, :, 3] > DECOR_ALPHA
    px &= empty_pixels(grid)
    px &= ~grass_band(grid, map_letter(txt_path))
    px &= ~components(rgba, grid, map_letter(txt_path))[2]
    gone = cleared_live(txt_path)
    for (x, y, w, h) in sway_items(txt_path):
        if (x, y) not in gone['sway']:
            _mark(px, x, y, w, h)
    for f in flame_points(txt_path):
        if (f[0], f[1]) not in gone['flames']:
            _mark(px, *flame_rect(f))
    return px


def decor_mask(txt_path, grid):
    """Число пикселей декора в каждой ПУСТОЙ клетке (decor_pixels); твердь — None."""
    px = decor_pixels(txt_path, grid)
    H, W = len(grid), len(grid[0])
    out = [[None] * W for _ in range(H)]
    for y in range(H):
        for x in range(W):
            if grid[y][x] in '#=':
                continue
            out[y][x] = int(px[y * TS:(y + 1) * TS, x * TS:(x + 1) * TS].sum())
    return out


def _mark(px, x0, y0, w, h):
    H, W = px.shape
    a, b = max(0, int(math.floor(x0))), min(W, int(math.ceil(x0 + w)))
    c, d = max(0, int(math.floor(y0))), min(H, int(math.ceil(y0 + h)))
    if a < b and c < d:
        px[c:d, a:b] = 1


# --- Геометрия ловушек ---

def post_top(g, x, y):
    """Верхний ряд столба горгульи в столбце x: до потолка (первая твердь над
    полом), если она не выше POST_CEIL_MAX клеток; иначе POST_FREE_H клеток."""
    cy = y - 1
    while cy >= 0 and g[cy][x] not in '#=':
        cy -= 1
    if cy >= 0 and y - cy <= POST_CEIL_MAX:
        return cy + 1
    return y - POST_FREE_H + 1


def zone_cells(kind, t, g=None):
    """Клетки, где не должно быть декора. g нужен горгулье (высота столба)."""
    if kind == 'hazard':
        return [tuple(t)]
    if kind == 'gargoyles':
        # 17.11.2026: голова в стене, столба нет — зона только у головы и плиты.
        x, y, d = t['x'], t['y'], t['dir']
        px = t['plate'][0]
        cells = {(x, cy) for cy in range(y - GARGOYLE_FREE_H + 1, y + 1)}
        cells |= {(x + d, cy) for cy in range(y - GARGOYLE_FREE_H + 1, y + 1)}
        cells |= {(px, y), (px + 1, y), (px, y - 1), (px + 1, y - 1)}
        return sorted(cells)
    if kind == 'stalactites':
        x, y, c = t['x'], t['y'], t['ceil']
        cells = [(cx, cy) for cx in (x, x + 1) for cy in range(c + 1, c + 1 + STAL_ZONE_ROWS)]
        return cells + [(x, y), (x + 1, y)]
    if kind == 'saws':
        return [(cx, cy) for cx in range(t['x0'], t['x1'] + 1) for cy in (t['y'], t['y'] - 1)]
    raise ValueError(kind)


def footprint(kind, t):
    """Клетки ряда стояния, которые ловушка занимает на ПОЛУ (для шага и окна 14).
    Сталактит пол не занимает — у него свои правила (check_stalactite)."""
    if kind == 'hazard':
        return [tuple(t)]
    if kind == 'gargoyles':
        # Клетка столба и плита. Полоса огня между ними — НЕ след: огонь вправе
        # лететь через точку врага или сундука (он бьёт первого на пути).
        x, y, px = t['x'], t['y'], t['plate'][0]
        return sorted([(x, y), (px, y), (px + 1, y)])
    if kind == 'stalactites':
        return []
    if kind == 'saws':
        return [(cx, t['y']) for cx in range(t['x0'], t['x1'] + 1)]
    raise ValueError(kind)


def anchor(kind, t):
    """Одна клетка ловушки — для разброса пулов и подписей."""
    fp = footprint(kind, t)
    return fp[0] if fp else (t['x'], t['y'])


def under_cells(kind, t):
    """Клетки на полу, над которыми не висит сталактит (±STAL_BELOW_PAD)."""
    if kind == 'gargoyles':
        x, y, d = t['x'], t['y'], t['dir']
        return [(x, y), (x + d, y)] + footprint(kind, t)
    return footprint(kind, t)


def hazard_cells(kind, t):
    """Клетки, которые для проверки волн ставятся в сетку как '^' (на них нельзя
    стоять, их надо перепрыгнуть). Пила — одна клетка, середина рельса: опасен диск
    ~1 клетку шириной, рельс сам не ранит. Горгулья — плита (огонь летит, а не
    лежит; столб не твёрдый). Сталактит пол не занимает — ничего."""
    if kind == 'hazard':
        return [tuple(t)]
    if kind == 'gargoyles':
        return [(t['plate'][0], t['y']), (t['plate'][0] + 1, t['y'])]
    if kind == 'stalactites':
        return []
    if kind == 'saws':
        return [((t['x0'] + t['x1']) // 2, t['y'])]
    raise ValueError(kind)


def run_of(S, x, y):
    left = x
    while (left - 1, y) in S:
        left -= 1
    right = x
    while (right + 1, y) in S:
        right += 1
    return left, right


def slot_points(slots):
    """Точки, от которых ловушки держатся на расстоянии: (вид, точка, минимум)."""
    out = []
    for cl in slots.get('enemyClusters') or []:
        for p in cl['points']:
            out.append(('враг', tuple(p), ENEMY_MIN))
    for p in slots.get('reward') or []:
        out.append(('сундук', tuple(p), POINT_MIN))
    npc = slots.get('npc') or {}
    for k in ('smuggler', 'puzzle'):
        for p in npc.get(k) or []:
            out.append((k, tuple(p), POINT_MIN))
    if slots.get('boss'):
        out.append(('босс', tuple(slots['boss']), POINT_MIN))
    if slots.get('obelisk'):
        for p in slots['obelisk'].get('points', []):
            out.append(('обелиск', tuple(p), POINT_MIN))
    for p in slots.get('breakables') or []:
        out.append(('бочка', tuple(p), BREAKABLE_MIN))
    return out


def dist(a, b):
    return math.hypot(a[0] - b[0], a[1] - b[1])


def _zone_bad(kind, t, ctx):
    g, decor = ctx['grid'], ctx['decor']
    bad = []
    for c in zone_cells(kind, t, g):
        x, y = c
        if not (0 <= y < len(g) and 0 <= x < len(g[0])) or g[y][x] in '#=':
            bad.append(f'клетка зоны {list(c)} — твердь или вне карты')
        elif decor is not None and decor[y][x] > DECOR_TOL:
            bad.append(f'декор в зоне {list(c)}: {decor[y][x]} px')
    return bad


def check_trap(kind, t, ctx, others):
    """Список нарушений одной НОВОЙ ловушки (горгулья, сталактит, пила) против
    правил расстановки. others — [(вид, ловушка)] остальных (все пулы)."""
    if kind == 'stalactites':
        return check_stalactite(t, ctx, others)
    g, S, start, points = ctx['grid'], ctx['S'], ctx['start'], ctx['points']
    bad = _zone_bad(kind, t, ctx)
    fp = footprint(kind, t)
    for c in fp:
        if c not in S:
            bad.append(f'клетка {list(c)} не клетка стояния')
    # Горгулья (17.11.2026): голова висит на стене над полом — расстояния до
    # старта и точек считаются от плиты; от клетки под головой — не ближе
    # GARGOYLE_HEAD_POINT_MIN (сундук или враг не стоят прямо под ней).
    fp_pts = fp if kind != 'gargoyles' else [c for c in fp if c != (t['x'], t['y'])]
    if min(dist(c, start) for c in fp_pts) < START_MIN:
        bad.append(f'ближе {START_MIN} к старту')
    for name, p, mn in points:
        if kind == 'gargoyles' and name == 'враг':
            mn = GARGOYLE_PLATE_ENEMY_MIN
        near = min(dist(c, p) for c in fp_pts)
        if near < mn:
            bad.append(f'ближе {mn} к точке «{name}» {list(p)} ({near:.1f})')
        if kind == 'gargoyles' and dist((t['x'], t['y']), p) < min(mn, GARGOYLE_HEAD_POINT_MIN):
            bad.append(f'голова над точкой «{name}» {list(p)}')
    # У горгульи клетка у стены — край площадки по построению (стена и есть
    # край): от края держится только плита.
    edge_fp = [c for c in fp if not (kind == 'gargoyles' and c == (t['x'], t['y']))]
    for c in edge_fp:
        if c in S:
            left, right = run_of(S, *c)
            if c[0] - left < EDGE_MIN or right - c[0] < EDGE_MIN:
                bad.append(f'{list(c)} у края площадки {left}..{right}')
                break
    if kind == 'gargoyles':
        # Сталактит не висит прямо над горгульей (то же правило, что
        # check_stalactite, — с этой стороны, для расстановки при готовых пулах).
        for okind, o in others:
            if okind != 'stalactites':
                continue
            cols = range(o['x'] - STAL_BELOW_PAD, o['x'] + 2 + STAL_BELOW_PAD)
            if any(cy == o['y'] and cx in cols for cx, cy in under_cells(kind, t)):
                bad.append(f'под сталактитом {[o["x"], o["y"]]}')
    row = fp[0][1]
    xs = [c[0] for c in fp]
    floor_new = ('gargoyles', 'saws')
    for okind, o in others:
        ofp = footprint(okind, o)
        if not ofp or ofp[0][1] != row:
            continue
        gap = min(abs(a - b) for a in xs for b in (c[0] for c in ofp))
        need = SPACING_SAME if okind == kind else SPACING_ANY
        if gap < need:
            bad.append(f'ближе {need} клеток к ловушке {okind} {ofp[0]}')
    # Окно 14 — только новые напольные (шипы не в счёт), и только окна, куда
    # попадает сама эта ловушка (по первой клетке).
    me = min(xs)
    starts = [min(c[0] for c in footprint(k, o)) for k, o in others
              if k in floor_new and footprint(k, o) and footprint(k, o)[0][1] == row]
    for w0 in range(me - WINDOW + 1, me + 1):
        if 1 + sum(1 for s in starts if w0 <= s < w0 + WINDOW) > WINDOW_MAX:
            bad.append(f'больше {WINDOW_MAX} новых ловушек на {WINDOW} клетках ряда {row}')
            break
    bad += geometry_problems(kind, t, g, S)
    return bad


def check_stalactite(t, ctx, others):
    g, S, start, points = ctx['grid'], ctx['S'], ctx['start'], ctx['points']
    bad = _zone_bad('stalactites', t, ctx)
    x, y = t['x'], t['y']
    for c in ((x, y), (x + 1, y)):
        if c not in S:
            bad.append(f'клетка пола {list(c)} не клетка стояния')
    if min(dist(c, start) for c in ((x, y), (x + 1, y))) < START_MIN:
        bad.append(f'ближе {START_MIN} к старту')
    cols = range(x - STAL_BELOW_PAD, x + 2 + STAL_BELOW_PAD)
    for name, p, _mn in points:
        if name in ('враг', 'сундук') and p[1] == y and p[0] in cols:
            bad.append(f'прямо над точкой «{name}» {list(p)}')
    for okind, o in others:
        if okind == 'stalactites':
            if o is not t and dist((x, y), (o['x'], o['y'])) < STAL_SPACING:
                bad.append(f'ближе {STAL_SPACING} к сталактиту {[o["x"], o["y"]]}')
            continue
        for cx, cy in under_cells(okind, o):
            if cy == y and cx in cols:
                bad.append(f'прямо над {okind} {[cx, cy]}')
                break
    bad += geometry_problems('stalactites', t, g, S)
    return bad


def geometry_problems(kind, t, g, S):
    bad = []
    H, W = len(g), len(g[0])
    if kind == 'gargoyles':
        x, y, d = t['x'], t['y'], t['dir']
        wx = x - d
        for k in range(GARGOYLE_WALL_H):
            cy = y - k
            if not (0 <= wx < W and 0 <= cy < H) or g[cy][wx] != '#':
                bad.append(f'нет стены «#» за головой ({[wx, cy]})')
                break
        for cx in (x, x + d):
            for cy in range(y - GARGOYLE_FREE_H + 1, y + 1):
                if not (0 <= cx < W and 0 <= cy < H) or g[cy][cx] in '#=':
                    bad.append(f'над полом у головы не свободно {GARGOYLE_FREE_H} клетки ({[cx, cy]})')
                    break
        # 17.11.2026: «7 клеток ровного пола от столба» снято — огонь летит до
        # стены, а пол нужен только от стены до плиты (проверка ниже).
        px = t['plate'][0]
        near = min(abs(px - x), abs(px + 1 - x))
        if not (PLATE_DIST[0] <= near <= PLATE_DIST[1]) or (px - x) * d < 0:
            bad.append(f'плита в {near} клетках от стены (нужно {PLATE_DIST[0]}..{PLATE_DIST[1]} в сторону огня)')
        a, b = min(x, px), max(x, px + 1)
        if any((cx, y) not in S for cx in range(a, b + 1)):
            bad.append('между стеной и плитой не сплошной пол')
    elif kind == 'stalactites':
        x, y, c = t['x'], t['y'], t['ceil']
        h = y - c
        if not (STAL_H[0] <= h <= STAL_H[1]):
            bad.append(f'потолок на высоте {h} (нужно {STAL_H[0]}..{STAL_H[1]})')
        for cx in (x, x + 1):
            if not (0 <= c < H) or g[c][cx] != '#':
                bad.append(f'над столбом {cx} нет потолка «#» в ряду {c}')
            if any(g[cy][cx] in '#=' for cy in range(c + 1, y + 1)):
                bad.append(f'в столбе {cx} между потолком и полом есть твердь')
    elif kind == 'saws':
        x0, x1, y = t['x0'], t['x1'], t['y']
        n = x1 - x0 + 1
        if not (SAW_LEN[0] <= n <= SAW_LEN[1]):
            bad.append(f'рельс {n} клеток (нужно {SAW_LEN[0]}..{SAW_LEN[1]})')
        if (x0, y) in S:
            left, right = run_of(S, x0, y)
            if right - left + 1 < SAW_FLOOR:
                bad.append(f'ровного пола {right - left + 1} < {SAW_FLOOR}')
    return bad


def all_traps(slots):
    out = [('hazard', tuple(p)) for p in slots.get('hazard') or []]
    for k in ('gargoyles', 'stalactites', 'saws'):
        out += [(k, t) for t in slots.get(k) or []]
    return out


def waves_with(g, start, traps, mt):
    """Волны (штатная и строгая) с клетками ловушек как '^'."""
    gs = [row[:] for row in g]
    cells = set()
    for k, t in traps:
        for x, y in hazard_cells(k, t):
            gs[y][x] = '^'
            cells.add((x, y))
    S, can = mt.build(gs)
    f = mt.wave(S, can, start)
    b = mt.wave(S, can, start, reverse=True)
    sf, sb, sS = mt.strict_wave(gs, start)
    return {'S': S, 'f': f, 'b': b, 'sf': sf, 'sb': sb, 'sS': sS, 'cells': cells}


def waves_lost(base, now):
    """Клетки, которые были достижимы без ловушек, а с ловушками — нет (не считая
    самих клеток ловушек). Пусто — ловушки не перекрыли ни одного пути."""
    lost = set()
    for key in ('f', 'b', 'sf', 'sb'):
        lost |= (base[key] - now['cells']) - now[key]
    return lost


# --- Сундуки, бочки и кувшины (17.11.2026): декор за ними тоже стирается ---
# Прямоугольники спрайтов в пикселях мира (по точкам ПУЛОВ слот-файла: в забег
# попадает часть, а чистится под всеми) — как их ставит игра:
#   сундук  центр x*64+32, ширина до 106 (раскрытый мимик 76×190/137 ≈ 105),
#           высота от пола 70 (закрытый: 90 − 27 = 63; мимик 66) + запас;
#   бочка   центр x*64+32, ширина 68 (BARREL_HITBOX_W), высота 77; кувшин ниже —
#           одна зона на оба (в пуле вид не записан).
CHEST_RECT = (110, 72)
BREAKABLE_RECT = (76, 82)


def object_rects(slots):
    """[(вид, точка, x0, y0, x1, y1)] — зоны сундуков и бочек (пиксели мира)."""
    out = []
    for kind, pts, (w, h) in (('chest', slots.get('reward') or [], CHEST_RECT), ('breakable', slots.get('breakables') or [], BREAKABLE_RECT)):
        for p in pts:
            x, y = p[0], p[1]
            cx, floor = x * TS + TS / 2, (y + 1) * TS
            out.append((kind, (x, y), cx - w / 2, floor - h, cx + w / 2, floor))
    return out


def counter_rows(traps):
    return Counter(footprint(k, t)[0][1] for k, t in traps)
