// СГЕНЕРИРОВАНО tools/build_map_art_new_six.mjs — руками не править, пересобирать скриптом.
//
// Готовые слои шести новых карт (10.11.2026, пакет new-six/handoff-six-maps-2026-11-10)
// и болотных W, Y (11.11.2026, пакет swamp/new-two/handoff-2026-11):
// world-overlay.png, нарезанный по ширине (не шире 4096 px), части ставятся встык с x.
// gridChecksum — сумма сетки .txt, под которую собран слой. backdrop — вид фона по
// карте из render-config.json пакета: файлы фона — темы (байт в байт те же),
// высота фона в мире, вуаль (цвет и альфа из 255), прозрачность ближнего слоя.
import type { MapArtEntry } from './mapArtManifest'

export const MAP_ART_NEW_SIX: Record<string, MapArtEntry> = {
  'map_A_burial-quarter.txt': { file: 'map_A_burial-quarter_1.webp', width: 6656, height: 1664, gridChecksum: 0xe705279f, slices: [{ file: 'map_A_burial-quarter_1.webp', x: 0, width: 2240 }, { file: 'map_A_burial-quarter_2.webp', x: 2240, width: 2240 }, { file: 'map_A_burial-quarter_3.webp', x: 4480, width: 2176 }], backdrop: { worldHeight: 1800, dimColor: 0x18161e, dimAlpha: 107 / 255, midAlpha: 1 } },
  'map_B_procession.txt': { file: 'map_B_procession_1.webp', width: 6656, height: 2560, gridChecksum: 0xc7aacfb7, slices: [{ file: 'map_B_procession_1.webp', x: 0, width: 3328 }, { file: 'map_B_procession_2.webp', x: 3328, width: 3328 }], backdrop: { worldHeight: 2560, dimColor: 0x18161e, dimAlpha: 107 / 255, midAlpha: 1 } },
  'map_C_casting-yards.txt': { file: 'map_C_casting-yards_1.webp', width: 6144, height: 1920, gridChecksum: 0xe8271b15, slices: [{ file: 'map_C_casting-yards_1.webp', x: 0, width: 3072 }, { file: 'map_C_casting-yards_2.webp', x: 3072, width: 3072 }], backdrop: { worldHeight: 1920, dimColor: 0x18161e, dimAlpha: 150 / 255, midAlpha: 1 } },
  'map_D_workshops.txt': { file: 'map_D_workshops_1.webp', width: 8192, height: 1920, gridChecksum: 0xa69ff5ec, slices: [{ file: 'map_D_workshops_1.webp', x: 0, width: 4096 }, { file: 'map_D_workshops_2.webp', x: 4096, width: 4096 }], backdrop: { worldHeight: 1920, dimColor: 0x18161e, dimAlpha: 150 / 255, midAlpha: 1 } },
  'map_E_three-halls.txt': { file: 'map_E_three-halls_1.webp', width: 5120, height: 2304, gridChecksum: 0x33d436e2, slices: [{ file: 'map_E_three-halls_1.webp', x: 0, width: 1728 }, { file: 'map_E_three-halls_2.webp', x: 1728, width: 1728 }, { file: 'map_E_three-halls_3.webp', x: 3456, width: 1664 }], backdrop: { worldHeight: 2304, dimColor: 0x18161e, dimAlpha: 107 / 255, midAlpha: 1 } },
  'map_F_eastern-stair.txt': { file: 'map_F_eastern-stair_1.webp', width: 7168, height: 2176, gridChecksum: 0xa0aff6d9, slices: [{ file: 'map_F_eastern-stair_1.webp', x: 0, width: 3584 }, { file: 'map_F_eastern-stair_2.webp', x: 3584, width: 3584 }], backdrop: { worldHeight: 2176, dimColor: 0x18161e, dimAlpha: 107 / 255, midAlpha: 1 } },
  'map_W_swamp-well.txt': { file: 'map_W_swamp-well_1.webp', width: 4608, height: 2560, gridChecksum: 0xfdc92794, slices: [{ file: 'map_W_swamp-well_1.webp', x: 0, width: 2304 }, { file: 'map_W_swamp-well_2.webp', x: 2304, width: 2304 }], backdrop: { worldHeight: 2560, dimColor: 0x14171b, dimAlpha: 155 / 255, midAlpha: 1 } },
  'map_Y_swamp-yards.txt': { file: 'map_Y_swamp-yards_1.webp', width: 5120, height: 2048, gridChecksum: 0x1a513b82, slices: [{ file: 'map_Y_swamp-yards_1.webp', x: 0, width: 1728 }, { file: 'map_Y_swamp-yards_2.webp', x: 1728, width: 1728 }, { file: 'map_Y_swamp-yards_3.webp', x: 3456, width: 1664 }], backdrop: { worldHeight: 2048, dimColor: 0x14171b, dimAlpha: 155 / 255, midAlpha: 1 } },
}
