#!/usr/bin/env python3
"""Сверка слот-файлов карт между public/assets/maps/ и server/src/maps/.

Источник: public/assets/maps/*_slots.json
Копия:    server/src/maps/*_slots.json

Только читает файлы и печатает результат. Ничего не меняет и не копирует.

Запуск: python tools/check_map_sync.py
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
SOURCE_DIR = PROJECT_ROOT / "public" / "assets" / "maps"
COPY_DIR = PROJECT_ROOT / "server" / "src" / "maps"

SLOTS_GLOB = "*_slots.json"


def list_slot_files(directory: Path) -> dict[str, Path]:
    """Возвращает {имя_файла: путь} для *_slots.json в directory (если она есть)."""
    if not directory.is_dir():
        return {}
    return {p.name: p for p in directory.glob(SLOTS_GLOB) if p.is_file()}


def file_hash(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> int:
    source_files = list_slot_files(SOURCE_DIR)
    copy_files = list_slot_files(COPY_DIR)

    only_in_source = sorted(set(source_files) - set(copy_files))
    only_in_copy = sorted(set(copy_files) - set(source_files))
    common_names = sorted(set(source_files) & set(copy_files))

    differing: list[str] = []
    for name in common_names:
        if file_hash(source_files[name]) != file_hash(copy_files[name]):
            differing.append(name)

    problems: list[str] = []

    for name in only_in_source:
        problems.append(f"ОТСУТСТВУЕТ В КОПИИ:   {name} (есть в {SOURCE_DIR})")

    for name in only_in_copy:
        problems.append(f"ЛИШНИЙ В КОПИИ:        {name} (нет в {SOURCE_DIR})")

    for name in differing:
        problems.append(f"РАЗНОЕ СОДЕРЖИМОЕ:     {name}")

    if not problems:
        print(f"Синхронно: все *_slots.json в {COPY_DIR} совпадают с {SOURCE_DIR} ({len(common_names)} файлов).")
        return 0

    print(f"Расхождения между {SOURCE_DIR} и {COPY_DIR}:")
    for line in problems:
        print(f"  - {line}")
    return 1


if __name__ == "__main__":
    sys.exit(main())
