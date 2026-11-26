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
     сундуком есть клетка стояния без ловушки (не щель в 1 тайл); (18.11.2026)
     сундук, бочка и кувшин не на проступи ступени шириной в клетку и не вплотную
     к подъёму на 1–2 клетки (соседняя клетка — «#», над ней клетка стояния):
     тело сундука — стена по X, и на B2 он запирал лестницу;
  e) сколько точек врагов на каждом ряду;
  f) (13.11.2026) ловушки: пулы gargoyles / stalactites / saws и trapsPerRun —
     правила расстановки и геометрия (tools/trap_rules.py, общие с
     place_traps.py), декор в зоне каждой ловушки, включая шипы hazard, и волны
     (штатная и строгая) со ВСЕМИ ловушками на месте: ни одна клетка, достижимая
     без ловушек, не теряется.

  g) (26.11.2026) события — сундук (он же жаровня и чаша Носителя огня),
     обелиск, Контрабандист, бочка и кувшин: на ровном полу с запасом ≥ 1
     клетки до края (соседние клетки того же ряда — клетки стояния или стена,
     не обрыв), не на
     ступени и не у подъёма (step_problem), достижимы строгой волной. Обелиск и
     сундук — стены по X: на уступе в 2 клетки (Y [42,16]) на него не встать;
  h) (26.11.2026) точки врагов (группы и патрульные) — не на ступени, не на
     проступи лестницы и не вплотную к подъёму (step_problem): оттуда враги
     почти не спускаются;
  i) (26.11.2026) проходимость ГЕРОЕМ покадрово — tools/hero_reach.mjs (та же
     физика, что в игре) — только с ключом --hero: идёт минутами.

Принятые до 13.11.2026 нарушения (ACCEPTED ниже) печатаются строкой «принято» и
проверку не роняют: подъём на 3 тайла на A, C, E (решение Андрея 10.11.2026) и
(до 26.11.2026 ещё враги вплотную к шипам на B2, C2 — исправлены). Ловушки
13.11.2026 проверяет 4f относительно волн БЕЗ ловушек — она этими исключениями
не прикрыта.

Обязательный подъём ловушкой не перекрыт, если c) прошёл: с '^' волны те же 100%.
"""
import json
import math
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import map_tools as mt  # noqa: E402
import trap_rules as R  # noqa: E402

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

# Нарушения, принятые до ловушек 13.11.2026 (см. шапку): буква → пункты.
ACCEPTED = {
    'A': {'4a', '4b', '4c'}, 'C': {'4a', '4b', '4c'}, 'E': {'4a', '4b', '4c'},
}
# (26.11.2026) B2 и C2 «враг вплотную к шипам» исправлены — исключения сняты.

ROOT = Path(__file__).resolve().parent.parent
MAPS = ROOT / 'public' / 'assets' / 'maps'
ENEMY_MIN_START_DIST = 8
TRAP_EDGE_MIN = 2


def load_grid(path):
    return [list(r.rstrip('\r')) for r in path.read_text(encoding='utf-8').split('\n') if r.rstrip('\r')]


def step_problem(g, S, x, y):
    """(18.11.2026) Сундук или бочка на ступени: на проступи шириной в клетку или
    вплотную к подъёму на 1–2 клетки — соседняя клетка «#», над ней клетка
    стояния (через неё идёт путь наверх). Пусто — место годное."""
    if (x, y) not in S:
        return ''
    left, right = x, x
    while (left - 1, y) in S:
        left -= 1
    while (right + 1, y) in S:
        right += 1
    if right == left:
        return 'на проступи ступени шириной в клетку'
    for d in (1, -1):
        nx = x + d
        if 0 <= nx < len(g[0]) and g[y][nx] == '#':
            for k in (1, 2):
                if (nx, y - k) in S:
                    return f'вплотную к подъёму на {k} в столбце {nx}'
    return ''


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
    for kind, pts in (('сундук', chests), ('бочка', [tuple(p) for p in slots.get('breakables') or []])):
        for x, y in pts:
            why = step_problem(g, S, x, y)
            if why:
                d.append(f'{kind} {[x, y]} {why}')
    if d:
        fails.append('4d: ' + '; '.join(d))

    # 4g — события на ровном полу с запасом до края, не у подъёма, достижимы.
    strict_f, _, _ = mt.strict_wave(g, start)
    # Подъём на 3 принят (A, C, E): модель его не допускает вовсе, и достижимость
    # точек там решает покадровая проверка героем (4i, --hero; 26.11.2026 — все
    # клетки A, C, E достижимы туда и обратно).
    check_reach = not (letter in ACCEPTED and '4b' in ACCEPTED[letter])
    gg = []

    def ledge(x, y):
        # Край — обрыв: соседняя клетка того же ряда не клетка стояния и не стена.
        return (x, y) not in S and 0 <= x < len(g[0]) and g[y][x] != '#'
    breakables = [tuple(p) for p in slots.get('breakables') or []]
    for kind, pts in (('сундук', chests), ('обелиск', obelisk), ('контрабандист', smugglers), ('бочка', breakables)):
        for x, y in pts:
            if (x, y) not in S:
                continue
            if ledge(x - 1, y) or ledge(x + 1, y):
                gg.append(f'{kind} {[x, y]} у края уступа (рядом обрыв)')
            why = step_problem(g, S, x, y)
            if why and kind in ('обелиск', 'контрабандист'):
                gg.append(f'{kind} {[x, y]} {why}')
            if check_reach and (x, y) not in strict_f:
                gg.append(f'{kind} {[x, y]} не достижим строгой волной')
    if gg:
        fails.append('4g: ' + '; '.join(gg))

    # 4h — точки врагов не на ступенях.
    hh = []
    for x, y in enemies:
        why = step_problem(g, S, x, y)
        if why:
            hh.append(f'враг {[x, y]} {why}')
    if hh:
        fails.append('4h: ' + '; '.join(hh))

    if HERO:
        hero = hero_reach(letter)
        if hero:
            fails.append('4i: ' + hero)

    f_bad = check_traps(letter, txts[0], g, slots, start)
    if f_bad:
        fails.append('4f: ' + '; '.join(f_bad))

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
    for tag, lst in (('4g события', gg), ('4h враги на ступенях', hh)):
        print(f"  {tag}: " + ('ок' if not lst else f'НАРУШЕНИЙ {len(lst)}'))
        for line in lst:
            print(f'     - {line}')
    print(f"  4e враги по рядам: {', '.join(f'ряд {y}: {n}' for y, n in rows)}")
    pools = {k: len(slots.get(k) or []) for k in ('gargoyles', 'stalactites', 'saws')}
    print(f"  4f ловушки: шипов {len(hazards)}, горгулий {pools['gargoyles']}, сталактитов {pools['stalactites']}, "
          f"пил {pools['saws']}; за забег {slots.get('trapsPerRun')}; " + ('ок' if not f_bad else f'НАРУШЕНИЙ {len(f_bad)}'))
    for line in f_bad:
        print(f'     - {line}')
    acc = ACCEPTED.get(letter, set())
    kept = [f for f in fails if f[:2] not in acc]
    took = [f[:2] for f in fails if f[:2] in acc]
    if took:
        print(f"  принято до 13.11.2026: {', '.join(sorted(set(took)))}")
    return kept


def check_traps(letter, txt, g, slots, start):
    """4f — ловушки (правила — tools/trap_rules.py)."""
    bad = []
    S, _ = mt.build(g)
    decor = R.decor_mask(txt, g)
    ctx = {'grid': g, 'S': S, 'start': start, 'points': R.slot_points(slots), 'decor': decor}
    traps = [(k, tuple(t) if k == 'hazard' else t) for k, t in R.all_traps(slots)]
    for i, (k, t) in enumerate(traps):
        if k == 'hazard':
            x, y = t
            if decor[y][x] is not None and decor[y][x] > R.DECOR_TOL:
                bad.append(f'декор в клетке шипа {list(t)}: {decor[y][x]} px')
            continue
        others = traps[:i] + traps[i + 1:]
        for b in R.check_trap(k, t, ctx, others):
            anchor = R.footprint(k, t)[0] if R.footprint(k, t) else (t['x'], t['y'])
            bad.append(f'{k} {anchor}: {b}')
    base = R.waves_with(g, start, [], mt)
    now = R.waves_with(g, start, traps, mt)
    lost = R.waves_lost(base, now)
    if lost:
        bad.append(f'ловушки перекрыли путь: теряются {sorted(lost)[:10]}')
    per = slots.get('trapsPerRun')
    if traps and len(traps) > len(slots.get('hazard') or []) or per is not None:
        if not isinstance(per, dict):
            bad.append('нет trapsPerRun')
        else:
            if per.get('spikes', -1) > len(slots.get('hazard') or []) or per.get('spikes', -1) < 0:
                bad.append(f"trapsPerRun.spikes {per.get('spikes')} больше пула шипов")
            for k in ('gargoyles', 'stalactites', 'saws'):
                n = per.get(k)
                if not isinstance(n, int) or n < 0 or n > len(slots.get(k) or []):
                    bad.append(f'trapsPerRun.{k} {n} больше пула {len(slots.get(k) or [])}')
            if per.get('gargoyles', 0) > R.GARGOYLE_MAX or per.get('saws', 0) > R.SAW_MAX:
                bad.append('горгулий или пил за забег больше 3')
    return bad


HERO = '--hero' in sys.argv


def hero_reach(letter):
    """4i — покадровая проходимость героем (tools/hero_reach.mjs). Пусто — ок."""
    import subprocess
    r = subprocess.run(['node', str(ROOT / 'tools' / 'hero_reach.mjs'), '--check', letter], capture_output=True, text=True, encoding='utf-8')
    out = (r.stdout or '').strip()
    print('  4i ' + out.replace(chr(10), chr(10) + '     '))
    return '' if r.returncode == 0 else out.split(chr(10), 1)[-1].strip()


def main():
    letters = [a for a in sys.argv[1:] if not a.startswith('--')] or sorted({p.name.split('_')[1] for p in MAPS.glob('map_*_slots.json')})
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
