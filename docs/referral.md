# Приглашения друзей (12.11.2026)

Вкладка «Сообщество» → «Друзья». До 12.11.2026 там была заглушка (ссылка без
кода, пустой список). Решение владельца: **без ограничений** на число друзей и
наград.

## Правила

- Ссылка друга — `https://t.me/RightPlaceGame_bot/game?startapp=r_<код>`, код —
  8 знаков `[A-Za-z0-9]` (`Character.referralCode`), создаётся лениво при первом
  `GET /character/friends`.
- **Привязка — только при СОЗДАНИИ нового игрока** (`/auth/login`): `start_param`
  читается из ПОДПИСАННОГО initData (`new URLSearchParams(initData).get('start_param')`
  после проверки подписи), а не из тела запроса. Старого игрока не привязать,
  себя не пригласить (у нового игрока кода ещё нет). Ссылки гильдии `g_` сюда не
  попадают — `parseReferralStartParam` берёт только `r_` + 8 знаков. Неизвестный
  код — игрок создаётся без привязки и `warn` в лог.
- **Порог** — `REFERRAL_LEVEL` = 3 по `calculateLevel` (статы + bonusLevels).
- **Приглашённый** получает награду сам: на входе (после закрытия брошенного
  забега) и на финише забега, если есть `invitedById`, `inviteeRewardAt` пуст,
  уровень ≥ 3 и `currentRun` пуст. Одна условная запись
  (`updateMany … inviteeRewardAt: null, currentRun: DbNull`): +`REFERRAL_GOLD` (5000)
  золота, +`REFERRAL_RP` (100) RP, `inviteeRewardAt = referralReadyAt = now`. В
  ответ — `referralReward: { inviterName }`, клиент показывает окно.
  `grantInviteeReward` (`server/src/routes/friends.ts`); сбой — громкий лог и
  `null`, вход и финиш от награды не падают.
- **Пригласивший** забирает награду кнопкой: друг в состоянии `claim` (уровень ≥ 3,
  `inviterClaimedAt` пуст). Одна транзакция: друг помечается условной записью
  (`inviterClaimedAt: null`), моё золото и RP — `increment` на число помеченных с
  фильтром «нет забега».

## Ручки (`server/src/routes/friends.ts`)

| Ручка | Ответ / отказы |
|---|---|
| `GET /character/friends` | `{ link, invitedBy: { name, rewardReceived } \| null, friends: [{ id, name, level, state }] }` — новые сверху (`id desc`); `state`: `progress` / `claim` / `claimed` |
| `POST /character/friends/claim` `{ friendId }` | тот же вид + `claimed`, `gold`, `rp`, `goldGained`, `rpGained`. 400 `Invalid friendId`, 400 `Run in progress` (как обмен трофеев), 404 `Friend not found` (чужой и несуществующий неразличимы), 409 `Already claimed`, 400 `Not ready` |
| `POST /character/friends/claim-all` | то же за всех готовых; никого — 400 `Not ready` |

Вход (`/auth/login`) и финиш (`/run/finish-explore`) несут `referralReward`, если
этот запрос выдал награду приглашённому. В сохранённый итог повтора финиша
(`finish:<runId>`) флаг не входит: повтор окна не покажет, награда при этом уже
начислена.

## Данные (миграция `20261112120000_referral_add`)

`Character`: `referralCode String? @unique`, `invitedById Int?` (связь
`Referral` на `Character`, `ON DELETE SET NULL`, индекс), `inviteeRewardAt`,
`inviterClaimedAt`, `referralReadyAt` (`DateTime?`). Только добавление.
⚠️ **Сервер без миграции роняет вход** (Prisma перечисляет новые колонки) —
порядок «бэкап-ветка Neon `backup-2026-11-12-before-referral` → `migrate deploy`
→ `git push` → Live на Render → `npm run deploy`».

## Общий каталог

`src/referral.ts` ↔ `server/src/referral.ts` — байт в байт (`check_potion_sync.py`):
`REFERRAL_PREFIX` `r_`, `REFERRAL_LEVEL` 3, `REFERRAL_GOLD` 5000, `REFERRAL_RP` 100,
`REFERRAL_CODE_LENGTH` 8, `referralUrl`, `parseReferralStartParam`, `friendState`.

## Клиент (`App.tsx`, `src/api.ts`)

- Вкладка «Друзья» перечитывает `GET /character/friends` при каждом открытии.
  Блок награды — числа из каталога; ссылка с кодом; «копировать» копирует её;
  «Пригласить друга» — `openTelegramLink` SDK на `https://t.me/share/url?url=…&text=…`
  (вне Telegram — `window.open`).
- Список: имя, «ур. N», справа «до награды N ур.» / «Забрать» / «получено»; при
  ≥ 2 готовых — «Забрать всё (N)». После забора — шапка валют из ответа и тост
  «+5000 золота, +100 RP». Отказ «Run in progress» — «Награду можно забрать после
  вылазки»; 409 / Not ready / 404 — молча перечитать список.
- Меня пригласили — строка «Тебя позвал <имя>. Награда — на 3 уровне» / «Награда
  получена».
- Окно «Награда за приглашение» (`zIndex` 2050) — по `referralReward` входа или
  финиша (поверх итогов забега).
- Офлайн-заглушка: пустой список, «Ссылка — в Telegram», запросов нет.
- Разбор строгий (`readFriendsView`): любое отклонение формы — «Ссылка не
  загрузилась» и «повторить».

## Уведомления бота

`server/src/bot/notify.ts` на 12.11.2026 **нет** — уведомлений нет. Когда
появится: `queueNotification(inviterId, 'friend_joined', …)` после привязки
(`routes/auth.ts`, создание игрока) и `'friend_reward'` в `grantInviteeReward`,
лучшим усилием в `try/catch`. Отметка для них — `referralReadyAt`.

## Что проверено (12.11.2026)

Временный локальный Postgres (embedded-postgres, порт 5498, база `rp_ref_test`;
предохранитель — порт и имя базы; не Neon), настоящие маршруты `auth`, `run`,
`friends` через `inject`, **39 из 39**: миграция поверх прежней схемы = новая
схема (`migrate diff --exit-code`); код 8 знаков и лениво; привязка нового, без
привязки — неизвестный код, `g_`, старый игрок, сам себя; `start_param` вне
подписи — 401; награда приглашённому на входе (и в ответе, и в базе), без второй
на повторном входе; с открытым забегом — нет; на финише — с `referralReward` и
золотом в ответе, повтор финиша — без второй; забор: до порога, во время забега,
200, 409, 404, кривой id, три одновременных — ровно один 200; claim-all за двух,
порядок «новые сверху», без готовых — 400. Клиент — офлайн-заглушка в
headless-Chrome на 390×844 и 844×390 (`s53_friends.mjs`): вкладка рисуется,
ничего за экран. ⚠️ Список с настоящими друзьями и кнопки «Забрать» — только по
коду и типам (у заглушки сервера нет); Telegram и живая база — долг «ДРУЗЬЯ».
