"""Глухая стена за краем карты (31.10.2026, entities/mapEdges.ts) — из настоящих
частей кладки каждой карты.

    python tools/build_map_walls.py            собрать и записать в public/
    python tools/build_map_walls.py --check    собрать и только сверить с файлами

ЧТО СОБИРАЕТ. Для каждой карты — две картинки, слева и справа: как если бы в .txt
карты слева и справа добавили по 12 столбцов «#» во всю высоту карты. Каждая
стена собирается ТЕМИ ЖЕ частями и ТЕМ ЖЕ способом, что сплошные массы своей
карты в архиве арта (D:\\dev\\right-place-art, переменная RIGHT_PLACE_ART):

- склеп (B, D_OPEN, D_SEALED) — texture() из build-seam-map-b.py: части
  body-1..4 из stage-07-solid-samples, швы по минимальной цене; затенение
  глубины по вертикальному пролёту, как в build-map-D.py (1 → 0.77 сверху вниз);
- литейная (C, E) — texture() и strip() из approved_v1/detail-set/build-samples.py
  (части body-1..4, полосы tie через 192 px с 128-го, cornice по верху пролёта);
  у E ещё затенение тела 1 → 0.86 и fascia-1 на вертикальной грани там, где
  соседняя клетка карты не «#» (правило build-maps-CE.py); у C край карты —
  своя сплошная стена шириной в клетку, стыка с воздухом нет;
- болото (B2, C2) — quilt() из approved-platforms-v1/build-samples.py по четырём
  участкам тела листа частей; у сплошной толщи кромок нет (кромки — только над и
  под воздухом);
- кладбище (A, F) — панельная стена одобренного способа (build-f-panel-walls.cjs,
  им же сделано основание A v4): панель 128×80 с шагом 124 × 76 и нахлёстом 4 px,
  полосы перил через 192 px с 128-го, голова черепной колонны на внешней грани
  наверху; части — f-panel-wall-study (вырезаны из одобренной F v3).

Отражения и затемнения сверх собственного способа карты нет. Высота стены —
высота карты, ширина — 12 клеток (768 px, MAP_EDGE_EXTEND_PX).

Архив скрипт только ЧИТАЕТ; функции берутся из его скриптов разбором текста
(ast), без запуска самих скриптов. Все входные файлы архива закреплены общим
sha256 (INPUTS_SHA256): архив поменяли — скрипт остановится; поменяли нарочно —
обновить число по его сообщению.

Нужны numpy и Pillow (как скриптам архива). У системного Python numpy нет —
запускать Python из рантайма Codex:
  %USERPROFILE%/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe tools/build_map_walls.py
"""
import ast
import hashlib
import io
import os
import random
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
ART = Path(os.environ.get('RIGHT_PLACE_ART', 'D:/dev/right-place-art')) / 'maps'
MAPS = ROOT / 'public' / 'assets' / 'maps'
OUT = MAPS / 'art' / 'walls'
TILE = 64
COLS = 12
WALL_W = COLS * TILE
LAYER_MAX = 1_500_000  # потолок файла, как у слоёв карт (build_map_art.mjs)
INPUTS_SHA256 = '607ef9591bdd2dedab51b400fce5cc975050adbe7c32705230469a071c3a1628'

PINNED = {}


def pinned(path: Path) -> Path:
    data = path.read_bytes()
    PINNED[path.relative_to(ART).as_posix()] = hashlib.sha256(data).hexdigest()
    return path


def functions(script: Path, names, env):
    """Определения функций из скрипта архива — без исполнения остального текста."""
    src = pinned(script).read_text(encoding='utf-8-sig')
    tree = ast.parse(src)
    body = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in names]
    if {n.name for n in body} != set(names):
        raise SystemExit(f'{script}: нет функций {set(names) - {n.name for n in body}}')
    exec(compile(ast.Module(body=body, type_ignores=[]), str(script), 'exec'), env)
    return env


def grid(name):
    rows = [r.rstrip('\r') for r in (MAPS / f'{name}.txt').read_text(encoding='utf-8').split('\n') if r.rstrip('\r')]
    return rows


# --- Склеп ---

def crypt_env():
    R = ART / 'crypt'
    parts = {p.stem: Image.open(pinned(p)).convert('RGBA') for p in sorted((R / 'stage-07-solid-samples/parts').glob('*.png'))}
    env = {'np': np, 'random': random, 'Image': Image, 'parts': parts, 'stats': []}
    return functions(R / 'build-seam-map-b.py', ['lum', 'path', 'combine', 'texture'], env)


def crypt_wall(env, rows, side, seed):
    h = len(rows) * TILE
    a = np.array(env['texture'](WALL_W, h, seed)).astype(np.float32)
    # Один вертикальный пролёт «#» во всю высоту — затенение глубины build-map-D.py.
    f = 1 - .23 * np.arange(h) / h
    a[:, :, :3] *= f[:, None, None]
    a[:, :, 3] = 255
    return Image.fromarray(a.astype('uint8'))


# --- Литейная ---

def foundry_env():
    R = ART / 'abbey'
    parts = {p.stem: Image.open(pinned(p)).convert('RGBA') for p in sorted((R / 'approved_v1/detail-set/parts').glob('*.png'))}
    env = {'np': np, 'random': random, 'Image': Image, 'parts': parts, 'seams': []}
    return functions(R / 'approved_v1/detail-set/build-samples.py', ['path', 'texture', 'strip'], env)


def foundry_wall(env, rows, side, seed, map_id):
    parts = env['parts']
    h = len(rows) * TILE
    body = env['texture'](WALL_W, h, seed)
    # Начало тела, от которого идут затенение и полосы tie: у E — верх его
    # сплошной массы (ряд 11, build-maps-CE.py), чтобы стена продолжала её
    # полосы; у C — верх карты (пролёт во всю высоту, как тело x42).
    start = 11 * TILE if map_id == 'E' else 0
    if map_id == 'E':
        a = np.array(body)
        fade = np.ones(h, dtype=np.float32)
        fade[start:] = np.linspace(1, .86, h - start, dtype=np.float32)
        a[:, :, :3] = (a[:, :, :3] * fade[:, None, None]).astype('uint8')
        body = Image.fromarray(a)
    for y in range(start + 128 - 192 * ((start + 128) // 192), h, 192):
        env['strip'](body, parts['tie'], y)
    # Верх пролёта — у верхнего края карты (y == 0 правило caprun считает открытым).
    cap = Image.new('RGBA', (WALL_W, 21))
    env['strip'](cap, parts['cornice'], 0)
    body.alpha_composite(cap, (0, 0))
    if map_id == 'E':
        # fascia-1 на грани, обращённой к карте, — у клеток, где соседняя клетка карты не «#».
        edge_col = 0 if side == 'L' else len(rows[0]) - 1
        for y, row in enumerate(rows):
            if row[edge_col] == '#':
                continue
            if side == 'L':
                body.alpha_composite(parts['fascia-1'].crop((57, 0, 64, 64)), (WALL_W - 7, y * TILE))
            else:
                body.alpha_composite(parts['fascia-1'].crop((0, 0, 7, 64)), (0, y * TILE))
    a = np.array(body)
    a[:, :, 3] = 255
    return Image.fromarray(a)


# --- Болото ---

def swamp_env():
    R = ART / 'swamp/approved-platforms-v1'
    raw = Image.open(pinned(R / 'source-sheet/parts-sheet-native.png')).convert('RGB')
    bodies = [raw.crop(box) for box in [(28, 306, 380, 690), (408, 306, 750, 690), (780, 306, 1134, 690), (1160, 306, 1508, 690)]]
    env = {'np': np, 'Image': Image, 'bodies': bodies}
    return functions(R / 'build-samples.py', ['cutpath', 'quilt'], env)


def swamp_wall(env, rows, side, seed):
    return env['quilt'](WALL_W, len(rows) * TILE, seed)


# --- Кладбище ---

def graveyard_env():
    P = ART / 'graveyard/work/f-panel-wall-study'
    return {
        'panel': Image.open(pinned(P / 'approved-panel.png')).convert('RGBA'),
        'head': Image.open(pinned(P / 'approved-skull-column.png')).convert('RGBA'),
        'rail': Image.open(pinned(P / 'approved-rail.png')).convert('RGBA'),
    }


def graveyard_wall(env, rows, side, seed):
    panel, head, rail = env['panel'], env['head'], env['rail']
    h = len(rows) * TILE
    out = Image.new('RGBA', (WALL_W, h), (0x6a, 0x64, 0x55, 255))
    # Панели во всю высоту, нахлёст 4 px с мягким краем — build-f-panel-walls.cjs.
    for y in range(0, h, 76):
        for x in range(0, WALL_W, 124):
            ww, hh = min(128, WALL_W - x), min(80, h - y)
            p = np.array(panel.crop((0, 0, ww, hh)))
            fy = np.minimum(1, np.arange(hh) / 4) if y > 0 else np.ones(hh)
            fx = np.minimum(1, np.arange(ww) / 4) if x > 0 else np.ones(ww)
            p[:, :, 3] = np.round(255 * np.minimum(fy[:, None], fx[None, :])).astype('uint8')
            out.alpha_composite(Image.fromarray(p), (x, y))
    # Голова черепной колонны — на внешней грани (обращённой к карте), наверху тела.
    out.alpha_composite(head, (WALL_W - 60 if side == 'L' else 0, 0))
    for y in range(128, h, 192):
        for x in range(0, WALL_W, 124):
            out.alpha_composite(rail.crop((0, 0, min(128, WALL_W - x), 8)), (x, y))
    a = np.array(out)
    a[:, :, 3] = 255
    return Image.fromarray(a)


MAPS_TABLE = [
    # имя карты, тема, сид левой и правой стены
    ('map_A_serpentine', 'graveyard', 0, 0),
    ('map_F_sanctuary', 'graveyard', 0, 0),
    ('map_B_razlom', 'crypt', 501, 502),
    ('map_D_OPEN', 'crypt', 511, 512),
    ('map_D_SEALED', 'crypt', 511, 512),
    ('map_C_boss_descent', 'foundry', 521, 522),
    ('map_E_towers', 'foundry', 531, 532),
    ('map_B2_swamp', 'swamp', 541, 542),
    ('map_C2_swamp_boss', 'swamp', 551, 552),
]


def encode(img):
    for q in (90, 86, 82, 78):
        buf = io.BytesIO()
        img.convert('RGB').save(buf, 'WEBP', quality=q, method=6)
        if buf.tell() <= LAYER_MAX:
            return buf.getvalue(), q
    raise SystemExit('стена не влезает в потолок файла')


def main():
    check = '--check' in sys.argv
    envs = {}
    bad = 0
    OUT.mkdir(parents=True, exist_ok=True)
    for name, theme, seed_l, seed_r in MAPS_TABLE:
        rows = grid(name)
        if theme not in envs:
            envs[theme] = {'crypt': crypt_env, 'foundry': foundry_env, 'swamp': swamp_env, 'graveyard': graveyard_env}[theme]()
        env = envs[theme]
        for side, seed in (('L', seed_l), ('R', seed_r)):
            if theme == 'crypt':
                img = crypt_wall(env, rows, side, seed)
            elif theme == 'foundry':
                img = foundry_wall(env, rows, side, seed, 'C' if name.startswith('map_C_') else 'E')
            elif theme == 'swamp':
                img = swamp_wall(env, rows, side, seed)
            else:
                img = graveyard_wall(env, rows, side, seed)
            assert img.size == (WALL_W, len(rows) * TILE), (name, img.size)
            data, q = encode(img)
            path = OUT / f'{name}_{side}.webp'
            if check:
                same = path.exists() and path.read_bytes() == data
                bad += 0 if same else 1
                print(f'{path.name}: {"совпадает" if same else "РАСХОДИТСЯ"}')
            else:
                path.write_bytes(data)
                print(f'{path.name}: {img.size[0]}x{img.size[1]}, q{q}, {len(data)} байт')
    inputs = hashlib.sha256('\n'.join(f'{k} {v}' for k, v in sorted(PINNED.items())).encode()).hexdigest()
    if inputs != INPUTS_SHA256:
        print(f'входы архива не те: sha256 {inputs}, ожидался {INPUTS_SHA256} ({len(PINNED)} файлов)')
        bad += 1
    sys.exit(1 if bad else 0)


main()
