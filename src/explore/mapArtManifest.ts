// СГЕНЕРИРОВАНО tools/build_map_art.mjs — руками не править, пересобирать скриптом.
//
// Готовые слои платформ и декора карт A, F и болота (B2, C2). gridChecksum —
// контрольная сумма сетки .txt, под которую слой собран: поменяют геометрию карты
// и не пересоберут слой — картинка разойдётся со столкновениями, и игра скажет об
// этом в консоли. slices — слой шире потолка текстуры (4096 px) нарезан по
// ширине: части ставятся встык с x, file тогда — первая часть.
export type MapArtSlice = { file: string; x: number; width: number }
export type MapArtEntry = { file: string; width: number; height: number; gridChecksum: number; slices?: MapArtSlice[] }

export const MAP_ART: Record<string, MapArtEntry> = {
  'map_A_serpentine.txt': { file: 'map_A_serpentine.webp', width: 3072, height: 1536, gridChecksum: 0x229221d3 },
  'map_F_sanctuary.txt': { file: 'map_F_sanctuary.webp', width: 3072, height: 1408, gridChecksum: 0xfa96b6a5 },
  'map_B2_swamp.txt': { file: 'map_B2_swamp_1.webp', width: 2816, height: 2944, gridChecksum: 0xa37ab4b2, slices: [{ file: 'map_B2_swamp_1.webp', x: 0, width: 960 }, { file: 'map_B2_swamp_2.webp', x: 960, width: 960 }, { file: 'map_B2_swamp_3.webp', x: 1920, width: 896 }] },
  'map_C2_swamp_boss.txt': { file: 'map_C2_swamp_boss_1.webp', width: 6144, height: 2432, gridChecksum: 0x403da22e, slices: [{ file: 'map_C2_swamp_boss_1.webp', x: 0, width: 1280 }, { file: 'map_C2_swamp_boss_2.webp', x: 1280, width: 1280 }, { file: 'map_C2_swamp_boss_3.webp', x: 2560, width: 1280 }, { file: 'map_C2_swamp_boss_4.webp', x: 3840, width: 1280 }, { file: 'map_C2_swamp_boss_5.webp', x: 5120, width: 1024 }] },
}
