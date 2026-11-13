"""Общие правила ловушек (13.11.2026) — для place_traps.py и check_map_slots.py.

Одна копия правил на расстановку и на проверку: разойдутся — скрипт будет
ставить то, что проверка бракует, или наоборот. Модуль только считает, файлов
не пишет.

Ловушки (координаты — клетки сетки, y — ряд стояния, пол под ним в y+1):
  hazard      [x, y]                               шип, клетка (x, y)
  gargoyles   {x, y, dir, plate: [px, y]}          голова у стены: x — первая
              клетка воздуха у стены, стена в x-dir; смотрит в сторону dir;
              плита — две клетки (px, px+1) на том же ряду
  stalactites {x, y, ceil}                          столб x, x+1; ceil — ряд
              потолка (твердь), над полом (y - ceil) клеток воздуха, 3..6
  saws        {x0, x1, y}                           рельс x0..x1, 4..6 клеток

Зоны, где не должно быть декора (клетки):
  шип        (x, y)
  плита      (px, y), (px+1, y) и клетки над ними
  горгулья   2x2: столбцы x, x+dir, ряды y-1, y
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

# Числа — решение 13.11.2026: правила из задачи (шаг 6, враги 4, край 2, старт 10,
# окно 2/14, декор 0 px) на картах A–F, B2, C2, W, Y не оставляли мест почти ни
# одной новой ловушке (замер place_traps.py: 1 из 50 за забег). Андрей: «делай
# меньше ловушек, найди оптимальный вариант». Перебором выбран этот набор — 27 из
# 50: ловушка рисуется ПОВЕРХ слоя и видна целиком, декор под ней терпим, пока его
# не больше четверти клетки (трава, камешки — да; надгробие, свеча — нет).
SPACING = 4           # между ловушками на одном ряду, клеток
WINDOW, WINDOW_MAX = 14, 3   # не больше 3 ловушек на 14 клеток ряда
START_MIN = 8         # от старта
ENEMY_MIN = 2         # от точек врагов
POINT_MIN = 3         # от сундуков, NPC, босса, обелиска
BREAKABLE_MIN = 1     # от бочек и кувшинов (не на той же клетке)
EDGE_MIN = 1          # от края площадки (новые ловушки; шипы — 2, check_map_slots.py)
HAZARD_EDGE_MIN = 2   # шипы, как в check_map_slots.py (TRAP_EDGE_MIN)
DECOR_ALPHA = 32      # пиксель декора — альфа больше этого
DECOR_TOL = 1024      # сколько пикселей декора терпимо в одной клетке зоны (¼ клетки)
GARGOYLE_FLOOR = 6    # ровный пол от горгульи
PLATE_DIST = (4, 8)   # плита от горгульи
STAL_H = (3, 6)       # высота потолка над полом
STAL_ZONE_ROWS = 3    # столб сталактита от потолка вниз
SAW_LEN = (4, 6)
SAW_FLOOR = 8
GARGOYLE_MAX, SAW_MAX = 3, 3
SPIKES_PER_RUN = 10
POOL_MULT = 1.5


def load_grid(path):
    return [list(r.rstrip('\r')) for r in path.read_text(encoding='utf-8').split('\n') if r.rstrip('\r')]


def map_files(letter):
    txts = list(MAPS.glob(f'map_{letter}_*.txt'))
    if len(txts) != 1:
        raise SystemExit(f'{letter}: ожидался один .txt, нашлось {[p.name for p in txts]}')
    return txts[0], MAPS / f'map_{letter}_slots.json'


def per_run(n_standing, n_hazard):
    """Сколько ловушек каждого вида ставится за забег."""
    total = max(10, min(20, round(n_standing / 16)))
    spikes = min(SPIKES_PER_RUN, n_hazard)
    rest = max(0, total - spikes)
    stal = garg = saw = rest // 3
    left = rest - 3 * (rest // 3)
    order = ['stal', 'garg', 'saw']
    i = 0
    while left > 0:
        k = order[i % 3]
        if k == 'stal':
            stal += 1
        elif k == 'garg':
            garg += 1
        else:
            saw += 1
        left -= 1
        i += 1
    over = max(0, garg - GARGOYLE_MAX) + max(0, saw - SAW_MAX)
    garg, saw = min(garg, GARGOYLE_MAX), min(saw, SAW_MAX)
    stal += over
    return {'total': total, 'spikes': spikes, 'stalactites': stal, 'gargoyles': garg, 'saws': saw}


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


def decor_mask(txt_path, grid):
    """Число пикселей декора в каждой ПУСТОЙ клетке (не '#', не '='): непрозрачные
    пиксели слоя карты + прямоугольники живого декора (качающийся камыш и осока,
    пламя свечей, огонёк в нише). Твердь — None (там камень, а не декор)."""
    from PIL import Image
    import numpy as np
    H, W = len(grid), len(grid[0])
    alpha = np.zeros((H * TS, W * TS), np.uint8)
    line = _entry_line(txt_path.name)
    for f, x, _w in re.findall(r"\{ file: '([^']+)', x: (\d+), width: (\d+) \}", line):
        a = np.array(Image.open(ART / f).convert('RGBA'))[:, :, 3]
        alpha[:a.shape[0], int(x):int(x) + a.shape[1]] = a
    px = (alpha > DECOR_ALPHA).astype(np.uint8)
    # Живой декор: качание (sway в манифесте слоя).
    for sx, sy, sw, sh in re.findall(r"sprite: '[a-z]+', x: (-?[\d.]+), y: (-?[\d.]+), w: ([\d.]+), h: ([\d.]+)", line):
        x0, y0 = float(sx) - float(sw) / 2, float(sy) - float(sh)
        _mark(px, x0, y0, float(sw), float(sh))
    # Пламя свечей и огонёк в нише (liveDecorManifest.ts): точка — низ пламени.
    live = (ROOT / 'src' / 'explore' / 'liveDecorManifest.ts').read_text(encoding='utf-8')
    m = re.search(r"'" + re.escape(txt_path.name) + r"': \[(.*?)\],?\r?\n", live)
    if m:
        for fx, fy, fw, fh in re.findall(r"x: ([\d.]+), y: ([\d.]+), w: ([\d.]+), h: ([\d.]+)", m.group(1)):
            w, h = float(fw) * 3, float(fh) * 3   # живое пламя выше и шире стёртого пятна
            _mark(px, float(fx) - w / 2, float(fy) - h, w, h)
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

def zone_cells(kind, t):
    """Клетки, где не должно быть декора."""
    if kind == 'hazard':
        return [tuple(t)]
    if kind == 'gargoyles':
        x, y, d = t['x'], t['y'], t['dir']
        px = t['plate'][0]
        return [(x, y), (x, y - 1), (x + d, y), (x + d, y - 1),
                (px, y), (px + 1, y), (px, y - 1), (px + 1, y - 1)]
    if kind == 'stalactites':
        x, y, c = t['x'], t['y'], t['ceil']
        cells = [(cx, cy) for cx in (x, x + 1) for cy in range(c + 1, c + 1 + STAL_ZONE_ROWS)]
        return cells + [(x, y), (x + 1, y)]
    if kind == 'saws':
        return [(cx, cy) for cx in range(t['x0'], t['x1'] + 1) for cy in (t['y'], t['y'] - 1)]
    raise ValueError(kind)


def footprint(kind, t):
    """Клетки ряда стояния, которые занимает ловушка (для расстояний и окна 14)."""
    if kind == 'hazard':
        return [tuple(t)]
    if kind == 'gargoyles':
        # Клетка под головой и плита. Полоса огня между ними — НЕ след: огонь
        # вправе лететь через точку врага или сундука (он бьёт первого на пути).
        x, y, px = t['x'], t['y'], t['plate'][0]
        return sorted([(x, y), (px, y), (px + 1, y)])
    if kind == 'stalactites':
        return [(t['x'], t['y']), (t['x'] + 1, t['y'])]
    if kind == 'saws':
        return [(cx, t['y']) for cx in range(t['x0'], t['x1'] + 1)]
    raise ValueError(kind)


def edge_cells(kind, t):
    """Клетки, к которым относится правило «не ближе 2 к краю площадки»."""
    if kind == 'gargoyles':   # голова висит у стены по определению — правило для плиты
        return [(t['plate'][0], t['y']), (t['plate'][0] + 1, t['y'])]
    return footprint(kind, t)


def hazard_cells(kind, t):
    """Клетки, которые для проверки волн ставятся в сетку как '^' (на них нельзя
    стоять, их надо перепрыгнуть). Пила — одна клетка, середина рельса: опасен диск
    ~1 клетку шириной, рельс сам не ранит. Горгулья — плита (огонь летит, а не лежит)."""
    if kind == 'hazard':
        return [tuple(t)]
    if kind == 'gargoyles':
        return [(t['plate'][0], t['y']), (t['plate'][0] + 1, t['y'])]
    if kind == 'stalactites':
        return [(t['x'], t['y']), (t['x'] + 1, t['y'])]
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


def check_trap(kind, t, ctx, others):
    """Список нарушений одной НОВОЙ ловушки (горгулья, сталактит, пила) против
    правил расстановки. others — [(вид, ловушка)] уже стоящих (все пулы)."""
    g, S, start, points, decor = ctx['grid'], ctx['S'], ctx['start'], ctx['points'], ctx['decor']
    bad = []
    fp = footprint(kind, t)
    for c in fp:
        if c not in S:
            bad.append(f'клетка {list(c)} не клетка стояния')
    for c in zone_cells(kind, t):
        x, y = c
        if not (0 <= y < len(g) and 0 <= x < len(g[0])) or decor[y][x] is None:
            bad.append(f'клетка зоны {list(c)} — твердь или вне карты')
        elif decor[y][x] > DECOR_TOL:
            bad.append(f'декор в зоне {list(c)}: {decor[y][x]} px')
    for c in fp:
        if dist(c, start) < START_MIN:
            bad.append(f'{list(c)} в {dist(c, start):.1f} от старта')
            break
    for name, p, mn in points:
        near = min(dist(c, p) for c in fp)
        if near < mn:
            bad.append(f'ближе {mn} к точке «{name}» {list(p)} ({near:.1f})')
    for c in edge_cells(kind, t):
        if c in S:
            left, right = run_of(S, *c)
            if c[0] - left < EDGE_MIN or right - c[0] < EDGE_MIN:
                bad.append(f'{list(c)} у края площадки {left}..{right}')
                break
    row = fp[0][1]
    xs = [c[0] for c in fp]
    for okind, o in others:
        ofp = footprint(okind, o)
        if ofp[0][1] != row:
            continue
        gap = min(abs(a - b) for a in xs for b in (c[0] for c in ofp))
        if gap < SPACING:
            bad.append(f'ближе {SPACING} клеток к ловушке {okind} {ofp[0]}')
    # Окно 14: ловушки (по их первой клетке) на ряду
    # Окно 14 — только окна, куда попадает САМА эта ловушка (по первой клетке):
    # перебор у старых шипов без неё — не её нарушение.
    me = min(xs)
    starts = [min(c[0] for c in footprint(k, o)) for k, o in others if footprint(k, o)[0][1] == row]
    for w0 in range(me - WINDOW + 1, me + 1):
        if 1 + sum(1 for s in starts if w0 <= s < w0 + WINDOW) > WINDOW_MAX:
            bad.append(f'больше {WINDOW_MAX} ловушек на {WINDOW} клетках ряда {row}')
            break
    bad += geometry_problems(kind, t, g, S)
    return bad


def geometry_problems(kind, t, g, S):
    bad = []
    H, W = len(g), len(g[0])
    if kind == 'gargoyles':
        x, y, d = t['x'], t['y'], t['dir']
        wx = x - d
        if not (0 <= wx < W) or g[y][wx] != '#' or g[y - 1][wx] != '#':
            bad.append('горгулья не у стены (нет «#» в x-dir на рядах y-1, y)')
        floor = [(x + d * i, y) for i in range(GARGOYLE_FLOOR)]
        if any(c not in S for c in floor):
            bad.append(f'ровного пола от горгульи меньше {GARGOYLE_FLOOR}')
        px = t['plate'][0]
        near = min(abs(px - x), abs(px + 1 - x))
        if not (PLATE_DIST[0] <= near <= PLATE_DIST[1]) or (px - x) * d < 0:
            bad.append(f'плита в {near} клетках от горгульи (нужно {PLATE_DIST[0]}..{PLATE_DIST[1]} в сторону огня)')
        a, b = min(x, px), max(x, px + 1)
        if any((cx, y) not in S for cx in range(a, b + 1)):
            bad.append('между горгульей и плитой не сплошной пол')
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


def counter_rows(traps):
    return Counter(footprint(k, t)[0][1] for k, t in traps)
