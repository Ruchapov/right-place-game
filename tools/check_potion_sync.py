#!/usr/bin/env python3
"""Сверка общих каталогов между клиентом и сервером.

Пары (источник → копия):
    src/potions.ts      → server/src/potions.ts
    src/consumables.ts  → server/src/consumables.ts

Общего пакета в проекте нет (tsconfig.app.json включает только "src", у
сервера rootDir "./src"), поэтому каталоги живут байт-в-байт копиями.
Разъедутся — витрина начнёт обещать одну цену/силу, а сервер применять
другую, причём молча. Тот же приём и та же плата, что у слот-файлов карт
(см. check_map_sync.py рядом).

Имя файла осталось историческим (сначала сверялись только зелья) — менять его
не стали: на него ссылаются CLAUDE.md, docs/ и привычка. Новый общий каталог
добавляется ОДНОЙ строкой в PAIRS ниже.

Только читает файлы и печатает результат. Ничего не меняет и не копирует.

Запуск: python tools/check_potion_sync.py
Код возврата: 0 — все копии совпадают, 1 — расхождение или файл отсутствует.
"""

import hashlib
import sys
from pathlib import Path

# На Windows консоль (cmd.exe) по умолчанию использует кодовую страницу,
# отличную от UTF-8, из-за чего кириллица в выводе превращается в кракозябры.
# Принудительно переключаем stdout на UTF-8, если интерпретатор это позволяет.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

PROJECT_ROOT = Path(__file__).resolve().parent.parent

# (подпись, источник правды, копия). Источник — всегда клиентский файл: именно
# его правят, а серверный получают копированием.
PAIRS = [
    ("каталог зелий", Path("src/potions.ts"), Path("server/src/potions.ts")),
    ("каталог расходников", Path("src/consumables.ts"), Path("server/src/consumables.ts")),
    ("каталог улучшений", Path("src/upgrades.ts"), Path("server/src/upgrades.ts")),
]


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def check_pair(label: str, source_rel: Path, copy_rel: Path) -> bool:
    """True — пара в порядке. Печатает результат сам."""
    source = PROJECT_ROOT / source_rel
    copy = PROJECT_ROOT / copy_rel

    missing = [p for p in (source, copy) if not p.is_file()]
    if missing:
        print(f"{label}: НЕТ ФАЙЛА")
        for path in missing:
            print(f"  {path}")
        return False

    source_hash = sha256(source)
    copy_hash = sha256(copy)

    if source_hash == copy_hash:
        print(f"{label}: синхронно ({source_rel.name}, sha256 {source_hash[:12]}…).")
        return True

    print(f"{label}: РАСХОЖДЕНИЕ")
    print(f"  {source}")
    print(f"    sha256 {source_hash}")
    print(f"  {copy}")
    print(f"    sha256 {copy_hash}")
    print(f"  Источник правды — {source_rel.as_posix()}. Скопировать поверх копии:")
    print(f"    copy {source_rel} {copy_rel}".replace("/", "\\"))
    return False


def main() -> int:
    # Проверяем ВСЕ пары, а не выходим на первой расхождённой: иначе вторая
    # ошибка всплыла бы только после починки первой, то есть на второй прогон.
    results = [check_pair(*pair) for pair in PAIRS]
    if all(results):
        return 0
    print()
    print(f"Расхождений: {results.count(False)} из {len(results)}.")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
