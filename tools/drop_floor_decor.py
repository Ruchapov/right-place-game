"""Декор на кромку пола (26.11.2026) — рабочая копия декора карт A и B.

    python tools/drop_floor_decor.py            A и B: записать рабочие копии
    python tools/drop_floor_decor.py --dry      только отчёт, ничего не писать
    python tools/drop_floor_decor.py --all      отчёт по всем восьми картам пакетов

Жалоба Андрея по телефону: на кладбищенских картах кресты, раковины-надгробия,
урны и свечи стоят на 5–10 px экрана ВЫШЕ кромки плиты — между ними и полом виден
фон. Причина — у картинок декора пакета Codex прозрачный низ: layout пакета ставит
низ РАМКИ предмета на верх клетки пола (= видимая кромка плиты), а сам предмет
кончается на 3–10 px выше. На C, D, E, F, W, Y декор стоит ровно (замер — тот же
скрипт с --dry, docs/maps.md, «Правки 26.11»).

Что делает с каждой картой (пакет new-six не трогается — правило границы
CLAUDE.md; пишет рядом, в maps/new-six/decor-floor-2026-11-26/<ключ>/):
  1. decor.png и platforms.png пакета. Группы декора — связные области
     непрозрачных пикселей; полупрозрачная кайма (до 3 px) едет со своей группой.
     Соседние предметы не сшиваются: иначе крест прирос бы к мху на полу.
  2. Зазор группы — по НЕПРОЗРАЧНЫМ пикселям (альфа > 128): сколько строк от её
     низа до СВЕТЛОГО канта плиты под ней (верх альфы платформы + тусклые верхние
     строки, cap_rows; минимум по столбцам, искать не дальше MAX_GAP). По одной
     альфе зазор у крестов и урн 0 — они касаются тусклой верхней строки плиты,
     но на кладбище она того же тона, что фон, и глазу предмет висит. Висящей считается группа с зазором
     >= MIN_GAP, не касающаяся платформы сверху (не свисает с потолка).
     Группа, задетая зоной чистки (R.cleanup_zone: ловушки, сундуки, бочки),
     НЕ опускается: clean_trap_decor.py сотрёт её целиком, а опущенная она ушла
     бы низом в клетку пола, куда чистка не заходит, — на плите остались бы
     обрезки. Переставили ловушки (place_traps.py) — перезапустить этот скрипт.
  3. Висящая группа опускается целиком на свой зазор: пиксели снимаются со старого
     места и кладутся поверх (alpha-over) на новом — декор в пакете рисуется
     поверх платформ, низ ложится на кромку.
  4. Записи layout (decor-layout.json, added-layout.json) свечей и прочего, чья
     рамка внутри сдвинутой группы, получают тот же сдвиг по y — по ним
     build_map_art_new_six.mjs ищет фитили живого пламени.
  5. world-overlay.png = декор поверх платформ (тот же способ, что у пакета:
     сверено — у A и B пакетный world-overlay ровно decor over platforms).
  6. report.json (каждая группа: рамка, зазор) и превью до/после крупно.
Сборщик берёт рабочую копию (WORK_DECOR в build_map_art_new_six.mjs, закреплена
sha256), как decor-spikes-2026-10-28 у build_map_art.mjs.
"""
import json
import shutil
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

import trap_rules as R

ART = Path('D:/dev/right-place-art/maps')
PACK = ART / 'new-six/handoff-six-maps-2026-11-10'
OUT = ART / 'new-six/decor-floor-2026-11-26'
MAPS = {'A': 'burial-quarter', 'B': 'procession'}
# Только для отчёта (--all): все карты пакетов; правятся лишь MAPS — там тусклый
# верх плиты сливается с фоном (кладбище). Литейная: фон тёмный (яркость ~20–60
# под вуалью), тусклый верх плиты (~98) читается плитой; склеп: верх плиты светлый
# (~190); болото: поверх плиты трава.
ALL_MAPS = {**MAPS, 'C': 'casting-yards', 'D': 'workshops', 'E': 'three-halls', 'F': 'eastern-stair',
            'W': '../../swamp/new-two/handoff-2026-11/swamp-well', 'Y': '../../swamp/new-two/handoff-2026-11/swamp-yards'}
MIN_GAP = 2
MAX_GAP = 16
OPAQUE = 128


def rgba(p: Path) -> np.ndarray:
    return np.array(Image.open(p).convert('RGBA'))


def over(top: np.ndarray, bot: np.ndarray) -> np.ndarray:
    """Porter-Duff over, 8 бит, неассоциированная альфа."""
    ta = top[..., 3:4].astype(np.float64) / 255
    ba = bot[..., 3:4].astype(np.float64) / 255
    a = ta + ba * (1 - ta)
    c = (top[..., :3] * ta + bot[..., :3] * ba * (1 - ta)) / np.maximum(a, 1e-9)
    out = np.zeros_like(top)
    out[..., :3] = np.where(a > 0, np.round(c), 0).astype(np.uint8)
    out[..., 3:4] = np.round(a * 255).astype(np.uint8)
    return out


def groups_of(dec: np.ndarray):
    """Группы — связные области НЕПРОЗРАЧНЫХ пикселей (альфа > 128, 8-связность);
    полупрозрачная кайма (альфа 1..128) приписывается ближайшей группе не дальше
    3 px. Сшивать соседние предметы нельзя: крест сросся бы с полосой мха на полу,
    у которой зазор 0, и не сдвинулся бы."""
    core = dec[..., 3] > OPAQUE
    lab, n = ndimage.label(core, structure=np.ones((3, 3)))
    dist, (iy, ix) = ndimage.distance_transform_edt(~core, return_indices=True)
    near = (dec[..., 3] > 0) & (dist <= 3)
    lab = np.where(near, lab[iy, ix], 0)
    return lab, n


def cap_rows(plat: np.ndarray) -> np.ndarray:
    """Для каждого непрозрачного пикселя верхней кромки платформы — сколько строк
    вниз до СВЕТЛОГО канта плиты (первая строка, где яркость дошла до середины
    между верхней строкой и самой светлой в 10 строках). На кладбище верхние 2–4
    строки плиты тусклые (яркость 81–91) — того же тона, что туманный фон под
    вуалью, и глаз читает их как фон: видимая кромка — кант."""
    a = plat[..., 3] > OPAQUE
    lum = 0.3 * plat[..., 0] + 0.59 * plat[..., 1] + 0.11 * plat[..., 2]
    H = a.shape[0]
    out = np.zeros(a.shape, np.int16)
    top = a & ~np.vstack([np.zeros((1, a.shape[1]), bool), a[:-1]])
    for y, x in zip(*np.nonzero(top)):
        col = lum[y:min(H, y + 10), x]
        ok = a[y:min(H, y + 10), x]
        n = int(np.argmin(ok)) if not ok.all() else ok.size
        col = col[:max(1, n)]
        thr = col[0] + 0.5 * (col.max() - col[0])
        out[y, x] = int(np.argmax(col >= thr))
    return out


def gap_of(mask_op: np.ndarray, oy: int, ox: int, solid: np.ndarray, cap: np.ndarray) -> int | None:
    """Минимальный по столбцам зазор от низа непрозрачной части до светлого
    канта плиты под ней (верх альфы платформы + cap)."""
    H = solid.shape[0]
    best = None
    for cx in range(mask_op.shape[1]):
        col = np.flatnonzero(mask_op[:, cx])
        if col.size == 0:
            continue
        b = oy + col.max()
        x = ox + cx
        if solid[b, x]:
            return 0
        below = np.flatnonzero(solid[b + 1:min(H, b + 1 + MAX_GAP + 1), x])
        if below.size:
            t = b + 1 + int(below[0])
            g = int(t + int(cap[t, x]) - b - 1)
            best = g if best is None else min(best, g)
    return best


def touches_above(mask_any: np.ndarray, oy: int, ox: int, solid: np.ndarray) -> bool:
    for cx in range(mask_any.shape[1]):
        col = np.flatnonzero(mask_any[:, cx])
        if col.size == 0:
            continue
        t = oy + col.min()
        if t > 0 and solid[max(0, t - 2):t, ox + cx].any():
            return True
    return False


def process(letter: str, key: str, dry: bool) -> dict:
    src = PACK / key
    dec = rgba(src / 'decor.png')
    plat = rgba(src / 'platforms.png')
    wo = rgba(src / 'world-overlay.png')
    assert (over(dec, plat)[..., 3] == wo[..., 3]).all(), f'{letter}: world-overlay пакета — не decor over platforms'
    solid = plat[..., 3] > OPAQUE
    cap = cap_rows(plat)
    txt, slots_path = R.map_files(letter)
    zone = R.cleanup_zone(R.load_grid(txt), json.loads(slots_path.read_text(encoding='utf-8')))
    skipped_zone = 0
    lab, n = groups_of(dec)
    moved = []
    gaps_all = []
    shifts = np.zeros(n + 1, dtype=np.int32)
    for i, sl in enumerate(ndimage.find_objects(lab), 1):
        if sl is None:
            continue
        ys, xs = sl
        m_any = lab[sl] == i
        m_op = m_any & (dec[sl][..., 3] > OPAQUE)
        if m_op.sum() < 20:
            continue
        g = gap_of(m_op, ys.start, xs.start, solid, cap)
        if g is None:
            continue
        gaps_all.append(g)
        if g < MIN_GAP or touches_above(m_any, ys.start, xs.start, solid):
            continue
        if (zone[sl] & m_any).any():
            skipped_zone += 1
            continue
        shifts[i] = g
        moved.append({'x': xs.start, 'y': ys.start, 'w': xs.stop - xs.start, 'h': ys.stop - ys.start, 'gap': int(g)})
    objs = ndimage.find_objects(lab)

    def compose() -> np.ndarray:
        """Снять все сдвигаемые группы и положить на новые места (группы не
        пересекаются, на новом месте — alpha-over)."""
        layer = dec.copy()
        layer[shifts[lab] > 0] = 0
        for i in np.flatnonzero(shifts):
            ys_, xs_ = objs[i - 1]
            g_ = int(shifts[i])
            piece = np.zeros((ys_.stop - ys_.start, xs_.stop - xs_.start, 4), np.uint8)
            m = lab[ys_, xs_] == i
            piece[m] = dec[ys_, xs_][m]
            dst = layer[ys_.start + g_:ys_.stop + g_, xs_.start:xs_.stop]
            layer[ys_.start + g_:ys_.stop + g_, xs_.start:xs_.stop] = over(piece, dst)
        return layer

    # Проверка тем же правилом, что у чистки (clean_trap_decor.py): области
    # пустых клеток (R.components), задетые зоной, стираются целиком. Опущенная
    # группа, попавшая в такую область (срослась внизу с соседом из зоны),
    # возвращается на место — иначе чистка сотрёт её часть над полом, а низ в
    # клетке пола останется обрезком на плите. Повторять, пока есть такие.
    grid = R.load_grid(txt)
    reverted = 0
    while True:
        new = compose()
        world_try = over(new, plat)
        clabels, _n, fringe, opaque = R.components(world_try, grid, letter)
        hit = np.unique(clabels[zone & opaque & ~fringe])
        erased = np.isin(clabels, hit[hit > 0])
        back = []
        for i in np.flatnonzero(shifts):
            ys_, xs_ = objs[i - 1]
            g_ = int(shifts[i])
            m = lab[ys_, xs_] == i
            if (erased[ys_.start + g_:ys_.stop + g_, xs_.start:xs_.stop] & m).any():
                back.append(i)
        if not back:
            break
        for i in back:
            shifts[i] = 0
        reverted += len(back)
    moved = [m for m in moved if shifts[lab[m['y']:m['y'] + m['h'], m['x']:m['x'] + m['w']]].max() > 0]
    # Layout: записи, чья рамка внутри сдвинутой группы.
    layouts = {}
    for name in ('decor-layout.json', 'added-layout.json'):
        f = src / name
        if not f.exists():
            continue
        data = json.loads(f.read_text(encoding='utf-8'))
        nmoved = 0

        def walk(x):
            nonlocal nmoved
            if isinstance(x, list):
                for v in x:
                    walk(v)
            elif isinstance(x, dict):
                if isinstance(x.get('asset'), str) and all(k in x for k in ('x', 'y', 'width', 'height')):
                    cx = int(x['x'] + x['width'] / 2)
                    ys_ = range(int(x['y']), int(x['y'] + x['height']))
                    ids = [int(lab[y, cx]) for y in ys_ if 0 <= y < lab.shape[0] and 0 <= cx < lab.shape[1] and lab[y, cx] > 0]
                    s = max((int(shifts[i]) for i in ids), default=0)
                    if s:
                        x['y'] = x['y'] + s
                        nmoved += 1
                else:
                    for v in x.values():
                        walk(v)
        walk(data)
        layouts[name] = (data, nmoved)
    world = over(new, plat)
    g = np.array(gaps_all)
    rep = {
        'map': letter, 'key': key, 'items': int(g.size), 'meanGap': round(float(g.mean()), 2), 'maxGap': int(g.max()),
        'hanging': len(moved), 'skippedInCleanupZone': skipped_zone + reverted, 'hangingMeanGap': round(float(np.mean([m['gap'] for m in moved])), 2) if moved else 0,
        'layoutMoved': {k: v[1] for k, v in layouts.items()}, 'moved': moved,
    }
    if not dry:
        out = OUT / key
        out.mkdir(parents=True, exist_ok=True)
        Image.fromarray(new).save(out / 'decor.png')
        Image.fromarray(world).save(out / 'world-overlay.png')
        for name, (data, _) in layouts.items():
            (out / name).write_text(json.dumps(data, ensure_ascii=False), encoding='utf-8')
        (out / 'report.json').write_text(json.dumps(rep, ensure_ascii=False, indent=1), encoding='utf-8')
        # Превью: каждая сдвинутая группа крупно, слева пакет, справа рабочая копия.
        prev = out / 'previews'
        if prev.exists():
            shutil.rmtree(prev)
        prev.mkdir()
        for k, m in enumerate(moved):
            x0, y0 = max(0, m['x'] - 24), max(0, m['y'] - 16)
            x1, y1 = min(wo.shape[1], m['x'] + m['w'] + 24), min(wo.shape[0], m['y'] + m['h'] + 40)
            bg = np.zeros((y1 - y0, x1 - x0, 4), np.uint8)
            bg[...] = (70, 74, 82, 255)
            a = over(wo[y0:y1, x0:x1], bg)
            b = over(world[y0:y1, x0:x1], bg)
            pair = np.concatenate([a, np.full((y1 - y0, 4, 4), 255, np.uint8), b], axis=1)
            Image.fromarray(pair).resize((pair.shape[1] * 3, pair.shape[0] * 3), Image.NEAREST).save(prev / f'{k:03d}_gap{m["gap"]}.png')
    return rep


def main() -> None:
    dry = '--dry' in sys.argv or '--all' in sys.argv
    for letter, key in (ALL_MAPS if '--all' in sys.argv else MAPS).items():
        r = process(letter, key, dry)
        print(f"{letter} {key}: предметов на полу {r['items']}, зазор средний {r['meanGap']} max {r['maxGap']} px мира; "
              f"опущено (>= {MIN_GAP}) {r['hanging']}, средний {r['hangingMeanGap']}; в зонах чистки не тронуто {r['skippedInCleanupZone']}; записей layout сдвинуто {r['layoutMoved']}")


if __name__ == '__main__':
    main()
