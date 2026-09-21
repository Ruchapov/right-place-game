import { useState } from 'react'
import * as C from '../constants'

const TEMP_MAP_SWITCHER: { letter: string; file: string }[] = [
  { letter: 'A', file: 'map_A_serpentine.txt' },
  { letter: 'B', file: 'map_B_razlom.txt' },
  { letter: 'C', file: 'map_C_boss_descent.txt' },
  { letter: 'D', file: 'map_D_OPEN.txt' },
  { letter: 'E', file: 'map_E_towers.txt' },
  { letter: 'F', file: 'map_F_sanctuary.txt' },
]

interface SettingsPanelProps {
  // TEMP: map switcher — список карт для отладочного переключателя A-F в
  // панели настроек. Имена файлов взяты фактические из public/assets/maps/
  // (не по шаблону mapId — суффиксы у карт разные). mapFile/onSelectMap
  // нужны ТОЛЬКО для этого переключателя — убрать оба пропа вместе с
  // TEMP_MAP_SWITCHER и самой панелью-переключателем перед релизом.
  mapFile: string
  onSelectMap: (file: string) => void
  // TEMP: тумблер бессмертия — заменяет бывшую константу C.DEBUG_INVINCIBLE
  // (Explore.tsx, useState). Убрать оба пропа вместе с TEMP_MAP_SWITCHER
  // перед релизом.
  invincible: boolean
  onToggleInvincible: (value: boolean) => void
  onClose?: () => void
  // Банк трофеев игрока ДО забега — ровно тот, что сгорит при выходе (выход
  // через шестерёнку = смерть, см. Explore.tsx). undefined — профиль не
  // загружен: тогда число не показываем ВООБЩЕ, а не подставляем ноль
  // (ноль здесь неотличим от «терять нечего» и уже вводил в заблуждение).
  trophies?: number
  // Добытое в ЭТОМ забеге на момент открытия окна подтверждения. Считает его
  // Explore (trophiesEarnedRef), и снимок делается при открытии: реф сам
  // перерисовку не вызывает, а показывать устаревшее число хуже, чем не
  // показывать.
  runTrophies: () => number
}

export default function SettingsPanel({ mapFile, onSelectMap, invincible, onToggleInvincible, onClose, trophies, runTrophies }: SettingsPanelProps) {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [exitConfirmOpen, setExitConfirmOpen] = useState(false)
  // Снимок добытого за забег на момент ОТКРЫТИЯ окна: дальше оно может расти
  // (игра под затемнением не на паузе), но диалог должен показывать то, что
  // было, когда игрок спросил.
  const [runTrophiesAtOpen, setRunTrophiesAtOpen] = useState(0)

  return (
    <>
      {/* Шестерёнка настроек — отдельный fixed-элемент в правом верхнем углу
          (не часть плиты). Открывает панель настроек (settingsOpen), больше
          НЕ выходит из забега напрямую — выход теперь только через
          "Выйти" -> подтверждение внутри панели. */}
      <button
        onClick={() => setSettingsOpen(true)}
        aria-label="Настройки"
        style={{
          position: 'fixed',
          top: 'calc(env(safe-area-inset-top) + 6px)',
          right: C.SETTINGS_BTN_RIGHT,
          zIndex: 1001,
          width: C.SETTINGS_BTN_SIZE,
          height: C.SETTINGS_BTN_SIZE,
          padding: 0,
          border: 'none',
          background: 'none',
          cursor: 'pointer',
        }}
      >
        <img
          src={C.SETTINGS_ICON_SRC}
          alt=""
          draggable={false}
          style={{ width: '100%', height: '100%', objectFit: 'contain' }}
        />
      </button>

      {/* Панель настроек — оверлей поверх живой игры (в проекте нет паузы,
          поэтому игра продолжает идти под затемнением). Клик по подложке
          закрывает панель. */}
      {settingsOpen && (
        <div
          onClick={() => setSettingsOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 5000,
            background: 'rgba(0,0,0,0.55)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'relative',
              width: C.SETTINGS_FRAME_W,
              height: C.SETTINGS_FRAME_H,
            }}
          >
            <img
              src={C.SETTINGS_FRAME_SRC}
              alt=""
              draggable={false}
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }}
            />
            {/* Столбец кнопок — на тёмном центральном поле рамки, с отступом
                от каменной оправы по бокам (~18% ширины рамки), чтобы не
                залезать на камень. Порядок сверху вниз: Продолжить (главный
                способ закрыть панель, крестик убран — не работал) -> Звук/
                Музыка (заглушки) -> Выйти (опасное действие, внизу и отдельно
                по цвету). */}
            <div
              style={{
                position: 'absolute',
                inset: 0,
                padding: '30% 18%',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
                gap: 14,
              }}
            >
              {/* TEMP: map switcher — временный ряд A-F для проверки фонов
                  параллакса на всех картах, убрать после проверки. */}
              <div style={{ display: 'flex', gap: 4 }}>
                {TEMP_MAP_SWITCHER.map(({ letter, file }) => (
                  <button
                    key={letter}
                    onClick={() => onSelectMap(file)}
                    style={{
                      flex: 1,
                      padding: '8px 0',
                      borderRadius: 6,
                      border: mapFile === file ? '2px solid #E8B23A' : '1px solid #3A3344',
                      background: '#221E2B',
                      color: '#EDE7F2',
                      fontSize: 13,
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    {letter}
                  </button>
                ))}
              </div>
              {/* TEMP: тумблер бессмертия — для проверки начисления уровня за
                  босса без скиллов, убрать вместе с TEMP_MAP_SWITCHER. Тот же
                  стиль активного/неактивного состояния, что у кнопок карт
                  выше (граница #E8B23A при true). */}
              <button
                onClick={() => onToggleInvincible(!invincible)}
                style={{
                  padding: '8px 0',
                  borderRadius: 6,
                  border: invincible ? '2px solid #E8B23A' : '1px solid #3A3344',
                  background: '#221E2B',
                  color: '#EDE7F2',
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                Бессмертие: {invincible ? 'ВКЛ' : 'ВЫКЛ'}
              </button>
              <button
                onClick={() => setSettingsOpen(false)}
                style={{
                  padding: '14px 8px',
                  borderRadius: 10,
                  border: '2px solid #E8B23A',
                  background: '#221E2B',
                  color: '#EDE7F2',
                  fontSize: 15,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                Продолжить
              </button>
              {['Звук', 'Музыка'].map((label) => (
                <button
                  key={label}
                  disabled
                  style={{
                    padding: '14px 8px',
                    borderRadius: 10,
                    border: '1px solid #3A3344',
                    background: '#221E2B',
                    color: '#EDE7F2',
                    fontSize: 15,
                    fontWeight: 700,
                    opacity: 0.5,
                    cursor: 'default',
                  }}
                >
                  {label}
                </button>
              ))}
              <button
                onClick={() => { setRunTrophiesAtOpen(Math.max(0, Math.round(runTrophies()))); setExitConfirmOpen(true) }}
                style={{
                  padding: '14px 8px',
                  borderRadius: 10,
                  border: '1px solid #E0353B',
                  background: '#221E2B',
                  color: '#EDE7F2',
                  fontSize: 15,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                Выйти
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Подтверждение выхода — поверх панели настроек (выше z-index). */}
      {exitConfirmOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 6000,
            background: 'rgba(0,0,0,0.55)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
          }}
        >
          <div
            style={{
              width: '100%',
              maxWidth: 300,
              background: '#221E2B',
              border: '1px solid #3A3344',
              borderRadius: 14,
              padding: 20,
              textAlign: 'center',
            }}
          >
            {/* Что РЕАЛЬНО происходит при выходе: сервер получает
                finish-explore с died:true и обнуляет колонку трофеев целиком
                (весь банк, не только добытое за забег), а заработанное в этом
                забеге не начисляется вовсе. Поэтому строк две, и вторая
                появляется, только если есть чему не начислиться. */}
            <div style={{ color: '#EDE7F2', fontSize: 15, marginBottom: 18, lineHeight: 1.4 }}>
              {trophies === undefined
                ? 'Выйти из забега? Весь накопленный банк трофеев сгорит.'
                : `Выйти из забега? Весь банк трофеев сгорит: ${Math.max(0, Math.round(trophies))}.`}
              {runTrophiesAtOpen > 0 && (
                <div style={{ fontSize: 13, color: '#B9AFC7', marginTop: 8 }}>
                  Добытое в этом забеге ({runTrophiesAtOpen}) не начислится.
                </div>
              )}
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={() => setExitConfirmOpen(false)}
                style={{
                  flex: 1,
                  padding: '12px 8px',
                  borderRadius: 10,
                  border: '1px solid #3A3344',
                  background: '#15131A',
                  color: '#EDE7F2',
                  fontSize: 14,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                Отмена
              </button>
              <button
                onClick={() => onClose?.()}
                style={{
                  flex: 1,
                  padding: '12px 8px',
                  borderRadius: 10,
                  border: 'none',
                  background: '#E0353B',
                  color: '#EDE7F2',
                  fontSize: 14,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                Выйти
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
