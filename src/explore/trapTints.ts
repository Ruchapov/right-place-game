// СГЕНЕРИРОВАНО tools/measure_trap_tint.py — руками не править.
//
// Слой карты у ловушек (17.11.2026): средний цвет кладки за головой горгульи
// и потолка над сталактитом (0..255; им красит stoneTint.ts), и насколько
// видимый верх пола ниже линии клетки под рельсом пилы (px; ключ «x0,y»).
// TRAP_SRC_LUM — средняя яркость серого камня самих ассетов.
export type TrapTint = { gargoyle?: [number, number, number]; stalactite?: [number, number, number]; sawSink?: Record<string, number> }

export const TRAP_SRC_LUM = { gargoyle: 0.389, stalactite: 0.4121, rubble: 0.4244 }

export const TRAP_TINTS: Record<string, TrapTint> = {
  'map_A_burial-quarter.txt': { stalactite: [115, 108, 86], sawSink: { '47,15': 3 } },
  'map_B2_swamp.txt': { stalactite: [89, 72, 51] },
  'map_B_procession.txt': { gargoyle: [113, 106, 86], stalactite: [113, 107, 87], sawSink: { '26,37': 0, '50,29': 0 } },
  'map_C2_swamp_boss.txt': { gargoyle: [89, 72, 49], stalactite: [96, 78, 54], sawSink: { '46,10': 0 } },
  'map_C_casting-yards.txt': { gargoyle: [119, 110, 99], stalactite: [122, 112, 101] },
  'map_D_workshops.txt': { gargoyle: [119, 109, 99], stalactite: [122, 112, 102], sawSink: { '45,27': 0, '94,11': 0 } },
  'map_E_three-halls.txt': { gargoyle: [94, 94, 98], stalactite: [99, 99, 103], sawSink: { '48,17': 0, '28,17': 0 } },
  'map_F_eastern-stair.txt': { gargoyle: [85, 85, 89], stalactite: [106, 105, 109], sawSink: { '77,15': 0, '30,31': 0 } },
  'map_W_swamp-well.txt': { gargoyle: [89, 73, 50], stalactite: [79, 64, 44] },
  'map_Y_swamp-yards.txt': { gargoyle: [88, 71, 48], stalactite: [75, 61, 41] },
}
