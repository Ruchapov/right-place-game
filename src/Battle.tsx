import { useEffect, useRef, useCallback, useState } from 'react'
import { Application, Graphics, Text, TextStyle } from 'pixi.js'

type BattleResult = { won: boolean; damageTaken: number; damageDealt: number; skillUses: number; actualHpLost: number; potionsUsed: number }

type BattleProps = {
  initialHp: number
  maxHp: number
  isBoss?: boolean
  level?: number
  equippedSkills?: string[]
  potionCharges?: number
  onBattleEnd: (result: BattleResult) => void
}

export default function Battle({ initialHp, maxHp, isBoss = false, level = 1, equippedSkills = [], potionCharges = 0, onBattleEnd }: BattleProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const directionRef = useRef(0)
  const [battleOver, setBattleOver] = useState(false)
  const attackRef = useRef<{
    canAttack: boolean
    cooldownLeft: number
    doAttack: () => void
  }>({ canAttack: false, cooldownLeft: 0, doAttack: () => {} })
  const dodgeRef = useRef<{ doDodge: () => void }>({ doDodge: () => {} })
  const healRef = useRef<{ doHeal: () => void; usePotion?: () => void }>({ doHeal: () => {} })
  const healBtnRef = useRef<HTMLButtonElement | null>(null)
  const potionsLeftRef = useRef(potionCharges)
  const potionsUsedRef = useRef(0)
  const potionCdRef = useRef(0)

  useEffect(() => {
    let app: Application | null = null
    let cancelled = false
    let endTimer: ReturnType<typeof setTimeout> | undefined

    async function setup() {
      app = new Application()
      const width = window.innerWidth
      const height = window.innerHeight
      const PLAYER_W = 40
      const SPEED = 3
      const ATTACK_RANGE = 70
      const ATTACK_DAMAGE = 15
      const ATTACK_COOLDOWN = 0.5

      await app.init({
        width,
        height,
        backgroundColor: 0x1a1a2e,
        resizeTo: window,
      })

      if (cancelled || !containerRef.current) {
        app.destroy(true, { children: true })
        return
      }

      containerRef.current.appendChild(app.canvas)

      const player = new Graphics()
      player.rect(0, 0, PLAYER_W, 60).fill(0x4caf50)
      player.x = width * 0.2
      player.y = height / 2 - 30
      app.stage.addChild(player)

      const ENEMY_W = isBoss ? 50 : 40
      const ENEMY_H = isBoss ? 75 : 60

      // --- Scaling по уровню ---
      const hpMultiplier = 1 + 0.18 * (level - 1)
      const dmgMultiplier = 1 + 0.12 * (level - 1)

      const BASE_ENEMY_HP = isBoss ? 200 : 120
      const BASE_ENEMY_DAMAGE = isBoss ? 18 : 14

      const ENEMY_MAX_HP = Math.round(BASE_ENEMY_HP * hpMultiplier)
      const ENEMY_ATTACK_DAMAGE = Math.round(BASE_ENEMY_DAMAGE * dmgMultiplier)
      // --- конец scaling ---

      const enemy = new Graphics()
      enemy.rect(0, 0, ENEMY_W, ENEMY_H).fill(isBoss ? 0xb71c1c : 0xd32f2f)
      enemy.x = width * 0.75
      enemy.y = height / 2 - ENEMY_H / 2
      app.stage.addChild(enemy)

      let enemyHp = ENEMY_MAX_HP
      let enemyAlive = true
      let playerHp = initialHp
      let totalDamageTaken = 0
      let healedAmount = 0
      let skillUses = 0
      let battleEnded = false

      const hpStyle = new TextStyle({ fontSize: 16, fill: 0xffffff })

      const enemyHpText = new Text({ text: `HP: ${enemyHp}`, style: hpStyle })
      enemyHpText.anchor.set(0.5, 1)
      enemyHpText.x = enemy.x + ENEMY_W / 2
      enemyHpText.y = enemy.y - 6
      app.stage.addChild(enemyHpText)

      const playerHpText = new Text({ text: `HP: ${playerHp}`, style: hpStyle })
      playerHpText.anchor.set(0.5, 1)
      playerHpText.x = player.x + PLAYER_W / 2
      playerHpText.y = player.y - 6
      app.stage.addChild(playerHpText)

      let cooldownLeft = 0
      const ENEMY_SPEED = 1
      const ENEMY_ATTACK_INTERVAL = isBoss ? 1.5 : 2
      let enemyAttackTimer = 0
      const ENEMY_WINDUP = 0.6
      let enemyWindingUp = false
      let windupTimer = 0
      let bossAttackType: 'melee' | 'aoe' | null = null
      const projectiles: { gfx: Graphics; targetX: number; dir: number }[] = []

      let aoeOverlay: Graphics | null = null
      if (isBoss) {
        aoeOverlay = new Graphics()
        aoeOverlay.rect(0, 0, width, height).fill({ color: 0xff0000, alpha: 0.15 })
        aoeOverlay.visible = false
        app.stage.addChild(aoeOverlay)
      }

      function applyDamageToPlayer() {
        playerHp -= ENEMY_ATTACK_DAMAGE
        totalDamageTaken += ENEMY_ATTACK_DAMAGE
        if (playerHp < 0) playerHp = 0
        playerHpText.text = `HP: ${playerHp}`
        if (playerHp <= 0) {
          battleEnded = true
          setBattleOver(true)
          enemyWindingUp = false
          enemy.scale.set(1)
          if (aoeOverlay) aoeOverlay.visible = false
          bossAttackType = null
          for (const proj of projectiles) app!.stage.removeChild(proj.gfx)
          projectiles.length = 0
          const loseStyle = new TextStyle({ fontSize: 48, fill: 0xff3333, fontWeight: 'bold' })
          const loseText = new Text({ text: 'Поражение', style: loseStyle })
          loseText.anchor.set(0.5)
          loseText.x = app!.screen.width / 2
          loseText.y = app!.screen.height / 2
          app!.stage.addChild(loseText)
          endTimer = setTimeout(() => {
            onBattleEnd({ won: false, damageTaken: totalDamageTaken, damageDealt: ENEMY_MAX_HP - enemyHp, skillUses: skillUses, actualHpLost: Math.max(0, totalDamageTaken - healedAmount), potionsUsed: potionsUsedRef.current })
          }, 1500)
        }
      }

      attackRef.current = {
        canAttack: true,
        cooldownLeft: 0,
        doAttack() {
          if (battleEnded || cooldownLeft > 0) return
          const dist = Math.abs(player.x - enemy.x)
          if (dist > ATTACK_RANGE) return
          enemyHp -= ATTACK_DAMAGE
          if (enemyHp < 0) enemyHp = 0
          enemyHpText.text = `HP: ${enemyHp}`
          cooldownLeft = ATTACK_COOLDOWN
          if (enemyHp <= 0) {
            enemyAlive = false
            battleEnded = true
            setBattleOver(true)
            app!.stage.removeChild(enemy)
            app!.stage.removeChild(enemyHpText)
            if (aoeOverlay) aoeOverlay.visible = false
            enemyWindingUp = false
            bossAttackType = null
            for (const proj of projectiles) app!.stage.removeChild(proj.gfx)
            projectiles.length = 0
            const winStyle = new TextStyle({ fontSize: 48, fill: 0xffd700, fontWeight: 'bold' })
            const winText = new Text({ text: 'Победа!', style: winStyle })
            winText.anchor.set(0.5)
            winText.x = app!.screen.width / 2
            winText.y = app!.screen.height / 2
            app!.stage.addChild(winText)
            endTimer = setTimeout(() => {
              onBattleEnd({ won: true, damageTaken: totalDamageTaken, damageDealt: ENEMY_MAX_HP - enemyHp, skillUses: skillUses, actualHpLost: Math.max(0, totalDamageTaken - healedAmount), potionsUsed: potionsUsedRef.current })
            }, 1500)
          }
        },
      }

      dodgeRef.current = {
        doDodge() {
          if (!enemyWindingUp) return
          enemyWindingUp = false
          windupTimer = 0
          enemyAttackTimer = 0
          if (bossAttackType === 'aoe' && aoeOverlay) {
            aoeOverlay.visible = false
          } else {
            enemy.scale.set(1)
          }
          bossAttackType = null
        },
      }

      // --- Heal ---
      let healCdLeft = 0

healRef.current = {
  doHeal() {
    if (battleEnded || healCdLeft > 0) return
    const healAmount = Math.round(maxHp * 0.1)
    playerHp = Math.min(playerHp + healAmount, maxHp)
    healedAmount += healAmount
    skillUses += 1
    playerHpText.text = `HP: ${playerHp}`
    healCdLeft = 5
    if (healBtnRef.current) {
      healBtnRef.current.style.background = 'rgba(60,60,60,0.4)'
      healBtnRef.current.style.borderColor = 'rgba(100,100,100,0.5)'
    }
  },
}
      healRef.current.usePotion = () => {
        if (battleEnded) return
        const healAmt = Math.round(maxHp * 0.5)
        playerHp = Math.min(playerHp + healAmt, maxHp)
        healedAmount += healAmt
        playerHpText.text = `HP: ${playerHp}`
      }
      // --- конец Heal ---

      app.ticker.add((ticker) => {
        if (battleEnded) return
        if (healCdLeft > 0) {
  healCdLeft -= ticker.deltaMS / 1000
  if (healBtnRef.current) {
    healBtnRef.current.textContent = String(Math.ceil(healCdLeft))
  }
  if (healCdLeft < 0) healCdLeft = 0
  if (healCdLeft === 0 && healBtnRef.current) {
    healBtnRef.current.textContent = '💊'
    healBtnRef.current.style.background = 'rgba(60,220,100,0.2)'
    healBtnRef.current.style.borderColor = 'rgba(60,220,100,0.7)'
  }
}
        if (potionCdRef.current > 0) {
          potionCdRef.current -= ticker.deltaMS / 1000
          if (potionCdRef.current < 0) potionCdRef.current = 0
          const potBtn = document.querySelector('[data-btn="potion"]') as HTMLButtonElement | null
          if (potBtn) {
            if (potionCdRef.current > 0) {
              potBtn.textContent = String(Math.ceil(potionCdRef.current))
            } else {
              potBtn.textContent = potionsLeftRef.current > 0 ? '🧪' : '✕'
            }
          }
        }

        if (cooldownLeft > 0) {
          cooldownLeft -= ticker.deltaMS / 1000
          if (cooldownLeft < 0) cooldownLeft = 0
        }
        attackRef.current.canAttack = cooldownLeft <= 0
        attackRef.current.cooldownLeft = cooldownLeft

        if (directionRef.current !== 0) {
          player.x += SPEED * directionRef.current
          const maxX = app!.screen.width - PLAYER_W
          if (player.x < 0) player.x = 0
          else if (player.x > maxX) player.x = maxX
        }
        playerHpText.x = player.x + PLAYER_W / 2

        for (let i = projectiles.length - 1; i >= 0; i--) {
          const p = projectiles[i]
          p.gfx.x += p.dir * 4
          const reachedTarget = p.dir > 0 ? p.gfx.x >= p.targetX : p.gfx.x <= p.targetX
          const offScreen = p.gfx.x < -20 || p.gfx.x > app!.screen.width + 20
          if (reachedTarget || offScreen) {
            if (reachedTarget) {
              const playerCenter = player.x + PLAYER_W / 2
              if (Math.abs(p.gfx.x - playerCenter) < 30) {
                app!.stage.removeChild(p.gfx)
                projectiles.splice(i, 1)
                applyDamageToPlayer()
                if (battleEnded) return
                continue
              }
            }
            app!.stage.removeChild(p.gfx)
            projectiles.splice(i, 1)
          }
        }

        if (enemyAlive) {
          const dx = player.x - enemy.x
          if (Math.abs(dx) > PLAYER_W) {
            enemy.x += Math.sign(dx) * ENEMY_SPEED
            if (enemy.x < 0) enemy.x = 0
            else if (enemy.x > app!.screen.width - ENEMY_W) enemy.x = app!.screen.width - ENEMY_W
          }
          enemyHpText.x = enemy.x + ENEMY_W / 2

          const dist = Math.abs(player.x - enemy.x)

          if (enemyWindingUp && bossAttackType !== 'aoe' && dist >= ATTACK_RANGE) {
            enemyWindingUp = false
            enemy.scale.set(1)
            windupTimer = 0
            bossAttackType = null
          }

          if (!enemyWindingUp) {
            if (isBoss || dist < ATTACK_RANGE) {
              enemyAttackTimer += ticker.deltaMS / 1000
              if (enemyAttackTimer >= ENEMY_ATTACK_INTERVAL) {
                enemyAttackTimer = 0
                if (isBoss) {
                  const roll = Math.random()
                  if (roll < 1 / 3) {
                    if (dist < ATTACK_RANGE) {
                      bossAttackType = 'melee'
                      enemyWindingUp = true
                      windupTimer = 0
                      enemy.scale.set(1.3)
                    }
                  } else if (roll < 2 / 3) {
                    bossAttackType = 'aoe'
                    enemyWindingUp = true
                    windupTimer = 0
                    if (aoeOverlay) aoeOverlay.visible = true
                  } else {
                    const gfx = new Graphics()
                    gfx.circle(0, 0, 6).fill(0xff9800)
                    gfx.x = enemy.x + ENEMY_W / 2
                    gfx.y = enemy.y + ENEMY_H / 2
                    app!.stage.addChild(gfx)
                    const targetX = player.x + PLAYER_W / 2
                    const dir = targetX > gfx.x ? 1 : -1
                    projectiles.push({ gfx, targetX, dir })
                  }
                } else {
                  enemyWindingUp = true
                  windupTimer = 0
                  enemy.scale.set(1.3)
                }
              }
            } else {
              enemyAttackTimer = 0
            }
          } else {
            windupTimer += ticker.deltaMS / 1000
            if (windupTimer >= ENEMY_WINDUP) {
              enemyWindingUp = false
              if (bossAttackType === 'aoe' && aoeOverlay) {
                aoeOverlay.visible = false
              } else {
                enemy.scale.set(1)
              }
              bossAttackType = null
              applyDamageToPlayer()
              if (battleEnded) return
            }
          }
        }
      })
    }

    setup()

    return () => {
      cancelled = true
      if (endTimer) clearTimeout(endTimer)
      if (app) {
        app.destroy(true, { children: true })
      }
    }
  }, [])

  const startMove = useCallback((dir: number) => { directionRef.current = dir }, [])
  const stopMove = useCallback(() => { directionRef.current = 0 }, [])

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        zIndex: 1000,
        background: '#1a1a2e',
      }}
    >
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />

      {!battleOver && (
        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 178, pointerEvents: 'none' }}>
          <canvas
            ref={(canvas) => {
              if (!canvas) return
              const dpr = window.devicePixelRatio || 1
              canvas.width = window.innerWidth * dpr
              canvas.height = 178 * dpr
              canvas.style.width = window.innerWidth + 'px'
              canvas.style.height = '178px'
            }}
            style={{ position: 'absolute', top: 0, left: 0 }}
          />

          {/* Кнопки движения — левый блок */}
          <button
            onTouchStart={() => startMove(-1)} onTouchEnd={stopMove} onTouchCancel={stopMove}
            onMouseDown={() => startMove(-1)} onMouseUp={stopMove} onMouseLeave={stopMove}
            style={{
              position: 'absolute', left: 23, bottom: 42, width: 64, height: 64,
              borderRadius: '50%', border: '1px solid rgba(255,255,255,0.2)',
              background: 'rgba(255,255,255,0.1)', color: 'white', fontSize: 24,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              touchAction: 'none', userSelect: 'none', pointerEvents: 'all',
            }}>◀</button>

          <button
            onTouchStart={() => startMove(1)} onTouchEnd={stopMove} onTouchCancel={stopMove}
            onMouseDown={() => startMove(1)} onMouseUp={stopMove} onMouseLeave={stopMove}
            style={{
              position: 'absolute', left: 108, bottom: 42, width: 64, height: 64,
              borderRadius: '50%', border: '1px solid rgba(255,255,255,0.2)',
              background: 'rgba(255,255,255,0.1)', color: 'white', fontSize: 24,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              touchAction: 'none', userSelect: 'none', pointerEvents: 'all',
            }}>▶</button>

          {/* Правый блок — динамические кнопки через JS */}
          <div ref={(container) => {
            if (!container) return
            const W = window.innerWidth
            const H = 178
            const ATK_R = 34
            const BTN_R = 28
            const ATK = { x: W - ATK_R - 10, y: H - ATK_R - 10 }
            const D = ATK_R + BTN_R
            const cosT = 1 - 2 * Math.pow(BTN_R / D, 2)
            const theta = Math.acos(cosT)
            const midAngle = 225 * Math.PI / 180
            const angles = [midAngle - theta, midAngle, midAngle + theta]

            const skillButtons = [
              { id: 'dodge',  emoji: '🔄', angle: angles[0], border: 'rgba(60,160,220,0.7)',  bg: 'rgba(60,160,220,0.2)'  },
              { id: 'skill1', emoji: equippedSkills[0] === 'heal' ? '💊' : equippedSkills[0] === 'fireball' ? '🔥' : equippedSkills[0] === 'slash' ? '🗡️' : equippedSkills[0] === 'iceball' ? '🧊' : equippedSkills[0] === 'dash' ? '⚡' : '', angle: angles[1], border: 'rgba(60,220,100,0.7)', bg: 'rgba(60,220,100,0.2)' },
              { id: 'skill2', emoji: equippedSkills[1] === 'heal' ? '💊' : equippedSkills[1] === 'fireball' ? '🔥' : equippedSkills[1] === 'slash' ? '🗡️' : equippedSkills[1] === 'iceball' ? '🧊' : equippedSkills[1] === 'dash' ? '⚡' : '', angle: angles[2], border: 'rgba(255,200,0,0.7)',  bg: 'rgba(255,200,0,0.2)'  },
            ]

            skillButtons.forEach(b => {
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
                border-radius:50%; border:1.5px solid ${b.border};
                background:${b.bg}; color:white; font-size:19px;
                display:flex; align-items:center; justify-content:center;
                touch-action:none; user-select:none; pointer-events:all; cursor:pointer;
                ${!b.emoji ? 'opacity:0.2;' : ''}
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
              border-radius:50%; border:2px solid rgba(255,80,80,0.85);
              background:rgba(180,30,30,0.6); color:white; font-size:24px;
              display:flex; align-items:center; justify-content:center;
              touch-action:none; user-select:none; pointer-events:all; cursor:pointer;
            `
            if (!atkEl) container.appendChild(atk)

            // Зелье
            const lastSkillX = ATK.x + D * Math.cos(angles[2])
            const lastSkillY = ATK.y + D * Math.sin(angles[2])
            const POT_R = 24
            const potX = lastSkillX
            const potY = lastSkillY - BTN_R - POT_R - 8

            const potEl = container.querySelector('[data-btn="potion"]') as HTMLButtonElement | null
            const pot = potEl || document.createElement('button')
            pot.dataset.btn = 'potion'
            pot.textContent = potionsLeftRef.current > 0 ? '🧪' : '✕'
            pot.style.cssText = `
              position:absolute;
              left:${potX - POT_R}px; top:${potY - POT_R}px;
              width:${POT_R * 2}px; height:${POT_R * 2}px;
              border-radius:50%; border:1.5px solid rgba(255,140,0,0.8);
              background:rgba(255,140,0,0.2); color:white; font-size:15px;
              display:flex; align-items:center; justify-content:center;
              touch-action:none; user-select:none; pointer-events:all; cursor:pointer;
              opacity:${potionsLeftRef.current > 0 ? 1 : 0.3};
            `
            if (!potEl) container.appendChild(pot)

            // Счётчик зарядов
            const badgeEl = container.querySelector('[data-badge="potion"]') as HTMLElement | null
            const badge = badgeEl || document.createElement('div')
            badge.dataset.badge = 'potion'
            badge.textContent = String(potionsLeftRef.current)
            badge.style.cssText = `
              position:absolute;
              left:${potX + POT_R - 14}px; top:${potY - POT_R}px;
              width:18px; height:18px; border-radius:50%;
              background:#ffd700; color:#1a1a2e;
              font-size:11px; font-weight:bold;
              display:flex; align-items:center; justify-content:center;
              pointer-events:none;
            `
            if (!badgeEl) container.appendChild(badge)

            pot.onclick = () => {
              if (potionsLeftRef.current <= 0 || potionCdRef.current > 0) return
              potionsLeftRef.current -= 1
              potionsUsedRef.current += 1
              potionCdRef.current = 2
              badge.textContent = String(potionsLeftRef.current)
              pot.style.opacity = potionsLeftRef.current > 0 ? '1' : '0.3'
              pot.textContent = '2'
              healRef.current.usePotion?.()
            }

            atk.onclick = () => attackRef.current.doAttack()

            const dodgeEl = container.querySelector('[data-btn="dodge"]') as HTMLElement
            if (dodgeEl) dodgeEl.onclick = () => dodgeRef.current.doDodge()

            const skill1El = container.querySelector('[data-btn="skill1"]') as HTMLElement
            if (skill1El && equippedSkills[0] === 'heal') skill1El.onclick = () => healRef.current.doHeal()
            if (skill1El && equippedSkills[0] === 'heal') healBtnRef.current = skill1El as HTMLButtonElement

            const skill2El = container.querySelector('[data-btn="skill2"]') as HTMLElement
            if (skill2El && equippedSkills[1] === 'heal') skill2El.onclick = () => healRef.current.doHeal()
            if (skill2El && equippedSkills[1] === 'heal') healBtnRef.current = skill2El as HTMLButtonElement
          }}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, pointerEvents: 'none' }} />
        </div>
      )}
    </div>
  )
}