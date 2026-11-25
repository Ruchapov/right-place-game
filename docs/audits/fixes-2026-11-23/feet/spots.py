"""Места для кадров посадки: ровный пол, полка '=', ступень — на каждой карте.
Клетка стояния (x,y): (x,y) — '#'/'=', над ней два ряда воздуха. Возвращаем КЛЕТКУ
ОПОРЫ (как s66: герой ставится на (y+1)*64 − 128, то есть ногами на верх клетки y+1),
поэтому отдаём y-1 = ряд, где стоит герой."""
import json, re
from pathlib import Path
ROOT = Path(r'D:/dev/telegram-game/public/assets/maps')
out = {}
for f in sorted(ROOT.glob('map_*.txt')):
    L = re.match(r'map_([A-Z]\d?)_', f.name).group(1)
    g = [r for r in f.read_text(encoding='utf-8').replace('\r', '').split('\n') if r]
    H = len(g)
    c = lambda x, y: g[y][x] if 0 <= y < H and 0 <= x < len(g[y]) else '#'
    air = lambda x, y: c(x, y) not in '#='
    def stand(x, y, ch='#='):  # ряд героя y, опора y+1
        return c(x, y + 1) in ch and air(x, y) and air(x, y - 1) and air(x, y - 2)
    spots = {}
    # ровный пол: 7 клеток подряд, по центру карты ближе к середине
    best = None
    for y in range(2, H - 1):
        for x in range(3, len(g[y]) - 8):
            if all(stand(x + i, y, '#') for i in range(7)):
                d = abs(x - len(g[y]) / 2)
                if best is None or d < best[0]:
                    best = (d, [x + 1, y])
    spots['flat'] = best[1] if best else None
    # полка '=': 4 клетки подряд
    best = None
    for y in range(2, H - 1):
        for x in range(2, len(g[y]) - 5):
            if all(stand(x + i, y, '=') for i in range(3)):
                best = [x + 1, y]
                break
        if best:
            break
    spots['eq'] = best
    # ступень: клетка стояния, слева от неё — клетка стояния на ряд НИЖЕ, и ещё 2 ровных левее
    best = None
    for y in range(2, H - 2):
        for x in range(4, len(g[y]) - 3):
            if stand(x, y, '#') and stand(x + 1, y, '#') and stand(x - 1, y + 1, '#') and stand(x - 2, y + 1, '#'):
                best = [x, y]
                break
        if best:
            break
    spots['step'] = best
    out[L] = spots
    print(L, spots)
json.dump(out, open(Path(__file__).with_name('spots.json'), 'w'))
