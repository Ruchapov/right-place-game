# Бот @RightPlaceGame_bot (13.11.2026)

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
| `bot/webhook.ts` | `POST /bot/webhook`. **Одна карточка** (13.11.2026, вечер): `/start`, `/play`, `/notify`, `/friends`, `/help` шлют одну карточку-фото; кнопки меню меняют её же (`editMessageMedia`), карточка старше 47 ч или правка не прошла — новая. Экраны: главный (start.jpg; [Играть] / [Уведомления] [Друзья] / [Канал: +50 RP] [Как играть]), уведомления (energy.jpg, переключатели меняют кнопки на месте), друзья (friend.jpg: позвано, наград ждёт, `copy_text` со ссылкой, «Отправить другу»), канал (channel.jpg), как играть (quests.jpg); в разделах — [Играть] [‹ Назад]. callback_data — латиница ≤ 64 байт (схема — в шапке файла), параметр /start (≤ 48 знаков) едет во всех кнопках. Эффект 🔥 — только при первом /start (флаг `botStarted` в `notifySettings`; без персонажа — в памяти до перезапуска). Обычный текст — «Я понимаю только кнопки 🙂» и главный экран, не чаще раза в 10 мин. Ошибка — «Колокол сбился…», детали в лог. Любое сообщение — `botAllowed=true, botBlocked=false` |
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
