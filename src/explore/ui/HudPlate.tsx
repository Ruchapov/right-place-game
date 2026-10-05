import type { RefObject } from 'react'
import * as C from '../constants'
import type { EventKind } from '../types'

interface HudPlateProps {
  hpFillRef: RefObject<HTMLDivElement | null>
  hpTextRef: RefObject<HTMLSpanElement | null>
  maxHp: number
  eventClosed: boolean[]
  eventKinds: EventKind[]
  /**
   * Оберег от смерти взят в забег и ЕЩЁ НЕ сработал — рисуем маленькую иконку у
   * полосы здоровья. Сработал (или не брали) — иконки нет: это единственный
   * признак, по которому игрок знает, есть ли у него запасная жизнь.
   */
  charmReady: boolean
  /**
   * Узел-обёртка десяти гнёзд маны. Колбэк, а не RefObject: горящие гнёзда
   * переключает сам Explore.tsx (updateManaSockets), без React-состояния, и
   * обязан сделать это сразу, как узел появился, — иначе до первой траты маны
   * плита показывала бы вид по умолчанию, а не запас.
   */
  manaRingRef: (el: HTMLDivElement | null) => void
}

// Диаметр гнезда маны — доля ШИРИНЫ плиты, тем же выражением, каким задана сама
// ширина: ширина и высота гнезда явные и равные, без aspect-ratio (см.
// комментарий у HP_FRAME_H в constants.ts — на нём уже обжигались).
const MANA_SOCKET_SIZE = `calc(${C.HP_FRAME_W} * ${C.MANA_SOCKET_D})`
// Свечение горящего шара. Размеры тени — тоже в долях ширины плиты: гнездо на
// узком экране около 4.5 px, и тень в постоянных пикселях залила бы соседей.
const MANA_ORB_GLOW = `0 0 calc(${C.HP_FRAME_W} * 0.012) calc(${C.HP_FRAME_W} * 0.004) rgba(70,196,232,0.9)`

export default function HudPlate({ hpFillRef, hpTextRef, maxHp, eventClosed, eventKinds, charmReady, manaRingRef }: HudPlateProps) {
  return (
    <>
      {/* HP-плита (v2) — fixed сверху-слева, safe-area aware. Несёт HP-полосу/
          число и 3 гнезда с иконками событий (тип из eventKinds, состояние —
          закрыто/нет из eventClosed, тот же индекс). */}
      <div
        style={{
          position: 'fixed',
          top: 'calc(env(safe-area-inset-top) + 6px)',
          left: 8,
          zIndex: 1001,
          width: C.HP_FRAME_W,
          height: C.HP_FRAME_H,
          pointerEvents: 'none',
        }}
      >
        <img
          src={C.HP_FRAME_SRC}
          alt=""
          draggable={false}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }}
        />
        {/* Окно HP лежит в нише плиты — рисуется ПОВЕРХ картинки (позже в
            DOM = выше в стэке), т.к. сама ниша в картинке непрозрачная
            (тёмная), не прозрачная дырка — "под" не был бы виден.
            Окно — контейнер ровно по углублению ниши, а форму ему даёт
            CSS-маска: прямоугольник обрезается по неровному краю камня. Маска
            висит на КОНТЕЙНЕРЕ, а не на заливке — иначе она сжималась бы
            вместе с шириной полосы, и форма ниши ездила бы за уровнем HP.
            Все три свойства маски продублированы с -webkit-: старый WebKit на
            iOS без префикса не понимает ни одного, а с одним -webkit-mask-image
            положил бы маску плиткой в натуральном размере (1579×324).
            Своего фона, рамки и скругления у окна НЕТ намеренно: пустая часть
            полосы прозрачная, под ней видна ниша самой плиты. */}
        <div
          style={{
            position: 'absolute',
            left: `${C.HP_WINDOW_X * 100}%`,
            top: `${C.HP_WINDOW_Y * 100}%`,
            height: `${C.HP_WINDOW_H * 100}%`,
            width: `${C.HP_WINDOW_W * 100}%`,
            maskImage: `url("${C.HP_WELL_MASK_SRC}")`,
            WebkitMaskImage: `url("${C.HP_WELL_MASK_SRC}")`,
            maskSize: '100% 100%',
            WebkitMaskSize: '100% 100%',
            maskRepeat: 'no-repeat',
            WebkitMaskRepeat: 'no-repeat',
          }}
        >
          {/* Заливка: растёт от левого края окна, ширину (долю HP) и цвет
              пишет updateHpBar в Explore.tsx. */}
          <div
            ref={hpFillRef}
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              bottom: 0,
              width: '100%',
              background: '#4FB477',
            }}
          />
        </div>
        <span
          ref={hpTextRef}
          style={{
            position: 'absolute',
            left: `${C.HPTXT_X * 100}%`,
            top: `${C.HPTXT_Y * 100}%`,
            transform: 'translate(-50%, -50%)',
            color: '#EDE7F2',
            fontSize: 13,
            fontWeight: 700,
            fontFamily: 'monospace',
            textShadow: '0 1px 2px rgba(0,0,0,0.9), 0 0 5px rgba(0,0,0,0.7)',
            whiteSpace: 'nowrap',
          }}
        >
          {maxHp}/{maxHp}
        </span>

        {/* Иконка оберега — у ПРАВОГО края полосы здоровья, снаружи ниши, чтобы
            не перекрывать ни полосу, ни число HP. Появляется только пока оберег
            цел; после срабатывания пропадает, и это заметное событие само по
            себе. Размер в долях плиты, как у гнёзд событий ниже — плита
            масштабируется, и пиксельный размер разъехался бы. */}
        {charmReady && (
          <img
            src={`${import.meta.env.BASE_URL}assets/icons/charm_death.png`}
            alt="Оберег от смерти"
            draggable={false}
            style={{
              position: 'absolute',
              left: `${(C.HP_WINDOW_X + C.HP_WINDOW_W) * 100}%`,
              top: `${(C.HP_WINDOW_Y + C.HP_WINDOW_H / 2) * 100}%`,
              width: `${C.SOCK_SIZE * 100}%`,
              aspectRatio: '1',
              transform: 'translate(4%, -50%)',
              objectFit: 'contain',
              display: 'block',
              filter: 'drop-shadow(0 1px 3px rgba(0,0,0,0.9))',
            }}
          />
        )}

        {/* 3 гнезда под иконки событий — центр в (SOCK_X[i], SOCK_Y) долях
            плиты, диаметр SOCK_SIZE*ширина_плиты. aspect-ratio:1 держит круг
            ровным (высота плиты считается по своей формуле, не 1:1). */}
        {C.SOCK_X.map((sockX, i) => {
          const closed = eventClosed[i]
          const kind = eventKinds[i]
          return (
            <div
              key={i}
              style={{
                position: 'absolute',
                left: `${sockX * 100}%`,
                top: `${C.SOCK_Y * 100}%`,
                width: `${C.SOCK_SIZE * 100}%`,
                aspectRatio: '1',
                transform: 'translate(-50%, -50%)',
                borderRadius: '50%',
              }}
            >
              {kind && (
                <img
                  src={C.EVENT_ICON_SRC[kind]}
                  alt=""
                  draggable={false}
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'contain',
                    opacity: closed ? 1 : 0.8,
                  }}
                />
              )}
              {closed && (
                // Светящееся кольцо "завершено" — диаметр = иконка*RING_SCALE,
                // центр сдвинут на (RING_DX,RING_DY) долей размера иконки.
                // box-shadow (не filter/drop-shadow) на круглом элементе даёт
                // ровный ореол по всему кругу, без потёка вниз. Пульсация —
                // только opacity тени через @keyframes (см. EVENT_RING_PULSE_CSS
                // ниже в файле), layout не трогает.
                <div
                  style={{
                    position: 'absolute',
                    left: `calc(50% + ${C.RING_DX * 100}%)`,
                    top: `calc(50% + ${C.RING_DY * 100}%)`,
                    width: `${C.RING_SCALE * 100}%`,
                    aspectRatio: '1',
                    transform: 'translate(-50%, -50%)',
                    borderRadius: '50%',
                    border: `${C.RING_W}px solid #E8B23A`,
                    boxSizing: 'border-box',
                    animation: 'eventRingPulse 1.5s ease-in-out infinite',
                    pointerEvents: 'none',
                  }}
                />
              )}
            </div>
          )
        })}

        {/* Гнёзда маны — десять лунок на ободе медальона (MANA_SOCKETS, индекс 0
            сверху, дальше по часовой). Пустое гнездо видно всегда; горящее —
            это шар поверх него. Какие горят, решает НЕ эта разметка: шары
            рисуются все десять, а гасит и зажигает их updateManaSockets в
            Explore.tsx, меняя opacity прямо у узла (как ширину полосы HP).
            Поэтому opacity в стиле шара ниже нет намеренно — React, не найдя
            её в пропах, на ре-рендере её и не трогает.
            Свечение — box-shadow на круглом узле, а не filter: drop-shadow, по
            той же причине, что у колец событий выше (ореол не стекает вниз). */}
        <div ref={manaRingRef} style={{ position: 'absolute', inset: 0 }}>
          {C.MANA_SOCKETS.map(([x, y], i) => (
            <div
              key={i}
              style={{
                position: 'absolute',
                left: `${x * 100}%`,
                top: `${y * 100}%`,
                width: MANA_SOCKET_SIZE,
                height: MANA_SOCKET_SIZE,
                transform: 'translate(-50%, -50%)',
                backgroundImage: `url("${C.MANA_SOCKET_SRC}")`,
                backgroundSize: '100% 100%',
                backgroundRepeat: 'no-repeat',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <div
                style={{
                  width: `${C.MANA_SOCKET_ORB_SCALE * 100}%`,
                  height: `${C.MANA_SOCKET_ORB_SCALE * 100}%`,
                  borderRadius: '50%',
                  backgroundImage: `url("${C.MANA_ORB_SRC}")`,
                  backgroundSize: '100% 100%',
                  backgroundRepeat: 'no-repeat',
                  boxShadow: MANA_ORB_GLOW,
                  transition: 'opacity 150ms linear',
                }}
              />
            </div>
          ))}
        </div>
      </div>
    </>
  )
}
