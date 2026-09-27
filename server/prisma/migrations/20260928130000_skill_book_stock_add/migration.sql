-- AlterTable: bookFire/bookIce/bookBleed/bookHeal/bookDash — запас книг скиллов
-- (расходники, каталог src/consumables.ts / server/src/consumables.ts, id
-- book_*). Книга улучшает ОДИН скилл: огонь → fireball, лёд → iceball, кровь →
-- slash, исцеление → heal, рывок → dash.
--
-- Книга, в отличие от точильного камня и оберега, В ЗАБЕГ НЕ ЕДЕТ
-- (runSlot: false) и в гнёзда подготовки не идёт: она применяется из инвентаря
-- между забегами. Само применение к скиллу ещё НЕ реализовано, поэтому пока эти
-- колонки только растут — покупкой через POST /character/buy-consumable.
--
-- По колонке на книгу, а не Json и не отдельная таблица — та же причина, что у
-- potionT1..T5, whetstones и charms: видов ровно столько, сколько в каталоге, а
-- счётчику нужен атомарный increment в том же UPDATE, где списывается золото
-- (условная запись с фильтром `gold >= total`).
--
-- DEFAULT 0 сразу проставляет 0 всем существующим строкам, поэтому отдельный
-- UPDATE для переливки не нужен: купить книгу до этой миграции никто не мог.
--
-- Здесь ТОЛЬКО ADD COLUMN. Ни DROP, ни переливки данных: добавление колонки с
-- DEFAULT безопасно для ещё живого старого серверного процесса на Render
-- (деплой не мгновенный) — он про эти колонки не знает и в SELECT их не
-- перечисляет, так что читать персонажа продолжит без ошибок.
--
-- ⚠️ ПОРЯДОК ВЫКЛАДКИ (как у оберега, и по той же причине): сначала эта миграция
-- против боевой БД, потом серверный код, и только потом фронт. Обратный порядок
-- уронит ЛОГИН: consumableStockOf перечисляет колонки книг поимённо, и Prisma
-- запросит их в каждом чтении персонажа.
-- ⚠️ На момент создания этой папки НЕ применена и МИГРАЦИЯ ОБЕРЕГА
-- (20260928120000_charm_stock_add). `prisma migrate deploy` применяет все
-- pending разом — обе уйдут одним заходом, и это безопасно: в обеих только
-- ADD COLUMN ... DEFAULT 0.
ALTER TABLE "Character" ADD COLUMN "bookFire" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Character" ADD COLUMN "bookIce" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Character" ADD COLUMN "bookBleed" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Character" ADD COLUMN "bookHeal" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Character" ADD COLUMN "bookDash" INTEGER NOT NULL DEFAULT 0;
