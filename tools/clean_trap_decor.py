"""Чистка декора в зонах ловушек (14.11.2026) — шаг сборки слоёв карт.

    python tools/clean_trap_decor.py              все карты
    python tools/clean_trap_decor.py A W          выбранные
    python tools/clean_trap_decor.py --no-previews

Запускать ПОСЛЕ сборки слоёв (build_map_art_new_six.mjs, build_map_art.mjs) и
после place_traps.py. Повторяемый: чистит всегда из НЕТРОНУТОГО слоя.

Нетронутые слои лежат в D:\\dev\\right-place-art\\game-export\\trap-clean\\pristine\\
(рабочая папка Claude Code, не архив арта — архив не меняется). Как скрипт
понимает, что слой в public свежесобранный: в state.json записан sha256 каждой
части после чистки; не совпал (сборщик переписал файл, или первый запуск) —
файл копируется в pristine как новый нетронутый.

Что делает с каждой картой:
  1. Зоны ВСЕХ ловушек всех пулов слот-файла (hazard, gargoyles + плита,
     stalactites, saws; trap_rules.zone_cells), только ПУСТЫЕ клетки ('#' и '='
     не трогаются — платформы остаются как есть).
  2. Связные области непрозрачных пикселей слоя (альфа > 0, 8-связность) в
     пустых клетках; каждая область, задетая зоной хоть одним пикселем, стирается
     ЦЕЛИКОМ (альфа и цвет в 0) — без половинок предметов. На болоте (B2, C2, W,
     Y) нижние SWAMP_GRASS_PX пикселей клетки над полом — кромка травы, её не
     трогаем и в области её не включаем.
  3. Живой декор, чьи предметы стёрты или чей прямоугольник лежит в зоне:
     пламя свечей и ниши (liveDecorManifest.ts), качающиеся стебли (sway
     манифеста слоя), цепи (chainSway.ts, CHAINS) — пишет в
     src/explore/trapDecorCleared.ts; игра их не создаёт.
  4. Кодирует части заново (tools/encode_webp_ladder.mjs — ступени сборщиков) в
     те же файлы public/assets/maps/art/; манифесты слоёв не меняются.
  5. Превью: D:\\dev\\right-place-art\\audits\\traps-2026-11-13-fix\\ (PNG) и
     уменьшенные JPG в docs/audits/traps-2026-11-13-fix/ — зум на каждую
     ловушку: слева нетронутый слой, справа очищенный со спрайтом ловушки.
"""
import hashlib
import json
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

sys.path.insert(0, str(Path(__file__).resolve().parent))
import trap_rules as R  # noqa: E402

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

WORK = Path(r'D:\dev\right-place-art\game-export\trap-clean')
PRISTINE = WORK / 'pristine'
STATE = WORK / 'state.json'
AUDIT = Path(r'D:\dev\right-place-art\audits\traps-2026-11-13-fix')
DOCS_AUDIT = R.ROOT / 'docs' / 'audits' / 'traps-2026-11-13-fix'
CLEARED_TS = R.ROOT / 'src' / 'explore' / 'trapDecorCleared.ts'
ENCODER = R.ROOT / 'tools' / 'encode_webp_ladder.mjs'
T = R.TS


def sha(p):
    return hashlib.sha256(Path(p).read_bytes()).hexdigest()


def chains_of(txt_name):
    p = R.ROOT / 'src' / 'explore' / 'entities' / 'chainSway.ts'
    if not p.exists():
        return []
    m = re.search(r"'" + re.escape(txt_name) + r"': \[(.*?)\]", p.read_text(encoding='utf-8'), re.S)
    if not m:
        return []
    return [(float(x), float(y), float(ln)) for x, y, ln in re.findall(r"x: (-?[\d.]+), y: (-?[\d.]+), length: ([\d.]+)", m.group(1))]


def rect_hits(mask, x, y, w, h):
    H, W = mask.shape
    a, b = max(0, int(x)), min(W, int(np.ceil(x + w)))
    c, d = max(0, int(y)), min(H, int(np.ceil(y + h)))
    return a < b and c < d and bool(mask[c:d, a:b].any())


def clean_map(letter, state, previews):
    txt, slots_path = R.map_files(letter)
    grid = R.load_grid(txt)
    slots = json.loads(slots_path.read_text(encoding='utf-8'))
    H, W = len(grid), len(grid[0])
    slices = R.slices_of(txt)
    PRISTINE.mkdir(parents=True, exist_ok=True)
    for f, _x, _w in slices:
        pub = R.ART / f
        if state.get(f) != sha(pub):
            shutil.copyfile(pub, PRISTINE / f)
    rgba = R.layer_rgba(txt, grid, art_dir=PRISTINE)
    pristine = rgba.copy()

    empty = np.array([[grid[y][x] not in '#=' for x in range(W)] for y in range(H)])
    empty_px = np.repeat(np.repeat(empty, T, 0), T, 1)
    band = R.grass_band(grid, letter)
    opaque = (rgba[:, :, 3] > 0) & empty_px & ~band
    labels, n = ndimage.label(opaque, structure=np.ones((3, 3), bool))

    traps = R.all_traps(slots)
    zone = np.zeros((H * T, W * T), bool)
    for k, t in traps:
        for cx, cy in R.zone_cells(k, t):
            if 0 <= cy < H and 0 <= cx < W and grid[cy][cx] not in '#=':
                zone[cy * T:(cy + 1) * T, cx * T:(cx + 1) * T] = True
    hit = np.unique(labels[zone & opaque])
    hit = hit[hit > 0]
    removed = np.isin(labels, hit)
    rgba[removed] = 0
    # Крупные области (шире 4 клеток или выше 3) — в отчёт: стёрто больше зоны.
    big = []
    for i, sl in enumerate(ndimage.find_objects(labels), start=1):
        if sl is None or i not in set(hit.tolist()):
            continue
        hh, ww = sl[0].stop - sl[0].start, sl[1].stop - sl[1].start
        if ww > 4 * T or hh > 3 * T:
            big.append((sl[1].start // T, sl[0].start // T, ww, hh))

    # Живой декор.
    cleared = {'flames': [], 'sway': [], 'chains': []}
    for f in R.flame_points(txt):
        fx, fy, fw, fh = f
        if rect_hits(zone, *R.flame_rect(f)) or rect_hits(removed, fx - fw, fy, 2 * fw, 10):
            cleared['flames'].append([fx, fy])
    for (x, y, w, h) in R.sway_items(txt):
        if rect_hits(zone, x, y, w, h):
            cleared['sway'].append([x, y])
    for (x, y, ln) in chains_of(txt.name):
        if rect_hits(zone, x - 8, y, 16, ln):
            cleared['chains'].append([x, y])

    # Части слоя заново.
    sizes = []
    with tempfile.TemporaryDirectory() as td:
        for f, x, w in slices:
            x, w = int(x), int(w)
            part = rgba[:, x:x + w]
            if np.array_equal(part, pristine[:, x:x + w]):
                shutil.copyfile(PRISTINE / f, R.ART / f)
                sizes.append((f, 'нетронута', (R.ART / f).stat().st_size))
            else:
                png = Path(td) / 'part.png'
                Image.fromarray(part, 'RGBA').save(png)
                r = subprocess.run(['node', str(ENCODER), str(png), str(R.ART / f)], capture_output=True, text=True, encoding='utf-8')
                if r.returncode != 0:
                    raise SystemExit(f'{letter}: {f}: {r.stderr}')
                info = json.loads(r.stdout.strip().splitlines()[-1])
                sizes.append((f, info['label'], info['bytes']))
            state[f] = sha(R.ART / f)

    if previews:
        make_previews(letter, txt, grid, traps, pristine, rgba)
    return {'letter': letter, 'items': int(len(hit)), 'px': int(removed.sum()), 'big': big, 'cleared': cleared, 'sizes': sizes}


def make_previews(letter, txt, grid, traps, pristine, cleaned):
    import place_traps as P
    AUDIT.mkdir(parents=True, exist_ok=True)
    DOCS_AUDIT.mkdir(parents=True, exist_ok=True)
    art = P.traps_art()
    H, W = pristine.shape[:2]
    bg = (34, 30, 40, 255)

    def on_bg(a):
        im = Image.new('RGBA', (a.shape[1], a.shape[0]), bg)
        im.alpha_composite(Image.fromarray(a, 'RGBA'))
        return im
    full_before = on_bg(pristine)
    full_after = on_bg(cleaned)
    with_traps = full_after.copy()
    for k, t in traps:
        P.draw_trap(with_traps, k, t, art)
    sc = min(1.0, 1600 / W)
    all_img = with_traps.convert('RGB').resize((int(W * sc), int(H * sc)))
    all_img.save(AUDIT / f'{letter}_all.png')
    small = all_img.resize((int(all_img.width * 900 / all_img.width), int(all_img.height * 900 / all_img.width)))
    small.save(DOCS_AUDIT / f'{letter}_all.jpg', quality=70)
    colors = {'hazard': (255, 60, 60), 'gargoyles': (255, 160, 0), 'stalactites': (90, 200, 255), 'saws': (200, 90, 255)}
    n = {}
    for k, t in traps:
        n[k] = n.get(k, 0) + 1
        cells = R.zone_cells(k, t)
        x0 = max(0, (min(c[0] for c in cells) - 2) * T)
        x1 = min(W, (max(c[0] for c in cells) + 3) * T)
        y0 = max(0, (min(c[1] for c in cells) - 2) * T)
        y1 = min(H, (max(c[1] for c in cells) + 3) * T)
        before = full_before.crop((x0, y0, x1, y1))
        d = ImageDraw.Draw(before)
        for cx, cy in cells:
            d.rectangle([cx * T - x0, cy * T - y0, cx * T - x0 + T - 1, cy * T - y0 + T - 1], outline=colors[k], width=2)
        after = with_traps.crop((x0, y0, x1, y1))
        both = Image.new('RGB', (before.width * 2 + 6, before.height), (0, 0, 0))
        both.paste(before.convert('RGB'), (0, 0))
        both.paste(after.convert('RGB'), (before.width + 6, 0))
        name = f'{letter}_{k}_{n[k]}'
        both.save(AUDIT / f'{name}.png')
        sm = both if both.width <= 520 else both.resize((520, int(both.height * 520 / both.width)))
        sm.save(DOCS_AUDIT / f'{name}.jpg', quality=62)


def write_cleared(results):
    def block(kind):
        rows = []
        for r in results:
            pts = r['cleared'][kind]
            if pts:
                txt = R.map_files(r['letter'])[0].name
                rows.append(f"  '{txt}': [" + ', '.join(f'[{x:g}, {y:g}]' for x, y in pts) + '],')
        return '\n'.join(rows)
    old = {}
    if CLEARED_TS.exists():
        # Карты, которых в этом запуске нет, — сохраняем их строки.
        t = CLEARED_TS.read_text(encoding='utf-8')
        for key in ('CLEARED_FLAMES', 'CLEARED_SWAY', 'CLEARED_CHAINS'):
            m = re.search(key + r".*?= \{\n(.*?)\n?\}", t, re.S)
            old[key] = {ln.split("'")[1]: ln for ln in (m.group(1).splitlines() if m else []) if "'" in ln}
    done = {R.map_files(r['letter'])[0].name for r in results}
    out = ['// СГЕНЕРИРОВАНО tools/clean_trap_decor.py — руками не править.',
           '//',
           '// Живой декор, стёртый чисткой зон ловушек (14.11.2026): его предмет стёрт из',
           '// слоя карты или лежит в зоне ловушки. Explore.tsx этих точек не создаёт.',
           '// Ключ — файл карты, точка — [x, y] из соответствующего манифеста.',
           '']
    for key, kind, typ in (('CLEARED_FLAMES', 'flames', 'liveDecorManifest.ts'), ('CLEARED_SWAY', 'sway', 'sway манифеста слоя'), ('CLEARED_CHAINS', 'chains', 'CHAINS, chainSway.ts')):
        lines = [ln for name, ln in old.get(key, {}).items() if name not in done]
        new = block(kind)
        body = '\n'.join(lines + ([new] if new else []))
        out.append(f'/** {typ} */')
        out.append(f'export const {key}: Record<string, [number, number][]> = {{')
        if body:
            out.append(body)
        out.append('}')
        out.append('')
    CLEARED_TS.write_text('\n'.join(out), encoding='utf-8')


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    previews = '--no-previews' not in sys.argv
    letters = args or sorted({p.name.split('_')[1] for p in R.MAPS.glob('map_*_slots.json')})
    state = json.loads(STATE.read_text(encoding='utf-8')) if STATE.exists() else {}
    results = []
    for letter in letters:
        r = clean_map(letter, state, previews)
        results.append(r)
        STATE.write_text(json.dumps(state, indent=1), encoding='utf-8')
        print(f"== {letter}: стёрто предметов {r['items']} ({r['px']} px); живой декор: пламя {len(r['cleared']['flames'])}, "
              f"стебли {len(r['cleared']['sway'])}, цепи {len(r['cleared']['chains'])}")
        for b in r['big']:
            print(f'   крупная область: клетка {b[:2]}, {b[2]}×{b[3]} px')
        for f, label, size in r['sizes']:
            print(f'   {f}: {label}, {size / 1e6:.2f} МБ')
    write_cleared(results)


if __name__ == '__main__':
    main()
