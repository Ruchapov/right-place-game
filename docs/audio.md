# Звук и музыка (16.11.2026)

Только клиент: сервер и база не менялись. Задача — `_sound/PROMPT.md` (архив
`RightPlace_sound.zip`, папка `_sound/` вне git).

## Файлы

`public/assets/audio/sfx/*.mp3` — 40 коротких звуков (моно, пик −1 dB);
`public/assets/audio/music/*.mp3` — 7 зацикленных треков: `crypt_explore`,
`foundry_explore`, `swamp_explore`, `graveyard_explore`, `battle`, `boss`,
`menu`. Пути — через `import.meta.env.BASE_URL`.

## `src/audio/sound.ts`

- Web Audio API, один `AudioContext`, шины `master` → (`music`, `sfx`).
- Разблокировка: одноразовые `pointerdown` / `touchend` на `window` →
  `ctx.resume()`; до этого `playSfx` молчит. Свернули — `visibilitychange`
  (hidden) → `suspend()`, вернулись → `resume()`. Обработчиков Telegram
  `activated`/`deactivated` в коде не было — не подключались.
- `initAudio()` зовёт `main.tsx`: создаёт контекст и фоном грузит все эффекты
  (кэш `Map<path, AudioBuffer>`; ошибка файла — `console.warn`, дальше без него).
- `playSfx(name, { volume, rate, x, y })`: базовая громкость — `SFX_VOLUMES`
  (таблица задачи, подкручивать там); разброс rate 0.95–1.05 и громкости
  0.9–1.0 (кроме `ui_click`); `step_stone` — случайный из `step_stone_1..5`, не
  тот же подряд; один звук не чаще раза в 50 мс, не больше 4 копий одного и 16
  всего. С позицией (`x`, `y` — мир) громкость падает с расстоянием до героя
  (полная до 6 тайлов, 0 от 16) и есть панорама −0.6…0.6; слушателя ставит
  тикер забега (`setAudioListener`, центр героя).
- Настройки `musicVolume` (0.5), `sfxVolume` (0.8), `muted` — `localStorage`
  ключ `rp_audio_v1`, чтение и запись в try/catch. React читает их
  `useSyncExternalStore(subscribeAudioSettings, getAudioSettings)`.

## `src/audio/music.ts` — «дирижёр»

Состояния `menu` / `explore` / `battle` / `boss` / `off`; трек —
`AudioBufferSourceNode` с `loop`, смена — кроссфейд `linearRampToValueAtTime`:
в бой 1 с, из боя 2.5 с, в босса 1.5 с, меню 1.5 с. Возврат в `explore`
продолжает трек с места, где его увели (`exploreOffset`); новая карта — с начала.
Громкость трека: explore 0.8, battle 0.85, boss 1.0, menu 0.7 (× `musicVolume`).

- Тема — `backdropForMap` (как фон): graveyard → `graveyard_explore` (нет файла
  — `crypt_explore`), flooded_crypt → `crypt_explore`, foundry →
  `foundry_explore`, swamp → `swamp_explore`, иначе `crypt_explore` + warn.
  `boss` без файла — `battle`.
- Память: `prepareRunMusic(theme, hasBoss)` (setup забега, как только известны
  события) грузит трек темы, `battle` и `boss` (только с боссом), остальное
  отпускает; `enterMenuMusic()` (старт игры, экран итогов, выход из забега) —
  только `menu`.
- Бой (`updateCombatMusic`, каждый кадр забега): `engaged` — хоть один живой
  враг (не Беглец) преследует (`aggroMemoryTimer`), заметил («!»,
  `noticePending`) или в замахе/атаке; или герой получил урон врага
  (`musicHeroHit`). Выход — 4 с подряд без этого, но не раньше 6 с от входа.
- Босс: `musicBossAppeared` в момент появления (заставка или пробуждение
  ударом), держится до смерти; смерть — тишина 3 с (гаснет за 1.5 с), потом
  `explore`. Смерть героя — гаснет за 1 с, `hero_death`, дальше `off` до итогов.

## Где звуки

| Звук | Где |
|---|---|
| `sword_swing_1` | начало замаха (`startPlayerAttack`, каждый удар комбо); выпад фехтовальщика — в кадр удара |
| `enemy_hit_1` / `boss_hurt` | `damageEnemy` / `damageBoss` — меч и навыки, не тики |
| `step_stone` | кадры касания ноги листа бега — 8 и 19 (замер по альфе), только на земле |
| `jump` / `land` | толчок прыжка / приземление после ≥150 мс в воздухе |
| `dash` | `startPlayerDash` |
| `block` | отбив (`takeDamage`, `takeRamDamage`), блок фехтовальщика |
| `hero_hurt` / `spikes` | `applyDamage`: урон врага / шипы и ловушки (горение — без звука) |
| `hero_death` | `triggerDeath` |
| `potion` | кадр глотка |
| `chest_open`, `shadow_chest` | удар по сундуку; Тень встала из сундука |
| `pickup` | всплывашка награды (одна на пачку), шар маны долетел |
| `barrel_break` / `jar_break` | `breakables.strike` |
| `ui_click` | общий `click` на документе (`main.tsx`): любая `<button>` вне боевых кнопок `[data-touch-controls]` |
| `enemy_alert` | `perception.perceive`: появилось «!» (стая — один звук, защита 50 мс) |
| `enemy_death` | `damageEnemy`, смертельный удар |
| `gravedigger_shovel`, `gravedigger_dirt` | кадр удара лопатой; бросок кома и его падение (0.6) |
| `crossbow_shot`, `stoker_fire`, `beetle_throw`, `beetle_dash` | кадр выстрела / удара / броска / начала рывка |
| `boss_appear` (+ `werewolf_roar` у Твари) | появление босса |
| `werewolf_claws`, `boss_slam` | Тварь: удар когтями (оба удара), топот |
| `boss_slam`, `boss_bell_swing` | Настоятель: кулак и колокол об пол / горизонтальный взмах |
| `serpent_bite`, `serpent_spit`, `boss_slam`, `werewolf_roar` ×0.8 | Змей: укус, плевок, удар головой и выныривание, рёв ярости |
| `crowking_wings`, `crowking_scatter` | Король: удар крыльями; распад и сборка |
| `boss_death` | `damageBoss`, смертельный удар |

Волк (зверь), Звонарь, Привратник — без своих звуков атаки (задача).

## Настройки

Панель шестерёнки (`SettingsPanel`) — блок «Звук» вместо двух прежних
заглушек: «Музыка» и «Эффекты» (0–100), «Без звука». Меню — кнопка-динамик
🔊/🔇 рядом с «?» на «Персонаже».

## Проверено

Headless-Chrome, офлайн-заглушка, карта B (`s48_sound.mjs` в папке
автоплейтеста, Chrome с `--autoplay-policy=no-user-gesture-required`):
загружены 40 эффектов и `menu`, после касания играет меню; в забеге
загружены `graveyard_explore` и `battle` (босса нет — `boss` не грузится),
играет тема; удар, три шага, прыжок, приземление — 7 эффектов; агро врага —
`battle`; после затишья — та же тема с места остановки; ошибок и
предупреждений нет. ⚠️ Не проверено: телефон, iOS-разблокировка, сворачивание
Telegram, боссы и новые враги вживую.

## Правки 17.11.2026: звук и в беззвучном режиме iPhone [ПРОВЕРИТЬ НА ТЕЛЕФОНЕ]

Решение Андрея: звук игры играет и при боковом переключателе «Без звука» (как в
обычных играх); громкость и «Без звука» — только из настроек игры.
- В каждом касании (`unlock`, `sound.ts`): `navigator.audioSession.type =
  'playback'` (iOS 16.4+). Старым iOS (нет `audioSession`) — тихий зацикленный
  `<audio>` (WAV-тишина 0.5 с из кода, `playsinline`), запускается в том же
  касании; пока он играет, аудиосессия страницы — «воспроизведение». Только на
  устройствах Apple с касанием; на Android и ПК не создаётся.
- Слушатели касания больше не снимаются: iOS «прерывает» контекст (звонок, Siri,
  сворачивание Telegram), и `resume` без касания не проходит — следующее касание
  поднимает его. `visibilitychange`: свернули — `suspend` и пауза тихого
  `<audio>`; вернулись — `play` и `resume`.
- Ползунки «Музыка» / «Эффекты», «Без звука» и динамик в меню — те же
  `setAudioSettings` → `applyBusVolumes` (шины master / music / sfx), хранятся в
  `rp_audio_v1`; сверено по коду.
- На ПК это не проверить: проверять на iPhone (долг «ПРАВКИ 17.11», пункт 14).
