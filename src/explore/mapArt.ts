import { MAP_ART } from './mapArtManifest'
import { MAP_ART_CRYPT_FOUNDRY } from './mapArtManifestCryptFoundry'

/**
 * ГОТОВЫЕ СЛОИ КАРТ: A и F (07.10.2026), B, D_OPEN, D_SEALED и E (19.10.2026),
 * C (20.10.2026), болото B2 и C2 (29.10.2026, tools/build_map_art.mjs) — у всех.
 *
 * У этих карт платформы и декор — не плитка из атласа, а одна прозрачная
 * картинка на всю карту, собранная из одобренных исходников художественного
 * архива (A и F — tools/build_map_art.mjs, склеп и литейная —
 * tools/build_map_art_crypt_foundry.mjs; сам архив лежит ВНЕ репозитория, в
 * D:\dev\right-place-art). Картинка — пиксель в пиксель мир игры: 64 px на тайл,
 * левый верхний угол в (0, 0), поэтому кладётся в worldContainer без масштаба.
 * У карты D свой слой на каждое состояние тайника (OPEN / SEALED): ключ — имя
 * загруженного .txt.
 *
 * Что от этого НЕ меняется: столкновения. Они по-прежнему считаются по сетке
 * .txt, слой — только вид. Шипы и объекты событий рисуются поверх него своим
 * кодом.
 */
export type MapArtSwayItem = { src: string; x: number; y: number; w: number; h: number; phase: number }
export type MapArt = { slices: { src: string; x: number; width: number }[]; width: number; height: number; gridChecksum: number; sway: MapArtSwayItem[] }

/**
 * Готовый слой карты или null, если его нет (Explore.tsx тогда отказывает в старте забега).
 *
 * slices — части слоя по ширине, слева направо, каждая со своего x. У слоя не
 * шире потолка текстуры (4096 px) часть одна — вся карта. Шире (болото C2, 6144
 * px) — tools/build_map_art.mjs режет его на равные части, кратные клетке, ДО
 * сжатия, и Explore.tsx ставит их встык.
 *
 * sway — камыш и осока болота (29.10.2026): вынуты из слоя (их тени в слое
 * остались), качаются отдельными спрайтами (entities/swayDecor.ts). У прочих
 * карт список пуст.
 */
export function mapArtFor(mapFile: string): MapArt | null {
  const entry = MAP_ART[mapFile] ?? MAP_ART_CRYPT_FOUNDRY[mapFile]
  if (!entry) return null
  const src = (file: string) => `${import.meta.env.BASE_URL}assets/maps/art/${file}`
  return {
    slices: entry.slices
      ? entry.slices.map((s) => ({ src: src(s.file), x: s.x, width: s.width }))
      : [{ src: src(entry.file), x: 0, width: entry.width }],
    width: entry.width,
    height: entry.height,
    gridChecksum: entry.gridChecksum,
    sway: (entry.sway ?? []).map((v) => ({ src: src(`sway/${v.sprite}.png`), x: v.x, y: v.y, w: v.w, h: v.h, phase: v.phase })),
  }
}

/**
 * Контрольная сумма сетки карты — FNV-1a, 32 бита, по строкам без '\r' и без
 * пустых строк, склеенным через '\n'. Та же функция — в tools/build_map_art.mjs:
 * она записывает сумму сетки, под которую собран слой, а игра сверяет её с
 * сеткой, которую реально загрузила.
 *
 * ⚠️ Считать по тексту файла ДО вставки шипов из слотов: шипы меняют рабочую
 * сетку на каждом забеге, а слой собран под геометрию из .txt.
 */
export function gridChecksum(mapText: string): number {
  const text = mapText.split(/\r?\n/).filter((row) => row.length > 0).join('\n')
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}
