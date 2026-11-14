"""Расстановка ловушек по картам (13.11.2026; переделано 14.11.2026).

    python tools/place_traps.py                 все карты
    python tools/place_traps.py A B2 W          выбранные
    python tools/place_traps.py --dry           только посчитать, файлы не писать

Что делает для каждой карты (правила — tools/trap_rules.py, проверка —
tools/check_map_slots.py):
  1. Цель за забег — trap_rules.TARGETS: 10 шипов (на W и Y — сколько в пуле
     hazard), остальное — сталактиты, горгульи, пилы поровну (горгулий и пил не
     больше 3). Пулы новых ловушек — в POOL_MULT раз больше (вверх).
  2. Ставит пулы gargoyles → saws → stalactites вразброс по строгим правилам.
     Декор расстановку НЕ ограничивает: его стирает из слоя в зонах ловушек
     следующий шаг, tools/clean_trap_decor.py. Не хватило горгулий или пил —
     недостачу добирают сталактиты, потом пилы (до 3). Не набралась цель — шаг
     между ловушками ослабляется до SPACING_FALLBACK, и скрипт пишет, на какой
     карте.
  3. Пишет пулы и trapsPerRun в ОБЕ копии слот-файла (public/assets/maps и
     server/src/maps) одними байтами — check_map_sync.py их сверяет.
Шипы (hazard) не трогает. После него — ОБЯЗАТЕЛЬНО clean_trap_decor.py (чистка
слоя и превью), потом check_map_slots.py.
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
        'points': R.slot_points(slots), 'decor': None,
    }


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


# --- Арт ловушек для превью (их рисует clean_trap_decor.py) ---

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


def place_all(ctx, base, hazards, spacing):
    """Пулы новых ловушек при шаге spacing. Возвращает (пулы, за забег)."""
    R.SPACING = spacing
    letter = ctx['letter']
    pr = R.per_run(len(ctx['S']), len(hazards))
    pr['total'] = R.TARGETS.get(letter, pr['total'])
    spikes = pr['spikes']
    rest = pr['total'] - spikes
    placed = [('hazard', h) for h in hazards]
    pools, got = {}, {}
    for kind in ('gargoyles', 'saws'):
        need = math.ceil(pr[kind] * R.POOL_MULT)
        pools[kind] = place_pool(kind, need, ctx, placed, base)
        got[kind] = min(pr[kind], len(pools[kind]))
    # Недостачу горгулий и пил добирают сталактиты.
    stal_want = rest - got['gargoyles'] - got['saws']
    pools['stalactites'] = place_pool('stalactites', math.ceil(stal_want * R.POOL_MULT), ctx, placed, base)
    got['stalactites'] = min(stal_want, len(pools['stalactites']))
    # Сталактитов не хватило — ещё пил, до SAW_MAX.
    short = rest - sum(got.values())
    if short > 0 and got['saws'] < R.SAW_MAX:
        extra_need = math.ceil(min(R.SAW_MAX, got['saws'] + short) * R.POOL_MULT) - len(pools['saws'])
        if extra_need > 0:
            pools['saws'] += place_pool('saws', extra_need, ctx, placed, base)
        got['saws'] = min(R.SAW_MAX, got['saws'] + short, len(pools['saws']))
    per_run = {'spikes': spikes, 'stalactites': got['stalactites'], 'gargoyles': got['gargoyles'], 'saws': got['saws']}
    return pools, per_run


def run(letter, dry):
    ctx = context(letter)
    g, start = ctx['grid'], ctx['start']
    base = R.waves_with(g, start, [], mt)
    hazards = [tuple(p) for p in ctx['slots'].get('hazard') or []]
    target = R.TARGETS.get(letter)
    pools, per_run = place_all(ctx, base, hazards, R.SPACING)
    spacing = 6
    if sum(per_run.values()) < target:
        p2, r2 = place_all(ctx, base, hazards, R.SPACING_FALLBACK)
        if sum(r2.values()) > sum(per_run.values()):
            pools, per_run, spacing = p2, r2, R.SPACING_FALLBACK
    R.SPACING = 6
    slots = dict(ctx['slots'])
    for kind in ('gargoyles', 'stalactites', 'saws'):
        slots[kind] = pools[kind]
    slots['trapsPerRun'] = per_run
    total = sum(per_run.values())
    print(f"== {letter}: цель {target}, за забег {total} (шипы {per_run['spikes']}, сталактиты {per_run['stalactites']}, "
          f"горгульи {per_run['gargoyles']}, пилы {per_run['saws']}); пулы: сталактиты {len(pools['stalactites'])}, "
          f"горгульи {len(pools['gargoyles'])}, пилы {len(pools['saws'])}; шаг {spacing}"
          + ('' if total >= target else f'  ⚠️ НЕ НАБРАЛОСЬ: {total} из {target}'))
    if not dry:
        write_slots(ctx, slots)
    return {'letter': letter, 'per_run': per_run, 'spacing': spacing, 'target': target, 'pools': {k: len(v) for k, v in pools.items()}}


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    dry = '--dry' in sys.argv
    letters = args or sorted({p.name.split('_')[1] for p in R.MAPS.glob('map_*_slots.json')})
    for letter in letters:
        run(letter, dry)


if __name__ == '__main__':
    main()
