import { C } from './theme'

// Значок в правом верхнем углу карточки ЛЮБОГО предмета (решение Андрея
// 26.10.2026): мешочек — предмет занимает место в сумке (каждая штука — своя
// ячейка), перечёркнутый мешочек — не занимает (зелья, страницы, Осколки души).
//
// Сам значок ничего не решает: что занимает место, решает КАТАЛОГ предмета
// полем takesCell (расходники — consumables.ts, зелья — potions.ts, страницы —
// scrolls.ts, предметы классов — classItems.ts; снаряжение — константа
// EQUIPMENT_TAKES_CELL). Карточка передаёт сюда это поле как есть — новый вид
// предметов получает значок, объявив takesCell в своём каталоге.
//
// Картинка — мешочек из иконок нижнего меню (nav_shop.png, тот же арт, что у
// вкладки «Убежище»): своего значка у сумки нет, а мешочек в стиле иконок
// игры читается сразу. Черту рисует код — второй картинки не нужно, и
// перечёркнутый не отличается от целого ничем, кроме черты. Не только цветом:
// черта — это форма (правило дизайна «не полагаться на цвет»).
//
// Позиция — абсолютная: родитель (окно карточки) обязан быть position:relative
// и оставить справа от названия место под значок.
const POUCH_SRC = `${import.meta.env.BASE_URL}assets/icons/nav_shop.png`
const SIZE = 26

export function BagCellBadge({ takesCell }: { takesCell: boolean }) {
  const label = takesCell ? 'Занимает место в сумке' : 'Не занимает места в сумке'
  return (
    <div
      role="img"
      aria-label={label}
      title={label}
      data-bag-cell={takesCell ? '1' : '0'}
      style={{ position:'absolute', top:12, right:12, width:SIZE, height:SIZE, pointerEvents:'none' }}>
      <img
        src={POUCH_SRC}
        alt=""
        width={SIZE}
        height={SIZE}
        style={{ display:'block', objectFit:'contain', opacity: takesCell ? 1 : 0.55 }}
      />
      {!takesCell && (
        <svg
          viewBox="0 0 26 26"
          width={SIZE}
          height={SIZE}
          style={{ position:'absolute', inset:0 }}
          aria-hidden="true">
          {/* Тёмная подложка под чертой — чтобы она читалась и на светлом
              мешочке, и на тёмном фоне карточки. */}
          <line x1="4" y1="22" x2="22" y2="4" stroke={C.outline} strokeWidth="5" strokeLinecap="round" />
          <line x1="4" y1="22" x2="22" y2="4" stroke={C.danger} strokeWidth="2.5" strokeLinecap="round" />
        </svg>
      )}
    </div>
  )
}
