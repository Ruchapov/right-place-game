"""Расстановка ловушек по картам (13.11.2026).

    python tools/place_traps.py                 все карты
    python tools/place_traps.py A B2 W          выбранные
    python tools/place_traps.py --dry           только посчитать, файлы не писать

Что делает для каждой карты (правила — tools/trap_rules.py, проверка —
tools/check_map_slots.py):
  1. Пул шипов `hazard`: точку, в клетке которой есть декор (слой карты + живой
     декор), переносит на ближайшую чистую клетку ТОГО ЖЕ ряда, проходящую правила
     check_map_slots.py (4c и 4d). Остальные точки не трогает.
  2. Считает, сколько ловушек ставится за забег (trap_rules.per_run), и пишет пулы
     `gargoyles`, `stalactites`, `saws` в POOL_MULT раз больше (вверх) — вразброс,
     по правилам расстановки и без декора в зоне.
  3. Пишет `trapsPerRun` и пулы в ОБЕ копии слот-файла (public/assets/maps и
     server/src/maps) одними и теми же байтами — check_map_sync.py их сверяет.
  4. Рисует превью: D:\\dev\\right-place-art\\audits\\traps-2026-11-13\\
     (<карта>_all.png — вся карта, <карта>_<вид>_<n>.png — зум на ловушку).

Пулы новых ловушек пишутся заново при каждом запуске (детерминированно), шипы
переносятся только если в их клетке декор.
"""
import json
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import map_tools as mt  # noqa: E402
import trap_rules as R  # noqa: E402

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

SERVER_MAPS = R.ROOT / 'server' / 'src' / 'maps'
AUDIT = Path(r'D:\dev\right-place-art\audits\traps-2026-11-13')
NEW_KINDS = ('gargoyles', 'saws', 'stalactites')   # порядок: самые редкие места — первыми


def context(letter):
    txt, slots_path = R.map_files(letter)
    g = R.load_grid(txt)
    raw = slots_path.read_bytes()
    slots = json.loads(raw.decode('utf-8'))
    S, _ = mt.build(g)
    return {
        'letter': letter, 'txt': txt, 'slots_path': slots_path, 'raw': raw,
        'grid': g, 'slots': slots, 'S': S, 'start': tuple(slots['start']),
        'points': R.slot_points(slots), 'decor': R.decor_mask(txt, g),
    }


# --- 1. Шипы с декором ---

def hazard_ok(ctx, hazards, i, cand, base):
    """Правила check_map_slots.py для точки шипа cand на месте i."""
    S, slots = ctx['S'], ctx['slots']
    x, y = cand
    if cand not in S or ctx['decor'][y][x] > R.DECOR_TOL:
        return False
    if cand in [tuple(h) for j, h in enumerate(hazards) if j != i]:
        return False
    named = [p for name, p, _ in ctx['points'] if name != 'бочка'] + [ctx['start']]
    if cand in named:
        return False
    for p in named:
        if p != ctx['start'] and p[1] == y and abs(p[0] - x) <= 1:
            return False
    left, right = R.run_of(S, x, y)
    if x - left < R.HAZARD_EDGE_MIN or right - x < R.HAZARD_EDGE_MIN:
        return False
    chests = [tuple(p) for p in slots.get('reward') or []]
    trial = [tuple(h) for h in hazards]
    trial[i] = cand
    tset = set(trial)
    for cx, cy in chests:
        if not any((nx, cy) in S and (nx, cy) not in tset for nx in (cx - 1, cx + 1)):
            return False
    now = R.waves_with(ctx['grid'], ctx['start'], [('hazard', h) for h in trial], mt)
    return not R.waves_lost(base, now)


def relocate_hazards(ctx, base):
    hazards = [tuple(p) for p in ctx['slots'].get('hazard') or []]
    moves = []
    for i, (x, y) in enumerate(hazards):
        if ctx['decor'][y][x] <= R.DECOR_TOL:
            continue
        found = None
        W = len(ctx['grid'][0])
        for dx in range(1, W):
            for nx in (x - dx, x + dx):
                if 0 <= nx < W and hazard_ok(ctx, hazards, i, (nx, y), base):
                    found = (nx, y)
                    break
            if found:
                break
        moves.append(((x, y), found))
        if found:
            hazards[i] = found
    return hazards, moves


# --- 2. Пулы новых ловушек ---

def candidates(kind, ctx):
    g, S = ctx['grid'], ctx['S']
    H, W = len(g), len(g[0])
    out = []
    if kind == 'gargoyles':
        for (x, y) in sorted(S):
            for d in (1, -1):
                wx = x - d
                if not (0 <= wx < W) or g[y][wx] != '#' or g[y - 1][wx] != '#':
                    continue
                for dd in (6, 5, 7, 4, 8):
                    px = x + dd if d == 1 else x - dd - 1
                    out.append({'x': x, 'y': y, 'dir': d, 'plate': [px, y]})
    elif kind == 'stalactites':
        for (x, y) in sorted(S):
            if (x + 1, y) not in S:
                continue
            ceils = []
            for cx in (x, x + 1):
                cy = y - 1
                while cy >= 0 and g[cy][cx] not in '#=':
                    cy -= 1
                ceils.append(cy)
            if ceils[0] == ceils[1] and ceils[0] >= 0:
                out.append({'x': x, 'y': y, 'ceil': ceils[0]})
    elif kind == 'saws':
        seen = set()
        for (x, y) in sorted(S):
            left, right = R.run_of(S, x, y)
            if (left, y) in seen:
                continue
            seen.add((left, y))
            for L in (5, 4, 6):
                for x0 in range(left + R.EDGE_MIN, right - R.EDGE_MIN - L + 2):
                    out.append({'x0': x0, 'x1': x0 + L - 1, 'y': y})
    return out


def place_pool(kind, need, ctx, placed, base):
    """Набирает need точек вида kind. Из подходящих берёт самую далёкую от уже
    стоящих ловушек — пул ложится вразброс по карте."""
    ok = [t for t in candidates(kind, ctx) if not R.check_trap(kind, t, ctx, placed)]
    chosen = []
    while len(chosen) < need and ok:
        def spread(t):
            c = R.footprint(kind, t)[0]
            others = [R.footprint(k, o)[0] for k, o in placed]
            return min((R.dist(c, o) for o in others), default=1e9)
        ok.sort(key=spread, reverse=True)
        took = None
        for t in ok:
            if R.check_trap(kind, t, ctx, placed):
                continue
            now = R.waves_with(ctx['grid'], ctx['start'], placed + [(kind, t)], mt)
            if R.waves_lost(base, now):
                continue
            took = t
            break
        if took is None:
            break
        chosen.append(took)
        placed.append((kind, took))
        ok = [t for t in ok if t is not took]
    return chosen


def write_slots(ctx, slots):
    raw = ctx['raw']
    crlf = b'\r\n' in raw
    text = json.dumps(slots, ensure_ascii=False, indent=2)
    if raw.rstrip(b'\r\n') != raw:
        text += '\n'
    if crlf:
        text = text.replace('\n', '\r\n')
    data = text.encode('utf-8')
    ctx['slots_path'].write_bytes(data)
    (SERVER_MAPS / ctx['slots_path'].name).write_bytes(data)


# --- 4. Превью ---

def previews(ctx, slots):
    from PIL import Image, ImageDraw
    AUDIT.mkdir(parents=True, exist_ok=True)
    g, T = ctx['grid'], R.TS
    W, H = len(g[0]) * T, len(g) * T
    layer = Image.new('RGBA', (W, H), (34, 30, 40, 255))
    line = R._entry_line(ctx['txt'].name)
    import re
    for f, x, _w in re.findall(r"\{ file: '([^']+)', x: (\d+), width: (\d+) \}", line):
        layer.alpha_composite(Image.open(R.ART / f).convert('RGBA'), (int(x), 0))
    art = traps_art()
    colors = {'hazard': (255, 60, 60, 255), 'gargoyles': (255, 160, 0, 255), 'stalactites': (90, 200, 255, 255), 'saws': (200, 90, 255, 255)}
    full = layer.copy()
    for k, t in R.all_traps(slots):
        draw_trap(full, k, t, art)
    d = ImageDraw.Draw(full)
    for k, t in R.all_traps(slots):
        for cx, cy in R.zone_cells(k, t):
            d.rectangle([cx * T, cy * T, cx * T + T - 1, cy * T + T - 1], outline=colors[k], width=3)
    sx, sy = ctx['start']
    d.rectangle([sx * T, sy * T, sx * T + T - 1, sy * T + T - 1], outline=(80, 255, 80, 255), width=5)
    scale = min(1.0, 3000 / W)
    full.convert('RGB').resize((int(W * scale), int(H * scale))).save(AUDIT / f"{ctx['letter']}_all.png")
    n = Counter()
    for k, t in R.all_traps(slots):
        n[k] += 1
        cells = R.zone_cells(k, t)
        x0 = (min(c[0] for c in cells) - 2) * T
        x1 = (max(c[0] for c in cells) + 3) * T
        y0 = (min(c[1] for c in cells) - 2) * T
        y1 = (max(c[1] for c in cells) + 3) * T
        crop = Image.new('RGBA', (x1 - x0, y1 - y0), (34, 30, 40, 255))
        crop.alpha_composite(layer.crop((max(0, x0), max(0, y0), min(W, x1), min(H, y1))), (max(0, -x0), max(0, -y0)))
        side = crop.copy()
        shifted = Image.new('RGBA', layer.size, (0, 0, 0, 0))
        draw_trap(shifted, k, t, art)
        side.alpha_composite(shifted.crop((x0, y0, x1, y1)) if x0 >= 0 and y0 >= 0 else shifted.crop((max(0, x0), max(0, y0), x1, y1)), (max(0, -x0), max(0, -y0)))
        dd = ImageDraw.Draw(crop)
        for cx, cy in cells:
            dd.rectangle([cx * T - x0, cy * T - y0, cx * T - x0 + T - 1, cy * T - y0 + T - 1], outline=colors[k], width=2)
        both = Image.new('RGBA', (crop.width * 2 + 8, crop.height), (0, 0, 0, 255))
        both.alpha_composite(crop, (0, 0))
        both.alpha_composite(side, (crop.width + 8, 0))
        both.convert('RGB').save(AUDIT / f"{ctx['letter']}_{k}_{n[k]}.png")


_ART = None


def traps_art():
    global _ART
    if _ART is None:
        from PIL import Image
        base = R.ROOT / 'public' / 'assets' / 'objects'
        _ART = {
            'spike': Image.open(base / 'spikes.png').convert('RGBA'),
            'garg': Image.open(base / 'traps' / 'Gargoyle_Idle.png').convert('RGBA'),
            'plate': Image.open(base / 'traps' / 'Plate_Up.png').convert('RGBA'),
            'stal': Image.open(base / 'traps' / 'Stalactite_Full.png').convert('RGBA'),
            'blade': Image.open(base / 'traps' / 'Saw_Blade.png').convert('RGBA'),
            'rail': Image.open(base / 'traps' / 'Saw_Rail.png').convert('RGBA'),
        }
    return _ART


def _paste(img, src, w, h, x, y, flip=False):
    from PIL import ImageOps
    s = src.resize((max(1, round(w)), max(1, round(h))))
    if flip:
        s = ImageOps.mirror(s)
    img.alpha_composite(s, (round(x), round(y))) if x >= 0 and y >= 0 else None


def draw_trap(img, k, t, art):
    """Тот же размер и посадка, что в игре (entities/traps.ts, TRAP_* в constants.ts)."""
    T = R.TS
    if k == 'hazard':
        x, y = t
        _paste(img, art['spike'], T, T * 0.48, x * T, y * T + T - T * 0.48)
    elif k == 'gargoyles':
        x, y, d = t['x'], t['y'], t['dir']
        fw, fh = 277 * 0.5, 254 * 0.5
        floor = (y + 1) * T
        gx = x * T if d == 1 else (x + 1) * T - fw
        _paste(img, art['garg'], fw, fh, gx, floor - 2 * T, flip=d == -1)
        px = t['plate'][0]
        _paste(img, art['plate'], 2 * T, 51 * 0.4, px * T, floor - 51 * 0.4 + 6)
    elif k == 'stalactites':
        x, c = t['x'], t['ceil']
        w = 2 * T
        _paste(img, art['stal'], w, 384 * w / 330, x * T, (c + 1) * T - 4)
    elif k == 'saws':
        y = t['y']
        floor = (y + 1) * T
        rh = 109 * T / 384 * 1.0
        for cx in range(t['x0'], t['x1'] + 1):
            _paste(img, art['rail'], T, rh, cx * T, floor - rh * 0.6)
        mid = (t['x0'] + t['x1'] + 1) / 2 * T
        _paste(img, art['blade'], T * 1.0, T * 256 / 250, mid - T / 2, floor - T * 0.62)


# --- main ---

from collections import Counter  # noqa: E402


def run(letter, dry):
    ctx = context(letter)
    g, start = ctx['grid'], ctx['start']
    base = R.waves_with(g, start, [], mt)
    hazards, moves = relocate_hazards(ctx, base)
    slots = dict(ctx['slots'])
    slots['hazard'] = [list(h) for h in hazards]
    pr = R.per_run(len(ctx['S']), len(hazards))
    placed = [('hazard', h) for h in hazards]
    pools = {}
    for kind in NEW_KINDS:
        need = math.ceil(pr[kind] * R.POOL_MULT)
        pools[kind] = place_pool(kind, need, ctx, placed, base)
    for kind in ('gargoyles', 'stalactites', 'saws'):
        slots[kind] = pools[kind]
    # Мест меньше, чем нужно, — за забег ставится столько, чтобы в пуле
    # оставался выбор (пул / POOL_MULT), но не меньше одной, если место есть.
    per_run = {k: min(pr[k], len(pools[k]) if len(pools[k]) <= 1 else max(1, math.floor(len(pools[k]) / R.POOL_MULT)))
               for k in ('stalactites', 'gargoyles', 'saws')}
    slots['trapsPerRun'] = {'spikes': pr['spikes'], **per_run}
    print(f"== {letter}: клеток стояния {len(ctx['S'])}, за забег {pr['total']} "
          f"(шипы {pr['spikes']}, сталактиты {pr['stalactites']}, горгульи {pr['gargoyles']}, пилы {pr['saws']})")
    for kind in ('stalactites', 'gargoyles', 'saws'):
        need = math.ceil(pr[kind] * R.POOL_MULT)
        mark = '' if len(pools[kind]) >= need else f'  ⚠️ НЕ ХВАТИЛО МЕСТ: нужно {need}, за забег будет {per_run[kind]} вместо {pr[kind]}'
        print(f'   {kind}: пул {len(pools[kind])}/{need}{mark}')
    for old, new in moves:
        print(f"   шип {list(old)} — декор {ctx['decor'][old[1]][old[0]]} px → " + (f'{list(new)}' if new else '⚠️ НЕКУДА: чистой клетки на ряду нет'))
    if not dry:
        write_slots(ctx, slots)
        previews(ctx, slots)
    return {'letter': letter, 'per_run': slots['trapsPerRun'], 'want': pr, 'moves': moves, 'pools': {k: len(v) for k, v in pools.items()}}


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    dry = '--dry' in sys.argv
    letters = args or sorted({p.name.split('_')[1] for p in R.MAPS.glob('map_*_slots.json')})
    for letter in letters:
        run(letter, dry)


if __name__ == '__main__':
    main()
