// Как показать одну единицу добычи (31.10.2026: вынесено из Explore.tsx) — её
// читают экран итогов забега и окно о прошлом забеге (PastRunNotice), который
// показывает добычу забега, засчитанного входом пройденным.
import type { RunDrop } from '../api'
import { POTION_TIERS } from '../potions'
import { consumableById } from '../consumables'
import { scrollById } from '../scrolls'
import { classItemById } from '../classItems'
import { itemIconSrc } from '../itemIcons'

/**
 * Как показать одну единицу добычи: название и путь к иконке.
 *
 * Имя и иконку берём из СВОИХ каталогов по id, а не из ответа сервера — иначе
 * те же строки жили бы в четвёртом экземпляре (каталоги страниц, зелий и
 * расходников и так байт-в-байт копии). Снаряжение — исключение и единственное,
 * что приезжает текстом: его названия лежат только в БД, клиентского каталога
 * предметов нет вовсе.
 *
 * Неизвестный id — НЕ повод спрятать строку: сервер уже начислил предмет, и
 * пропажа его со списка выглядела бы как потеря. Показываем сам id и пустую
 * иконку — видно, что это сбой каталога, а не невезение.
 */
export function dropView(drop: RunDrop): { key: string; name: string; iconSrc: string | null } {
  switch (drop.category) {
    case 'equipment':
      return { key: `${drop.slot}-${drop.tier}`, name: drop.nameRu, iconSrc: itemIconSrc(drop.slot, drop.tier) }
    case 'scroll': {
      const spec = scrollById(drop.id)
      return {
        key: drop.id,
        name: spec?.nameRu ?? drop.id,
        iconSrc: spec === null ? null : `${import.meta.env.BASE_URL}assets/icons/${spec.icon}`,
      }
    }
    case 'book': {
      const spec = consumableById(drop.id)
      return {
        key: drop.id,
        name: spec?.nameRu ?? drop.id,
        iconSrc: spec === null ? null : `${import.meta.env.BASE_URL}assets/icons/${spec.icon}`,
      }
    }
    case 'potion': {
      const spec = POTION_TIERS[drop.tier - 1]
      return {
        key: `potion-${drop.tier}`,
        name: spec?.nameRu ?? `Зелье ${drop.tier} тира`,
        iconSrc: spec === undefined ? null : `${import.meta.env.BASE_URL}assets/icons/${spec.icon}`,
      }
    }
    // Предметы классов (18.10.2026): у категории один вид, id каталога — она сама.
    case 'soul_shard':
    case 'renounce_seal': {
      const spec = classItemById(drop.category)
      return {
        key: drop.category,
        name: spec?.nameRu ?? drop.category,
        iconSrc: spec === null ? null : `${import.meta.env.BASE_URL}assets/icons/${spec.icon}`,
      }
    }
    // Мастер (29.10.2026): сырьё и кольца — тот же каталог, id внутри.
    case 'crafter': {
      const spec = classItemById(drop.id)
      return {
        key: drop.id,
        name: spec?.nameRu ?? drop.id,
        iconSrc: spec === null ? null : `${import.meta.env.BASE_URL}assets/icons/${spec.icon}`,
      }
    }
  }
}
