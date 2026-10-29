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
// на полу), в отличие от '=', который прижат к верху. С 29.10.2026 spikes.png —
// вариант A из spikes-readability-v1 (архив арта, решение Андрея): 64×31, ровно
// под эту полосу (64 × 30.72), зубья собраны без растяжения. До этого был лист
// 541×547 — его сплющивало в ту же полосу; прежний файл лежит в архиве арта
// (archive/game-assets-old/public/assets/objects/spikes.png).
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
// Болото (B2, C2) — с 29.10.2026.
export type BackdropPreset = 'graveyard' | 'flooded_crypt' | 'foundry' | 'swamp';

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
  // Болото — как одобренный предпросмотр (approved-architecture-v1): оба слоя
  // обрезаны сверху на 450 px (это делает tools/build_map_art.mjs), высотой с
  // карту, ближний непрозрачен, вуаль (20,23,27) с альфой 155.
  swamp: { file: 'swamp', ext: 'webp', midAlpha: 1, dimColor: 0x14171b, dimAlpha: 155 / 255, worldHeight: 'map' },
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

// Блик на верхушках зубьев — синхронный, на всех шипах карты разом (одобренный
// образец spikes-animation.html, Codex, 17.10.2026): раз в 3.6 с, 0.85 с, сила
// sin²(π·t/0.85). Пять точек — верхушки пяти зубьев в координатах картинки
// 64×31; у каждой радиальный градиент радиусом 4.5 px, белый с тёплым оттенком,
// 0.95 в центре и 0.65 на середине радиуса; блик обрезан альфой самих зубьев.
// Explore.tsx рисует его ОДНОЙ текстурой клетки и ставит спрайты всех шипов в
// один контейнер, прозрачность которого — общая фаза (spikeGlintAlpha).
export const SPIKE_GLINT_PERIOD_S = 3.6;
export const SPIKE_GLINT_DURATION_S = 0.85;
const SPIKE_GLINT_TIPS: [number, number][] = [[7, 9], [19, 7], [31, 4], [44, 7], [56, 9]];
const SPIKE_ART_W = 64, SPIKE_ART_H = 31;

/** Сила блика (0..1) в момент t, секунды игрового времени. Одна на все шипы. */
export function spikeGlintAlpha(t: number): number {
  const phase = t % SPIKE_GLINT_PERIOD_S;
  if (phase >= SPIKE_GLINT_DURATION_S) return 0;
  return Math.sin((Math.PI * phase) / SPIKE_GLINT_DURATION_S) ** 2;
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
export async function renderSpikeTile(tileSize = 64): Promise<{ spike: HTMLCanvasElement; glint: HTMLCanvasElement | null }> {
  const IMG = await loadSprites({ spikes: SPIKES_SRC });
  const canvas = document.createElement('canvas');
  canvas.width = tileSize;
  canvas.height = tileSize;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;
  drawSpikeCell(ctx, IMG.spikes, 0, 0, tileSize);
  return { spike: canvas, glint: renderSpikeGlintTile(IMG.spikes, tileSize) };
}

/**
 * Клетка блика — тот же размер и та же полоса, что у шипа, на полной силе
 * (силу задаёт прозрачность контейнера). null — картинка шипа не загрузилась
 * (ошибку уже написал loadSprites): блестеть нечему.
 */
function renderSpikeGlintTile(img: HTMLImageElement | undefined, tileSize: number): HTMLCanvasElement | null {
  if (!img || !img.complete || img.naturalWidth === 0) return null;
  const art = document.createElement('canvas');
  art.width = SPIKE_ART_W;
  art.height = SPIKE_ART_H;
  const sc = art.getContext('2d')!;
  for (const [x, y] of SPIKE_GLINT_TIPS) {
    const grad = sc.createRadialGradient(x, y + 1.5, 0, x, y + 1.5, 4.5);
    grad.addColorStop(0, 'rgba(255,247,224,0.95)');
    grad.addColorStop(0.5, 'rgba(255,247,224,0.65)');
    grad.addColorStop(1, 'rgba(255,247,224,0)');
    sc.fillStyle = grad;
    sc.fillRect(x - 5, y - 1, 10, 7);
  }
  sc.globalCompositeOperation = 'destination-in';
  sc.drawImage(img, 0, 0, SPIKE_ART_W, SPIKE_ART_H);
  const canvas = document.createElement('canvas');
  canvas.width = tileSize;
  canvas.height = tileSize;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;
  const h = tileSize * SPIKE_H_RATIO;
  ctx.drawImage(art, 0, tileSize - h, tileSize, h);
  return canvas;
}
