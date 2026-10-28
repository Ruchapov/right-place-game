import { useEffect, useRef, useState, type CSSProperties, type MouseEvent, type RefObject } from 'react'
import { QUEST_UNLOCK_LEVEL, questById, type QuestId } from '../quests'
import type { QuestReward, QuestView } from '../api'
import { C } from './theme'
// Какие листки видны и что на них — без вёрстки, общее с App.tsx.
import { boardNotes, type BoardNote } from './questBoardModel'

// Доска ежедневных заданий (26.10.2026). Вид — docs/quest-board-art.md, эталон —
// docs/quest-board-mock.png; правила заданий — docs/daily-quests.md.
//
// Здесь только ВИД: что взять, что заменить и когда перечитать, решает App.tsx
// (там же запросы и подтверждение). Доска рисуется в двух местах одним и тем же
// компонентом QuestBoard:
//   • на стене убежища (вкладка «Исследовать») — уменьшенной копией
//     (QuestWallBoard ниже): та же вёрстка той же ширины, ужатая transform'ом
//     под свободное место у героя, нажимается целиком и открывает доску;
//   • открытой — в полный размер, как в эталоне: там берутся и меняются задания.
// Одна вёрстка на оба места намеренно: копия на стене не может разойтись с
// доской ни видом, ни составом листков.

/** Шрифт «чернил» — Lora Italic (index.html, Google Fonts; есть кириллица). */
export const FONT_INK = "'Lora', Georgia, 'Times New Roman', serif"

const INK = '#22160E'
const INK_RED = '#78160C'
const inkShadow = (rgb: string) => `0 0 1px rgba(${rgb}, 0.35)`

// Наклон текста листка по ПОЗИЦИИ на доске — фиксированный, не случайный: иначе
// он менялся бы на каждый рендер и текст дёргался. Четвёртый — на случай
// переходящего задания и трёх новых.
const NOTE_TILT_DEG = [-1.2, -0.7, -1.5, -0.9]

// Гвоздь и кинжал — из docs/quest-board-art.md (размеры картинок 67×106 и 260×237).
const NAIL_W = 15
const NAIL_H = NAIL_W * 106 / 67
const DAGGER_W = 58
const DAGGER_H = DAGGER_W * 237 / 260

// Доска — 9-slice: картинка 1100×597 режется по 160 px и рисуется на 40 css px
// внутрь от края (`border-image … / 40px`) — поверх отступов, сколько бы их ни
// было. Что лежит в этой полосе (замер по картинке 27.10.2026, × 40/160):
// боковая планка рамы с тенью — до ≈21 css px от края, нижняя — до ≈16; ржавый
// уголок — буквой «Г»: плечо вдоль боковой планки ≈13 px шириной и ≈35 px
// высотой, плечо вдоль нижней (верхней) ≈36 px длиной и ≈13 px высотой.
const BOARD_FRAME = 40
// Листки отстоят от края доски на 22 css px (docs/quest-board-art.md) — по
// бокам И СНИЗУ: дальше внутреннего края планки и мимо обоих плеч уголка, так
// что рама и уголки остаются видны целиком. До 27.10.2026 снизу стояло 4 px —
// нижний листок ложился на нижнюю планку и закрывал плечи уголков.
const NOTE_INSET = 22
// Сверху листки ниже строки «Задания»; сама строка начинается сразу под верхней
// планкой и уголками не задета (их верхнее плечо — 13 px, вертикальное — левее
// текста).
const BOARD_TOP = 14

const asset = (name: string) => `${import.meta.env.BASE_URL}assets/${name}`

/** Иконки трёх наград — те же, что у валют в меню (128×128, прозрачный фон). */
const QUEST_REWARD_ICONS: { key: keyof QuestReward; src: string; alt: string }[] = [
  { key: 'gold', src: 'icons/icon_gold.png', alt: 'Золото' },
  { key: 'hunterBadges', src: 'icons/icon_hunter_badge.png', alt: 'Значки охотника' },
  { key: 'rp', src: 'icons/icon_rp.png', alt: 'RP' },
]

/**
 * Награда строкой: число + иконка, по порядку золото, значки, RP. Общая для
 * листка (чернилами) и для экрана итогов забега (светлым по камню) — стиль
 * числа приходит снаружи.
 */
export function QuestRewardRow({ reward, numberStyle, iconSize, gap }: {
  reward: QuestReward
  numberStyle: CSSProperties
  iconSize: number
  gap: number
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap, minWidth: 0 }}>
      {QUEST_REWARD_ICONS.map((icon) => (
        <div key={icon.key} style={{ display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0 }}>
          <span style={numberStyle}>{reward[icon.key]}</span>
          <img
            src={asset(icon.src)}
            alt={icon.alt}
            draggable={false}
            style={{ width: iconSize, height: iconSize, objectFit: 'contain', display: 'block' }}
          />
        </div>
      ))}
    </div>
  )
}

function Note({ note, index, replaceAvailable, interactive, onTake, onReplace }: {
  note: BoardNote
  index: number
  replaceAvailable: boolean
  interactive: boolean
  onTake: (id: QuestId) => void
  onReplace: (id: QuestId) => void
}) {
  const quest = questById(note.id)
  // Каталог не знает id — readQuestView такой вид не пропускает; здесь страховка.
  const name = quest?.nameRu ?? note.id
  const description = quest?.descriptionRu ?? ''
  const tilt = NOTE_TILT_DEG[index % NOTE_TILT_DEG.length]
  const ink: CSSProperties = { color: INK, mixBlendMode: 'multiply', textShadow: inkShadow('34, 22, 14') }
  const red: CSSProperties = { color: INK_RED, mixBlendMode: 'multiply', textShadow: inkShadow('120, 22, 12') }
  const takeable = interactive && !note.active
  return (
    <div
      data-quest-note={note.id}
      onClick={takeable ? () => onTake(note.id) : undefined}
      style={{ position: 'relative', cursor: takeable ? 'pointer' : 'default' }}
    >
      {/* Бумага — 9-slice и чуть светлее исходника. Фильтр и смешивание чернил
          живут ВНУТРИ неё: текст впитывается в бумагу, а гвоздь и кинжал
          (снаружи) этим не задеты. */}
      <div style={{
        boxSizing: 'border-box',
        // Рамка в раскладке — 1 px, а картинка рисуется на 12 px внутрь (поверх
        // отступов): так текст встаёт по эталону, близко к рваному краю.
        borderStyle: 'solid',
        borderWidth: 1,
        borderColor: 'transparent',
        borderImage: `url(${asset('quests/quest_note.webp')}) 60 fill / 12px stretch`,
        filter: 'brightness(1.12)',
        // Слева 26 (у активного 48 — место под кинжал), справа 24 — от края
        // листка; сверху и снизу — по эталону docs/quest-board-mock.png.
        padding: `6px 23px 14px ${note.active ? 47 : 25}px`,
        fontFamily: FONT_INK,
        fontStyle: 'italic',
      }}>
        <div style={{ transform: `rotate(${tilt}deg)`, transformOrigin: 'left center' }}>
          <div style={{ ...ink, fontWeight: 700, fontSize: 17, lineHeight: 1.25 }}>{name}</div>
          <div style={{ ...ink, fontWeight: 500, fontSize: 14, lineHeight: 1.32, marginTop: 4 }}>{description}</div>
          {/* Строка награды. Не влезает справа прогресс или «Заменить» (узкий
              экран, трёхзначные награды на высоких уровнях) — они переносятся
              на следующую строку вправо, а не наезжают на иконки. */}
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', columnGap: 6, rowGap: 2, marginTop: 3 }}>
            <QuestRewardRow
              reward={note.reward}
              numberStyle={{ ...ink, fontWeight: 600, fontSize: 14 }}
              iconSize={16}
              gap={7}
            />
            {note.active ? (
              <span style={{ ...red, fontWeight: 700, fontSize: 18, whiteSpace: 'nowrap', flexShrink: 0, marginLeft: 'auto' }}>
                {note.progress ?? 0} / {note.goal}
              </span>
            ) : replaceAvailable && (
              <span
                data-quest-replace={note.id}
                onClick={interactive ? (e) => { e.stopPropagation(); onReplace(note.id) } : undefined}
                style={{
                  ...red, fontWeight: 600, fontSize: 14, textDecoration: 'underline',
                  whiteSpace: 'nowrap', flexShrink: 0,
                  // Зона касания шире слова: палец, а не курсор (≥ 44 px высотой).
                  // Слева поле auto — прижать к правому краю и при переносе.
                  padding: '13px 4px', marginTop: -13, marginBottom: -13, marginRight: -4, marginLeft: 'auto',
                  cursor: interactive ? 'pointer' : 'default',
                }}
              >
                Заменить
              </span>
            )}
          </div>
        </div>
      </div>
      {/* Гвоздь — у каждого листка: центр на 82% ширины, выше листка на 30%
          своей высоты. */}
      <img
        src={asset('quests/quest_nail.webp')}
        alt=""
        draggable={false}
        style={{ position: 'absolute', width: NAIL_W, height: NAIL_H, left: `calc(82% - ${NAIL_W / 2}px)`, top: -NAIL_H * 0.3, pointerEvents: 'none' }}
      />
      {/* Кинжал — только у активного: клинок входит в бумагу в точке (28, 40)
          листка, рукоять уходит за край влево-вверх. */}
      {note.active && (
        <img
          src={asset('quests/quest_dagger.webp')}
          alt=""
          draggable={false}
          style={{ position: 'absolute', width: DAGGER_W, height: DAGGER_H, left: 28 - DAGGER_W * 0.915, top: 40 - DAGGER_H * 0.905, pointerEvents: 'none' }}
        />
      )}
    </div>
  )
}

export type QuestBoardProps = {
  /** null — вида ещё нет (не загружен или не загрузился, см. status). */
  view: QuestView | null
  /** Почему вида нет: 'loading' — грузится, 'failed' — не загрузился. */
  status: 'loading' | 'ready' | 'failed'
  /** Уровень героя — до ответа сервера по нему решается «ещё не готов». null — неизвестен. */
  level: number | null
  /** Текст «новые через Ч:ММ» или null — таймер не запущен. */
  countdown: string | null
  /** Нажимаются ли листки и «Заменить» (на стене — нет: там нажимается доска целиком). */
  interactive: boolean
  onTake: (id: QuestId) => void
  onReplace: (id: QuestId) => void
  /** Листки в два столбца — только у доски набок (QuestBoardSideFit). */
  columns?: 1 | 2
}

/**
 * Доска: тёмные доски в раме (9-slice — рама и уголки не вытягиваются), сверху
 * «Задания» и «новые через Ч:ММ», под ними листки. Ширину задаёт родитель,
 * высота — по содержимому.
 */
export function QuestBoard({ view, status, level, countdown, interactive, onTake, onReplace, columns = 1 }: QuestBoardProps) {
  const unlockLevel = view?.unlockLevel ?? QUEST_UNLOCK_LEVEL
  const locked = view !== null ? !view.unlocked : level !== null && level < unlockLevel
  const notes = view !== null && view.unlocked ? boardNotes(view) : []
  const lineStyle: CSSProperties = {
    fontFamily: FONT_INK, fontStyle: 'italic', fontWeight: 500, fontSize: 15,
    color: '#D9C9A6', textShadow: '0 1px 2px rgba(0,0,0,0.85)', textAlign: 'center',
    lineHeight: 1.4, padding: '6px 4px 4px',
  }
  return (
    <div data-quest-board="" style={{
      boxSizing: 'border-box',
      width: '100%',
      // Своё выравнивание: вкладка «Исследовать» центрирует текст, а чернила на
      // листках пишутся от левого края.
      textAlign: 'left',
      borderStyle: 'solid',
      // Высота доски = BOARD_TOP + строка «Задания» + листки и промежутки +
      // NOTE_INSET: по высоте содержимого, а раму картинка рисует на
      // BOARD_FRAME px внутрь сама, поверх этих отступов (числа и почему
      // именно они — у констант выше).
      borderWidth: `${BOARD_TOP}px ${NOTE_INSET}px ${NOTE_INSET}px`,
      borderColor: 'transparent',
      borderImage: `url(${asset('quests/quest_board.webp')}) 160 fill / ${BOARD_FRAME}px stretch`,
      // Пустая доска (всё сделано, «ещё не готов») не ниже двух уголков рамки —
      // иначе 40-пиксельные уголки сжались бы.
      minHeight: 96,
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, padding: '0 2px 13px' }}>
        <span style={{ fontFamily: FONT_INK, fontStyle: 'italic', fontWeight: 700, fontSize: 18, color: '#E9DCC0', textShadow: '0 1px 2px rgba(0,0,0,0.9)' }}>
          Задания
        </span>
        {countdown !== null && !locked && (
          <span data-quest-countdown="" style={{ fontFamily: FONT_INK, fontStyle: 'italic', fontWeight: 500, fontSize: 15, color: '#CDBF9F', textShadow: '0 1px 2px rgba(0,0,0,0.9)', whiteSpace: 'nowrap' }}>
            новые через {countdown}
          </span>
        )}
      </div>
      {locked ? (
        <div style={lineStyle}>Ты ещё не готов. Задания — с {unlockLevel} уровня</div>
      ) : view === null ? (
        <div style={{ ...lineStyle, color: C.textDim }}>
          {status === 'failed' ? 'Задания не загрузились' : 'Задания загружаются…'}
        </div>
      ) : (
        <div style={columns === 2
          // Два столбца (набок): промежуток между ними шире, чем между рядами, —
          // кинжал активного листка выходит за его левый край на 25 px и не
          // должен лечь на соседний листок.
          ? { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', alignItems: 'start', columnGap: SIDE_COLUMN_GAP, rowGap: 8 }
          : { display: 'flex', flexDirection: 'column', gap: 8 }}>
          {notes.map((note, i) => (
            <Note
              key={note.id}
              note={note}
              index={i}
              replaceAvailable={view.replaceAvailable}
              interactive={interactive}
              onTake={onTake}
              onReplace={onReplace}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// Доска набок (QuestBoardSideFit). Ширина в два столбца — не больше этого, в
// один (листков меньше трёх, «ещё не готов») — как у доски в вертикали.
const SIDE_BOARD_MAX_W = 720
const SIDE_BOARD_ONE_COLUMN_W = 400
const SIDE_COLUMN_GAP = 28
const stopClick = (e: MouseEvent) => e.stopPropagation()

/**
 * Открытая доска на телефоне набок (sideMenu, 28.10.2026): целиком в области
 * между безопасными зонами, без прокрутки. В вертикали доска узкая и высокая,
 * набок такой она не влезает (402 px с тремя листками при 270–350 доступных),
 * а ужатая целиком давала бы текст мельче 11 px (у 4 листков на 780×360 —
 * ≈8 px). Поэтому листки — в два столбца в более широкой доске той же вёрстки,
 * и уже она уменьшается transform'ом до доступной высоты (и ширины), сохраняя
 * пропорции рамы, уголков и отступов (docs/quest-board-art.md).
 * Касание мимо доски проходит к подложке (она закрывает доску): ловит его
 * только сама доска.
 */
export function QuestBoardSideFit(props: QuestBoardProps) {
  const areaRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)
  const [fit, setFit] = useState<{ w: number; h: number; natH: number } | null>(null)
  useEffect(() => {
    const area = areaRef.current
    const inner = innerRef.current
    if (!area || !inner) return
    // offsetHeight от transform не зависит — это высота доски в полный размер.
    const measure = () => setFit((prev) => {
      const next = { w: area.clientWidth, h: area.clientHeight, natH: inner.offsetHeight }
      return prev && prev.w === next.w && prev.h === next.h && prev.natH === next.natH ? prev : next
    })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(area)
    ro.observe(inner)
    return () => ro.disconnect()
  }, [])
  const { view } = props
  const twoColumns = view !== null && view.unlocked && boardNotes(view).length >= 3
  const maxW = twoColumns ? SIDE_BOARD_MAX_W : SIDE_BOARD_ONE_COLUMN_W
  const natW = fit ? Math.min(fit.w, maxW) : maxW
  const scale = fit && fit.natH > 0 ? Math.min(1, fit.h / fit.natH) : 0
  return (
    <div ref={areaRef} style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
      <div
        data-quest-board-fit=""
        onClick={stopClick}
        style={{ flexShrink: 0, width: natW * scale, height: fit ? fit.natH * scale : 0, visibility: scale > 0 ? 'visible' : 'hidden' }}
      >
        <div ref={innerRef} style={{ width: natW, transform: `scale(${scale})`, transformOrigin: 'top left' }}>
          <QuestBoard {...props} columns={twoColumns ? 2 : 1} />
        </div>
      </div>
    </div>
  )
}

/** Где на стене убежища висит уменьшенная доска (считает QuestWallBoard). */
type WallPlacement = { left: number; top: number; scale: number }

// Геометрия сцены у костра — в px колонки вкладки, от тех же чисел, что ставят
// саму сцену (RefugeScene в App.tsx): якорь — середина низа сцены, сцена
// 502×355 до масштаба, герой — левые 317 px, костёр — справа от него.
export type RefugeSceneGeometry = {
  /** Якорь сцены по горизонтали, доля ширины колонки (0.46 = 50% − 4%). */
  anchorXFrac: number
  /** Якорь по вертикали, доля высоты колонки (0.64). */
  anchorYFrac: number
  /** Масштаб сцены (0.42). */
  scale: number
  /** Ширина и высота всей сцены до масштаба (502 × 355). */
  sceneW: number
  sceneH: number
  /** Ширина кадра героя до масштаба (317) — правее него костёр. */
  heroW: number
  /** Высота костра над якорем до масштаба (187 − 12). */
  fireH: number
}

// Насколько крупной бывает копия на стене: больше — она спорит с героем за
// внимание и закрывает стену, меньше 0.4 — листки превращаются в пятна, и
// тогда лучше перевесить её на другую сторону.
const WALL_SCALE_MAX = 0.62
const WALL_SCALE_GOOD = 0.4
// Зазоры от героя, костра, края колонки и энергии сверху.
const WALL_GAP = 12
const WALL_EDGE = 12
// Высота доски с тремя листками к её ширине (замер 27.10.2026 на экране 375:
// 402 к 343 — с нижним отступом NOTE_INSET; до него было 384). По ней, а не по
// нынешнему содержимому, выбираются сторона стены и масштаб: иначе копия
// перепрыгивала бы на другую стену и меняла ширину, когда задание выполнено.
const WALL_REF_ASPECT = 1.17

/**
 * Где повесить копию доски размером natW × natH (до масштаба) в колонке W × H.
 * Два места на стене, оба — не заходя на героя и костёр:
 *   A — над героем, у левой стены (там стена самая широкая и ровная);
 *   B — справа от героя, над костром (его свет на доске).
 * Сторона и масштаб — по доске с тремя листками (WALL_REF_ASPECT): A, если
 * такая копия там не мельче WALL_SCALE_GOOD, иначе то, где она крупнее. На
 * высоком экране это A, на коротком (над головой героя стены почти нет) — B.
 * Доска выше эталонной (переходящее и три новых) ужимается под своё место.
 */
function placeOnWall(W: number, H: number, wallTop: number, natW: number, natH: number, g: RefugeSceneGeometry): WallPlacement {
  const anchorX = W * g.anchorXFrac
  const anchorY = H * g.anchorYFrac
  const sceneLeft = anchorX - (g.sceneW * g.scale) / 2
  const heroTop = anchorY - g.sceneH * g.scale
  const heroRight = sceneLeft + g.heroW * g.scale
  const fireTop = anchorY - g.fireH * g.scale
  const refH = natW * WALL_REF_ASPECT
  const fit = (w: number, h: number) => Math.max(0, Math.min(WALL_SCALE_MAX, w / natW, h / refH))

  const aW = W * 0.66 - WALL_EDGE
  const aH = heroTop - WALL_GAP - wallTop
  const sA = fit(aW, aH)
  const bLeft = heroRight + WALL_GAP
  const bW = W - WALL_EDGE - bLeft
  const bH = fireTop - WALL_GAP - wallTop
  const sB = fit(bW, bH)

  if (sA >= WALL_SCALE_GOOD || sA >= sB) {
    // Над героем, сдвинута влево: центр — над его плечом, но не дальше левого
    // края стены.
    const scale = Math.min(sA, aH / natH)
    const w = natW * scale
    const heroCenter = sceneLeft + (g.heroW * g.scale) / 2
    const left = Math.max(WALL_EDGE, Math.min(heroCenter - w * 0.62, W - WALL_EDGE - w))
    return { left, top: wallTop, scale }
  }
  const scale = Math.min(sB, bH / natH)
  return { left: bLeft + Math.max(0, (bW - natW * scale) / 2), top: wallTop, scale }
}

/**
 * Копия доски на стене убежища. Ставится ВНУТРЬ колонки вкладки абсолютным
 * слоем во всю колонку (pointer-events: none) и сама меряет колонку, верх стены
 * (низ блока энергии — wallTopRef) и высоту доски, чтобы выбрать место
 * (placeOnWall). Нажимается целиком: onOpen открывает доску в полный размер.
 *
 * Доска внутри — та же вёрстка той же ширины, что открытая (колонка − 32 px),
 * ужатая transform: scale. Высота в раскладке от transform не меняется, поэтому
 * её честно меряет ResizeObserver.
 */
export function QuestWallBoard({ board, geometry, wallTopRef, onOpen }: {
  board: Omit<QuestBoardProps, 'interactive' | 'onTake' | 'onReplace'>
  geometry: RefugeSceneGeometry
  wallTopRef: RefObject<HTMLElement | null>
  onOpen: () => void
}) {
  const layerRef = useRef<HTMLDivElement | null>(null)
  const innerRef = useRef<HTMLDivElement | null>(null)
  const [box, setBox] = useState<{ W: number; H: number; wallTop: number; natH: number } | null>(null)

  useEffect(() => {
    const layer = layerRef.current
    const inner = innerRef.current
    if (!layer || !inner) return
    const measure = () => {
      const top = wallTopRef.current
      const wallTop = top ? top.offsetTop + top.offsetHeight + WALL_GAP : 120
      setBox({ W: layer.clientWidth, H: layer.clientHeight, wallTop, natH: inner.offsetHeight })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(layer)
    ro.observe(inner)
    return () => ro.disconnect()
  }, [wallTopRef])

  const natW = box ? Math.max(0, box.W - 32) : 0
  const place = box && natW > 0 && box.natH > 0 ? placeOnWall(box.W, box.H, box.wallTop, natW, box.natH, geometry) : null
  return (
    <div ref={layerRef} style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 4 }}>
      <div
        data-quest-wall=""
        onClick={onOpen}
        style={{
          position: 'absolute',
          left: place?.left ?? 0,
          top: place?.top ?? 0,
          width: place ? natW * place.scale : 0,
          height: place && box ? box.natH * place.scale : 0,
          // До первого замера копии не видно — иначе она мигнула бы в полный
          // размер в углу колонки.
          visibility: place ? 'visible' : 'hidden',
          pointerEvents: place ? 'auto' : 'none',
          cursor: 'pointer',
          filter: 'drop-shadow(0 6px 8px rgba(0,0,0,0.55))',
        }}
      >
        <div
          ref={innerRef}
          style={{
            width: natW || '100%',
            transform: `scale(${place?.scale ?? 1})`,
            transformOrigin: 'top left',
            pointerEvents: 'none',
          }}
        >
          <QuestBoard {...board} interactive={false} onTake={() => {}} onReplace={() => {}} />
        </div>
      </div>
    </div>
  )
}

/**
 * Копия доски для телефона набок (sideMenu в App.tsx, 28.10.2026): сцена у костра
 * там во всю область вкладки, и копия висит справа от костра над подготовкой —
 * место (maxW × maxH и положение в `style`) App.tsx считает от той же геометрии
 * сцены. Та же вёрстка ширины `natW`, ужатая так, чтобы влезть в maxW × maxH.
 */
export function QuestBoardThumb({ board, natW, maxW, maxH, style, onOpen }: {
  board: Omit<QuestBoardProps, 'interactive' | 'onTake' | 'onReplace'>
  natW: number
  maxW: number
  maxH: number
  style: CSSProperties
  onOpen: () => void
}) {
  const innerRef = useRef<HTMLDivElement | null>(null)
  const [natH, setNatH] = useState(0)
  useEffect(() => {
    const inner = innerRef.current
    if (!inner) return
    const measure = () => setNatH(inner.offsetHeight)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(inner)
    return () => ro.disconnect()
  }, [])
  const scale = natH > 0 ? Math.min(WALL_SCALE_MAX, maxW / natW, maxH / natH) : 0
  return (
    <div
      data-quest-wall=""
      onClick={onOpen}
      style={{
        ...style,
        cursor: 'pointer', pointerEvents: 'auto',
        width: natW * scale, height: natH * scale,
        visibility: scale > 0 ? 'visible' : 'hidden',
        filter: 'drop-shadow(0 6px 8px rgba(0,0,0,0.55))',
      }}
    >
      <div ref={innerRef} style={{ width: natW, transform: `scale(${scale})`, transformOrigin: 'top left', pointerEvents: 'none' }}>
        <QuestBoard {...board} interactive={false} onTake={() => {}} onReplace={() => {}} />
      </div>
    </div>
  )
}
