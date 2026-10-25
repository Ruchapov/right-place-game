import { useState, type ReactElement } from 'react'
import { C, FONT_DISPLAY } from './theme'
import {
  HERO_CLASSES,
  CLASS_CHOOSE_LEVEL,
  CLASS_CHOOSE_SHARDS,
  CLASS_CHOOSE_GOLD,
  CLASS_ASCEND_LEVEL,
  CLASS_ASCEND_SHARDS,
  CLASS_ASCEND_GOLD,
  heroClassById,
  heroClassStage,
  chooseShortfalls,
  ascendShortfalls,
  shortfallLine,
  type HeroClass,
  type HeroClassId,
  type HeroClassState,
  type HeroClassWallet,
} from '../heroClasses'
import { bookBySkillId, parseSkillBookSkillId } from '../consumables'
import { classItemById } from '../classItems'

// Вид классов героя (20.10.2026, docs/classes.md, «Выбор, возвышение, отречение —
// у Отшельника», «Строка класса на «Персонаже»»). Здесь только вид: состояние,
// запросы и мерж ответов — в App.tsx (handleClassAction), правила «чего не
// хватает» — в общем каталоге heroClasses.ts, одни на клиент и сервер.
//
// Эффектов классов в бою пока нет — карточка только рассказывает, что класс даст.

const ICON = (file: string) => `${import.meta.env.BASE_URL}assets/icons/${file}`

/** Имя книги по id навыка — из каталога расходников, как в отказе сервера. */
function classBookName(skillId: string): string {
  const parsed = parseSkillBookSkillId(skillId)
  return (parsed === null ? null : bookBySkillId(parsed))?.nameRu ?? skillId
}

function bookIcon(skillId: string): string | null {
  const parsed = parseSkillBookSkillId(skillId)
  return (parsed === null ? null : bookBySkillId(parsed))?.icon ?? null
}

const SHARD_ICON = classItemById('soul_shard')?.icon ?? 'item_soul_shard.png'

// --- Строка класса на «Персонаже» ---

/**
 * Просто текст под именем героя, без тапа (docs/classes.md):
 * до 10 уровня — «Класс не выбран», с 10 без класса — «Можно выбрать класс», с
 * классом — иконка и название ТЕКУЩЕЙ ступени. heroClass === null — сервер класс
 * не назвал: это не «класса нет», и строка говорит именно это.
 */
export function HeroClassLine({ heroClass, level }: { heroClass: HeroClassState | null; level: number }) {
  if (heroClass === null) {
    return <div style={{ fontSize:11, color:C.textDim, marginTop:2 }}>Класс неизвестен</div>
  }
  if (heroClass === 'none') {
    return level >= CLASS_CHOOSE_LEVEL
      ? <div style={{ fontSize:11, color:C.glowMid, marginTop:2 }}>Можно выбрать класс</div>
      : <div style={{ fontSize:11, color:C.textDim, marginTop:2 }}>Класс не выбран</div>
  }
  const cls = heroClassById(heroClass.id)
  if (cls === null) return <div style={{ fontSize:11, color:C.textDim, marginTop:2 }}>{heroClass.id}</div>
  const stage = heroClassStage(cls, heroClass.tier)
  return (
    // По центру — как имя над ней и прежняя надпись «— класс не выбран —»:
    // текст в шапке наследует центрирование корня, а flex его не наследует.
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:4, marginTop:2, minWidth:0 }}>
      <img src={ICON(stage.icon)} alt="" width={16} height={16} style={{ display:'block', objectFit:'contain', flexShrink:0 }} />
      <span style={{ fontSize:11, color:C.bone, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{stage.nameRu}</span>
    </div>
  )
}

// --- Плитки «Классы» у Отшельника ---

/**
 * Три плитки с иконками ПЕРВОЙ ступени — ячейка того же вида, что в витрине
 * «Убежища» (ниша, плашка в углу, замок по уровню приглушением). Свой класс
 * отмечен рамкой со свечением изнутри (правило стиля: свечение подсвечивает, а
 * не рисует рамку — рамка здесь цвета края свечения, как у активной вкладки) и
 * плашкой «твой». До 10 уровня — замок: плитка приглушена, на плашке «ур. 10»;
 * тап всё равно открывает карточку для чтения.
 *
 * Подпись с именем под плиткой — решение сессии: у товаров витрины названий
 * нет, но здесь выбор из трёх, и без имени он вслепую.
 */
export function HeroClassTiles({ heroClass, level, onSelect }: {
  heroClass: HeroClassState | null
  level: number
  onSelect: (id: HeroClassId) => void
}) {
  const ownId = heroClass !== null && heroClass !== 'none' ? heroClass.id : null
  // Замок — только у героя без класса ниже 10 уровня: с классом уровень и так
  // не ниже десятого.
  const locked = level < CLASS_CHOOSE_LEVEL && ownId === null
  return (
    <div style={{ display:'grid', gridTemplateColumns:'repeat(3, minmax(0, 1fr))', gap:8, padding:'0 8px' }}>
      {HERO_CLASSES.map((cls) => {
        const stage = heroClassStage(cls, 1)
        const own = cls.id === ownId
        return (
          <div key={cls.id} onClick={() => onSelect(cls.id)} style={{ cursor:'pointer', minWidth:0 }}>
            <div style={{
              boxSizing:'border-box', position:'relative', aspectRatio:'1',
              background:C.nicheDeep, borderRadius:10, padding:6,
              border:`1px solid ${own ? C.glowEdge : C.stoneDark}`,
              boxShadow: own
                ? 'inset 0 0 14px rgba(209,151,68,0.35), inset 0 2px 6px rgba(0,0,0,0.5)'
                : 'inset 0 2px 6px rgba(0,0,0,0.5)',
              opacity: locked ? 0.45 : 1,
            }}>
              <img src={ICON(stage.icon)} alt={stage.nameRu} style={{ width:'100%', height:'100%', objectFit:'contain', display:'block' }} />
              {(own || locked) && (
                <div style={{
                  position:'absolute', right:4, bottom:4,
                  background:'rgba(21,18,24,0.85)', borderRadius:5, padding:'2px 6px',
                  fontSize:11, fontFamily:FONT_DISPLAY,
                  color: own ? C.glowCore : C.textDim,
                }}>
                  {own ? 'твой' : `ур. ${CLASS_CHOOSE_LEVEL}`}
                </div>
              )}
            </div>
            <div style={{
              marginTop:5, fontSize:11, textAlign:'center',
              color: own ? C.glowCore : C.textDim,
              overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap',
            }}>
              {stage.nameRu}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// --- Карточка класса ---

export type ClassActionKind = 'choose' | 'ascend' | 'renounce'

const blockStyle = {
  background:C.nicheDeep, borderRadius:8, padding:'9px 11px', marginBottom:10,
} as const
const blockTitle = {
  fontSize:10, letterSpacing:1, color:C.textDim, fontFamily:FONT_DISPLAY, marginBottom:6,
} as const

// Списки и строки цены — влево явно: корень приложения центрирует текст, и
// пункт с маркером слева и текстом посередине читался бы криво.
function EffectList({ effects }: { effects: string[] }) {
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:4, textAlign:'left' }}>
      {effects.map((e) => (
        <div key={e} style={{ display:'flex', gap:6, fontSize:12, lineHeight:1.45, color:C.bone }}>
          <span style={{ color:C.glowEdge, flexShrink:0 }}>•</span>
          <span style={{ minWidth:0 }}>{e}</span>
        </div>
      ))}
    </div>
  )
}

/** Строка цены: иконка, подпись, справа значение. `short` — красным: этого не хватает. */
function PriceRow({ icon, label, value, short }: { icon: string | null; label: string; value: string; short: boolean }) {
  return (
    <div style={{ display:'flex', alignItems:'center', gap:7, minHeight:24 }}>
      {icon !== null
        ? <img src={ICON(icon)} alt="" width={20} height={20} style={{ display:'block', objectFit:'contain', flexShrink:0 }} />
        : <div style={{ width:20, flexShrink:0 }} />}
      <span style={{ flex:1, minWidth:0, fontSize:12, color:C.textMain, textAlign:'left' }}>{label}</span>
      <span style={{ fontSize:12, fontFamily:FONT_DISPLAY, color: short ? C.danger : C.bone, whiteSpace:'nowrap' }}>{value}</span>
    </div>
  )
}

const buttonBase = {
  boxSizing:'border-box' as const, minHeight:44, width:'100%',
  display:'flex', alignItems:'center', justifyContent:'center',
  background:C.nicheDeep, borderRadius:9, padding:'9px 12px', textAlign:'center' as const,
  fontSize:14,
}

function PrimaryButton({ label, enabled, onClick }: { label: string; enabled: boolean; onClick: () => void }) {
  return (
    <div
      onClick={() => { if (enabled) onClick() }}
      style={{
        ...buttonBase,
        border:`1px solid ${enabled ? C.glowEdge : C.stoneDark}`,
        color: enabled ? C.glowCore : C.textDim,
        boxShadow: enabled ? 'inset 0 0 12px rgba(209,151,68,0.28)' : 'none',
        cursor: enabled ? 'pointer' : 'default',
        opacity: enabled ? 1 : 0.6,
      }}>
      {label}
    </div>
  )
}

/** Подтверждение [Да] [Нет] — того же вида, что у продажи Печати (SaleConfirm в App.tsx). */
function Confirm({ question, onYes, onNo }: { question: string; onYes: () => void; onNo: () => void }) {
  const button = (danger: boolean) => ({
    ...buttonBase, flex:1, width:undefined,
    border:`1px solid ${danger ? C.danger : C.stoneDark}`,
    color: danger ? C.danger : C.textMain, cursor:'pointer' as const,
  })
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
      <div style={{ fontSize:13, lineHeight:1.45, color:C.textMain, textAlign:'center' }}>{question}</div>
      <div style={{ display:'flex', gap:8 }}>
        <div onClick={onYes} style={button(true)}>Да</div>
        <div onClick={onNo} style={button(false)}>Нет</div>
      </div>
    </div>
  )
}

/**
 * Карточка класса — как карточка предмета: иконка, название, красивое описание,
 * «что даёт», «На 30 уровне — <вторая ступень>» с её иконкой и эффектами, цена,
 * кнопка. Рисуется в App.tsx прямым потомком корня (как карточка обмена): она
 * выше экрана 568 px, и внутри вкладки, под маской растворения, её низ с кнопкой
 * лёг бы под нижнюю панель.
 *
 * `wallet === null` — что-то из нужного неизвестно (профиль, склад осколков,
 * надетые навыки или класс не названы): кнопка гаснет со словами, а не считает
 * от нуля.
 */
export function HeroClassCard({
  cls, wallet, pending, errorLines, showRefresh, refreshPending, onRefresh, onAction, onClose,
}: {
  cls: HeroClass
  wallet: HeroClassWallet | null
  pending: ClassActionKind | null
  errorLines: string[] | null
  showRefresh: boolean
  refreshPending: boolean
  onRefresh: () => void
  onAction: (kind: ClassActionKind) => void
  onClose: () => void
}) {
  // Подтверждение — состояние самой карточки: закрыл карточку — вопрос пропал.
  const [confirm, setConfirm] = useState<'choose' | 'renounce' | null>(null)
  const first = heroClassStage(cls, 1)
  const second = heroClassStage(cls, 2)
  const heroClass = wallet?.heroClass ?? null
  const own = heroClass !== null && heroClass !== 'none' && heroClass.id === cls.id ? heroClass : null
  const other = heroClass !== null && heroClass !== 'none' && heroClass.id !== cls.id ? heroClass : null
  const ascended = own !== null && own.tier === 2

  // Какая цена показывается и судится ли она по кошельку. Судится — когда
  // действие открыто по уровню: ниже порога карточка «для чтения», и красное по
  // всем строкам читалось бы тревогой, а не подсказкой.
  const price: { title: string; shards: number; gold: number; books: boolean; judged: boolean } | null =
    ascended ? null
      : own !== null ? { title:'ЦЕНА ВОЗВЫШЕНИЯ', shards:CLASS_ASCEND_SHARDS, gold:CLASS_ASCEND_GOLD, books:false, judged: wallet !== null && wallet.level >= CLASS_ASCEND_LEVEL }
        : { title:'ЦЕНА ВЫБОРА', shards:CLASS_CHOOSE_SHARDS, gold:CLASS_CHOOSE_GOLD, books:true, judged: wallet !== null && other === null && wallet.level >= CLASS_CHOOSE_LEVEL }

  const missing = wallet === null ? [] : own !== null ? ascendShortfalls(wallet, cls) : chooseShortfalls(wallet, cls)
  // Уровень называет сама кнопка («С 10 уровня»), чужой класс — строка вместо
  // кнопки: под кнопкой остаются только навыки, осколки и золото.
  const missingLines = missing
    .filter((m) => m.kind !== 'level' && m.kind !== 'class-chosen')
    .map((m) => shortfallLine(m, classBookName))

  const seals = wallet?.renounceSeals ?? 0

  let main: ReactElement | null
  if (wallet === null) {
    main = <PrimaryButton label="Данные не загружены" enabled={false} onClick={() => {}} />
  } else if (other !== null) {
    const otherCls = heroClassById(other.id)
    const otherName = otherCls === null ? other.id : heroClassStage(otherCls, other.tier).nameRu
    main = (
      <div style={{ fontSize:12, lineHeight:1.45, color:C.textDim, textAlign:'center', padding:'4px 0' }}>
        Твой класс — {otherName}. Другой можно выбрать только после отречения.
      </div>
    )
  } else if (own === null) {
    if (wallet.level < CLASS_CHOOSE_LEVEL) {
      main = <PrimaryButton label={`С ${CLASS_CHOOSE_LEVEL} уровня`} enabled={false} onClick={() => {}} />
    } else if (confirm === 'choose') {
      main = <Confirm question={`Выбрать ${first.nameAcc}?`} onYes={() => { setConfirm(null); onAction('choose') }} onNo={() => setConfirm(null)} />
    } else {
      main = <PrimaryButton label={pending === 'choose' ? 'Выбираем…' : 'Выбрать'} enabled={pending === null && missing.length === 0} onClick={() => setConfirm('choose')} />
    }
  } else if (!ascended) {
    // Возвышение — без подтверждения: в задаче и в дизайне его нет.
    main = wallet.level < CLASS_ASCEND_LEVEL
      ? <PrimaryButton label={`С ${CLASS_ASCEND_LEVEL} уровня`} enabled={false} onClick={() => {}} />
      : <PrimaryButton label={pending === 'ascend' ? 'Возвышение…' : 'Возвыситься'} enabled={pending === null && missing.length === 0} onClick={() => onAction('ascend')} />
  } else {
    main = null
  }

  const shortShards = price !== null && price.judged && wallet !== null && wallet.soulShards < price.shards
  const shortGold = price !== null && price.judged && wallet !== null && wallet.gold < price.gold

  return (
    <div onClick={onClose} style={{
      boxSizing:'border-box', position:'fixed', top:0, left:0, right:0, bottom:0,
      // Безопасные зоны — отступом подложки, как у карточки обмена: высокая
      // карточка иначе легла бы под чёлку и кнопки Telegram.
      padding:'var(--rp-safe-top) var(--rp-safe-right) var(--rp-safe-bottom) var(--rp-safe-left)',
      background:'rgba(0,0,0,0.55)',
      display:'flex', alignItems:'center', justifyContent:'center',
      zIndex:1000,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        boxSizing:'border-box', maxWidth:300, width:'100%',
        // Прокрутка внутри: карточка выше экрана 568 px и тем более экрана
        // телефона набок.
        maxHeight:'100%', overflowY:'auto',
        background:C.appBg, border:`1px solid ${C.stoneDark}`, borderRadius:14, padding:16,
      }}>
        <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:12 }}>
          <div style={{
            width:64, height:64, flexShrink:0, background:C.nicheDeep, borderRadius:8,
            boxShadow:'inset 0 2px 5px rgba(0,0,0,0.55)',
            display:'flex', alignItems:'center', justifyContent:'center',
          }}>
            <img src={ICON(first.icon)} alt={first.nameRu} style={{ width:56, height:56, objectFit:'contain', display:'block' }} />
          </div>
          <div style={{ minWidth:0, textAlign:'left' }}>
            <div style={{ fontFamily:FONT_DISPLAY, fontSize:17, color:C.textMain }}>{first.nameRu}</div>
            {own !== null && <div style={{ fontSize:11, color:C.glowCore, marginTop:3 }}>Твой класс</div>}
          </div>
        </div>

        <div style={{ fontSize:12, lineHeight:1.55, fontStyle:'italic', color:C.textDim, marginBottom:12 }}>{first.desc}</div>

        <div style={blockStyle}>
          <div style={blockTitle}>ЧТО ДАЁТ</div>
          <EffectList effects={first.effects} />
        </div>

        <div style={{ ...blockStyle, border:`1px solid ${ascended ? C.glowEdge : 'transparent'}` }}>
          <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:7 }}>
            <img src={ICON(second.icon)} alt={second.nameRu} width={36} height={36} style={{ display:'block', objectFit:'contain', flexShrink:0 }} />
            <div style={{ minWidth:0, textAlign:'left' }}>
              <div style={{ fontSize:12, color: ascended ? C.glowCore : C.textMain, lineHeight:1.35 }}>
                {ascended ? `Возвышение — ${second.nameRu}` : `На ${CLASS_ASCEND_LEVEL} уровне — ${second.nameRu}`}
              </div>
              {ascended && <div style={{ fontSize:11, color:C.textDim, marginTop:2 }}>получено</div>}
            </div>
          </div>
          <EffectList effects={second.effects} />
        </div>

        {price !== null && (
          <div style={blockStyle}>
            <div style={blockTitle}>{price.title}</div>
            <PriceRow
              icon={SHARD_ICON}
              label="Осколки души"
              value={`${wallet === null ? '—' : wallet.soulShards} / ${price.shards}`}
              short={shortShards}
            />
            <PriceRow icon="icon_gold.png" label="Золото" value={String(price.gold)} short={shortGold} />
            {price.books && cls.requiredSkills.map((skillId) => {
              const worn = wallet !== null && wallet.equippedSkills.includes(skillId)
              return (
                <PriceRow
                  key={skillId}
                  icon={bookIcon(skillId)}
                  label={classBookName(skillId)}
                  value={wallet === null ? '—' : worn ? 'надета' : 'не надета'}
                  short={price.judged && !worn}
                />
              )
            })}
          </div>
        )}

        {main}

        {/* Чего не хватает — под серой кнопкой, теми же строками, какими
            откажет сервер (общий каталог). Пока идёт подтверждение — нет. */}
        {confirm === null && wallet !== null && other === null && !ascended && missingLines.length > 0
          && wallet.level >= (own !== null ? CLASS_ASCEND_LEVEL : CLASS_CHOOSE_LEVEL) && (
          <div style={{ marginTop:8, display:'flex', flexDirection:'column', gap:3 }}>
            {missingLines.map((line) => (
              <div key={line} style={{ fontSize:11, color:C.danger, textAlign:'center' }}>{line}</div>
            ))}
          </div>
        )}

        {/* Отречение — только на своём классе и только при Печати в сумке. */}
        {own !== null && seals > 0 && (
          <div style={{ marginTop:10 }}>
            {confirm === 'renounce' ? (
              <Confirm
                question={`Отречься от ${heroClassStage(cls, own.tier).nameGen}? Класс и возвышение пропадут`}
                onYes={() => { setConfirm(null); onAction('renounce') }}
                onNo={() => setConfirm(null)}
              />
            ) : (
              <div
                onClick={() => { if (pending === null) setConfirm('renounce') }}
                style={{
                  ...buttonBase, fontSize:13,
                  border:`1px solid ${C.danger}`, color:C.danger,
                  cursor: pending === null ? 'pointer' : 'default',
                  opacity: pending === null ? 1 : 0.5,
                }}>
                {pending === 'renounce' ? 'Отречение…' : 'Отречься'}
              </div>
            )}
          </div>
        )}

        {errorLines !== null && (
          <div style={{ marginTop:10, display:'flex', flexDirection:'column', gap:3 }}>
            {errorLines.map((line) => (
              <div key={line} style={{ fontSize:11, color:C.danger, textAlign:'center' }}>{line}</div>
            ))}
          </div>
        )}
        {showRefresh && (
          <div
            onClick={() => { if (!refreshPending) onRefresh() }}
            style={{
              ...buttonBase, marginTop:8, fontSize:13,
              border:`1px solid ${C.stoneDark}`, color:C.textMain,
              cursor: refreshPending ? 'default' : 'pointer',
              opacity: refreshPending ? 0.5 : 1,
            }}>
            {refreshPending ? 'Сверяем...' : 'Обновить баланс'}
          </div>
        )}
      </div>
    </div>
  )
}

// --- Окно торжества ---

/**
 * После выбора и после возвышения: на весь экран крупная иконка и надпись «Ты
 * стал …» (творительный падеж ступени), тап в любом месте закрывает. Поверх
 * нижней панели (999), карточек (1000) и тоста (1100), но ниже окна о прошлом
 * забеге (2000): то говорит о штрафе и перекрывать его нечем.
 *
 * Появление — короткое проявление с подъёмом; при «уменьшении движения» в
 * системе — без движения, сразу.
 */
export function HeroClassCelebration({ state, onClose }: { state: { id: HeroClassId; tier: 1 | 2 }; onClose: () => void }) {
  const cls = heroClassById(state.id)
  if (cls === null) return null
  const stage = heroClassStage(cls, state.tier)
  return (
    <div onClick={onClose} style={{
      boxSizing:'border-box', position:'fixed', top:0, left:0, right:0, bottom:0,
      padding:'calc(var(--rp-safe-top) + 24px) calc(var(--rp-safe-right) + 16px) calc(var(--rp-safe-bottom) + 24px) calc(var(--rp-safe-left) + 16px)',
      background:'radial-gradient(circle at 50% 42%, rgba(70,48,30,0.96) 0%, rgba(16,13,20,0.97) 62%)',
      display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:18,
      zIndex:1500, cursor:'pointer',
    }}>
      <style>{`
        @keyframes rp-class-rise { from { opacity: 0; transform: translateY(14px) scale(0.92); } to { opacity: 1; transform: none; } }
        .rp-class-rise { animation: rp-class-rise 520ms ease-out both; }
        @media (prefers-reduced-motion: reduce) { .rp-class-rise { animation: none; } }
      `}</style>
      <img
        className="rp-class-rise"
        src={ICON(stage.icon)}
        alt={stage.nameRu}
        style={{
          width:'min(52vmin, 220px)', height:'min(52vmin, 220px)', objectFit:'contain', display:'block',
          filter:'drop-shadow(0 0 22px rgba(245,188,91,0.45)) drop-shadow(0 6px 14px rgba(0,0,0,0.7))',
        }}
      />
      <div className="rp-class-rise" style={{
        fontFamily:FONT_DISPLAY, fontSize:24, lineHeight:1.3, color:C.glowCore, textAlign:'center',
        textShadow:'0 0 18px rgba(209,151,68,0.45)', maxWidth:340,
      }}>
        Ты стал {stage.nameIns}
      </div>
      <div style={{ fontSize:12, color:C.textDim }}>Коснись, чтобы продолжить</div>
    </div>
  )
}
