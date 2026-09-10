#!/usr/bin/env python3
"""Сверка каталога зелий между клиентом и сервером.

Источник: src/potions.ts
Копия:    server/src/potions.ts

Общего пакета в проекте нет (tsconfig.app.json включает только "src", у
сервера rootDir "./src"), поэтому каталог живёт двумя байт-в-байт копиями.
Разъедутся — витрина начнёт обещать одну цену/силу, а сервер применять
другую, причём молча. Тот же приём и та же плата, что у слот-файлов карт
(см. check_map_sync.py рядом).

Только читает файлы и печатает результат. Ничего не меняет и не копирует.

Запуск: python tools/check_potion_sync.py
Код возврата: 0 — копии совпадают, 1 — расхождение или файл отсутствует.
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
SOURCE = PROJECT_ROOT / "src" / "potions.ts"
COPY = PROJECT_ROOT / "server" / "src" / "potions.ts"


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> int:
    missing = [p for p in (SOURCE, COPY) if not p.is_file()]
    if missing:
        for path in missing:
            print(f"НЕТ ФАЙЛА: {path}")
        return 1

    source_hash = sha256(SOURCE)
    copy_hash = sha256(COPY)

    if source_hash == copy_hash:
        print(f"Синхронно: {SOURCE} и {COPY} совпадают (sha256 {source_hash[:12]}…).")
        return 0

    print("РАСХОЖДЕНИЕ каталога зелий:")
    print(f"  {SOURCE}")
    print(f"    sha256 {source_hash}")
    print(f"  {COPY}")
    print(f"    sha256 {copy_hash}")
    print()
    print("Источник правды — src/potions.ts. Скопировать поверх копии:")
    print("  copy src\\potions.ts server\\src\\potions.ts")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
