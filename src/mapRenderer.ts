/**
 * Рендер "мира" карты (фон + тайлы + декор) на Canvas2D.
 * Перенесено из _ref/map_editor.html — редакторские функции (палитра,
 * слоты, сетка-grid, метка старта, оверлеи) сюда не включены.
 *
 * ⚠️ С 19.10.2026 плиткой рисуется ОДНА карта — C, временно, старым набором
 * тронного зала (см. legacyTilesFor), пока Codex не перерисует её слой. У
 * остальных пяти платформы и декор — готовый слой-картинка (explore/mapArt.ts),
 * и отсюда им нужны только шипы (renderSpikeTile) да вид фона (backdropLook).
 */

export interface DecorDef {
  sprite: string;
  tiles: number;
  anchor: 'top' | 'bottom';
  label: string;
}

// Тематический декор (заменил старый набор из 8 универсальных типов —
// torch/chain/banner/pillar/barrel/bones/grass/rubble). map_X_slots.json
// по-прежнему хранит СТАРЫЕ имена типов у точек декора (файлы не
// переписываем) — при рендере они подменяются на актуальный тип текущей
// темы карты, см. THEME_DECOR/pickThemedDecorType и цикл декора в конце
// renderMapToCanvas(). chest/spikes/obelisk сюда НЕ входят — это игровые
// объекты со своей логикой, живут отдельно от декора.
export const DECOR: Record<string, DecorDef> = {
  // Декораций кладбища (grave_*, 07.10.2026) и склепа (crypt_*, 19.10.2026) здесь
  // БОЛЬШЕ НЕТ: декор этих карт — часть готового слоя (см. шапку файла), а сами
  // картинки убраны из public/ в архив арта. Остался набор тронного зала —
  // только для карты C, пока у неё нет слоя.
  throne_royal_chair:     { sprite: 'throne_royal_chair',     tiles: 3.0, anchor: 'bottom', label: 'Трон' },
  throne_candelabra:      { sprite: 'throne_candelabra',      tiles: 3.4, anchor: 'bottom', label: 'Канделябр' },
  throne_weapon_rack:     { sprite: 'throne_weapon_rack',     tiles: 2.4, anchor: 'bottom', label: 'Оружейная стойка' },
  throne_shield_stand:    { sprite: 'throne_shield_stand',    tiles: 3.0, anchor: 'bottom', label: 'Стойка со щитом' },
  throne_treasure_pile:   { sprite: 'throne_treasure_pile',   tiles: 1.4, anchor: 'bottom', label: 'Груда сокровищ' },
  throne_broken_crown:    { sprite: 'throne_broken_crown',    tiles: 1.2, anchor: 'bottom', label: 'Разбитая корона' },
};

// Доля высоты тайла, которую занимает полоса '=' (прижата к верху клетки).
// Единый источник правды — коллизия в Explore.tsx использует то же число.
export const PLATFORM_H_RATIO = 0.44;

// Доля высоты тайла под спрайтом шипов '^' — прижат к НИЗУ клетки (зубья стоят
// на полу), в отличие от '=', который прижат к верху. spikes.png сам по себе
// почти квадратный (541×547) — вписать в тайл по ширине БЕЗ искажения дало бы
// ~100% высоты клетки, а не 40-50%; в рамках заданного диапазона берём верхнюю
// границу (0.48), чтобы минимально сплющить зубья.
// Единый источник правды — коллизия урона в Explore.tsx использует то же
// число, чтобы зона урона совпадала с видимыми зубьями, а не со всей клеткой.
export const SPIKE_H_RATIO = 0.48;

// Объекты карты — обычные public-ассеты, грузятся по сети с учётом Vite
// BASE_URL (важно для GitHub Pages, где base — не "/").
// Темы карт. Фон — два живых PixiJS-слоя (far/mid) с параллаксом, которые
// Explore.tsx создаёт и двигает сам вместе с камерой; mapRenderer.ts тут только
// источник правды для имён файлов и вида фона, чтобы они не разъезжались между
// двумя местами.
// ⚠️ До 19.10.2026 тема литейной (C и E) называлась throne_room — по старой
// плитке тронного зала. Плитка эта осталась только у C и под своим старым
// именем (TileTheme ниже), а тема называется по новому арту.
export type BackdropPreset = 'graveyard' | 'flooded_crypt' | 'foundry';

/**
 * Старый набор плитки и декора, который ещё рисует этот модуль, — один, тронного
 * зала (masonry_throne_room.png и шесть throne_*), и рисует он одну карту: C, пока
 * у неё нет готового слоя (решение Андрея 19.10.2026: колонна-стенка в
 * одобренном арте C стоит не на сетке, ждём новую версию от Codex). Кладка и
 * декор кладбища убраны 07.10.2026, склепа — 19.10.2026; тип не даёт вызвать
 * рендер плитки с ними — иначе вместо камня молча вышла бы плоская заливка.
 * Придёт слой C — удалить этот тип, LEGACY_TILES, renderMapToCanvas с её
 * помощниками и семь картинок throne_* / masonry_throne_room.
 */
export type TileTheme = 'throne_room';

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
 * - Склеп (B, D) и литейная (E): как в предпросмотре — ближний слой
 *   непрозрачный, картинка фона высотой с карту ('map': B и E — 1536 px мира,
 *   D — 1792), вуаль 107/255 у склепа и 150/255 у литейной (правило литейной:
 *   «вуаль предпросмотров C/E и переноса в игру — альфа 150»).
 * ⚠️ Параллакс (0.15 / 0.4) сюда не входит и от темы не зависит.
 *
 * worldHeight — высота картинки фона в пикселях мира (на экране она умножается
 * на масштаб мира); 'map' — высота карты; null — «по высоте экрана» (только у
 * старой плитки C). ⚠️ Это нижняя граница, а не точное значение: на экране выше
 * такой картинки фон всё равно дотягивается до его высоты, иначе плитка фона
 * повторилась бы по вертикали (см. Explore.tsx).
 */
export type BackdropLook = {
  /** Файлы фона — backgrounds/bg_<file>_far.<ext> и bg_<file>_mid.<ext>. */
  file: string;
  ext: 'webp' | 'png';
  midAlpha: number;
  dimColor: number;
  dimAlpha: number;
  worldHeight: number | 'map' | null;
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

/**
 * Карта БЕЗ готового слоя: старая плитка вместе со СВОИМ старым фоном и вуалью —
 * чтобы C до новой версии арта выглядела ровно как раньше (решение Андрея
 * 19.10.2026), а не старой плиткой на новом фоне литейной. Есть только у
 * литейной; у кладбища и склепа карта без слоя — ошибка старта забега.
 */
const LEGACY_TILES: Partial<Record<BackdropPreset, { tileTheme: TileTheme; look: BackdropLook }>> = {
  foundry: {
    tileTheme: 'throne_room',
    look: { file: 'throne_room', ext: 'png', midAlpha: 1, dimColor: 0x0e0c13, dimAlpha: 0.42, worldHeight: null },
  },
};

export function legacyTilesFor(preset: BackdropPreset): { tileTheme: TileTheme; look: BackdropLook } | null {
  return LEGACY_TILES[preset] ?? null;
}

export function backdropPaths(look: BackdropLook): { far: string; mid: string } {
  const base = `${import.meta.env.BASE_URL}assets/maps/backgrounds/bg_${look.file}`;
  return { far: `${base}_far.${look.ext}`, mid: `${base}_mid.${look.ext}` };
}

// Категория СТАРОГО типа декора (см. комментарий у DECOR выше) — определяет,
// из какого списка THEME_DECOR подставлять актуальную замену: floor (стоит
// на земле) или hanging (свисает с потолка, было только у chain/banner).
const OLD_DECOR_CATEGORY: Record<string, 'floor' | 'hanging'> = {
  torch: 'floor',
  pillar: 'floor',
  barrel: 'floor',
  bones: 'floor',
  grass: 'floor',
  rubble: 'floor',
  chain: 'hanging',
  banner: 'hanging',
};

// 6 актуальных типов декора набора, разбитые на floor/hanging. У throne_room
// потолочного декора нет, поэтому для его старых hanging-точек
// pickThemedDecorType ниже откатывается на floor (единственный доступный
// список).
const THEME_DECOR: Record<TileTheme, { floor: string[]; hanging: string[] }> = {
  throne_room: {
    floor: ['throne_royal_chair', 'throne_candelabra', 'throne_weapon_rack', 'throne_shield_stand', 'throne_treasure_pile', 'throne_broken_crown'],
    hanging: [],
  },
};

// Детерминированный выбор актуального типа декора для точки (x,y) со СТАРЫМ
// типом oldType — один и тот же хэш координат при каждом запуске даёт один и
// тот же тип, картинка не "прыгает" между заходами на карту. Напольные старые
// типы ВСЕГДА идут в floor-список (никогда не становятся подвесными); только
// старые hanging-точки (chain/banner) могут попасть в hanging-список — и
// только если он не пуст для этой темы.
function pickThemedDecorType(theme: TileTheme, oldType: string, x: number, y: number): string | null {
  const category = OLD_DECOR_CATEGORY[oldType] ?? 'floor'
  const pool = THEME_DECOR[theme]
  const list = category === 'hanging' && pool.hanging.length > 0 ? pool.hanging : pool.floor
  if (list.length === 0) return null
  const hash = Math.abs((x * 73856093) ^ (y * 19349663))
  return list[hash % list.length]
}

const SPIKES_SRC = `${import.meta.env.BASE_URL}assets/objects/spikes.png`

// Путь к тематическому файлу кладки/декора — все лежат в одной папке,
// имя файла = имя пресета/типа декора (см. DECOR/THEME_DECOR выше).
function textureAssetPath(name: string): string {
  return `${import.meta.env.BASE_URL}assets/maps/textures/${name}.png`
}

// Собирает пути спрайтов набора плитки (кладка + её 6 типов декора + spikes).
// Ключ 'masonry' сохранён прежним
// (drawSolid/drawPlatform его не меняют), путь теперь theme-зависимый.
function objectSpritesForTheme(theme: TileTheme): Record<string, string> {
  const sprites: Record<string, string> = {
    spikes: SPIKES_SRC,
    masonry: textureAssetPath(`masonry_${theme}`),
  }
  const pool = THEME_DECOR[theme]
  for (const type of [...pool.floor, ...pool.hanging]) {
    sprites[type] = textureAssetPath(type)
  }
  return sprites
}

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

export interface RenderMapOptions {
  grid: string[][];
  decor?: { x: number; y: number; type: string }[];
  tileSize?: number;
  // ОБЯЗАТЕЛЬНА и без умолчания: раньше умолчанием было «кладбище», а у него
  // плитки больше нет — забытая тема молча дала бы карту без камня.
  theme: TileTheme;
}

/** Шип в клетке (x, y): прижат к НИЗУ клетки, см. SPIKE_H_RATIO. Один на оба рендера ниже. */
function drawSpikeCell(ctx: CanvasRenderingContext2D, img: HTMLImageElement | undefined, x: number, y: number, TS: number) {
  const px = x * TS, bottom = (y + 1) * TS, h = TS * SPIKE_H_RATIO, top = bottom - h;
  if (img && img.complete && img.naturalWidth > 0) ctx.drawImage(img, px, top, TS, h);
  else { ctx.fillStyle = '#E0353B'; ctx.fillRect(px, top, TS, h); }
}

/**
 * Одна клетка с шипом '^' — для карт с готовым слоем платформ и декора (все,
 * кроме C, см. explore/mapArt.ts). Шипов в .txt карт нет: игра вставляет их в
 * сетку на старте забега из слот-файла, поэтому в готовую картинку их запечь
 * нельзя, и рисуются они поверх неё — тем же спрайтом и в том же месте клетки,
 * что и на плиточной карте (один drawSpikeCell на оба пути).
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

export async function renderMapToCanvas(options: RenderMapOptions): Promise<HTMLCanvasElement> {
  const { grid, decor = [], tileSize: TS = 64, theme } = options;
  const H = grid.length;
  const W = H > 0 ? grid[0].length : 0;

  // Ждётся здесь же — до первой отрисовки, так что '^' не пропадёт из-за
  // того, что spikes.png ещё не успел загрузиться.
  const IMG = await loadSprites(objectSpritesForTheme(theme));

  const canvas = document.createElement('canvas');
  canvas.width = W * TS;
  canvas.height = H * TS;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;

  function inb(x: number, y: number) { return x >= 0 && y >= 0 && x < W && y < H; }
  function isBody(x: number, y: number) { return inb(x, y) && grid[y][x] === '#'; }
  function isPlat(x: number, y: number) { return inb(x, y) && grid[y][x] === '='; }
  function ready(k: string) { return !!IMG[k] && IMG[k].complete && IMG[k].naturalWidth > 0; }

  function texSrc(x: number, y: number, surface: boolean) {
    // Атлас masonry_<theme>.png — сетка 8 КОЛОНОК × 4 СТРОКИ. Светлая
    // "истёртая" кромка есть ТОЛЬКО в верхней строке атласа (my=0) — строки
    // 1..3 ровные, без осветления (замерено на masonry_graveyard). Раньше
    // строка бралась просто как y % ROWS, из-за чего пол на разных этажах
    // мог случайно попасть то в кромку, то в ровную строку и выглядеть
    // по-разному. Теперь строка выбирается ПО СМЫСЛУ тайла, а не по остатку Y:
    // - surface (сверху воздух, по тайлу реально ходят) -> ВСЕГДА my=0 —
    //   кромка есть у всех трёх атласов именно в верхней строке;
    // - под землёй -> my = 1 + (y % 3), строки 1..3 (ровные, без кромки),
    //   горизонтальное разнообразие по-прежнему даёт mx = x % COLS.
    const COLS = 8, ROWS = 4, cellW = IMG.masonry.width / COLS, cellH = IMG.masonry.height / ROWS;
    const mx = ((x % COLS) + COLS) % COLS;
    const my = surface ? 0 : 1 + (((y % 3) + 3) % 3);
    // У атласа между соседними плитками в СТАРОМ варианте была тёмная
    // разделительная полоса — при масштабировании со сглаживанием она
    // "протекала" внутрь соседних тайлов и выглядела как трещины между
    // камнями на каждом стыке клеток сетки. В новых тематических атласах
    // (graveyard/throne_room/flooded_crypt) её нет (замерено яркостью на
    // границах ячеек) — INSET уменьшен до минимума, чтобы не съедать
    // полезную площадь плитки зря.
    const INSET = 2;
    // У каждой ячейки атласа своя светлая полоса "износа" у верхнего края
    // (замерено: яркость подскакивает ~в 3 раза на y≈8-20px внутри клетки,
    // потом падает и держится ровной до низа). Она правильно смотрится на
    // РЕАЛЬНОЙ поверхности (где сверху воздух), но если так же тайлить и
    // ряды ПОД землёй — получаются повторяющиеся "ступеньки" по всей толще
    // камня. Для непокрытых сверху тайлов ("surface") берём клетку как есть;
    // для тех, что под землёй, пропускаем светлую полосу и берём только
    // ровный низ клетки (тут же и защита на случай, если в какой-то из трёх
    // "ровных" строк всё же останется небольшой остаточный засвет).
    const BURIED_SKIP_TOP = 28;
    const topSkip = surface ? INSET : BURIED_SKIP_TOP;
    return {
      sx: mx * cellW + INSET,
      sy: my * cellH + topSkip,
      sw: cellW - INSET * 2,
      sh: cellH - topSkip - INSET,
    };
  }

  function drawSprite(key: string, cellX: number, cellY: number, tiles: number, anchor: 'top' | 'bottom', alpha?: number) {
    if (!ready(key)) return;
    const im = IMG[key], targetH = tiles * TS, sc = targetH / im.naturalHeight, targetW = im.naturalWidth * sc;
    const x = cellX * TS + TS / 2 - targetW / 2;
    const y = anchor === 'top' ? cellY * TS : (cellY + 1) * TS - targetH;
    if (alpha != null) { ctx.save(); ctx.globalAlpha = alpha; }
    ctx.drawImage(im, x, y, targetW, targetH);
    if (alpha != null) ctx.restore();
  }

  function drawSolid(x: number, y: number) {
    const px = x * TS, py = y * TS;
    const air = (nx: number, ny: number) => !isBody(nx, ny);
    const surface = air(x, y - 1);
    if (ready('masonry')) { const { sx, sy, sw, sh } = texSrc(x, y, surface); ctx.drawImage(IMG.masonry, sx, sy, sw, sh, px, py, TS, TS); }
    else { ctx.fillStyle = '#221E2B'; ctx.fillRect(px, py, TS, TS); }
    ctx.strokeStyle = 'rgba(14,12,19,0.92)'; ctx.lineWidth = Math.max(2, TS * 0.09);
    ctx.beginPath();
    if (air(x, y - 1)) { ctx.moveTo(px, py + 1); ctx.lineTo(px + TS, py + 1); }
    if (air(x, y + 1)) { ctx.moveTo(px, py + TS - 1); ctx.lineTo(px + TS, py + TS - 1); }
    if (air(x - 1, y)) { ctx.moveTo(px + 1, py); ctx.lineTo(px + 1, py + TS); }
    if (air(x + 1, y)) { ctx.moveTo(px + TS - 1, py); ctx.lineTo(px + TS - 1, py + TS); }
    ctx.stroke();
    if (air(x, y - 1)) {
      ctx.strokeStyle = 'rgba(237,231,242,0.20)'; ctx.lineWidth = Math.max(1, TS * 0.06);
      ctx.beginPath(); ctx.moveTo(px, py + TS * 0.14); ctx.lineTo(px + TS, py + TS * 0.14); ctx.stroke();
    }
  }

  function drawPlatform(x: number, y: number) {
    const px = x * TS, py = y * TS, h = TS * PLATFORM_H_RATIO, top = py;
    if (ready('masonry')) { const { sx, sy, sw, sh } = texSrc(x, y, true); ctx.drawImage(IMG.masonry, sx, sy + sh * 0.55, sw, sh * 0.45, px, top, TS, h); }
    else { ctx.fillStyle = '#3A3344'; ctx.fillRect(px, top, TS, h); }
    ctx.strokeStyle = 'rgba(237,231,242,0.24)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(px, top + 1); ctx.lineTo(px + TS, top + 1); ctx.stroke();
    ctx.strokeStyle = 'rgba(14,12,19,0.92)'; ctx.lineWidth = 2; ctx.beginPath();
    ctx.moveTo(px, top + h - 1); ctx.lineTo(px + TS, top + h - 1);
    if (!isPlat(x - 1, y)) { ctx.moveTo(px + 1, top); ctx.lineTo(px + 1, top + h); }
    if (!isPlat(x + 1, y)) { ctx.moveTo(px + TS - 1, top); ctx.lineTo(px + TS - 1, top + h); }
    ctx.stroke();
  }

  function drawSpikes(x: number, y: number) {
    drawSpikeCell(ctx, IMG.spikes, x, y, TS);
  }

  // Фон карты НЕ рисуется здесь — canvas карты несёт только тайлы/декор и
  // остаётся прозрачным (ctx по умолчанию прозрачный, никакой заливки на
  // весь холст нет), чтобы сквозь него был виден параллакс (bgFar/bgMid),
  // который Explore.tsx рисует и двигает отдельным слоем ПОД картой.
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const ch = grid[y][x];
      if (ch === '#') drawSolid(x, y);
      else if (ch === '=') drawPlatform(x, y);
      else if (ch === '^') drawSpikes(x, y);
    }
  }
  // d.type в слот-файле — СТАРОЕ имя типа (torch/pillar/chain/...), которого
  // больше нет в DECOR — подменяем на актуальный тип текущей темы (см.
  // pickThemedDecorType выше), детерминированно по координатам точки.
  for (const d of decor) {
    const themedType = pickThemedDecorType(theme, d.type, d.x, d.y);
    const s = themedType ? DECOR[themedType] : undefined;
    if (s) drawSprite(s.sprite, d.x, d.y, s.tiles, s.anchor);
  }

  return canvas;
}
