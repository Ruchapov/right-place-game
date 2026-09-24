"""
Right Place — инструменты карт. Единственный источник правды для геометрии.
Правила: SKILL right-place-maps. Процесс: WORKFLOW-MAPS.md.
"""
import random

# ---------- примитивы сетки ----------
def make(W, H):
    return [['.'] * W for _ in range(H)]

def fill(g, x0, x1, y0, y1, ch='#'):
    for y in range(y0, y1):
        for x in range(x0, x1):
            g[y][x] = ch

def plat(g, x, y, w):
    """Тонкая one-way платформа. ТОЛЬКО мосты/срезки, не обязательные подъёмы."""
    for i in range(w):
        g[y][x + i] = '='

def save(g, f):
    open(f, 'w').write('\n'.join(''.join(r) for r in g))

def load(f):
    return [list(l) for l in open(f).read().split('\n')]

# ---------- лестница (выстраданная) ----------
def stairs(g, x_base, stand_from, stand_to, d, w=2):
    """
    Зиккурат-лестница из сплошной кладки. Ступени поднимают НОГИ ровно на 1.
    x_base     — колонка ПЕРВОЙ (нижней) ступени; вход со стороны, противоположной d
    stand_from — ряд ног на нижней площадке (пол)
    stand_to   — ряд ног наверху (плита этажа = её stand-ряд)
    d          — +1 подъём вправо, -1 влево
    ВАЖНО: игрок стоит на ряд ВЫШЕ верхнего занятого ряда столба.
    """
    n = stand_from - stand_to
    for i in range(1, n + 1):
        top_solid = stand_from - i + 1          # верхний ЗАНЯТЫЙ ряд столба
        bx = x_base + d * w * (i - 1)
        lo, hi = (bx, bx + w) if d > 0 else (bx - w + 1, bx + 1)
        fill(g, lo, hi, top_solid, stand_from + 2)   # столб до пола

# ---------- модель прыжка и волны (штатная) ----------
def build(g):
    """
    Штатная модель. can() проверяет, что на пути ВВЕРХ (dy>0) игрок не
    проходит сквозь занятые тайлы: '#' И '=' — платформа блокирует подъём
    снизу так же, как стена (по бокам и сверху '=' ведёт себя как раньше).
    Спуск (dy<0) и прямая (dy==0) — без проверки коридора, как и было.
    До этой сессии это было отдельной build_strict(); теперь это и есть
    основная build(). Старая модель без проверки пути — build_legacy(),
    оставлена рядом только для сравнения (см. lint_ascent()).
    """
    H, W = len(g), len(g[0])

    def free(x, y):
        if y < 0 or y >= H or x < 0 or x >= W:
            return False
        return g[y][x] not in '#=^'

    S = {(x, y) for y in range(H) for x in range(W)
         if free(x, y) and free(x, y - 1) and y + 1 < H and g[y + 1][x] in '#='}

    def blocked(x, y):
        if y < 0 or y >= H or x < 0 or x >= W:
            return False
        return g[y][x] in '#='

    def path_clear(ax, ay, bx, by):
        """Консервативная проверка коридора подъёма (ax,ay) -> (bx,by), by < ay."""
        x0, x1 = (ax, bx) if ax <= bx else (bx, ax)
        rows = set(range(by, ay))   # промежуточные строки: от ay-1 до by включительно
        rows.add(by - 1)            # рост игрока 2 тайла — голова над целевой строкой
        for y in rows:
            for x in range(x0, x1 + 1):
                if blocked(x, y):
                    return False
        return True

    def can(a, b):
        ax, ay = a; bx, by = b
        dy = ay - by; dx = abs(ax - bx)
        if dy < 0:  return dx <= 5     # падение
        if dy == 0: return dx <= 4     # в длину
        if dy == 1: return dx <= 3 and path_clear(ax, ay, bx, by)
        if dy == 2: return dx <= 2 and path_clear(ax, ay, bx, by)
        return False                    # вверх 3 запрещён

    return S, can

# ---------- старая модель: без проверки препятствий на пути (для сравнения) ----------
def build_legacy(g):
    """
    Модель ДО этой сессии: can() проверял только dx/dy, без проверки, что
    на пути прыжка нет твёрдых тайлов — '=' была проходима снизу вверх,
    '#' на пути мог быть срезан по диагонали. Держим рядом только чтобы
    lint_ascent() мог показать разницу со штатной build().
    """
    H, W = len(g), len(g[0])
    def free(x, y):
        if y < 0 or y >= H or x < 0 or x >= W:
            return False
        return g[y][x] not in '#=^'
    S = {(x, y) for y in range(H) for x in range(W)
         if free(x, y) and free(x, y - 1) and y + 1 < H and g[y + 1][x] in '#='}
    def can(a, b):
        ax, ay = a; bx, by = b
        dy = ay - by; dx = abs(ax - bx)
        if dy < 0:  return dx <= 5     # падение
        if dy == 0: return dx <= 4     # в длину
        if dy == 1: return dx <= 3
        if dy == 2: return dx <= 2
        return False                    # вверх 3 запрещён на обязательных путях
    return S, can


# ---------- промежуточная модель: на подъёме проверяем ТОЛЬКО '#' ----------
def build_walls(g):
    """
    Как штатная build(), но path_clear считает преградой на пути ВВЕРХ
    только '#'. '=' здесь по-прежнему воздух снизу (как в build_legacy()) —
    это НЕ новое правило про '=', только проверка стен, которую build_legacy()
    вообще не делал. Разница (build − build_walls) = цена именно решения
    "'=' блокирует снизу". Используется в lint_ascent().
    """
    H, W = len(g), len(g[0])

    def free(x, y):
        if y < 0 or y >= H or x < 0 or x >= W:
            return False
        return g[y][x] not in '#=^'

    S = {(x, y) for y in range(H) for x in range(W)
         if free(x, y) and free(x, y - 1) and y + 1 < H and g[y + 1][x] in '#='}

    def blocked(x, y):
        if y < 0 or y >= H or x < 0 or x >= W:
            return False
        return g[y][x] == '#'          # '=' НЕ преграда — только стены

    def path_clear(ax, ay, bx, by):
        x0, x1 = (ax, bx) if ax <= bx else (bx, ax)
        rows = set(range(by, ay))
        rows.add(by - 1)
        for y in rows:
            for x in range(x0, x1 + 1):
                if blocked(x, y):
                    return False
        return True

    def can(a, b):
        ax, ay = a; bx, by = b
        dy = ay - by; dx = abs(ax - bx)
        if dy < 0:  return dx <= 5
        if dy == 0: return dx <= 4
        if dy == 1: return dx <= 3 and path_clear(ax, ay, bx, by)
        if dy == 2: return dx <= 2 and path_clear(ax, ay, bx, by)
        return False

    return S, can


def wave(S, can, start, reverse=False):
    seen = {start}; fr = [start]
    while fr:
        c = fr.pop()
        for n in S:
            if n in seen:
                continue
            if (can(n, c) if reverse else can(c, n)):
                seen.add(n); fr.append(n)
    return seen

def report(f, start, quiet=False):
    g = load(f); S, can = build(g)
    fwd = wave(S, can, start)
    back = wave(S, can, start, reverse=True)
    a, b, t = len(fwd & S), len(back & S), len(S)
    if not quiet:
        print(f'{f}: туда {a}/{t}, обратно {b}/{t}',
              '' if a == t else f'| не дойти: {sorted(S - fwd)[:5]}',
              '' if b == t else f'| не вернуться: {sorted(S - back)[:5]}')
    return a == t and b == t

def lint_grid(g):
    """Ядро lint() на уже загруженной сетке — платформы '=' короче 2 тайлов."""
    H, W = len(g), len(g[0]); bad = []
    for y in range(H):
        x = 0
        while x < W:
            if g[y][x] == '=':
                x0 = x
                while x < W and g[y][x] == '=':
                    x += 1
                if x - x0 < 2:
                    bad.append((x0, y))
            else:
                x += 1
    return bad

def lint(f):
    g = load(f)
    bad = lint_grid(g)
    if bad:
        print(f'{f}: ПЛАТФОРМЫ В 1 ТАЙЛ: {bad}')
    return not bad

# ---------- линтер правила 1: обязательный подъём только кладкой '#' ----------
def lint_ascent_grid(g, start):
    """
    Ядро lint_ascent() на уже загруженной сетке.
    Сравнивает build_walls() (стены '#' уже проверены, '=' ещё воздух снизу)
    со штатной build() ('=' тоже блокирует подъём): всё, что было проходимо
    в первом случае и перестало — держалось на '='. Возвращает отсортированный
    список координат (пусто = правило соблюдено).
    """
    Sw, can_w = build_walls(g)
    fwd_w = wave(Sw, can_w, start) & Sw
    back_w = wave(Sw, can_w, start, reverse=True) & Sw

    S, can_s = build(g)
    fwd_s = wave(S, can_s, start) & S
    back_s = wave(S, can_s, start, reverse=True) & S

    return sorted((fwd_w - fwd_s) | (back_w - back_s))

def lint_ascent(f, start, quiet=False):
    """
    ГЛАВНЫЙ инструмент для правки карт под новое правило '='.
    Находит клетки, где ЕДИНСТВЕННЫЙ путь наверх/обратно держится на '=' —
    это нарушение правила 1 SKILL-maps (обязательный подъём = только
    сплошная кладка '#', '=' — не обязательные мосты/срезки).
    """
    g = load(f)
    lost = lint_ascent_grid(g, start)
    if not quiet:
        if lost:
            print(f"{f}: НАРУШЕНИЕ ПРАВИЛА 1 — подъём держится на '=' в {len(lost)} местах:")
            print(f'  {lost}')
        else:
            print(f'{f}: правило 1 соблюдено — весь обязательный подъём кладкой')
    return lost

# ---------- линтер клиренса: '=' слишком низко над точкой стояния ----------
def lint_clearance_grid(g):
    """
    Ядро lint_clearance() на уже загруженной сетке.
    ВАЖНО про определение. build()'s S строится через free(), а free() САМА
    исключает '#'/'=' из (x,y) и (x,y-1) — то есть для настоящего члена S
    проверка "голова/ноги свободны" тавтологична и НИКОГДА не найдёт
    нарушение. Реальная дыра — места, где опора под ногами ЕСТЬ
    (g[y+1][x] в '#='), но free() из-за занятой головы/ног молча выкинула
    точку из S целиком. Такая точка не появляется ни в report() (она не
    "не дойти" — её попросту нет как узла графа), ни в lint_ascent(). Игрок
    находит её только руками, физикой, как на карте A.

    Поэтому кандидаты здесь генерируются НЕ через free()/S, а по признаку
    "опора снизу есть" (g[y+1][x] в '#='). ВАЖНО: кандидат — только
    РЕАЛЬНАЯ, физически возможная точка стояния, поэтому сама клетка (x,y)
    должна быть свободна. Без этого условия кандидатом считалась бы ЛЮБАЯ
    клетка внутри сплошной кладки толще 1 тайла (пол в 2-3 ряда, лестница
    stairs() — там нижние ряды каждой ступени "опираются" на такой же
    занятый тайл под собой) — это шум, а не нарушение: там никто не может
    стоять, там просто камень, не нужно решать несуществующую проблему.
    После фильтра остаются только настоящие "ноги" (тайл над реальной
    опорой сам почему-то занят) и "голова" (клетка над ногами занята) —
    ровно то, что нашли на карте A руками.

    Возвращает список [(x, y, blockers)], blockers — список
    (part, bx, by, ch): part = 'ноги'|'голова', ch = мешающий символ.
    """
    H, W = len(g), len(g[0])
    violations = []
    for y in range(H):
        for x in range(W):
            if g[y][x] in '#=':
                continue  # сама клетка занята — не РЕАЛЬНАЯ точка стояния, а камень
            if y + 1 >= H or g[y + 1][x] not in '#=':
                continue  # нет опоры под ногами — не точка стояния
            blockers = []
            if y - 1 >= 0 and g[y - 1][x] in '#=':
                blockers.append(('голова', x, y - 1, g[y - 1][x]))
            if blockers:
                violations.append((x, y, blockers))
    return violations

def lint_clearance(f, quiet=False):
    g = load(f)
    violations = lint_clearance_grid(g)
    if not quiet:
        if violations:
            print(f'{f}: НАРУШЕНИЕ КЛИРЕНСА в {len(violations)} местах:')
            for x, y, blockers in violations[:10]:
                desc = ', '.join(f"{part} ({bx},{by})='{ch}'" for part, bx, by, ch in blockers)
                print(f'  ({x},{y}): {desc}')
        else:
            print(f'{f}: клиренс в порядке')
    return violations

# ---------- единый валидатор ----------
def validate(g, start):
    """
    Сводит report()/lint()/lint_clearance()/lint_ascent() в одну программную
    проверку. Принимает уже загруженную сетку (не путь к файлу) — generate()
    гоняет это на сырых попытках в памяти, ничего не сохраняя на диск.

    Возвращает (ok, problems). problems — список dict с полем 'type' и
    координатами, чтобы вызывающий код (генератор) мог понять, какое именно
    правило нарушено и где:
      - 'start_not_standable'          — старт не клетка стояния
      - 'unreachable_forward'/'_backward' — обе волны должны быть 100%
      - 'short_platform'                — '=' короче 2 тайлов (lint)
      - 'clearance'                     — '#'/'=' в клетке ног/головы над
                                            реальной точкой стояния (lint_clearance)
      - 'ascent_on_platform'            — единственный подъём держится на '='
                                            (lint_ascent, правило 1)
    ok = True только если problems пуст.
    """
    problems = []

    S, can = build(g)
    if not S:
        return False, [{'type': 'no_standable_cells'}]

    if start not in S:
        problems.append({'type': 'start_not_standable', 'x': start[0], 'y': start[1]})

    fwd = wave(S, can, start) & S
    back = wave(S, can, start, reverse=True) & S
    for (x, y) in sorted(S - fwd):
        problems.append({'type': 'unreachable_forward', 'x': x, 'y': y})
    for (x, y) in sorted(S - back):
        problems.append({'type': 'unreachable_backward', 'x': x, 'y': y})

    for (x, y) in lint_grid(g):
        problems.append({'type': 'short_platform', 'x': x, 'y': y})

    for (x, y, blockers) in lint_clearance_grid(g):
        for part, bx, by, ch in blockers:
            problems.append({
                'type': 'clearance', 'x': x, 'y': y,
                'part': part, 'blocker_x': bx, 'blocker_y': by, 'ch': ch,
            })

    for (x, y) in lint_ascent_grid(g, start):
        problems.append({'type': 'ascent_on_platform', 'x': x, 'y': y})

    return (len(problems) == 0, problems)

# ---------- генератор карт ----------
def _generate_relief(rng, w, floors, gap_min, gap_max):
    """
    Рельеф: floors этажей (индекс 0 — верхний, последний — нижний, старт —
    середина нижнего, так же, как в реальных картах A-F). Подъём между
    соседними этажами — ТОЛЬКО stairs() из кладки, зигзагом (чередуем
    сторону входа, чтобы верхняя площадка одной лестницы не перекрывала
    зону разрыва другой). Между этажами всегда gap_min..gap_max строк
    (>=7 по правилу).

    Каждый этаж — сплошная кладка '#' на всю ширину, КРОМЕ узкой зоны у
    своего края, где в него упирается лестница снизу: если оставить пол
    сплошным над верхними ступенями, path_clear (по всей ширине зоны
    прыжка, а не только в точке приземления) видит сплошной потолок над
    пролётом и блокирует ЛЮБОЙ прыжок рядом с площадкой — это не баг
    модели, а корректная проверка "не проходим сквозь плиту сбоку". Разрыв
    даёт лестнице открытый подход; сама верхняя ступень уже стоит вровень
    с полом и держит её локально.

    Опциональные декоративные мосты '=' (>=2 тайла) — только НАД собственным
    этажом, никогда не соединяют этажи между собой, поэтому в принципе не
    могут стать "единственным подъёмом" (ascent_on_platform). Их высота над
    полом рандомна и МОЖЕТ нарушать клиренс — это намеренно, чтобы
    validate() и retry-цикл generate() было на чём проверять.
    """
    gaps = [rng.randint(gap_min, gap_max) for _ in range(floors - 1)]
    floor_rows = [3]  # верхний этаж, запас 3 строки над ним
    for gap in gaps:
        floor_rows.append(floor_rows[-1] + gap)
    h = floor_rows[-1] + 2  # запас под нижним полом
    g = make(w, h)

    # stairs() заливает solid КАЖДУЮ свою колонну вплоть до stand_from+1
    # включительно — то есть подошва ВСЕГО пролёта (по X) на ряду stand_from
    # сплошная, её нельзя использовать как пол для ходьбы. Значит:
    #  (а) верхнюю площадку нельзя закрывать сплошным полом над пролётом —
    #      иначе path_clear видит потолок и блокирует любой прыжок рядом
    #      с ней (см. предыдущий разбор);
    #  (б) на НИЖНЕЙ площадке подошва делит пол на два куска по разные
    #      стороны пролёта, и они НЕ соединены друг с другом (это и есть
    #      сама лестница). Открытая, ходибельная часть пола должна быть
    #      ТОЛЬКО с одной стороны — там, где стоит первая (самая нижняя,
    #      КОРОТКАЯ) ступень: с неё высота прыжка dy=1, вход рядом. Высокий
    #      конец (последняя ступень) должен упираться в край карты, чтобы
    #      по другую сторону от него не оставалось изолированного клочка
    #      пола, до которого никак не дойти.
    floor_gap = {}      # row -> (lo, hi) разрыва пола над пролётом (верхняя площадка)
    entry_side = {}     # row нижней площадки -> 'left'|'right' — где открытый пол
    for i in range(floors - 1):
        stand_from = floor_rows[i + 1] - 1   # нижняя площадка
        stand_to = floor_rows[i] - 1          # верхняя площадка
        n = stand_from - stand_to
        tall_end_left = (i % 2 == 0)          # чередуем для разнообразия силуэта
        if tall_end_left:
            d = -1
            x_base = 2 * (n - 1) + 1          # последняя (высокая) ступень у col0
        else:
            d = 1
            x_base = w - 2 * n                # последняя (высокая) ступень у col w-1
        stairs(g, x_base, stand_from, stand_to, d, w=2)

        if d == 1:
            step1_edge = x_base                          # первая (короткая) ступень слева от неё
        else:
            step1_edge = x_base + 1                       # первая (короткая) ступень справа от неё
        # Разрыв над ВЕРХНЕЙ площадкой — НЕ на весь пролёт, а только у самой
        # площадки (там, где предпоследняя ступень технически совпадает по
        # высоте с рядом пола, см. разбор). Небольшой запас (до 5 ступеней),
        # весь остальной верхний этаж остаётся сплошным и соединённым с
        # местом приземления — иначе площадка отрезана от остального этажа
        # тем же разрывом, который её спасал.
        GAP_W = min(2 * n, 7)
        if tall_end_left:
            floor_gap[floor_rows[i]] = (0, min(w, GAP_W))
        else:
            floor_gap[floor_rows[i]] = (max(0, w - GAP_W), w)
        # Граница НИЖНЕЙ площадки — БЕЗ запаса: это опорный пол (кладка),
        # его нужно залить вплотную к первой ступени, а не оставлять щель.
        entry_side[floor_rows[i + 1]] = ('right', step1_edge) if tall_end_left else ('left', step1_edge)

    # Приоритет: если этаж ещё и ОТПРАВЛЯЕТ дальше вверх (entry_side) —
    # даём ему полноценный широкий пол с той стороны (проверенная логика
    # выше). Если этаж ТОЛЬКО принимает лестницу и дальше не ведёт (только
    # floor_gap, это всегда самый верхний этаж) — его открытая зона это и
    # есть сама площадка (уже стоит на своей ступени), остальное сознательно
    # не заливаем: попытка сделать его "широким" и есть тот самый разрыв
    # между dx<=4 и требованиями path_clear, который не решается без
    # серии коротких (<=2 тайла) лестниц — отдельная задача на будущее.
    for row in floor_rows:
        if row in entry_side:
            side, edge = entry_side[row]
            if side == 'right':
                fill(g, edge, w, row, row + 1, '#')
            else:
                fill(g, 0, edge, row, row + 1, '#')
        elif row in floor_gap:
            pass
        else:
            fill(g, 0, w, row, row + 1, '#')

    # Мосты — не на этажах-"тупиках" (только floor_gap, без entry_side):
    # там открытая зона — это сама лестничная площадка, мост может
    # приземлиться в пустоту и создать оторванный, недостижимый остров.
    for row in floor_rows:
        if row in floor_gap and row not in entry_side:
            continue
        if rng.random() >= 0.6:
            continue
        stand = row - 1
        offset = rng.randint(1, 4)   # 1 = намеренно в клетке головы (риск)
        bridge_y = stand - offset
        if bridge_y <= 0:
            continue
        bw = rng.randint(2, 4)
        bx = rng.randint(6, max(7, w - 6 - bw))
        plat(g, bx, bridge_y, bw)

    # Старт — в открытой части нижнего этажа (там же, где вход на первую
    # ступень последней лестницы), с запасом от границы пролёта. Нижний
    # этаж никогда не бывает "верхней площадкой" — сплошного разрыва там
    # нет, есть только это разделение на открытую/лестничную половины.
    bottom_row = floor_rows[-1]
    if bottom_row in entry_side:
        side, edge = entry_side[bottom_row]
        start_x = min(w - 2, edge + 6) if side == 'right' else max(1, edge - 6)
    else:
        start_x = w // 2  # только 1 этаж — лестниц нет вообще, весь пол открыт
    start = (start_x, bottom_row - 1)
    return g, start


def _generate_slots(rng, g, start, map_id, floors):
    """Слоты событий в формате слот-JSON карт A-F (см. README пакета)."""
    S, _can = build(g)
    candidates = sorted(S - {start})
    rng.shuffle(candidates)

    def take(n):
        chosen, rest = candidates[:n], candidates[n:]
        candidates[:] = rest
        return [[x, y] for x, y in chosen]

    enemy_clusters = []
    for i in range(rng.randint(2, 3)):
        pts = take(3)
        if len(pts) < 3:
            break
        enemy_clusters.append({'zone': f'кластер-{i + 1}', 'points': pts})

    reward = take(rng.randint(2, 4))
    hazard = take(rng.randint(2, 4))

    npc = {'smuggler': None, 'puzzle': None}
    if candidates and rng.random() < 0.5:
        npc[rng.choice(['smuggler', 'puzzle'])] = take(1)

    boss = None
    if candidates and rng.random() < 0.3:
        pt = take(1)
        boss = pt[0] if pt else None

    return {
        'mapId': f'GEN-{map_id}',
        'name': f'Сгенерированная ({floors} этажа)',
        'start': [start[0], start[1]],
        'enemyClusters': enemy_clusters,
        'reward': reward,
        'hazard': hazard,
        'npc': npc,
        'boss': boss,
    }


def generate(seed, params=None):
    """
    Процедурный генератор карт с validate() как приёмочным тестом.
    Рельеф: 2-3 "прогулочных" этажа сплошной кладки, подъёмы между ними
    ТОЛЬКО через stairs() (зиккурат, ступень поднимает ноги ровно на 1
    тайл), между этажами >=7 строк (params gap_min/gap_max). Декоративные
    мосты '=' (>=2 тайла) только над собственным этажом, никогда не
    становятся единственным подъёмом — но по высоте иногда нарушают
    клиренс намеренно (см. _generate_relief), чтобы было что отбраковывать.

    Каждая попытка — НОВЫЙ seed (seed + номер попытки), детерминирована
    через random.Random(trial_seed) — один seed всегда даёт одну и ту же
    карту. До params['max_attempts'] (по умолчанию 50) попыток; первая же,
    прошедшая validate(), возвращается со слотами. Если ни одна не прошла —
    честный провал: (None, None, meta), meta['ok']=False,
    meta['attempts_log'] = [(trial_seed, problems), ...] по каждой отбраковке.

    Сеток на диск не пишет — только модель в памяти (save() — отдельно).
    """
    p = dict(params or {})
    w = p.get('w', 48)
    floors_choices = p.get('floors_choices', (2, 3))
    gap_min = p.get('gap_min', 7)
    gap_max = p.get('gap_max', 9)
    max_attempts = p.get('max_attempts', 50)

    attempts_log = []
    for attempt in range(max_attempts):
        trial_seed = seed + attempt
        rng = random.Random(trial_seed)

        floors = rng.choice(list(floors_choices))
        g, start = _generate_relief(rng, w, floors, gap_min, gap_max)

        ok, problems = validate(g, start)
        if ok:
            slots = _generate_slots(rng, g, start, seed, floors)
            meta = {
                'ok': True, 'seed': seed, 'trial_seed': trial_seed,
                'attempts': attempt + 1, 'floors': floors, 'w': w, 'h': len(g),
            }
            return g, slots, meta
        attempts_log.append((trial_seed, problems))

    meta = {'ok': False, 'seed': seed, 'attempts': max_attempts, 'attempts_log': attempts_log}
    return None, None, meta

# ---------- визуальный отладчик ----------
def debug(g, start):
    """ASCII-достижимость. Чинить карты ТОЛЬКО глядя на это, не вслепую."""
    S, can = build(g)
    R = wave(S, can, start)
    B = wave(S, can, start, reverse=True)
    H, W = len(g), len(g[0])
    print('   ' + ''.join(str(x % 10) for x in range(W)))
    for y in range(H):
        row = ''
        for x in range(W):
            c = g[y][x]
            if c == '#':   row += '█'
            elif c == '=': row += '▬'
            elif (x, y) == start: row += 'S'
            elif (x, y) in S:
                row += '·' if ((x, y) in R and (x, y) in B) else \
                       ('▲' if (x, y) in R else '×')
            else:
                row += ' '
        print(f'{y:2d} {row}')
    print('· ходибельно  ▲ дойти-нельзя-вернуться  × не-дойти')
