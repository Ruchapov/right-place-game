-- Мастер (docs/crafter.md, 29.10.2026): склад сырья, Слитков и колец, гнёзда
-- колец и десять вещей иного места.
--
-- Колонки склада — по одной на предмет, как soulShards/renounceSeals (каталог
-- classItems.ts): счётчику нужен атомарный increment в ТОМ ЖЕ UPDATE, который
-- закрывает забег. DEFAULT 0 сразу проставляет 0 всем строкам.
--   darkClots   — Сгусток тьмы (с групп врагов, с 5 уровня);
--   starPollen  — Звёздная пыльца (Звёздоцвет на карте, с 5 уровня);
--   otherIngots — Слиток иного места (переплавка у Мастера);
--   ring*       — кольца, лежащие в сумке (с 30 уровня).
-- ringSlots — что надето в два гнезда Дланей иного места: id колец, не больше
-- двух. Надетое кольцо уходит со склада и места в сумке не занимает.
--
-- Вещи иного места — тир 7, уровень 30. id — читаемые слаги, как у старого
-- каталога (сырой INSERT обязан задать id сам). Тир 7 в обычную добычу НЕ
-- попадает: выбор вещи в runs ограничен tier <= 6 (resolveDropIntent).
--
-- Здесь только ADD COLUMN и INSERT — безопасно для ещё живого старого
-- серверного процесса.
--
-- ⚠️ ПОРЯДОК ВЫКЛАДКИ: резервная ветка Neon → эта миграция → сервер → фронт.
--   cd server && npx prisma migrate deploy && npx prisma migrate status
ALTER TABLE "Character" ADD COLUMN "darkClots" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Character" ADD COLUMN "starPollen" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Character" ADD COLUMN "otherIngots" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Character" ADD COLUMN "ringSaving" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Character" ADD COLUMN "ringSkillSearch" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Character" ADD COLUMN "ringAsh" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Character" ADD COLUMN "ringOverflow" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Character" ADD COLUMN "ringProspector" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Character" ADD COLUMN "ringReturn" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Character" ADD COLUMN "ringSlots" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

INSERT INTO "Item" ("id", "slot", "tier", "nameRu", "iconPath", "levelRequired", "damage", "armor", "moveSpeed", "luck", "description") VALUES
  ('other_shpaga',     'weapon', 7, 'Шпага иного места',      'items/other_shpaga.png',     30, 60,   NULL, NULL, NULL, 'Находит щель в любой защите.'),
  ('other_palash',     'weapon', 7, 'Палаш иного места',      'items/other_palash.png',     30, 60,   NULL, NULL, NULL, 'Широкий клинок, который не знает пощады.'),
  ('other_klinok',     'weapon', 7, 'Клинок иного места',     'items/other_klinok.png',     30, 60,   NULL, NULL, NULL, 'Чужая кровь залечивает твои раны.'),
  ('other_kolet',      'armor',  7, 'Колет иного места',      'items/other_kolet.png',      30, NULL, 30,   NULL, NULL, 'Его хозяин не боится встречного удара. Скорее ждёт его.'),
  ('other_brigantina', 'armor',  7, 'Бригантина иного места', 'items/other_brigantina.png', 30, NULL, 30,   NULL, NULL, 'Пропущенный удар здесь не всегда пропал даром.'),
  ('other_pancir',     'armor',  7, 'Панцирь иного места',    'items/other_pancir.png',     30, NULL, 30,   NULL, NULL, 'Крепнет вместе с отчаянием хозяина.'),
  ('other_klobuk',     'helmet', 7, 'Клобук иного места',     'items/other_klobuk.png',     30, NULL, 10,   NULL, NULL, 'Носивший его не падал там, где падали другие.'),
  ('other_dlani',      'gloves', 7, 'Длани иного места',      'items/other_dlani.png',      30, NULL, 10,   NULL, NULL, 'Руки мастера ждут своих колец.'),
  ('other_shag',       'boots',  7, 'Шаг иного места',        'items/other_shag.png',       30, NULL, NULL, 10,   NULL, 'Кто носит их, ступает по шипам почти без боли.'),
  ('other_chetki',     'amulet', 7, 'Чётки иного места',      'items/other_chetki.png',     30, NULL, NULL, NULL, 10,   'Ещё одна молитва — ещё один глоток.')
ON CONFLICT ("id") DO NOTHING;
