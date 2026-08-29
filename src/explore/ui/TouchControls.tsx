import type { MutableRefObject } from 'react'

interface TouchControlsProps {
  dirRef: MutableRefObject<number>
  jumpPressedRef: MutableRefObject<boolean>
  attackPressedRef: MutableRefObject<boolean>
  dodgePressedRef: MutableRefObject<boolean>
  drinkPressedRef: MutableRefObject<boolean>
  skill1PressedRef: MutableRefObject<boolean>
  skill2PressedRef: MutableRefObject<boolean>
  potionBtnRef: MutableRefObject<HTMLButtonElement | null>
  // Пишет "🧪 ×N"/opacity в potionBtnRef.current — вызывается сразу после
  // создания DOM-узла кнопки зелья (см. ref-колбэк ниже), чтобы подпись не
  // была пустой до первого срабатывания тикера в Explore.tsx.
  updatePotionButton: () => void
}

export default function TouchControls({
  dirRef,
  jumpPressedRef,
  attackPressedRef,
  dodgePressedRef,
  drinkPressedRef,
  skill1PressedRef,
  skill2PressedRef,
  potionBtnRef,
  updatePotionButton,
}: TouchControlsProps) {
  return (
    <>
      {/* Экранные кнопки управления — компактная раскладка в стиле Battle.tsx
          (круглые кнопки, радиальный веер вокруг атаки). Ввод дёргает те же
          refs, что и клавиатура (dirRef/jumpPressedRef/attackPressedRef/
          dodgePressedRef) — меняется только вид, не способ ввода. */}
      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 178, zIndex: 1001, pointerEvents: 'none' }}>
        {/* Движение — левый блок */}
        <button
          aria-label="Влево"
          onPointerDown={(e) => {
            e.preventDefault()
            e.currentTarget.setPointerCapture(e.pointerId)
            dirRef.current = -1
          }}
          onPointerUp={(e) => {
            dirRef.current = 0
            if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
          }}
          onPointerLeave={() => { dirRef.current = 0 }}
          onPointerCancel={(e) => {
            dirRef.current = 0
            if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
          }}
          onLostPointerCapture={() => { dirRef.current = 0 }}
          style={{
            position: 'absolute', left: 23, bottom: 12, width: 52, height: 52,
            borderRadius: '50%', border: '1px solid #3A3344',
            background: '#221E2B', color: '#EDE7F2', fontSize: 20,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            touchAction: 'none', userSelect: 'none', WebkitUserSelect: 'none',
            WebkitTouchCallout: 'none',
            pointerEvents: 'all',
          }}
        >
          ◀
        </button>
        <button
          aria-label="Вправо"
          onPointerDown={(e) => {
            e.preventDefault()
            e.currentTarget.setPointerCapture(e.pointerId)
            dirRef.current = 1
          }}
          onPointerUp={(e) => {
            dirRef.current = 0
            if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
          }}
          onPointerLeave={() => { dirRef.current = 0 }}
          onPointerCancel={(e) => {
            dirRef.current = 0
            if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
          }}
          onLostPointerCapture={() => { dirRef.current = 0 }}
          style={{
            position: 'absolute', left: 90, bottom: 12, width: 52, height: 52,
            borderRadius: '50%', border: '1px solid #3A3344',
            background: '#221E2B', color: '#EDE7F2', fontSize: 20,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            touchAction: 'none', userSelect: 'none', WebkitUserSelect: 'none',
            WebkitTouchCallout: 'none',
            pointerEvents: 'all',
          }}
        >
          ▶
        </button>

        {/* Правый блок — атака/dodge/скиллы/прыжок/зелье через JS в
            ref-колбэке, та же техника и геометрия, что в Battle.tsx.
            skill1/skill2 пишут в skill1PressedRef/skill2PressedRef (как
            dodge пишет в dodgePressedRef) — сама логика скиллов ещё не
            реализована, см. explore/entities/skills.ts. Зелье (🧪) —
            ТОЛЬКО визуал (анимация питья через drinkPressedRef), без
            хила/зарядов/кулдауна. */}
        <div
          ref={(container) => {
            if (!container) return
            const W = window.innerWidth
            const H = 178
            const ATK_R = 28
            const BTN_R = 22
            const ATK = { x: W - ATK_R - 10, y: H - ATK_R - 10 }
            const D = ATK_R + BTN_R + 6
            const cosT = 1 - 2 * Math.pow(BTN_R / D, 2)
            const theta = Math.acos(cosT)
            const midAngle = 225 * Math.PI / 180
            const angles = [midAngle - theta, midAngle, midAngle + theta]

            const fanButtons = [
              { id: 'dodge', emoji: '🔄', angle: angles[0] },
              { id: 'skill1', emoji: '⚡', angle: angles[1] },
              { id: 'skill2', emoji: '🔥', angle: angles[2] },
            ]

            fanButtons.forEach(b => {
              const x = ATK.x + D * Math.cos(b.angle)
              const y = ATK.y + D * Math.sin(b.angle)
              const existing = container.querySelector(`[data-btn="${b.id}"]`) as HTMLElement
              const el = existing || document.createElement('button')
              el.dataset.btn = b.id
              el.textContent = b.emoji
              el.style.cssText = `
                position:absolute;
                left:${x - BTN_R}px; top:${y - BTN_R}px;
                width:${BTN_R * 2}px; height:${BTN_R * 2}px;
                border-radius:50%; border:1px solid #3A3344;
                background:#221E2B; color:#EDE7F2; font-size:16px;
                display:flex; align-items:center; justify-content:center;
                touch-action:none; user-select:none; -webkit-user-select:none;
                -webkit-touch-callout:none; pointer-events:all; cursor:pointer;
              `
              if (!existing) container.appendChild(el)
            })

            const atkEl = container.querySelector('[data-btn="atk"]') as HTMLElement
            const atk = atkEl || document.createElement('button')
            atk.dataset.btn = 'atk'
            atk.textContent = '⚔'
            atk.style.cssText = `
              position:absolute;
              left:${ATK.x - ATK_R}px; top:${ATK.y - ATK_R}px;
              width:${ATK_R * 2}px; height:${ATK_R * 2}px;
              border-radius:50%; border:1px solid #3A3344;
              background:#221E2B; color:#EDE7F2; font-size:20px;
              display:flex; align-items:center; justify-content:center;
              touch-action:none; user-select:none; -webkit-user-select:none;
              -webkit-touch-callout:none; pointer-events:all; cursor:pointer;
            `
            if (!atkEl) container.appendChild(atk)

            // Прыжок — вплотную слева от всего веера (не от центра атаки),
            // на высоте центра атаки, размер как у атаки.
            const JMP_R = ATK_R
            const jumpX = ATK.x - D - JMP_R - 30
            const jumpY = ATK.y

            const jumpEl = container.querySelector('[data-btn="jump"]') as HTMLElement
            const jump = jumpEl || document.createElement('button')
            jump.dataset.btn = 'jump'
            jump.textContent = '▲'
            jump.style.cssText = `
              position:absolute;
              left:${jumpX - JMP_R}px; top:${jumpY - JMP_R}px;
              width:${JMP_R * 2}px; height:${JMP_R * 2}px;
              border-radius:50%; border:1px solid #3A3344;
              background:#221E2B; color:#EDE7F2; font-size:20px;
              display:flex; align-items:center; justify-content:center;
              touch-action:none; user-select:none; -webkit-user-select:none;
              -webkit-touch-callout:none; pointer-events:all; cursor:pointer;
            `
            if (!jumpEl) container.appendChild(jump)

            // Зелье — над самым правым скиллом веера (angles[2]).
            const lastSkillX = ATK.x + D * Math.cos(angles[2])
            const lastSkillY = ATK.y + D * Math.sin(angles[2])
            const POT_R = 20
            const potX = lastSkillX
            const potY = lastSkillY - BTN_R - POT_R - 4

            const potEl = container.querySelector('[data-btn="potion"]') as HTMLElement
            const pot = (potEl || document.createElement('button')) as HTMLButtonElement
            pot.dataset.btn = 'potion'
            pot.style.cssText = `
              position:absolute;
              left:${potX - POT_R}px; top:${potY - POT_R}px;
              width:${POT_R * 2}px; height:${POT_R * 2}px;
              border-radius:50%; border:1px solid #3A3344;
              background:#221E2B; color:#EDE7F2; font-size:11px;
              display:flex; align-items:center; justify-content:center;
              touch-action:none; user-select:none; -webkit-user-select:none;
              -webkit-touch-callout:none; pointer-events:all; cursor:pointer;
            `
            if (!potEl) container.appendChild(pot)
            // Ref на DOM-узел кнопки — чтобы ticker мог обновлять подпись
            // "🧪 ×N"/opacity без React-состояния (см. updatePotionButton).
            // cssText выше стирает opacity при каждом ре-рендере компонента —
            // updatePotionButton() сразу после переустанавливает актуальную.
            potionBtnRef.current = pot
            updatePotionButton()

            // Разовые кнопки (не удержание): действие срабатывает на
            // pointerdown (не click/mouseup) — с захватом пойнтера, чтобы
            // второй одновременный палец на другой кнопке (движение) не
            // терялся при мультитаче (браузер эмулирует mouse/click только
            // для первого пальца). pointerdown физически не повторяется при
            // удержании пальца (в отличие от keydown), так что действие
            // естественно срабатывает один раз за нажатие — повтор только
            // после нового pointerdown, т.е. после отпускания.
            const bindTap = (el: HTMLElement, action: () => void) => {
              el.onpointerdown = (e) => {
                e.preventDefault()
                el.setPointerCapture(e.pointerId)
                action()
              }
              const release = (e: PointerEvent) => {
                if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
              }
              el.onpointerup = release
              el.onpointercancel = release
            }

            bindTap(atk, () => { attackPressedRef.current = true })
            bindTap(jump, () => { jumpPressedRef.current = true })

            const dodgeEl = container.querySelector('[data-btn="dodge"]') as HTMLElement
            if (dodgeEl) bindTap(dodgeEl, () => { dodgePressedRef.current = true })

            const skill1El = container.querySelector('[data-btn="skill1"]') as HTMLElement
            if (skill1El) bindTap(skill1El, () => { skill1PressedRef.current = true })

            const skill2El = container.querySelector('[data-btn="skill2"]') as HTMLElement
            if (skill2El) bindTap(skill2El, () => { skill2PressedRef.current = true })

            bindTap(pot, () => { drinkPressedRef.current = true })
          }}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, pointerEvents: 'none' }}
        />
      </div>
    </>
  )
}
