import type { RunResultSummary, AbandonedRunSummary } from '../api'
import * as C from '../explore/constants'
import { C as Theme } from './theme'

// Окно о ПРОШЛОМ забеге, который сервер закрыл сам при входе (/auth/login
// отдаёт либо interruptedRun, либо abandonedRun — поля взаимоисключающие, см.
// src/api.ts). Игрок этот забег уже не увидит: он показывается один раз,
// поверх меню, и закрывается кнопкой.
//
// Живёт в src/ui (рядом с theme.ts), а не в src/explore/ui: это экран МЕНЮ, а
// не часть забега — во время забега он не существует. Explore-константы
// (шрифт, иконка трофея) импортируются тем же способом, что в ResultsScreen.
//
// Две ветки:
//   interrupted — подтверждённый забег, закрытый как смерть (трофеи сгорели,
//                 статы и зелья применены). Выглядит как экран смерти;
//   abandoned   — забег, которого игрок не видел: штрафа нет, энергия
//                 возвращена.
export type PastRunNoticeData =
  | { kind: 'interrupted'; result: RunResultSummary }
  | { kind: 'abandoned'; summary: AbandonedRunSummary }

// --- Копия геометрии рамки и плиты из ResultsScreen, Explore.tsx:272-300 ---
// Менять вместе: те же файлы ассетов, те же замеры по ним. Экспорта у тех
// констант нет, а Explore.tsx в этой задаче трогать нельзя, поэтому копия.
// Аспект — реальные пиксели файла через calc()/padding-bottom, НЕ CSS
// aspect-ratio и НЕ auto-высота от <img>: иначе проценты top/height у
// абсолютных детей считать не от чего (см. CLAUDE.md, Critical Gotchas).
const RESULTS_FRAME_SRC = `${import.meta.env.BASE_URL}assets/results_frame.png`
const RESULTS_PLATE_SRC = `${import.meta.env.BASE_URL}assets/results_plate.png`
const RESULTS_FRAME_ASPECT = 596 / 420
const RESULTS_FRAME_W = 'clamp(300px, 94vw, 400px)'
const RESULTS_FRAME_H = `calc(${RESULTS_FRAME_W} * ${RESULTS_FRAME_ASPECT})`
const RESULTS_FIELD_X = 0.105
const RESULTS_FIELD_Y = 0.075
const RESULTS_FIELD_W = 0.789
const RESULTS_FIELD_H = 0.847
const RESULTS_PLATE_ASPECT = 139 / 420
const RESULTS_PLATE_FIELD_X = 0.055
const RESULTS_PLATE_FIELD_Y = 0.165
const RESULTS_PLATE_FIELD_W = 0.89
const RESULTS_PLATE_FIELD_H = 0.619
// --- конец копии ---

// Вид кнопки — правилом таблицы стилей, а не инлайном (тот же приём, что у
// PRESS_CSS в TouchControls.tsx). Значения — копия кнопки "В МЕНЮ",
// Explore.tsx:644-662, менять вместе.
const NOTICE_CSS = `
  [data-past-run-notice] button {
    padding: 12px 30px;
    border-radius: 10px;
    border: 2px solid ${Theme.glowEdge};
    background: ${Theme.nicheDeep};
    color: ${Theme.glowCore};
    font-family: ${C.FONT_DISPLAY};
    font-weight: 700;
    font-size: clamp(13px, 4vw, 15px);
    letter-spacing: 0.06em;
    cursor: pointer;
  }
`

// Разделитель "линия-ромб-линия" под заголовком — копия из ResultsScreen,
// Explore.tsx:452-456, менять вместе. Ширина задаётся снаружи: под заголовком
// он уже (68%), чем секционные разделители (100%).
function Divider({ width }: { width: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, width }}>
      <div style={{ flex: 1, height: 1, background: Theme.stoneDark }} />
      <div style={{ width: 6, height: 6, background: Theme.glowEdge, transform: 'rotate(45deg)', flexShrink: 0 }} />
      <div style={{ flex: 1, height: 1, background: Theme.stoneDark }} />
    </div>
  )
}

export default function PastRunNotice({ notice, onClose }: { notice: PastRunNoticeData; onClose: () => void }) {
  // Заголовок и его цвет — единственное, что разводит две ветки до самой
  // разметки. У interrupted условие на died оставлено ровно таким же, как в
  // ResultsScreen: сервер закрывает прерванный забег смертью, но подменять
  // заголовок на смерть в обход флага значило бы соврать, если ветка когда-то
  // начнёт отдавать died:false.
  const died = notice.kind === 'interrupted' ? notice.result.died : false
  // ТА ЖЕ логика подписи, что у ResultsScreen в Explore.tsx (менять вместе —
  // плита трофеев здесь её копия): «ПОТЕРЯНО» не только на смерти, но и когда
  // добыча забега отрицательна. Отрицательной её делает кража у Контрабандиста
  // (ставка = банк + добыча до сделки, множитель кражи 0.5), и показать убыток
  // как «получено −400» значило бы соврать подписью. Число тогда берётся по
  // модулю, а знак несёт подпись.
  // Сейчас у `interrupted` сервер всегда ставит died: true, то есть ветка
  // недостижима — но копия плиты обязана врать одинаково с оригиналом, иначе
  // разойдутся они молча.
  const trophyLossView = died || (notice.kind === 'interrupted' && notice.result.trophiesEarned < 0)
  const title = notice.kind === 'abandoned' ? 'ЗАБЕГ НЕ НАЧАЛСЯ' : died ? 'НЕ В ЭТОТ РАЗ' : 'ЖИВ'
  const subtitle =
    notice.kind === 'abandoned' ? 'Штрафа нет' : 'Забег не завершён — приложение было закрыто'

  return (
    <div
      data-past-run-notice=""
      style={{
        // Копия оболочки ResultsScreen, Explore.tsx:359-406, менять вместе.
        // zIndex 2000 — выше нижней навигации (999) и экрана забега (1000).
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        zIndex: 2000,
        background: Theme.appBg,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <style>{NOTICE_CSS}</style>
      <div style={{ position: 'relative', width: RESULTS_FRAME_W, height: RESULTS_FRAME_H }}>
        <img
          src={RESULTS_FRAME_SRC}
          alt=""
          draggable={false}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }}
        />
        <div
          style={{
            position: 'absolute',
            left: `${RESULTS_FIELD_X * 100}%`,
            top: `${RESULTS_FIELD_Y * 100}%`,
            width: `${RESULTS_FIELD_W * 100}%`,
            height: `${RESULTS_FIELD_H * 100}%`,
            padding: 16,
            boxSizing: 'border-box',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'space-evenly',
            gap: 10,
            overflowY: 'auto',
          }}
        >
          {/* 1. Заголовок + подпись + разделитель — одна секция, как в
              ResultsScreen (разделитель держится вплотную к заголовку своим
              gap, а не общим space-evenly). Подпись стоит на месте строки
              состояния сохранения: здесь сохранять уже нечего — забег закрыл
              сервер, — поэтому тот же размер и курсив, но другой смысл. */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, flexShrink: 0 }}>
            <div
              style={{
                fontFamily: C.FONT_DISPLAY,
                fontWeight: 900,
                fontSize: 'clamp(19px, 6.2vw, 26px)',
                letterSpacing: '0.08em',
                color: died ? Theme.danger : Theme.textMain,
                textAlign: 'center',
              }}
            >
              {title}
            </div>
            <div
              style={{
                fontSize: 'clamp(10px, 3vw, 12px)',
                fontStyle: 'italic',
                textAlign: 'center',
                color: Theme.textDim,
              }}
            >
              {subtitle}
            </div>
            <Divider width="68%" />
          </div>

          {/* 2. Плита с трофеями — только у interrupted. Обёртка получает
              РЕАЛЬНУЮ высоту через padding-bottom% (RESULTS_PLATE_ASPECT
              выше), иначе %-поле внутри не позиционируется. Копия из
              ResultsScreen, Explore.tsx:496-535, менять вместе. */}
          {notice.kind === 'interrupted' && (
            <div style={{ position: 'relative', width: '100%', paddingBottom: `${RESULTS_PLATE_ASPECT * 100}%`, flexShrink: 0 }}>
              <img
                src={RESULTS_PLATE_SRC}
                alt=""
                draggable={false}
                style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }}
              />
              <div
                style={{
                  position: 'absolute',
                  left: `${RESULTS_PLATE_FIELD_X * 100}%`,
                  top: `${RESULTS_PLATE_FIELD_Y * 100}%`,
                  width: `${RESULTS_PLATE_FIELD_W * 100}%`,
                  height: `${RESULTS_PLATE_FIELD_H * 100}%`,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 2,
                }}
              >
                <div style={{ fontSize: 'clamp(8px, 2.4vw, 10px)', letterSpacing: '0.05em', color: Theme.textDim }}>
                  {trophyLossView ? 'ТРОФЕЕВ ПОТЕРЯНО' : 'ТРОФЕЕВ ПОЛУЧЕНО'}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span
                    style={{
                      fontFamily: C.FONT_DISPLAY,
                      fontWeight: 900,
                      fontSize: 'clamp(19px, 5.8vw, 25px)',
                      color: trophyLossView ? Theme.danger : Theme.glowCore,
                      lineHeight: 1,
                    }}
                  >
                    {died ? notice.result.trophiesLost : Math.abs(notice.result.trophiesEarned)}
                  </span>
                  <img src={C.REWARD_ICON_SRC.trophy} alt="" draggable={false} style={{ width: 20, height: 20, objectFit: 'contain' }} />
                </div>
              </div>
            </div>
          )}

          {/* 3. Прокачка — ТОЛЬКО прибавка, только у interrupted. Копия из
              ResultsScreen, Explore.tsx:561-595, менять вместе. Нули с сервера
              (забег без единого удара) секцию не рендерят вовсе. */}
          {notice.kind === 'interrupted' &&
            (notice.result.strengthGained > 0 ||
              notice.result.enduranceGained > 0 ||
              notice.result.agilityGained > 0 ||
              notice.result.leveledUp) && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, width: '100%', flexShrink: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
                  <div style={{ flex: 1, height: 1, background: Theme.stoneDark }} />
                  <div style={{ fontSize: 'clamp(9px, 2.6vw, 11px)', letterSpacing: '0.08em', color: Theme.textDim, whiteSpace: 'nowrap' }}>
                    ПРОКАЧКА
                  </div>
                  <div style={{ flex: 1, height: 1, background: Theme.stoneDark }} />
                </div>
                {notice.result.leveledUp && (
                  <div
                    style={{
                      fontFamily: C.FONT_DISPLAY,
                      fontWeight: 900,
                      fontSize: 'clamp(14px, 4.4vw, 18px)',
                      letterSpacing: '0.06em',
                      color: Theme.glowCore,
                    }}
                  >
                    УРОВЕНЬ ПОВЫШЕН
                  </div>
                )}
                {[
                  { label: 'Сила', value: notice.result.strengthGained },
                  { label: 'Выносливость', value: notice.result.enduranceGained },
                  { label: 'Ловкость', value: notice.result.agilityGained },
                ]
                  .filter((stat) => stat.value > 0)
                  .map((stat) => (
                    <div key={stat.label} style={{ fontSize: 'clamp(11px, 3.2vw, 13px)', color: Theme.textMain }}>
                      +{stat.value} {stat.label}
                    </div>
                  ))}
              </div>
            )}

          {/* 4. Возврат энергии — только у abandoned и только если она реально
              вернулась. Ноль не показываем: "+0" читается как поломка, а не
              как "возвращать было нечего". */}
          {notice.kind === 'abandoned' && notice.summary.energyRefunded > 0 && (
            <div style={{ fontSize: 'clamp(11px, 3.2vw, 13px)', color: Theme.textMain, textAlign: 'center', flexShrink: 0 }}>
              Энергия возвращена: +{notice.summary.energyRefunded}
            </div>
          )}

          {/* 5. Кнопка — единственный способ закрыть окно. Вид задан правилом
              NOTICE_CSS вверху файла. */}
          <div style={{ display: 'flex', justifyContent: 'center', flexShrink: 0 }}>
            <button onClick={onClose}>ПОНЯТНО</button>
          </div>
        </div>
      </div>
    </div>
  )
}
