"""Проверка сетки карты и её слотов (10.11.2026) — перед выкладкой новой карты.

    python tools/check_map_slots.py A B C        карты по букве (map_<буква>_*.txt + map_<буква>_slots.json)
    python tools/check_map_slots.py              все карты с одним .txt на букву

Read-only, ничего не чинит. Печатает таблицу по каждой карте и падает (код 1),
если хоть что-то не прошло:

  a) map_tools.validate(g, start): обе волны 100%, lint, lint_clearance, lint_ascent пусты;
  b) строгая волна (map_tools.strict_wave: падение и ровный прыжок не сквозь '#'),
     туда и обратно 100%;
  c) a и b, когда ВСЕ ловушки пула (slots.hazard) вставлены в сетку как '^';
  d) точки слотов: клетка стояния, без повторов; враги не ближе 8 тайлов от
     старта (по прямой); враг, сундук, NPC и босс не на ловушке и не вплотную к
     ней (x±1, тот же ряд); ловушка не ближе 2 тайлов к краю площадки; рядом с
     сундуком есть клетка стояния без ловушки (не щель в 1 тайл);
  e) сколько точек врагов на каждом ряду.

Обязательный подъём ловушкой не перекрыт, если c) прошёл: с '^' волны те же 100%.
"""
import json
import math
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import map_tools as mt  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
MAPS = ROOT / 'public' / 'assets' / 'maps'
ENEMY_MIN_START_DIST = 8
TRAP_EDGE_MIN = 2


def load_grid(path):
    return [list(r.rstrip('\r')) for r in path.read_text(encoding='utf-8').split('\n') if r.rstrip('\r')]


def waves(g, start):
    ok, probs = mt.validate(g, start)
    kinds = Counter(p['type'] for p in probs)
    f, b, S = mt.strict_wave(g, start)
    return {
        'validate': ok, 'problems': dict(kinds),
        'strict': (len(f), len(b), len(S)),
        'strict_ok': len(f) == len(S) and len(b) == len(S),
        'strict_lost': sorted((S - f) | (S - b))[:12],
    }


def check(letter):
    txts = [p for p in MAPS.glob(f'map_{letter}_*.txt')]
    if len(txts) != 1:
        raise SystemExit(f'{letter}: ожидался один .txt, нашлось {[p.name for p in txts]}')
    g = load_grid(txts[0])
    slots = json.loads((MAPS / f'map_{letter}_slots.json').read_text(encoding='utf-8'))
    start = tuple(slots['start'])
    fails = []

    a = waves(g, start)
    if not a['validate']:
        fails.append(f"4a: {a['problems']}")
    if not a['strict_ok']:
        fails.append(f"4b: строгая волна {a['strict']}, теряются {a['strict_lost']}")

    hazards = [tuple(p) for p in slots.get('hazard') or []]
    gs = [row[:] for row in g]
    for x, y in hazards:
        gs[y][x] = '^'
    c = waves(gs, start)
    if not c['validate']:
        fails.append(f"4c (с '^'): {c['problems']}")
    if not c['strict_ok']:
        fails.append(f"4c (с '^') строгая волна {c['strict']}, теряются {c['strict_lost']}")

    S, _ = mt.build(g)
    enemies = [tuple(p) for cl in slots.get('enemyClusters') or [] for p in cl['points']]
    chests = [tuple(p) for p in slots.get('reward') or []]
    npc = slots.get('npc') or {}
    smugglers = [tuple(p) for p in npc.get('smuggler') or []]
    puzzles = [tuple(p) for p in npc.get('puzzle') or []]
    boss = [tuple(slots['boss'])] if slots.get('boss') else []
    obelisk = [tuple(p) for p in (slots.get('obelisk') or {}).get('points', [])] if slots.get('obelisk') else []
    named = ([('старт', start)] + [('враг', p) for p in enemies] + [('сундук', p) for p in chests]
             + [('ловушка', p) for p in hazards] + [('контрабандист', p) for p in smugglers]
             + [('загадка', p) for p in puzzles] + [('босс', p) for p in boss] + [('обелиск', p) for p in obelisk])
    d = []
    for kind, p in named:
        if p not in S:
            d.append(f'{kind} {list(p)} не клетка стояния')
    for p, n in Counter(p for _, p in named).items():
        if n > 1:
            d.append(f'точка {list(p)} повторяется {n} раз: {[k for k, q in named if q == p]}')
    for p in enemies:
        dist = math.hypot(p[0] - start[0], p[1] - start[1])
        if dist < ENEMY_MIN_START_DIST:
            d.append(f'враг {list(p)} в {dist:.1f} тайла от старта')
    trapset = set(hazards)
    for kind, p in named:
        if kind in ('ловушка', 'старт'):
            continue
        near = [q for q in hazards if q[1] == p[1] and abs(q[0] - p[0]) <= 1]
        if near:
            d.append(f'{kind} {list(p)} на ловушке или вплотную к ней: {[list(q) for q in near]}')
    for x, y in hazards:
        if (x, y) not in S:
            continue
        left = x
        while (left - 1, y) in S:
            left -= 1
        right = x
        while (right + 1, y) in S:
            right += 1
        if x - left < TRAP_EDGE_MIN or right - x < TRAP_EDGE_MIN:
            d.append(f'ловушка {[x, y]} у края площадки {left}..{right}')
    for x, y in chests:
        if not any((nx, y) in S and (nx, y) not in trapset for nx in (x - 1, x + 1)):
            d.append(f'сундук {[x, y]} в щели: рядом нет клетки, где стоять')
    if d:
        fails.append('4d: ' + '; '.join(d))

    rows = sorted(Counter(p[1] for p in enemies).items())
    print(f'== {letter} ({txts[0].name}, {len(g[0])}×{len(g)}, старт {list(start)})')
    print(f"  4a validate: {'ок' if a['validate'] else 'НЕТ ' + str(a['problems'])}; клеток стояния {a['strict'][2]}")
    print(f"  4b строгая волна: туда {a['strict'][0]}/{a['strict'][2]}, обратно {a['strict'][1]}/{a['strict'][2]}")
    print(f"  4c с {len(hazards)} '^': validate {'ок' if c['validate'] else 'НЕТ ' + str(c['problems'])}; "
          f"строгая туда {c['strict'][0]}/{c['strict'][2]}, обратно {c['strict'][1]}/{c['strict'][2]}")
    print(f"  4d точки: врагов {len(enemies)}, сундуков {len(chests)}, ловушек {len(hazards)}, "
          f"контрабандист {[list(p) for p in smugglers] or '—'}, босс {[list(p) for p in boss] or '—'}; "
          f"ближайший враг от старта {min(math.hypot(p[0]-start[0], p[1]-start[1]) for p in enemies):.1f}; "
          + ('ок' if not d else f'НАРУШЕНИЙ {len(d)}'))
    for line in d:
        print(f'     - {line}')
    print(f"  4e враги по рядам: {', '.join(f'ряд {y}: {n}' for y, n in rows)}")
    return fails


def main():
    letters = sys.argv[1:] or sorted({p.name.split('_')[1] for p in MAPS.glob('map_*_slots.json')})
    bad = {}
    for letter in letters:
        fails = check(letter)
        if fails:
            bad[letter] = fails
    print()
    if bad:
        for letter, fails in bad.items():
            print(f'{letter}: НЕ ПРОШЛО — ' + ' | '.join(fails))
        sys.exit(1)
    print('Все карты прошли.')


main()
