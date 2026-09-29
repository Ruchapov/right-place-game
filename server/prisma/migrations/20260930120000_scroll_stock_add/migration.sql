-- AlterTable: scrollFire/scrollIce/scrollBleed/scrollHeal/scrollDash — запас
-- СТРАНИЦ книг (каталог src/scrolls.ts / server/src/scrolls.ts, id scroll_*).
-- По странице на каждый навык: огонь → fireball, лёд → iceball, кровь → slash,
-- исцеление → heal, рывок → dash — та же раскладка, что у книг book_*.
--
-- Три страницы складываются в ОДНУ книгу (SCROLLS_PER_BOOK, POST
-- /character/assemble-book), одна продаётся за SCROLL_SELL_PRICE золота
-- (POST /character/sell-scroll).
--
-- ⚠️ СТРАНИЦЫ НЕ ПРОДАЮТСЯ В МАГАЗИНЕ — решение дизайнера 28.09.2026: они
-- только ВЫПАДАЮТ в забегах. Поэтому, в отличие от книг и расходников, эти
-- колонки растут не покупкой, а дропом на финише забега (POST
-- /run/finish-explore), и до появления дропа заводить их было незачем: колонка,
-- которую нечем наполнить, только притворялась бы механикой.
--
-- Ячейку сумки страница НЕ тратит (docs/items.md, «ПРАВИЛО ВМЕСТИМОСТИ») — их
-- копятся десятки, как зелий. Это не свойство схемы, а правило клиента и
-- подсчёта добычи, но на форму хранения оно влияет: потолка у счётчика нет.
--
-- По колонке на страницу, а не Json и не отдельная таблица — та же причина, что
-- у potionT1..T5, whetstones/charms и book*: видов ровно столько, сколько в
-- каталоге, а счётчику нужен атомарный increment в ТОМ ЖЕ UPDATE, который
-- закрывает забег (иначе повтор финиша выдал бы добычу дважды).
--
-- DEFAULT 0 сразу проставляет 0 всем существующим строкам, поэтому отдельный
-- UPDATE для переливки не нужен: получить страницу до этой миграции никто не мог.
--
-- Здесь ТОЛЬКО ADD COLUMN. Ни DROP, ни переливки данных: добавление колонки с
-- DEFAULT безопасно для ещё живого старого серверного процесса на Render
-- (деплой не мгновенный) — он про эти колонки не знает и в SELECT их не
-- перечисляет, так что читать персонажа продолжит без ошибок.
--
-- ⚠️ ПОРЯДОК ВЫКЛАДКИ (как у книг, и по той же причине): сначала эта миграция
-- против боевой БД, потом серверный код, и только потом фронт. Обратный порядок
-- уронит ЛОГИН: scrollStockOf (runState.ts) перечисляет эти колонки поимённо, и
-- Prisma запросит их в КАЖДОМ чтении персонажа.
ALTER TABLE "Character" ADD COLUMN "scrollFire" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Character" ADD COLUMN "scrollIce" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Character" ADD COLUMN "scrollBleed" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Character" ADD COLUMN "scrollHeal" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Character" ADD COLUMN "scrollDash" INTEGER NOT NULL DEFAULT 0;
