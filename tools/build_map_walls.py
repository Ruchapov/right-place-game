"""Плитки глухой стены за краем карты (31.10.2026, entities/mapEdges.ts).

В низком горизонтальном экране у камеры есть боковые поля: за левым и правым
краем карты видно мир, которого нет. Там рисуется глухая стена — плитка
сплошного камня карты, повторённая по всему полю.

Скрипт вырезает из готового слоя карты (public/assets/maps/art/) участок
сплошного камня — внутри толщи стен, без верхней кромки, декора и проёмов — и
складывает из него бесшовную плитку зеркалом 2×2 (участок, он же отражённый по
горизонтали, по вертикали и по обеим осям). Пишет
public/assets/maps/art/walls/<имя карты>.webp. Игра берёт файл по имени карты
(mapArt.ts, wallFor).

Участки подобраны глазом по кадрам слоя (сессия 31.10.2026):
- склеп (B, D_OPEN, D_SEALED), литейная (C, E), болото (B2, C2) — свой камень
  каждой карты, из её же толщи;
- кладбище (A, F): толща стен там — фриз с арками, фигурами и колоннами, ровного
  камня нет ни на A, ни в толще F; взят плитняк массива в правом нижнем углу F
  (блок плитняка у левого края массива, без пилястр), он же и для A — та же тема и тот же арт.

--check — только сверить файлы на диске с тем, что даёт скрипт.
Запуск из корня репозитория: python tools/build_map_walls.py [--check]
"""
import io
import sys
from pathlib import Path

from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parent.parent
ART = ROOT / 'public' / 'assets' / 'maps' / 'art'
OUT = ART / 'walls'

# Части слоя слева направо (как slices манифеста).
LAYERS = {
    'A': ['map_A_serpentine.webp'],
    'F': ['map_F_sanctuary.webp'],
    'B': ['map_B_razlom.webp'],
    'D_OPEN': ['map_D_OPEN.webp'],
    'D_SEALED': ['map_D_SEALED.webp'],
    'E': ['map_E_towers.webp'],
    'C': ['map_C_boss_descent.webp'],
    'B2': ['map_B2_swamp_1.webp', 'map_B2_swamp_2.webp', 'map_B2_swamp_3.webp'],
    'C2': [f'map_C2_swamp_boss_{i}.webp' for i in range(1, 6)],
}

# Имя файла стены -> (слой-источник, x, y, ширина, высота) в px мира.
WALLS = {
    'map_A_serpentine': ('F', 2886, 1180, 32, 190),
    'map_F_sanctuary': ('F', 2886, 1180, 32, 190),
    'map_B_razlom': ('B', 2656, 704, 320, 256),
    'map_D_OPEN': ('D_OPEN', 2592, 1408, 320, 256),
    'map_D_SEALED': ('D_SEALED', 2592, 1408, 320, 256),
    'map_E_towers': ('E', 2496, 1152, 320, 256),
    'map_C_boss_descent': ('C', 640, 1560, 320, 100),
    'map_B2_swamp': ('B2', 2240, 2560, 320, 256),
    'map_C2_swamp_boss': ('C2', 5568, 1984, 320, 256),
}


def layer(key):
    parts = [Image.open(ART / f).convert('RGBA') for f in LAYERS[key]]
    out = Image.new('RGBA', (sum(p.width for p in parts), parts[0].height))
    x = 0
    for p in parts:
        out.paste(p, (x, 0))
        x += p.width
    return out


def build(src, x, y, w, h):
    patch = src.crop((x, y, x + w, y + h))
    alpha_min = patch.getchannel('A').getextrema()[0]
    if alpha_min < 255:
        raise SystemExit(f'участок {x},{y} {w}x{h}: есть прозрачные пиксели (альфа {alpha_min}) — это не сплошной камень')
    patch = patch.convert('RGB')
    tile = Image.new('RGB', (w * 2, h * 2))
    tile.paste(patch, (0, 0))
    tile.paste(ImageOps.mirror(patch), (w, 0))
    tile.paste(ImageOps.flip(patch), (0, h))
    tile.paste(ImageOps.flip(ImageOps.mirror(patch)), (w, h))
    buf = io.BytesIO()
    tile.save(buf, 'WEBP', quality=88, method=6)
    return buf.getvalue()


def main():
    check = '--check' in sys.argv
    layers = {}
    bad = 0
    OUT.mkdir(exist_ok=True)
    for name, (key, x, y, w, h) in WALLS.items():
        if key not in layers:
            layers[key] = layer(key)
        data = build(layers[key], x, y, w, h)
        path = OUT / f'{name}.webp'
        if check:
            same = path.exists() and path.read_bytes() == data
            print(f'{name}: {"совпадает" if same else "РАСХОДИТСЯ"}')
            bad += 0 if same else 1
        else:
            path.write_bytes(data)
            print(f'{name}: {w * 2}x{h * 2}, {len(data)} байт')
    sys.exit(1 if bad else 0)


main()
