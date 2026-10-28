import type { RunResultSummary, AbandonedRunSummary } from '../api'
import * as C from '../explore/constants'
import { C as Theme } from './theme'
import { skillSealSrc } from '../skillBooks'
import { ResultsFrame, ResultsDivider, ResultsSectionTitle, TrophyPlate } from './ResultsFrame'

// Окно о ПРОШЛОМ забеге, который сервер закрыл сам при входе (/auth/login
// отдаёт либо interruptedRun, либо abandonedRun — поля взаимоисключающие, см.
// src/api.ts). Игрок этот забег уже не увидит: он показывается один раз,
// поверх меню, и закрывается кнопкой.
//
// Живёт в src/ui (рядом с theme.ts), а не в src/explore/ui: это экран МЕНЮ, а
// не часть забега — во время забега он не существует.
//
// Две ветки:
//   interrupted — подтверждённый забег, закрытый как смерть (трофеи сгорели,
//                 статы и зелья применены). Выглядит как экран смерти;
//   abandoned   — забег, которого игрок не видел: штрафа нет, энергия
//                 возвращена.
export type PastRunNoticeData =
  | { kind: 'interrupted'; result: RunResultSummary }
  | { kind: 'abandoned'; summary: AbandonedRunSummary }

// Рамка, плита трофеев и обе раскладки (вертикаль и телефон набок) — общие с
// экраном итогов забега, src/ui/ResultsFrame.tsx. Здесь — только содержимое и
// вид кнопки.
// Вид кнопки — правилом таблицы стилей, а не инлайном (тот же приём, что у
// PRESS_CSS в TouchControls.tsx). Значения — копия кнопки "В МЕНЮ"
// ResultsScreen (Explore.tsx), менять вместе.
const NOTICE_CSS = `
  [data-past-run-notice] button {
    padding: 12px 30px;
    border-radius: 10px;
    border: 2px solid ${Theme.glowEdge};
    background: ${Theme.nicheDeep};
    color: ${Theme.glowCore};
    font-family: ${C.FONT_DISPLAY};
    font-weight: 700;
    font-size: clamp(13px, 4vmin, 15px);
    letter-spacing: 0.06em;
    cursor: pointer;
  }
`

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

  const interrupted = notice.kind === 'interrupted' ? notice.result : null
  const hasProgress =
    interrupted !== null &&
    (interrupted.strengthGained > 0 ||
      interrupted.enduranceGained > 0 ||
      interrupted.agilityGained > 0 ||
      interrupted.leveledUp ||
      interrupted.skillLevelUps.length > 0)
  const energyLine = notice.kind === 'abandoned' && notice.summary.energyRefunded > 0 ? notice.summary.energyRefunded : null

  return (
    <ResultsFrame
      dataName="past-run-notice"
      extraCss={NOTICE_CSS}
      head={
        /* 1. Заголовок + подпись + разделитель — одна секция, как в
            ResultsScreen. Подпись стоит на месте строки состояния сохранения:
            здесь сохранять уже нечего — забег закрыл сервер, — поэтому тот же
            размер и курсив, но другой смысл. */
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <div
            style={{
              fontFamily: C.FONT_DISPLAY,
              fontWeight: 900,
              fontSize: 'clamp(19px, 6.2vmin, 26px)',
              letterSpacing: '0.08em',
              color: died ? Theme.danger : Theme.textMain,
              textAlign: 'center',
            }}
          >
            {title}
          </div>
          <div
            style={{
              fontSize: 'clamp(10px, 3vmin, 12px)',
              fontStyle: 'italic',
              textAlign: 'center',
              color: Theme.textDim,
            }}
          >
            {subtitle}
          </div>
          <ResultsDivider width="68%" />
        </div>
      }
      left={
        /* 2. Плита с трофеями — только у interrupted (общая с ResultsScreen). */
        interrupted === null ? null : (
          <TrophyPlate
            lossView={trophyLossView}
            count={died ? interrupted.trophiesLost : Math.abs(interrupted.trophiesEarned)}
            color={trophyLossView ? Theme.danger : Theme.glowCore}
          />
        )
      }
      right={
        !hasProgress && energyLine === null ? null : (
          <>
            {/* 3. Прокачка — ТОЛЬКО прибавка, только у interrupted. Те же строки,
                что в ResultsScreen (Explore.tsx), менять вместе. Нули с сервера
                (забег без единого удара) секцию не рендерят вовсе. */}
            {interrupted !== null && hasProgress && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, width: '100%', flexShrink: 0 }}>
                <ResultsSectionTitle>ПРОКАЧКА</ResultsSectionTitle>
                {interrupted.leveledUp && (
                  <div
                    style={{
                      fontFamily: C.FONT_DISPLAY,
                      fontWeight: 900,
                      fontSize: 'clamp(14px, 4.4vmin, 18px)',
                      letterSpacing: '0.06em',
                      color: Theme.glowCore,
                    }}
                  >
                    УРОВЕНЬ ПОВЫШЕН
                  </div>
                )}
                {[
                  { label: 'Сила', value: interrupted.strengthGained },
                  { label: 'Выносливость', value: interrupted.enduranceGained },
                  { label: 'Ловкость', value: interrupted.agilityGained },
                ]
                  .filter((stat) => stat.value > 0)
                  .map((stat) => (
                    <div key={stat.label} style={{ fontSize: 'clamp(11px, 3.2vmin, 13px)', color: Theme.textMain }}>
                      +{stat.value} {stat.label}
                    </div>
                  ))}
                {/* Выросшие навыки. Брошенный забег растит уровни навыков
                    по-настоящему (из того же среза, что статы, см. /auth/login),
                    поэтому прятать это здесь было бы молчанием о настоящем
                    изменении персонажа. */}
                {interrupted.skillLevelUps.map((up) => (
                  <div
                    key={up.skillId}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 'clamp(11px, 3.2vmin, 13px)', color: Theme.textMain }}
                  >
                    <img
                      src={skillSealSrc(up.skillId)}
                      alt=""
                      draggable={false}
                      style={{ width: 24, height: 24, objectFit: 'contain', display: 'block', flexShrink: 0 }}
                    />
                    Уровень {up.level}
                  </div>
                ))}
              </div>
            )}

            {/* 4. Возврат энергии — только у abandoned и только если она реально
                вернулась. Ноль не показываем: "+0" читается как поломка, а не
                как "возвращать было нечего". */}
            {energyLine !== null && (
              <div style={{ fontSize: 'clamp(11px, 3.2vmin, 13px)', color: Theme.textMain, textAlign: 'center', flexShrink: 0 }}>
                Энергия возвращена: +{energyLine}
              </div>
            )}
          </>
        )
      }
      foot={
        /* 5. Кнопка — единственный способ закрыть окно. Вид задан правилом
            NOTICE_CSS вверху файла. */
        <div style={{ display: 'flex', justifyContent: 'center', flexShrink: 0 }}>
          <button onClick={onClose}>ПОНЯТНО</button>
        </div>
      }
    />
  )
}
