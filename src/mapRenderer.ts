/**
 * Вид карты, который не входит в её готовый слой: темы и фон, доли клетки под
 * полкой '=' и шипами, клетка с шипом.
 *
 * ⚠️ С 20.10.2026 плиточного рендера здесь НЕТ: платформы и декор всех шести
 * карт — готовые слои-картинки (explore/mapArt.ts; A и F — 07.10.2026, B, D, E
 * — 19.10.2026, C — 20.10.2026). Прежний рендер Canvas2D (атлас кладки, декор
 * по точкам слот-файла) удалён вместе со своими картинками — они лежат в архиве
 * арта, D:\dev\right-place-art\archive\game-assets-old\.
 */

// Доля высоты тайла, которую занимает полоса '=' (прижата к верху клетки).
// Единый источник правды — коллизия (explore/collision.ts) использует то же число.
export const PLATFORM_H_RATIO = 0.44;

// Доля высоты тайла под спрайтом шипов '^' — прижат к НИЗУ клетки (зубья стоят
// на полу), в отличие от '=', который прижат к верху. spikes.png сам по себе
// почти квадратный (541×547) — вписать в тайл по ширине БЕЗ искажения дало бы
// ~100% высоты клетки, а не 40-50%; в рамках заданного диапазона берём верхнюю
// границу (0.48), чтобы минимально сплющить зубья.
// Единый источник правды — коллизия урона (explore/collision.ts) использует то же
// число, чтобы зона урона совпадала с видимыми зубьями, а не со всей клеткой.
export const SPIKE_H_RATIO = 0.48;

// Объекты карты — обычные public-ассеты, грузятся по сети с учётом Vite
// BASE_URL (важно для GitHub Pages, где base — не "/").
// Темы карт. Фон — два живых PixiJS-слоя (far/mid) с параллаксом, которые
// Explore.tsx создаёт и двигает сам вместе с камерой; mapRenderer.ts тут только
// источник правды для имён файлов и вида фона, чтобы они не разъезжались между
// двумя местами.
// ⚠️ До 19.10.2026 тема литейной (C и E) называлась throne_room — по старой
// плитке тронного зала, которой больше нет.
export type BackdropPreset = 'graveyard' | 'flooded_crypt' | 'foundry';

/**
 * Как фон кладётся под карту: файлы, прозрачность ближнего слоя, вуаль поверх
 * обоих слоёв и масштаб картинки.
 *
 * Всё — из ОДОБРЕННЫХ предпросмотров тем: цвет вуали (24,22,30) у всех трёх,
 * плотность вуали и высота картинки фона в пикселях мира — та, под которую
 * подбирался слой платформ.
 * - Кладбище (A, F): картинка высотой 1800 px мира. ⚠️ Два числа с предпросмотром
 *   РАСХОДЯТСЯ намеренно (решения дизайнера 08.10.2026). Ближний слой —
 *   НЕПРОЗРАЧНЫЙ, в предпросмотре он лежал с 0.55: в игре с 0.55 фон выглядел
 *   полупрозрачным и блёклым. Прозрачные участки самой картинки остаются
 *   прозрачными — дальний слой виден сквозь них, а не сквозь камень. Вуаль —
 *   0.42, в предпросмотре 0.22: на плотном фоне с 0.22 платформы сливались с ним
 *   (фон в 0.86 яркости платформ, с 0.42 — 0.70).
 * - Склеп (B, D) и литейная (C, E): как в предпросмотре — ближний слой
 *   непрозрачный, картинка фона высотой с карту ('map': B и E — 1536 px мира,
 *   C — 1664, D — 1792), вуаль 107/255 у склепа и 150/255 у литейной (правило
 *   литейной: «вуаль предпросмотров C/E и переноса в игру — альфа 150»).
 * ⚠️ Параллакс (0.15 / 0.4) сюда не входит и от темы не зависит.
 *
 * worldHeight — высота картинки фона в пикселях мира (на экране она умножается
 * на масштаб мира); 'map' — высота карты, она же высота её готового слоя.
 * ⚠️ Это нижняя граница, а не точное значение: на экране выше такой картинки фон
 * всё равно дотягивается до его высоты, иначе плитка фона повторилась бы по
 * вертикали (см. Explore.tsx).
 */
export type BackdropLook = {
  /** Файлы фона — backgrounds/bg_<file>_far.<ext> и bg_<file>_mid.<ext>. */
  file: string;
  ext: 'webp' | 'png';
  midAlpha: number;
  dimColor: number;
  dimAlpha: number;
  worldHeight: number | 'map';
};

const BACKDROP_LOOK: Record<BackdropPreset, BackdropLook> = {
  graveyard: { file: 'graveyard', ext: 'webp', midAlpha: 1, dimColor: 0x18161e, dimAlpha: 0.42, worldHeight: 1800 },
  flooded_crypt: { file: 'flooded_crypt', ext: 'webp', midAlpha: 1, dimColor: 0x18161e, dimAlpha: 107 / 255, worldHeight: 'map' },
  foundry: { file: 'foundry', ext: 'webp', midAlpha: 1, dimColor: 0x18161e, dimAlpha: 150 / 255, worldHeight: 'map' },
};

/** Вид фона карты с готовым слоем — по теме. */
export function backdropLook(preset: BackdropPreset): BackdropLook {
  return BACKDROP_LOOK[preset];
}

export function backdropPaths(look: BackdropLook): { far: string; mid: string } {
  const base = `${import.meta.env.BASE_URL}assets/maps/backgrounds/bg_${look.file}`;
  return { far: `${base}_far.${look.ext}`, mid: `${base}_mid.${look.ext}` };
}

const SPIKES_SRC = `${import.meta.env.BASE_URL}assets/objects/spikes.png`

function loadSprites(sprites: Record<string, string>): Promise<Record<string, HTMLImageElement>> {
  const keys = Object.keys(sprites);
  const images: Record<string, HTMLImageElement> = {};
  if (keys.length === 0) return Promise.resolve(images);
  return new Promise((resolve) => {
    let loaded = 0;
    for (const key of keys) {
      const img = new Image();
      img.onload = () => { loaded++; if (loaded >= keys.length) resolve(images); };
      img.onerror = () => {
        // Раньше ошибка загрузки глоталась молча — ready('masonry') просто
        // возвращал false, и рендер тихо падал на плоскую заливку без единой
        // строчки в консоли. Теперь путь, который реально не загрузился,
        // явно виден в консоли — это и есть источник правды при диагностике
        // "текстура не появилась".
        console.error(`mapRenderer: не удалось загрузить текстуру "${key}" по пути ${sprites[key]}`);
        loaded++; if (loaded >= keys.length) resolve(images);
      };
      img.src = sprites[key];
      images[key] = img;
    }
  });
}

/** Шип в клетке (x, y): прижат к НИЗУ клетки, см. SPIKE_H_RATIO. */
function drawSpikeCell(ctx: CanvasRenderingContext2D, img: HTMLImageElement | undefined, x: number, y: number, TS: number) {
  const px = x * TS, bottom = (y + 1) * TS, h = TS * SPIKE_H_RATIO, top = bottom - h;
  if (img && img.complete && img.naturalWidth > 0) ctx.drawImage(img, px, top, TS, h);
  else { ctx.fillStyle = '#E0353B'; ctx.fillRect(px, top, TS, h); }
}

/**
 * Одна клетка с шипом '^'. Шипов в .txt карт нет: игра вставляет их в сетку на
 * старте забега из слот-файла, поэтому в готовый слой карты (explore/mapArt.ts)
 * их запечь нельзя, и рисуются они поверх него — спрайтом этой клетки.
 *
 * ⚠️ Клетка, а не холст на всю карту: холст 3072×1536 ради трёх шипов — это
 * ещё ~19 МБ видеопамяти рядом с самим слоем. Explore.tsx делает из клетки
 * одну текстуру и ставит по спрайту на каждый шип.
 */
export async function renderSpikeTile(tileSize = 64): Promise<HTMLCanvasElement> {
  const IMG = await loadSprites({ spikes: SPIKES_SRC });
  const canvas = document.createElement('canvas');
  canvas.width = tileSize;
  canvas.height = tileSize;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;
  drawSpikeCell(ctx, IMG.spikes, 0, 0, tileSize);
  return canvas;
}
