# Бот @RightPlaceGame_bot (13.11.2026)

> ⚠️ **С 24–25.11.2026 сервер живёт в Москве (`api.rightplace-game.ru`), и всё про
> Render и cron-job.org ниже — история.** Telegram с сервера недоступен, бот ходит
> через Cloudflare Worker `rightplace-tg` (`tools/tg-proxy/`): Bot API — `/tg`,
> вебхук — `/hook`, картинки — `/art` (воркер сам загружает их файлом). `/cron/tick`
> зовёт systemd-таймер `rightplace-cron.timer` раз в минуту; задача на cron-job.org
> выключена (не удалена — для отката). Переменные: `TELEGRAM_API_BASE`, `PROXY_KEY`,
> `TELEGRAM_WEBHOOK_URL`, `BOT_ART_URL`, `PUBLIC_URL`. Под уведомлениями с 25.11.2026
> кнопка «🏠 В меню» (callback `m`). Подробно — CLAUDE.md, «Свой сервер».

Уведомления («Колокол Убежища»), карточки с картинками, канал @rightplace_news с
наградой +50 RP. Bot API — голым `fetch`, без пакетов. Код — `server/src/bot/`.

## Переменные Render

| Переменная | Зачем |
|---|---|
| `BOT_TOKEN` | был и раньше (проверка initData); им же бот шлёт сообщения |
| `BOT_WEBHOOK_SECRET` | заголовок `X-Telegram-Bot-Api-Secret-Token` вебхука; без него `/bot/webhook` отвечает 401 всем |
| `CRON_SECRET` | ключ `GET /cron/tick?key=…`; без него — 401 |
| `PUBLIC_URL` | `https://right-place-game.onrender.com`; есть — при старте сервер сам делает `setWebhook` и `setMyCommands` (ошибки — в лог) |

**cron-job.org:** задание раз в минуту на
`https://right-place-game.onrender.com/cron/tick?key=<CRON_SECRET>`. Он же будит
Render Free. Ответ — JSON со счётчиками (`queued`, `queue.sent/failed/…`).

**Канал:** бот обязан быть администратором @rightplace_news — иначе
`getChatMember` не отвечает, и ручка награды даёт 503 `check_failed`.

## Файлы

| Файл | Что |
|---|---|
| `bot/telegram.ts` | `call()` (429 — ждать `retry_after` и один повтор; 403 — `botBlocked=true`), обёртки, кнопки (`style` Bot API 9.4), `sendCard` — фото, а если Telegram не взял картинку, тот же текст сообщением |
| `bot/notify.ts` | `queueNotification(characterId, kind, payload?)` — только ставит в `BotNotification`; не ставит при выключенном типе, `botAllowed=false`, `botBlocked`. Тихие часы 23:00–09:00 МСК → ближайшие 09:00. Тексты и картинки уведомлений |
| `bot/webhook.ts` | `POST /bot/webhook`. **Одна карточка** (13.11.2026, вечер): `/start`, `/play`, `/notify`, `/friends`, `/help` шлют одну карточку-фото; кнопки меню меняют её же (`editMessageMedia`), карточка старше 47 ч или правка не прошла — новая. Экраны: главный (start.jpg; [Играть] / [Уведомления] [Друзья] / [Канал: +50 RP] [Об игре]), уведомления (energy.jpg, переключатели меняют кнопки на месте), друзья (friend.jpg: позвано, `copy_text` со ссылкой, «Отправить другу»), канал (channel.jpg), об игре (quests.jpg; с 17.11.2026 — описание мира вместо правил); в разделах — [Играть] [‹ Назад]. callback_data — латиница ≤ 64 байт (схема — в шапке файла), параметр /start (≤ 48 знаков) едет во всех кнопках. Эффект 🔥 — только при первом /start (флаг `botStarted` в `notifySettings`; без персонажа — в памяти до перезапуска). Обычный текст — «🔔 Колокол не слышит слов. Только кнопки.» и главный экран, не чаще раза в 10 мин. Ошибка — «Колокол сбился…», детали в лог. Любое сообщение — `botAllowed=true, botBlocked=false` |
| `bot/cron.ts` | `GET /cron/tick`: полная энергия, новый набор заданий, «вернись» на 3 и 7 день (`lastSeenAt`, `comebackStage`), отправка очереди: 25/с, до 300 за вызов, игрок в игре (`lastActiveAt` < 15 мин) — energy/quests гасятся, остальное ждёт; energy, quests и comeback — не больше 2 игроку за 24 ч (гильдия и друзья в лимит не идут); старше 48 ч — `expired` |
| `bot/routes.ts` | `GET/POST /character/notify-settings`, `POST /character/bot-allowed`, `POST /character/channel-reward` (400 `not_subscribed`, 409 `already`, 503 `check_failed`), хук `lastActiveAt` (раз в минуту, не ломает запрос) |

Кто ставит уведомления: вход (`friend_joined` пригласившему при создании игрока
по `r_<код>`), `grantInviteeReward` (`friend_reward`, ровно один раз — после
условной записи), `/guild/request` (`guild_request` главе и заместителям),
`/guild/requests/decide` (`guild_accepted` / `guild_declined`) — после коммита,
ошибка ответ не ломает.

База — миграция `20261113120000_bot_notifications_add` (только ADD COLUMN и
CREATE TABLE): колонки персонажа `botAllowed`, `botBlocked`, `notifySettings`
(NULL — всё включено), `lastActiveAt`, `energyNotifiedAt`, `questsNotifiedAt`,
`comebackStage`, `channelRewardAt` и таблица `BotNotification`. Вход и профиль
отдают `channelRewardClaimed`.

## Картинки

`public/bot/<имя>.jpg` (start, energy, quests, guild, friend, comeback, channel),
адрес `https://ruchapov.github.io/right-place-game/bot/<имя>.jpg`.
1280×720, всего ≈0.9 МБ, из `RightPlace_bot_art.zip` (13.11.2026). Пропадёт файл — `sendCard`
отправит карточку текстом.

## Клиент

«Сообщество» → третья вкладка «Канал» (`src/ui/ChannelPanel.tsx`): колокол,
плашка «+50 RP», шаги «1. Открыть канал» и «2. Проверить подписку», при успехе
всплывает «+50 RP» и RP в шапке растёт. «Персонаж» внизу — «🔔 Уведомления»
(`src/ui/NotifySettingsSheet.tsx`): пять переключателей, без разрешения —
«Разрешить сообщения от бота» (`requestWriteAccess`).

## Кнопки под уведомлением

[⚔️ Играть] [🔕 Не присылать такое] — нажатие выключает этот тип (`no:<настройка>`) всплывашкой «Больше не пришлю такое» и меняет кнопки на [⚔️ Играть] [↩️ Вернуть] (`yes:<настройка>` включает обратно).

## Чат игроков (22.11.2026)

Публичная группа t.me/rightplace_chat — она же обсуждение канала @rightplace_news.
В главном меню бота — кнопка «💬 Чат игроков» своим рядом под «Канал / Об игре»
(ссылка, `url`, без колбэка). Адрес — `CHAT_URL` рядом с `CHANNEL_URL` в
`server/src/bot/telegram.ts`. Награды и проверки участия нет. В игре та же ссылка —
плитка во вкладке «Сообщество → Канал» (`docs/meta-screens.md`).

## Напоминания «Печати Колокола» (25.11.2026)

Премиум за RP (`docs/premium.md`). `scanPremium` в `GET /cron/tick` ставит
`premium_3d` (за 3 дня), `premium_1d` (за день) и `premium_end` («Печать Колокола
угасла. Вернуть её можно в Убежище»), картинка `comeback`, кнопки как у остальных.
Вне лимита «2 фоновых звона в сутки», в игре — откладываются, как гильдия. Шестой
переключатель `premium` («Печать Колокола») в настройках игры и бота. Каждое —
ровно один раз за срок: `Character.premiumNoticeStage` (0–3) пишется условной
записью; покупка ставит 0.

## Описание бота и путь нового игрока (26.11.2026)

Жалоба: человек из канала @rightplace_news не смог зайти в игру — «возможно,
потому что не писал боту»; и в пустом чате бота нет приветствия.

**Описание для пустого чата.** `registerBotWebhook` (`bot/webhook.ts`) при старте
сервера ставит теперь, кроме вебхука и команд, `setMyDescription` («Right Place —
тёмный платформер-рогалик прямо в Telegram. Вылазки, враги и боссы, добыча и
прокачка героя. Нажми «Начать», чтобы играть.») и `setMyShortDescription`
(«Тёмный платформер-рогалик в Telegram: вылазки, боссы, добыча.»), тем же `call`
через воркер. Лог: `bot: setMyDescription ok` / `bot: setMyShortDescription ok`
или `… failed` с описанием от Telegram.

**Вход нового игрока — две поломки в коде, обе исправлены:**
1. `parseTelegramUser` (`server/src/auth.ts`) второй раз раскодировал поле `user`,
   которое `URLSearchParams.get` уже раскодировал: имя с «%» давало `URIError` →
   400 «Cannot parse user data», игрок не входил вовсе. Теперь — `JSON.parse` как
   есть, старый путь — запасной.
2. Гонка первого входа (`routes/auth.ts`): первый запрос нового игрока медленный
   (создание на холодной базе), клиент по таймауту 20 с шлёт повтор, оба не
   находят игрока, второй `create` падал на уникальности `telegramId` → 500.
   Теперь проигравший гонку (`P2002`) перечитывает игрока; лог `login: new player
   created by a parallel login, re-reading`, прочие ошибки создания —
   `login: new player create failed`.
Писал ли человек боту, для входа НЕ важно: Mini App по ссылке
`t.me/RightPlaceGame_bot/game` даёт подписанный initData и без чата с ботом.

⚠️ Логи сервера сессия 26.11 НЕ видела — SSH на `161.104.30.53` заблокирован
фильтром разрешений среды. Что снять Андрею (из cmd):
`ssh root@161.104.30.53 "journalctl -u rightplace --since '2026-11-25' | grep -iE 'auth|login|initData|401|500|card send'"`.
Ищем: `Invalid initData` (401 — подпись не сошлась: не тот бот или старый токен),
`Cannot parse user data`, `login: new player create failed`, 500 на `/auth/login`,
`bot: card send failed` (карточка `/start` не ушла — причина в строке). И в
BotFather: `/myapps` → бот → Mini App `game` → Edit Web App URL — должен быть
`https://rightplace-game.ru` (после переезда 24.11). Если там старый адрес
GitHub Pages — новый игрок открывает СТАРЫЙ фронт, который ходит на
приостановленный Render, и вход не проходит. У игрока спросить скрин того, что он
видел (экран ошибки или пустой экран).
