// СГЕНЕРИРОВАНО tools/build_map_art.mjs — руками не править, пересобирать скриптом.
//
// Готовые слои платформ и декора карт A и F. gridChecksum — контрольная сумма
// сетки .txt, под которую слой собран: поменяют геометрию карты и не пересоберут
// слой — картинка разойдётся со столкновениями, и игра скажет об этом в консоли.
export type MapArtEntry = { file: string; width: number; height: number; gridChecksum: number }

export const MAP_ART: Record<string, MapArtEntry> = {
  'map_A_serpentine.txt': { file: 'map_A_serpentine.webp', width: 3072, height: 1536, gridChecksum: 0x229221d3 },
  'map_F_sanctuary.txt': { file: 'map_F_sanctuary.webp', width: 3072, height: 1408, gridChecksum: 0xfa96b6a5 },
}
