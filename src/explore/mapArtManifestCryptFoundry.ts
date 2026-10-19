// СГЕНЕРИРОВАНО tools/build_map_art_crypt_foundry.mjs — руками не править, пересобирать скриптом.
//
// Готовые слои платформ и декора карт склепа (B, D_OPEN, D_SEALED) и литейной (E).
// Слои карт A и F — в mapArtManifest.ts (их собирает tools/build_map_art.mjs).
// gridChecksum — контрольная сумма сетки .txt, под которую слой собран: поменяют
// геометрию карты и не пересоберут слой — картинка разойдётся со столкновениями,
// и игра скажет об этом в консоли.
import type { MapArtEntry } from './mapArtManifest'

export const MAP_ART_CRYPT_FOUNDRY: Record<string, MapArtEntry> = {
  'map_B_razlom.txt': { file: 'map_B_razlom.webp', width: 3072, height: 1536, gridChecksum: 0xf6dfe442 },
  'map_D_OPEN.txt': { file: 'map_D_OPEN.webp', width: 3136, height: 1792, gridChecksum: 0x853287cf },
  'map_D_SEALED.txt': { file: 'map_D_SEALED.webp', width: 3136, height: 1792, gridChecksum: 0xaa0a58b4 },
  'map_E_towers.txt': { file: 'map_E_towers.webp', width: 3072, height: 1536, gridChecksum: 0x0d29d252 },
}
