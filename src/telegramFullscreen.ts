import { isFullscreen, requestFullscreen, retrieveLaunchParams } from '@telegram-apps/sdk'

/**
 * Полный экран Telegram на телефоне — ВСЕГДА, в обоих положениях (решение Андрея
 * 27.10.2026; отменяет решение 12.10.2026 «в горизонтали — полный экран, в
 * вертикали — обычное окно»). Серая шапка Telegram не нужна ни в одном
 * положении: в горизонтали она съедала шестую часть низкого экрана, в вертикали
 * — просто чужая полоса над игрой.
 *
 * Как: полный экран просим один раз на старте и из него НЕ выходим — при
 * повороте ничего не делаем, если окно и так полноэкранное. Telegram мог его
 * снять (игрок свернул) — тогда на следующем повороте просим снова. Отказ
 * Telegram запоминается: в том же положении телефона повторно не просим (иначе
 * отказ стал бы бесконечной очередью запросов), смена положения отказ снимает.
 *
 * Только телефон (ios, android, android_x). Десктоп, macOS и веб-клиенты не
 * трогаем: там окно Mini App не поворачивается, и разворачивать его на весь
 * экран никто не просил. Вне Telegram (браузер, localhost) сюда не доходим
 * вовсе — вызывающий проверяет, что вьюпорт SDK смонтирован.
 *
 * Полный экран появился в Mini Apps 8.0. Метод недоступен (старый Telegram) —
 * одно предупреждение в консоль, и игра работает в обычном окне: это не
 * поломка, а отсутствие удобства.
 *
 * ⚠️ В полном экране сверху лежат СОБСТВЕННЫЕ кнопки Telegram (закрыть, меню) и
 * вырез экрана — в обоих положениях. Место под них — `--rp-safe-top`
 * (src/index.css: вырез + contentSafeAreaInset Telegram), снизу полоса жеста —
 * `--rp-safe-bottom`. Всё, что стоит у верхнего или нижнего края экрана, обязано
 * отступать на них, иначе ляжет под кнопку «закрыть» или под жест «домой».
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
 * Включить полный экран: сейчас и (если Telegram его снял) на каждом повороте.
 * Звать ОДИН раз, после mountViewport() — без смонтированного вьюпорта методы
 * полного экрана недоступны.
 */
export function keepFullscreenOnPhone(): void {
  if (!isPhoneTelegram()) return

  const landscape = window.matchMedia(LANDSCAPE_QUERY)
  // Запрос в пути — второй не шлём: SDK отверг бы его как параллельный.
  let busy = false
  // Положение телефона, в котором Telegram отказал. Пока оно то же, не просим
  // снова; поворот отказ снимает.
  let refusedIn: boolean | null = null
  // «Недоступно» пишем один раз, а не на каждом повороте.
  let unavailableWarned = false

  const apply = () => {
    const orientation = landscape.matches
    if (refusedIn !== null && refusedIn !== orientation) refusedIn = null
    if (isFullscreen() || busy || refusedIn !== null) return
    if (!requestFullscreen.isAvailable()) {
      if (!unavailableWarned) {
        unavailableWarned = true
        console.warn(
          'Полный экран Telegram недоступен (нужен Telegram с Mini Apps 8.0 и новее) — ' +
          'игра остаётся в обычном окне, с шапкой',
        )
      }
      return
    }
    busy = true
    // Через then, а не прямым вызовом: метод SDK умеет бросить и синхронно
    // (вьюпорт размонтирован), и такая ошибка обязана попасть в тот же catch,
    // а не оборвать обработчик поворота.
    Promise.resolve()
      .then(() => requestFullscreen())
      .then(() => {
        // Запрос «прошёл», а окно не полноэкранное — считаем отказом: иначе
        // следующий поворот в том же положении просил бы снова и снова.
        if (!isFullscreen()) throw new Error('окно не стало полноэкранным')
      })
      .catch((error: unknown) => {
        // Отказ Telegram (например, полный экран запрещён настройкой клиента).
        // Игра продолжает работать в том окне, которое есть.
        refusedIn = orientation
        console.warn('Telegram не включил полный экран', error)
      })
      .finally(() => {
        busy = false
        // Телефон повернули, пока запрос был в пути, — сверить заново. В том же
        // положении — нет: успех ничего не требует, отказ запомнен.
        if (landscape.matches !== orientation) apply()
      })
  }

  // Старый WebKit (iOS до 14) не знает addEventListener у MediaQueryList. Там
  // слушаем resize: поворот его вызывает всегда, а лишние срабатывания (например,
  // от клавиатуры) apply отсекает первой же проверкой.
  if (typeof landscape.addEventListener === 'function') landscape.addEventListener('change', apply)
  else window.addEventListener('resize', apply)
  apply()
}
