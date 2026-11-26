"""Низкие мосты и потолки над местами, где ходят (26.11.2026, «Правки 26.11 (мосты)»).

    python tools/low_overhangs.py [буквы]      отчёт; код 1, если есть нарушения

Read-only. Для каждой клетки стояния (и для соседних столбцов, над которыми может
оказаться бокс героя 54 px, стоящего в ней) — просвет от линии пола до низа
ближайшей тверди над ней: '#' — низ клетки, '=' — низ полосы (44% клетки).

Числа из кода игры (src/explore/constants.ts, mapRenderer.ts, ncConstants.ts):
  бокс героя 128, в воздухе верх бокса опущен на JUMP_HIT_OFFSET_Y = 40 —
  макушка в прыжке на 88 px выше ступней; полный прыжок поднимает ступни на
  11.5² / (2 × 0.31) = 213 px; самый высокий враг — фехтовальщик, 150.

Нарушение (оба правила — из задачи Андрея 26.11):
  A) «прыжок упирается»: рядом (dx ≤ 2, со стороны этого столбца) есть клетка
     стояния выше на 1–2, а
     полный прыжок отсюда бьёт головой раньше, чем ступни поднимутся на высоту
     ступени + 8 px запаса: просвет < подъём + 88 + 8.
     Удар головой гасит взлёт сразу (Explore.tsx, sweepHeadBlock → vy = 0), и
     игрок, держащий прыжок, не поднимается. Так было на Y под настилом: на
     правой половине ступени (38,12) бокс заходит под настил (39,11), просвет
     100 px — прыжок поднимает ступни на 12 px.
  B) «враг не пролезает»: просвет над клеткой стояния меньше 150 + 16.
     Считается ТОЛЬКО под мостами — полосами '=' и висящими кусками '#', под
     которыми есть клетки стояния, — а не под каждым низким потолком пещер.
"""
import sys
from pathlib import Path

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

ROOT = Path(__file__).resolve().parent.parent
MAPS = ROOT / 'public' / 'assets' / 'maps'
T = 64
BAND = T * 0.44
PH = 128
HEAD_OFF = 40
RISE = 11.5 ** 2 / (2 * 0.31)
ENEMY_H = 150
MARGIN_JUMP = 8
MARGIN_ENEMY = 16


def load(path):
    return [r.rstrip('\r') for r in path.read_text(encoding='utf-8').split('\n') if r.rstrip('\r')]


def air(c):
    return c in '.^'


def blocker(g, x, top_row):
    """Низ ближайшей тверди над строкой top_row в столбце x: (низ px, строка, символ) или None."""
    for r in range(top_row, -1, -1):
        c = g[r][x]
        if c == '#':
            return (r + 1) * T, r, c
        if c == '=':
            return r * T + BAND, r, c
    return None


def standing(g):
    H, W = len(g), len(g[0])
    return {(x, y) for y in range(1, H - 1) for x in range(W)
            if air(g[y][x]) and air(g[y - 1][x]) and g[y + 1][x] in '#='}


def is_bridge(g, r, x):
    """Клетка — часть моста: '=' или '#', под которой (в этом столбце) воздух."""
    c = g[r][x]
    if c == '=':
        return True
    return c == '#' and r + 1 < len(g) and air(g[r + 1][x])


def check(g):
    S = standing(g)
    W = len(g[0])
    out = []
    for (x, y) in sorted(S):
        feet = (y + 1) * T
        for cx in (x - 1, x, x + 1):
            # Цель прыжка — клетка стояния выше на 1–2, dx ≤ 2; соседний столбец
            # мешает, только если цель с его стороны (туда игрок и жмёт).
            side = cx - x
            need = 0
            for dy in (1, 2):
                for dx in range(-2, 3):
                    if side and dx * side <= 0:
                        continue
                    if (x + dx, y - dy) in S:
                        need = max(need, dy * T)
            if not 0 <= cx < W:
                continue
            # В прыжке верх бокса опущен на 40 px: под соседний столбец бокс
            # подлезает, даже если там на уровне головы полоса '=' (она — верхние
            # 28 px клетки). Так на Y герой со ступени (38,12) заходит под край
            # настила (39,11) и бьётся о него.
            if cx != x and not (air(g[y][cx]) and (air(g[y - 1][cx]) or g[y - 1][cx] == '=')):
                continue
            b = blocker(g, cx, y - 1 if cx != x else y - 2)
            if b is None:
                continue
            bottom, r, ch = b
            clear = feet - bottom
            rise = clear - (PH - HEAD_OFF)
            # Только '=': под '#' бокс не подлезает (стена по X проверяется с
            # макушки в прыжке), и из-под навеса '#' герой просто отходит —
            # настоящий движок (hero_reach.mjs) там капканов не находит.
            if need and ch == '=' and rise < need + MARGIN_JUMP:
                out.append(('A', x, y, cx, r, ch, round(clear), round(rise), need))
            elif is_bridge(g, r, cx) and clear < ENEMY_H + MARGIN_ENEMY and cx == x:
                out.append(('B', x, y, cx, r, ch, round(clear), round(rise), need))
    return out


def main():
    letters = [a for a in sys.argv[1:] if not a.startswith('--')]
    files = sorted(MAPS.glob('map_*.txt'))
    bad = 0
    for f in files:
        L = f.name.split('_')[1]
        if letters and L not in letters:
            continue
        g = load(f)
        res = check(g)
        a = sorted({(x, y) for k, x, y, *_ in res if k == 'A'})
        b = sorted({(x, y) for k, x, y, *_ in res if k == 'B'})
        print(f'== {L} ({f.name}): прыжок упирается — {len(a)} клеток, враг не пролезает — {len(b)}')
        for k, x, y, cx, r, ch, clear, rise, need in res:
            print(f'   {k} клетка [{x},{y}] столбец {cx}: над ней {ch!r} в ряду {r}, просвет {clear} px, '
                  f'подъём до удара {rise} px' + (f', нужен {need}' if need else ''))
        bad += bool([r for r in res if r[0] == "A"])
    sys.exit(1 if bad and "--check" in sys.argv else 0)


if __name__ == '__main__':
    main()
