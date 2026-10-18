#!/usr/bin/env python3
"""Красная копия листа эффекта переносом цвета (docs/classes.md, «Визуал»).

Делает красные копии двух листов под классы, без новой генерации:
    public/assets/skills/Heal_Aura.png        -> Heal_Aura_Red.png    (лечение Упыря)
    public/assets/sprites/hero/parry_spark.png -> parry_spark_Red.png (крит)
Копия ложится рядом с оригиналом.

Перенос цвета — в HSV, по каждому пикселю:
    тон          -> красный (RED_HUE);
    насыщенность -> S + (255 - S) * lift — поднимается на долю lift от того,
                    что ей не хватает до полной. Без подъёма почти белые части
                    (частицы ауры, горячее ядро искры) остались бы белыми, и
                    копия не читалась бы красной; с ним белое становится
                    розовато-красным, а уже насыщенное — чисто красным;
    яркость (V)  -> как была;
    альфа        -> как была, БАЙТ В БАЙТ. Отсюда и раскладка кадров та же:
                    силуэт каждого кадра, его место в клетке и прозрачные
                    клетки не меняются ничем. Скрипт это проверяет сам.
Пиксели с альфой 0 не трогаются вовсе (RGB под ними остаётся оригинальным).

Сила подъёма своя у каждого листа: аура рисуется обычным наложением и почти
вся белёсая, искра — аддитивным (Explore.tsx, spark.blendMode = 'add'), и
слишком насыщенная выглядела бы на тёмном фоне тусклой, а не горячей.

Только Pillow (numpy в окружении нет). Запуск из корня репозитория:
    python tools/recolor_red.py            сделать обе копии
    python tools/recolor_red.py --check    только сверить, что копии на диске
                                           совпадают с тем, что дал бы скрипт
"""

import hashlib
import sys
from pathlib import Path

from PIL import Image

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parent.parent

# Тон в шкале Pillow (0..255 на весь круг). 0 — чистый красный.
RED_HUE = 0

# (оригинал, копия, lift)
SHEETS = [
    ("public/assets/skills/Heal_Aura.png", "public/assets/skills/Heal_Aura_Red.png", 0.55),
    ("public/assets/sprites/hero/parry_spark.png", "public/assets/sprites/hero/parry_spark_Red.png", 0.45),
]


def recolor(src: Image.Image, lift: float) -> Image.Image:
    """Красная копия RGBA-листа: тон в красный, насыщенность с подъёмом, V и альфа как были."""
    rgba = src.convert("RGBA")
    alpha = rgba.getchannel("A")
    _, s, v = rgba.convert("RGB").convert("HSV").split()
    h = Image.new("L", rgba.size, RED_HUE)
    s = s.point(lambda x: round(x + (255 - x) * lift))
    red = Image.merge("HSV", (h, s, v)).convert("RGB")
    red.putalpha(alpha)
    # Под альфой 0 — оригинальные байты: такие пиксели не видны, и менять их незачем.
    visible = alpha.point(lambda a: 255 if a > 0 else 0)
    return Image.composite(red, rgba, visible)


def png_bytes_hash(im: Image.Image) -> str:
    return hashlib.sha256(im.tobytes()).hexdigest()


def main() -> int:
    check = "--check" in sys.argv[1:]
    ok = True
    for src_rel, dst_rel, lift in SHEETS:
        src_path, dst_path = ROOT / src_rel, ROOT / dst_rel
        src = Image.open(src_path)
        out = recolor(src, lift)
        # Раскладка кадров та же: размер и альфа совпадают байт в байт.
        if out.size != src.size or out.getchannel("A").tobytes() != src.convert("RGBA").getchannel("A").tobytes():
            print(f"{dst_rel}: АЛЬФА ИЛИ РАЗМЕР РАЗОШЛИСЬ с оригиналом — не записано")
            ok = False
            continue
        if check:
            if not dst_path.is_file():
                print(f"{dst_rel}: НЕТ ФАЙЛА")
                ok = False
            elif png_bytes_hash(Image.open(dst_path).convert("RGBA")) != png_bytes_hash(out):
                print(f"{dst_rel}: РАСХОДИТСЯ с тем, что даёт скрипт")
                ok = False
            else:
                print(f"{dst_rel}: совпадает (lift {lift}).")
            continue
        out.save(dst_path, optimize=True)
        print(f"{dst_rel}: записано, {out.size[0]}x{out.size[1]}, lift {lift}, альфа = оригиналу.")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
