"""Насколько ниже кромки пола (+) нижняя строка с альфой > 40 у реквизита с посадкой
«якорь — низ кадра, y = пол + OFFSET». По полноразмерным листам архива, каждый кадр.
d = OFFSET + (нижняя_строка + 1 − высота_клетки) × (DRAW_H / высота_клетки)."""
from pathlib import Path
import numpy as np
from PIL import Image
ARC = Path(r'D:/dev/right-place-art/archive/game-assets-old/sheets-full-2026-11-16')
PUB = Path(r'D:/dev/telegram-game/public/assets')

def find(rel):
    for base in (ARC, ARC / 'assets', PUB):
        p = base / rel
        if p.exists():
            return p
    hits = list(ARC.rglob(Path(rel).name))
    return hits[0] if hits else None

def bottoms(rel, cw, ch, n, cols=None):
    p = find(rel)
    a = np.asarray(Image.open(p).convert('RGBA'))[:, :, 3]
    cols = cols or a.shape[1] // cw
    out = []
    for i in range(n):
        x, y = (i % cols) * cw, (i // cols) * ch
        cell = a[y:y + ch, x:x + cw]
        rows = np.nonzero((cell > 40).any(axis=1))[0]
        out.append(int(rows[-1]) + 1 if len(rows) else None)
    return p, out

def report(name, rel, cw, ch, n, draw_h, offset):
    p, b = bottoms(rel, cw, ch, n)
    k = draw_h / ch
    ds = [round(offset + (r - ch) * k, 1) for r in b if r is not None]
    print(f'{name:22s} {str(p)[-60:]:60s} кадры {n:2d}  d: мин {min(ds):5.1f} кадр0 {ds[0]:5.1f} макс {max(ds):5.1f}  (OFFSET {offset}, k {k:.3f})')
    return ds

report('сундук (Chest_Open)', 'objects/Chest_Open.png', 140, 178, 13, 90, 27)
report('мимик (Trap_Explode)', 'objects/Chest_Trap_Explode.png', 190, 137, 14, 76, 10)
report('обелиск idle', 'objects/Obelisk_Idle.png', 190, 512, 10, 195, 18)
report('обелиск горит', 'objects/Obelisk_Burning.png', 190, 512, 10, 195, 18)
report('Контрабандист', 'sprites/smuggler/smuggler_idle.png', 230, 296, 14, 148, 12)
