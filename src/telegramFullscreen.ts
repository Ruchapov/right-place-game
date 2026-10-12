import { exitFullscreen, isFullscreen, requestFullscreen, retrieveLaunchParams } from '@telegram-apps/sdk'

/**
 * Полный экран Telegram по положению телефона (решение Андрея 12.10.2026):
 * в горизонтали — полный экран, без шапки Telegram; в вертикали — обычное окно,
 * как было всегда.
 *
 * Зачем: шапка Telegram в горизонтали съедает около шестой части и без того
 * низкого экрана (замер 12.10.2026: 844×325 вместо 844×390), и в меню кнопка
 * «Начать забег» уходила под нижнюю панель.
 *
 * Только телефон (ios, android, android_x). Десктоп, macOS и веб-клиенты не
 * трогаем: там окно Mini App не поворачивается, а «горизонталь» — просто
 * широкое окно, и разворачивать его на весь экран никто не просил. Вне Telegram
 * (браузер, localhost) сюда не доходим вовсе — вызывающий проверяет, что
 * вьюпорт SDK смонтирован.
 *
 * Полный экран появился в Mini Apps 8.0. Метод недоступен (старый Telegram)
 * или вернул ошибку — предупреждение в консоль, и игра работает как раньше, в
 * обычном окне: это не поломка, а отсутствие удобства.
 *
 * ⚠️ В полном экране сверху лежат СОБСТВЕННЫЕ кнопки Telegram (закрыть, меню).
 * Место под них сообщает contentSafeAreaInset — его обязаны учитывать отступы
 * HUD и меню сверху, иначе плита HP окажется под кнопкой «закрыть».
 */

const PHONE_PLATFORMS: readonly string[] = ['ios', 'android', 'android_x']
const LANDSCAPE_QUERY = '(orientation: landscape)'

function isPhoneTelegram(): boolean {
  try {
    return PHONE_PLATFORMS.includes(retrieveLaunchParams().tgWebAppPlatform)
  } catch {
    // Параметров запуска нет — мы не в Telegram. Ожидаемый случай, не ошибка.
    return false
  }
}

/**
 * Включить слежение: сейчас и на каждом повороте приводит окно к нужному виду.
 * Звать ОДИН раз, после mountViewport() — без смонтированного вьюпорта методы
 * полного экрана недоступны.
 */
export function followOrientationWithFullscreen(): void {
  if (!isPhoneTelegram()) return

  const landscape = window.matchMedia(LANDSCAPE_QUERY)
  // Запрос в пути — второй не шлём: SDK отверг бы его как параллельный. Поворот,
  // случившийся за это время, не теряется: когда запрос закончится, состояние
  // сверяется заново (см. finally).
  let busy = false
  // Цель, которую Telegram уже отверг: true — полный экран, false — обычное окно.
  // Пока положение телефона то же, повторно не просим — иначе отказ превратился
  // бы в бесконечную очередь запросов. Смена положения отказ снимает.
  let refused: boolean | null = null
  // «Недоступно» пишем один раз, а не на каждом повороте.
  let unavailableWarned = false

  const apply = () => {
    const want = landscape.matches
    if (refused !== want) refused = null
    if (isFullscreen() === want || busy || refused !== null) return
    const change = want ? requestFullscreen : exitFullscreen
    if (!change.isAvailable()) {
      if (!unavailableWarned) {
        unavailableWarned = true
        console.warn(
          'Полный экран Telegram недоступен (нужен Telegram с Mini Apps 8.0 и новее) — ' +
          'в горизонтали игра остаётся в обычном окне, с шапкой',
        )
      }
      return
    }
    busy = true
    // Через then, а не прямым вызовом: метод SDK умеет бросить и синхронно
    // (вьюпорт размонтирован), и такая ошибка обязана попасть в тот же catch,
    // а не оборвать обработчик поворота.
    Promise.resolve()
      .then(() => change())
      .then(() => {
        // Запрос «прошёл», а состояние прежнее — считаем отказом: иначе сверка в
        // finally просила бы то же самое снова и снова.
        if (isFullscreen() !== want) throw new Error('состояние окна не изменилось')
      })
      .catch((error: unknown) => {
        // Отказ Telegram (например, полный экран запрещён настройкой клиента).
        // Игра продолжает работать в том окне, которое есть.
        refused = want
        console.warn(
          want ? 'Telegram не включил полный экран в горизонтали' : 'Telegram не вернул обычное окно в вертикали',
          error,
        )
      })
      .finally(() => {
        busy = false
        // Телефон могли повернуть обратно, пока запрос был в пути.
        apply()
      })
  }

  // Старый WebKit (iOS до 14) не знает addEventListener у MediaQueryList. Там
  // слушаем resize: поворот его вызывает всегда, а лишние срабатывания (например,
  // от клавиатуры) apply отсекает первой же проверкой.
  if (typeof landscape.addEventListener === 'function') landscape.addEventListener('change', apply)
  else window.addEventListener('resize', apply)
  apply()
}
