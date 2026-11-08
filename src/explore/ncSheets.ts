// Листы новых врагов и боссов (09.11.2026) — СГЕНЕРИРОВАНО из sheets.json архива
// RightPlace_new_enemies_bosses.zip, руками не править: перегенерировать.
// Поля: клетка, сетка, якорь (точка ног, доли клетки, кадр 0), fps (уже с
// ускорением), mode (loop / pingpong / once / hold / hurt), playOrder (порядок
// кадров у pingpong и hurt), номера кадров событий, точки вылета spawn /
// impactPoint (px клетки), reachPx (докуда достаёт удар перед точкой ног, px
// листа), eyes (Змей: [x, y, alpha] глаза на каждом кадре, px клетки).

const B = import.meta.env.BASE_URL

export type NcSheetMode = 'loop' | 'pingpong' | 'once' | 'hold' | 'hurt'

export type NcSheet = {
  src: string
  cellW: number
  cellH: number
  count: number
  cols: number
  anchorX: number
  anchorY: number
  fps: number | null
  mode: NcSheetMode
  playOrder?: readonly number[]
  hit?: readonly [number, number]
  release?: number
  spawn?: readonly [number, number]
  block?: readonly [number, number]
  open?: readonly [number, number]
  telegraph?: readonly [number, number]
  thrust?: readonly [number, number]
  impact?: number
  impactPoint?: readonly [number, number]
  reachPx?: number
  eyesIgnite?: readonly [number, number]
  eyes?: readonly (readonly [number, number, number])[]
}

export const NC_SHEETS = {
  Fencer_Idle: { src: `${B}assets/sprites/fencer/Fencer_Idle.webp`, cellW: 187, cellH: 267, count: 31, cols: 21, anchorX: 0.5748, anchorY: 0.991, fps: 12, mode: 'pingpong', playOrder: [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,29,28,27,26,25,24,23,22,21,20,19,18,17,16,15,14,13,12,11,10,9,8,7,6,5,4,3,2,1] },
  Fencer_Walk: { src: `${B}assets/sprites/fencer/Fencer_Walk.webp`, cellW: 233, cellH: 258, count: 32, cols: 17, anchorX: 0.5722, anchorY: 0.9876, fps: 24, mode: 'loop' },
  Fencer_Attack: { src: `${B}assets/sprites/fencer/Fencer_Attack.webp`, cellW: 326, cellH: 266, count: 36, cols: 12, anchorX: 0.712, anchorY: 0.988, fps: 32.4, mode: 'once', hit: [13,19], reachPx: 226 },
  Fencer_Parry: { src: `${B}assets/sprites/fencer/Fencer_Parry.webp`, cellW: 322, cellH: 355, count: 36, cols: 12, anchorX: 0.7525, anchorY: 0.991, fps: 38.4, mode: 'once', block: [4,8], open: [9,20] },
  Fencer_Hurt: { src: `${B}assets/sprites/fencer/Fencer_Hurt.webp`, cellW: 292, cellH: 266, count: 9, cols: 9, anchorX: 0.4685, anchorY: 0.988, fps: null, mode: 'hurt', playOrder: [0,1,2,3,4,5,6,7,8,7,6,5,4,3,2,1,0] },
  Fencer_Death: { src: `${B}assets/sprites/fencer/Fencer_Death.webp`, cellW: 298, cellH: 277, count: 36, cols: 13, anchorX: 0.5751, anchorY: 0.9566, fps: 12, mode: 'hold' },
  Gravedigger_Idle: { src: `${B}assets/sprites/gravedigger/Gravedigger_Idle.webp`, cellW: 170, cellH: 315, count: 43, cols: 24, anchorX: 0.3844, anchorY: 0.9898, fps: 12, mode: 'pingpong', playOrder: [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,41,40,39,38,37,36,35,34,33,32,31,30,29,28,27,26,25,24,23,22,21,20,19,18,17,16,15,14,13,12,11,10,9,8,7,6,5,4,3,2,1] },
  Gravedigger_Walk: { src: `${B}assets/sprites/gravedigger/Gravedigger_Walk.webp`, cellW: 187, cellH: 318, count: 38, cols: 21, anchorX: 0.5171, anchorY: 0.9899, fps: 24, mode: 'loop' },
  Gravedigger_Throw: { src: `${B}assets/sprites/gravedigger/Gravedigger_Throw.webp`, cellW: 358, cellH: 311, count: 30, cols: 11, anchorX: 0.7232, anchorY: 0.9897, fps: 19.2, mode: 'once', release: 10, spawn: [18,120] },
  Gravedigger_Swing: { src: `${B}assets/sprites/gravedigger/Gravedigger_Swing.webp`, cellW: 331, cellH: 374, count: 35, cols: 12, anchorX: 0.6377, anchorY: 0.9893, fps: 19.2, mode: 'once', hit: [14,16], reachPx: 180 },
  Gravedigger_Hurt: { src: `${B}assets/sprites/gravedigger/Gravedigger_Hurt.webp`, cellW: 214, cellH: 312, count: 8, cols: 8, anchorX: 0.4366, anchorY: 0.9897, fps: null, mode: 'hurt', playOrder: [0,1,2,3,4,5,6,7,6,5,4,3,2,1,0] },
  Gravedigger_Death: { src: `${B}assets/sprites/gravedigger/Gravedigger_Death.webp`, cellW: 216, cellH: 314, count: 35, cols: 18, anchorX: 0.3481, anchorY: 0.9796, fps: 12, mode: 'hold' },
  Crossbowman_Idle: { src: `${B}assets/sprites/crossbowman/Crossbowman_Idle.webp`, cellW: 194, cellH: 291, count: 40, cols: 21, anchorX: 0.7284, anchorY: 0.989, fps: 12, mode: 'loop' },
  Crossbowman_Walk: { src: `${B}assets/sprites/crossbowman/Crossbowman_Walk.webp`, cellW: 217, cellH: 294, count: 30, cols: 18, anchorX: 0.6771, anchorY: 0.9864, fps: 24, mode: 'loop' },
  Crossbowman_Shoot: { src: `${B}assets/sprites/crossbowman/Crossbowman_Shoot.webp`, cellW: 284, cellH: 291, count: 37, cols: 14, anchorX: 0.8141, anchorY: 0.9863, fps: 19.2, mode: 'once', release: 16, spawn: [46,51] },
  Crossbowman_Reload: { src: `${B}assets/sprites/crossbowman/Crossbowman_Reload.webp`, cellW: 218, cellH: 291, count: 36, cols: 18, anchorX: 0.6434, anchorY: 0.989, fps: 19.2, mode: 'once' },
  Crossbowman_Hurt: { src: `${B}assets/sprites/crossbowman/Crossbowman_Hurt.webp`, cellW: 214, cellH: 291, count: 10, cols: 10, anchorX: 0.7313, anchorY: 0.989, fps: null, mode: 'hurt', playOrder: [0,1,2,3,4,5,6,7,8,9,8,7,6,5,4,3,2,1,0] },
  Crossbowman_Death: { src: `${B}assets/sprites/crossbowman/Crossbowman_Death.webp`, cellW: 249, cellH: 295, count: 30, cols: 16, anchorX: 0.6206, anchorY: 0.9756, fps: 12, mode: 'hold' },
  Stoker_Idle: { src: `${B}assets/sprites/stoker/Stoker_Idle.webp`, cellW: 270, cellH: 315, count: 31, cols: 15, anchorX: 0.571, anchorY: 0.9898, fps: 12, mode: 'loop' },
  Stoker_Walk: { src: `${B}assets/sprites/stoker/Stoker_Walk.webp`, cellW: 301, cellH: 319, count: 31, cols: 13, anchorX: 0.6356, anchorY: 0.9825, fps: 24, mode: 'loop' },
  Stoker_Attack: { src: `${B}assets/sprites/stoker/Stoker_Attack.webp`, cellW: 390, cellH: 392, count: 39, cols: 10, anchorX: 0.6936, anchorY: 0.9939, fps: 21.6, mode: 'once', hit: [21,23], reachPx: 265 },
  Stoker_Hurt: { src: `${B}assets/sprites/stoker/Stoker_Hurt.webp`, cellW: 294, cellH: 355, count: 7, cols: 7, anchorX: 0.6033, anchorY: 0.991, fps: null, mode: 'hurt', playOrder: [0,1,2,3,4,5,6,5,4,3,2,1,0] },
  Stoker_Death: { src: `${B}assets/sprites/stoker/Stoker_Death.webp`, cellW: 414, cellH: 339, count: 33, cols: 9, anchorX: 0.4739, anchorY: 0.9646, fps: 12, mode: 'hold' },
  Beetle_Idle: { src: `${B}assets/sprites/beetle/Beetle_Idle.webp`, cellW: 401, cellH: 198, count: 42, cols: 10, anchorX: 0.4661, anchorY: 0.9839, fps: 12, mode: 'loop' },
  Beetle_Walk: { src: `${B}assets/sprites/beetle/Beetle_Walk.webp`, cellW: 402, cellH: 203, count: 88, cols: 10, anchorX: 0.4692, anchorY: 0.9724, fps: 24, mode: 'loop' },
  Beetle_Throw: { src: `${B}assets/sprites/beetle/Beetle_Throw.webp`, cellW: 427, cellH: 205, count: 39, cols: 9, anchorX: 0.5056, anchorY: 0.9766, fps: 24, mode: 'once', release: 32, spawn: [36,72] },
  Beetle_Dash: { src: `${B}assets/sprites/beetle/Beetle_Dash.webp`, cellW: 466, cellH: 230, count: 43, cols: 8, anchorX: 0.3986, anchorY: 0.9549, fps: 19.2, mode: 'once', telegraph: [4,18], thrust: [19,25] },
  Beetle_Hurt: { src: `${B}assets/sprites/beetle/Beetle_Hurt.webp`, cellW: 434, cellH: 210, count: 9, cols: 9, anchorX: 0.4871, anchorY: 0.9809, fps: null, mode: 'hurt', playOrder: [0,1,2,3,4,5,6,7,8,7,6,5,4,3,2,1,0] },
  Beetle_Death: { src: `${B}assets/sprites/beetle/Beetle_Death.webp`, cellW: 482, cellH: 218, count: 32, cols: 8, anchorX: 0.4452, anchorY: 0.9121, fps: 12, mode: 'hold' },
  Serpent_Idle: { src: `${B}assets/sprites/serpent/Serpent_Idle.webp`, cellW: 330, cellH: 348, count: 42, cols: 12, anchorX: 0.6045, anchorY: 0.9885, fps: 12, mode: 'loop', eyes: [[97,87,1],[97,86,1],[97,85,1],[96,83,1],[96,81,1],[95,79,1],[95,76,1],[95,74,1],[94,71,1],[93,69,1],[93,67,1],[93,65,1],[92,64,1],[91,62,1],[90,63,1],[89,64,1],[88,65,1],[87,67,1],[86,69,1],[85,71,1],[84,72,1],[83,75,1],[83,76,1],[82,78,1],[82,80,1],[81,82,1],[81,84,1],[81,85,1],[82,87,1],[83,88,1],[84,89,1],[85,90,1],[85,90,1],[86,91,1],[87,91,1],[89,91,1],[90,91,1],[91,91,1],[92,91,1],[93,90,1],[94,89,1],[95,89,1]] },
  Serpent_Submerge: { src: `${B}assets/sprites/serpent/Serpent_Submerge.webp`, cellW: 390, cellH: 371, count: 47, cols: 10, anchorX: 0.5359, anchorY: 0.973, fps: 26, mode: 'once', eyes: [[105,104,1],[105,104,1],[103,105,1],[100,106,1],[97,106,1],[94,107,1],[90,107,1],[87,106,1],[83,105,1],[79,103,1],[77,100,1],[75,97,1],[75,94,1],[76,91,1],[77,88,1],[79,87,1],[81,86,1],[84,86,1],[86,87,1],[89,89,1],[92,93,1],[92,101,1],[91,112,1],[87,124,1],[85,136,1],[83,147,1],[81,159,1],[80,171,1],[80,181,1],[80,190,1],[83,196,1],[85,205,1],[91,209,1],[102,210,1],[126,208,1],[153,212,1],[175,225,1],[174,259,0.5],[196,298,0],[201,323,0],[181,359,0],[181,359,0],[181,359,0],[181,359,0],[181,359,0],[46,351,0],[181,359,0]] },
  Serpent_Emerge: { src: `${B}assets/sprites/serpent/Serpent_Emerge.webp`, cellW: 496, cellH: 476, count: 43, cols: 8, anchorX: 0.5, anchorY: 0.9223, fps: 26, mode: 'once', eyes: [[136,-19,0],[136,-19,0],[136,-19,0],[136,-19,0],[136,-19,0],[136,-19,0],[246,174,0],[289,133,0.5],[293,93,1],[291,82,1],[286,72,1],[280,66,1],[272,62,1],[262,60,1],[249,61,1],[230,69,1],[194,84,1],[168,106,1],[160,114,1],[151,123,1],[142,135,1],[135,147,1],[129,160,1],[125,173,1],[123,185,1],[122,196,1],[122,207,1],[124,214,1],[125,221,1],[128,217,1],[129,213,1],[132,208,1],[136,204,1],[142,200,1],[145,197,1],[149,193,1],[155,188,1],[158,185,1],[162,182,1],[164,180,1],[165,179,1],[166,178,1],[165,178,1]] },
  Serpent_Spit: { src: `${B}assets/sprites/serpent/Serpent_Spit.webp`, cellW: 447, cellH: 360, count: 47, cols: 9, anchorX: 0.7092, anchorY: 0.9889, fps: 26, mode: 'once', release: 22, spawn: [-87,122], eyes: [[213,100,1],[213,99,1],[213,98,1],[213,96,1],[213,93,1],[213,89,1],[213,85,1],[213,80,1],[214,75,1],[214,70,1],[215,65,1],[216,60,1],[216,55,1],[216,51,1],[216,47,1],[216,44,1],[216,42,1],[216,41,1],[216,41,1],[210,45,1],[189,64,1],[165,88,1],[147,109,1],[139,120,1],[138,122,1],[139,121,1],[142,119,1],[146,115,1],[151,110,1],[157,104,1],[164,97,1],[172,90,1],[179,83,1],[186,77,1],[193,73,1],[199,70,1],[202,71,1],[204,75,1],[206,79,1],[207,84,1],[208,89,1],[210,93,1],[211,97,1],[212,100,1],[212,100,1],[212,101,1],[212,100,1]] },
  Serpent_Hurt: { src: `${B}assets/sprites/serpent/Serpent_Hurt.webp`, cellW: 315, cellH: 344, count: 9, cols: 9, anchorX: 0.5921, anchorY: 0.9884, fps: null, mode: 'hurt', playOrder: [0,1,2,3,4,5,6,7,8,7,6,5,4,3,2,1,0], eyes: [[81,95,1],[83,95,1],[86,94,1],[89,94,1],[92,92,1],[94,90,1],[110,72,1],[126,55,1],[124,52,1]] },
  Serpent_Death: { src: `${B}assets/sprites/serpent/Serpent_Death.webp`, cellW: 362, cellH: 436, count: 42, cols: 11, anchorX: 0.5566, anchorY: 0.9885, fps: 18, mode: 'hold', eyes: [[99,173,1],[97,175,1],[92,178,1],[89,181,1],[85,184,1],[81,186,1],[78,186,1],[75,186,1],[73,184,1],[74,179,1],[77,172,1],[81,163,1],[87,154,1],[94,143,1],[103,132,1],[111,122,1],[115,114,1],[121,107,1],[127,101,1],[133,96,1],[138,93,1],[143,92,1],[149,93,1],[154,98,1],[159,107,1],[162,120,1],[166,139,1],[169,163,1],[172,192,1],[172,227,1],[172,266,0.9],[174,295,0.8],[177,294,0.7],[180,293,0.6],[184,294,0.5],[187,296,0.4],[191,296,0.3],[192,294,0.2],[192,294,0.1],[189,298,0],[189,298,0],[189,298,0]] },
  Serpent_Slam: { src: `${B}assets/sprites/serpent/Serpent_Slam.webp`, cellW: 506, cellH: 398, count: 47, cols: 8, anchorX: 0.7421, anchorY: 0.9849, fps: 26, mode: 'once', impact: 25, impactPoint: [112,394], eyes: [[279,133,1],[279,133,1],[279,134,1],[279,135,1],[279,136,1],[279,138,1],[279,139,1],[279,140,1],[278,141,1],[273,147,1],[267,154,1],[261,161,1],[255,169,1],[250,174,1],[249,166,1],[253,142,1],[267,109,1],[286,77,1],[308,52,1],[323,38,1],[322,36,1],[301,39,1],[266,61,1],[206,136,1],[175,249,1],[178,314,1],[175,316,1],[174,315,1],[172,315,1],[174,311,1],[175,312,1],[175,314,1],[175,310,1],[181,279,1],[196,234,1],[219,189,1],[249,153,1],[268,132,1],[276,117,1],[284,106,1],[285,105,1],[285,107,1],[284,110,1],[281,112,1],[277,118,1],[275,121,1],[274,123,1]] },
  Serpent_Bite: { src: `${B}assets/sprites/serpent/Serpent_Bite.webp`, cellW: 480, cellH: 345, count: 47, cols: 8, anchorX: 0.724, anchorY: 0.9884, fps: 26, mode: 'once', hit: [19,23], reachPx: 342, eyes: [[244,84,1],[245,84,1],[246,85,1],[248,87,1],[251,89,1],[255,92,1],[260,95,1],[265,99,1],[270,102,1],[274,105,1],[276,106,1],[268,102,1],[252,95,1],[231,87,1],[206,81,1],[180,79,1],[153,85,1],[126,98,1],[104,115,1],[91,134,1],[85,147,1],[82,156,1],[82,159,1],[83,157,1],[86,154,1],[91,149,1],[98,143,1],[105,138,1],[114,133,1],[126,129,1],[139,126,1],[152,125,1],[165,124,1],[178,124,1],[191,124,1],[203,121,1],[213,118,1],[221,113,1],[226,109,1],[232,103,1],[236,98,1],[239,93,1],[241,90,1],[242,87,1],[244,85,1],[244,84,1],[244,84,1]] },
  Serpent_Roar: { src: `${B}assets/sprites/serpent/Serpent_Roar.webp`, cellW: 327, cellH: 390, count: 47, cols: 12, anchorX: 0.6024, anchorY: 0.9897, fps: 18, mode: 'once', eyesIgnite: [12,16], eyes: [[93,129,0],[93,129,0],[95,127,0],[98,124,0],[103,119,0],[109,112,0],[115,100,0],[120,85,0],[125,70,0],[128,57,0],[127,46,0],[121,41,0],[110,40,0.2],[99,42,0.4],[90,45,0.6],[87,46,0.8],[86,46,1],[85,46,1],[84,46,1],[83,46,1],[82,46,1],[82,46,1],[82,46,1],[83,48,1],[85,53,1],[88,60,1],[92,69,1],[96,79,1],[99,89,1],[102,100,1],[104,110,1],[103,117,1],[100,123,1],[96,130,1],[92,138,1],[88,145,1],[85,151,1],[83,155,1],[82,157,1],[82,157,1],[82,157,1],[82,156,1],[82,155,1],[82,154,1],[82,152,1],[82,150,1],[82,148,1]] },
  CrowKing_Idle: { src: `${B}assets/sprites/crowking/CrowKing_Idle.webp`, cellW: 196, cellH: 337, count: 47, cols: 20, anchorX: 0.4515, anchorY: 0.9852, fps: 12, mode: 'loop' },
  CrowKing_Walk: { src: `${B}assets/sprites/crowking/CrowKing_Walk.webp`, cellW: 197, cellH: 344, count: 44, cols: 20, anchorX: 0.4746, anchorY: 0.9709, fps: 24, mode: 'loop' },
  CrowKing_Strike: { src: `${B}assets/sprites/crowking/CrowKing_Strike.webp`, cellW: 584, cellH: 399, count: 47, cols: 7, anchorX: 0.5231, anchorY: 0.9749, fps: 26, mode: 'once', hit: [25,33], reachPx: 300 },
  CrowKing_Scatter: { src: `${B}assets/sprites/crowking/CrowKing_Scatter.webp`, cellW: 786, cellH: 394, count: 18, cols: 5, anchorX: 0.5013, anchorY: 0.9873, fps: 26, mode: 'once' },
  CrowKing_Hurt: { src: `${B}assets/sprites/crowking/CrowKing_Hurt.webp`, cellW: 490, cellH: 367, count: 6, cols: 6, anchorX: 0.4898, anchorY: 0.9264, fps: null, mode: 'hurt', playOrder: [0,1,2,3,4,5,4,3,2,1,0] },
  CrowKing_Death: { src: `${B}assets/sprites/crowking/CrowKing_Death.webp`, cellW: 519, cellH: 359, count: 43, cols: 7, anchorX: 0.5385, anchorY: 0.9582, fps: 18, mode: 'hold' },
} as const satisfies Record<string, NcSheet>

export type NcSheetName = keyof typeof NC_SHEETS
