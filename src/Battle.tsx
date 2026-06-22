import { useEffect, useRef, useCallback, useState } from 'react'
import { Application, Graphics, Text, TextStyle } from 'pixi.js'

type BattleResult = { won: boolean; damageTaken: number; damageDealt: number; skillUses: number; actualHpLost: number }

type BattleProps = {
  initialHp: number
  maxHp: number
  isBoss?: boolean
  level?: number
  onBattleEnd: (result: BattleResult) => void
}

export default function Battle({ initialHp, maxHp, isBoss = false, level = 1, onBattleEnd }: BattleProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const directionRef = useRef(0)
  const [battleOver, setBattleOver] = useState(false)
  const [healCooldown, setHealCooldown] = useState(0)
  const attackRef = useRef<{
    canAttack: boolean
    cooldownLeft: number
    doAttack: () => void
  }>({ canAttack: false, cooldownLeft: 0, doAttack: () => {} })
  const dodgeRef = useRef<{ doDodge: () => void }>({ doDodge: () => {} })
  const healRef = useRef<{ doHeal: () => void }>({ doHeal: () => {} })

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
            onBattleEnd({ won: false, damageTaken: totalDamageTaken, damageDealt: ENEMY_MAX_HP - enemyHp, skillUses: skillUses, actualHpLost: Math.max(0, totalDamageTaken - healedAmount) })
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
              onBattleEnd({ won: true, damageTaken: totalDamageTaken, damageDealt: ENEMY_MAX_HP - enemyHp, skillUses: skillUses, actualHpLost: Math.max(0, totalDamageTaken - healedAmount) })
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
    setHealCooldown(5)
  },
}
      // --- конец Heal ---

      app.ticker.add((ticker) => {
        if (battleEnded) return
        if (healCdLeft > 0) {
  healCdLeft -= ticker.deltaMS / 1000
  if (healCdLeft < 0) healCdLeft = 0
  setHealCooldown(Math.ceil(healCdLeft))
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
        <div
          style={{
            position: 'absolute',
            bottom: 40,
            left: '50%',
            transform: 'translateX(-50%)',
            display: 'flex',
            gap: 16,
          }}
        >
          <button
            onMouseDown={() => startMove(-1)}
            onMouseUp={stopMove}
            onMouseLeave={stopMove}
            onTouchStart={() => startMove(-1)}
            onTouchEnd={stopMove}
            onTouchCancel={stopMove}
            style={{
              width: 64, height: 64, borderRadius: '50%', border: 'none',
              background: 'rgba(255,255,255,0.2)', color: 'white', fontSize: 28,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              touchAction: 'none', userSelect: 'none',
            }}
          >◀</button>

          <button
            onMouseDown={() => startMove(1)}
            onMouseUp={stopMove}
            onMouseLeave={stopMove}
            onTouchStart={() => startMove(1)}
            onTouchEnd={stopMove}
            onTouchCancel={stopMove}
            style={{
              width: 64, height: 64, borderRadius: '50%', border: 'none',
              background: 'rgba(255,255,255,0.2)', color: 'white', fontSize: 28,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              touchAction: 'none', userSelect: 'none',
            }}
          >▶</button>

          <button
            onClick={() => attackRef.current.doAttack()}
            style={{
              width: 64, height: 64, borderRadius: '50%', border: 'none',
              background: 'rgba(220,60,60,0.4)', color: 'white', fontSize: 20,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              touchAction: 'none', userSelect: 'none',
            }}
          >⚔</button>

          <button
            onClick={() => dodgeRef.current.doDodge()}
            style={{
              width: 64, height: 64, borderRadius: '50%', border: 'none',
              background: 'rgba(60,160,220,0.4)', color: 'white', fontSize: 20,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              touchAction: 'none', userSelect: 'none',
            }}
          >🔄</button>

          <button
  onClick={() => healRef.current.doHeal()}
  disabled={healCooldown > 0}
  style={{
    width: 64, height: 64, borderRadius: '50%', border: 'none',
    background: healCooldown > 0 ? 'rgba(100,100,100,0.4)' : 'rgba(60,220,100,0.4)',
    color: 'white', fontSize: healCooldown > 0 ? 16 : 20,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    touchAction: 'none', userSelect: 'none',
  }}
>{healCooldown > 0 ? healCooldown : '💊'}</button>
        </div>
      )}
    </div>
  )
}