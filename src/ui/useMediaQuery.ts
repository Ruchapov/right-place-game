import { useEffect, useState } from 'react'

/**
 * Совпадает ли сейчас медиа-запрос, с перерисовкой на каждой смене ответа.
 *
 * Нужен МЕНЮ: его раскладка задана инлайн-стилями React, а в них медиа-запрос
 * не написать. Поворот телефона сам рендера не вызывает — его вызывает этот хук.
 *
 * ⚠️ Не для забега: там по повороту обязан сработать сам браузер, в том же
 * кадре и без рендера (кнопки — правилом CSS, мир — обработчиком размера холста;
 * см. TouchControls и Explore.tsx). Рендер React по повороту посреди боя — это
 * лишняя работа под тикером.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const list = window.matchMedia(query)
    const onChange = () => setMatches(list.matches)
    // Между первым рендером и эффектом ответ мог смениться.
    onChange()
    // Старый WebKit (iOS до 14) не знает addEventListener у MediaQueryList —
    // там слушаем resize: поворот его вызывает всегда.
    if (typeof list.addEventListener === 'function') {
      list.addEventListener('change', onChange)
      return () => list.removeEventListener('change', onChange)
    }
    window.addEventListener('resize', onChange)
    return () => window.removeEventListener('resize', onChange)
  }, [query])
  return matches
}
