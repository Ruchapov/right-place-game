import { useEffect, useRef, useCallback, useState } from 'react'
import { Application, Graphics, Text, TextStyle, Assets, TilingSprite, AnimatedSprite, Texture, Rectangle } from 'pixi.js'

type BattleResult = { won: boolean; damageTaken: number; damageDealt: number; skillUses: number; actualHpLost: number; potionsUsed: number }

type BattleProps = {
  initialHp: number
  maxHp: number
  isBoss?: boolean
  level?: number
  equippedSkills?: string[]
  potionCharges?: number
  strength?: number
  onBattleEnd: (result: BattleResult) => void
}

export default function Battle({ initialHp, maxHp, isBoss = false, level = 1, equippedSkills = [], potionCharges = 0, strength = 0, onBattleEnd }: BattleProps) {
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
  const orcIdleRef = useRef<AnimatedSprite | null>(null)
  const orcRunRef = useRef<AnimatedSprite | null>(null)
  const orcAttackRef = useRef<AnimatedSprite | null>(null)
  const orcDeadRef = useRef<AnimatedSprite | null>(null)
  const orcStateRef = useRef<'idle' | 'run' | 'attack' | 'dead'>('idle')
  const fireballRef = useRef<{ doFireball: () => void }>({ doFireball: () => {} })
  const fireballBtnRef = useRef<HTMLButtonElement | null>(null)
  const iceballRef = useRef<{ doIceball: () => void }>({ doIceball: () => {} })
  const iceballBtnRef = useRef<HTMLButtonElement | null>(null)
  const iceballFramesRef = useRef<Texture[]>([])
  const iceballsRef = useRef<{ sprite: AnimatedSprite, worldX: number, dir: number }[]>([])
  const iceballCdRef = useRef(0)
  const enemyFrozenRef = useRef(0)
  const dashRef = useRef<{ doDash: () => void }>({ doDash: () => {} })
  const dashBtnRef = useRef<HTMLButtonElement | null>(null)
  const dashFramesRef = useRef<Texture[]>([])
  const dashCdRef = useRef(0)
  const dashActiveRef = useRef(false)
  const dashDirRef = useRef(1)
  const dashSpriteRef = useRef<AnimatedSprite | null>(null)
  const dashHitRef = useRef(false)
  const slashRef = useRef<{ doSlash: () => void }>({ doSlash: () => {} })
  const slashBtnRef = useRef<HTMLButtonElement | null>(null)
  const slashCdRef = useRef(0)
  const bleedingRef = useRef(0)
  const bleedTickRef = useRef(0)

  useEffect(() => {
    let app: Application | null = null
    let cancelled = false
    let endTimer: ReturnType<typeof setTimeout> | undefined

    async function setup() {
      app = new Application()
      const base = import.meta.env.BASE_URL
      const width = window.innerWidth
      const height = window.innerHeight
      const PLAYER_W = 40
      const SPEED = 3
      const ATTACK_RANGE = 70
      const ATTACK_DAMAGE = 15 + Math.floor(strength / 2)
      const ATTACK_COOLDOWN = 0.5

      try {
        await Assets.load([
          `${base}assets/bg-sky.png`,
          `${base}assets/bg-ruins.png`,
          `${base}assets/bg-floor.png`,
          `${base}assets/platform.png`,
          `${base}assets/Walk.png`,
          `${base}assets/Attack_1.png`,
          `${base}assets/Idle.png`,
          `${base}assets/enemy/orc/Idle.png`,
          `${base}assets/enemy/orc/Run.png`,
          `${base}assets/enemy/orc/Attack_1.png`,
        ])
        try {
          await Assets.load(`${base}assets/enemy/orc/Dead.png`)
        } catch {
          console.warn('Orc Dead.png not found, skipping')
        }
        try {
          await Assets.load(`${base}assets/skills/fireball.png`)
        } catch {
          console.warn('fireball.png not found, skipping')
        }
        try {
          await Assets.load(`${base}assets/skills/iceball.png`)
        } catch {
          console.warn('iceball.png not found, skipping')
        }
        try {
          await Assets.load(`${base}assets/skills/dash.png`)
        } catch {
          console.warn('dash.png not found, skipping')
        }
        try {
          await Assets.load(`${base}assets/skills/slash.png`)
        } catch {
          console.warn('slash.png not found, skipping')
        }
      } catch (e) {
        console.error('Failed to load background assets:', e)
      }

      await app.init({ width, height, background: 0x0d0820, backgroundAlpha: 1, resizeTo: window })

      if (cancelled || !containerRef.current) {
        app.destroy(true, { children: true })
        return
      }

      containerRef.current.appendChild(app.canvas)

      // --- World & Camera ---
      const WORLD_WIDTH = 3000
      const FLOOR_H = 120  // высота платформы на экране
      const FLOOR_Y = height - 200  // Y где стоят персонажи
      let cameraX = 0  // мировая X камеры

      // Небо — тайлинг на весь экран
      const bgSky = new TilingSprite({
        texture: Assets.get(`${base}assets/bg-sky.png`),
        width: width,
        height: height,
      })
      bgSky.y = 0
      app.stage.addChild(bgSky)

      // Руины — тайлинг нижняя часть
      const bgRuins = new TilingSprite({
        texture: Assets.get(`${base}assets/bg-ruins.png`),
        width: width,
        height: height * 0.35,
      })
      bgRuins.y = height * 0.42
      bgRuins.tileScale.set(0.5)
      app.stage.addChild(bgRuins)

      // Платформа — тайлинг внизу
      const platform = new TilingSprite({
        texture: Assets.get(`${base}assets/platform.png`),
        width: width,
        height: FLOOR_H,
      })
      platform.y = FLOOR_Y
      app.stage.addChild(platform)
      const underPlatform = new Graphics()
      underPlatform.rect(0, FLOOR_Y + FLOOR_H, width, height).fill(0x000000)
      app.stage.addChild(underPlatform)
      // --- конец background ---

      const FRAME_W = 128
      const FRAME_H = 128
      const walkTex = Assets.get(`${base}assets/Walk.png`)
      const walkFrames: import('pixi.js').Texture[] = Array.from({ length: 8 }, (_, i) =>
        new Texture({ source: walkTex.source, frame: new Rectangle(i * FRAME_W, 0, FRAME_W, FRAME_H) })
      )
      const atkTex = Assets.get(`${base}assets/Attack_1.png`)
      const attackFrames: import('pixi.js').Texture[] = Array.from({ length: 6 }, (_, i) =>
        new Texture({ source: atkTex.source, frame: new Rectangle(i * FRAME_W, 0, FRAME_W, FRAME_H) })
      )
      const idleTex = Assets.get(`${base}assets/Idle.png`)
      const idleFrames: import('pixi.js').Texture[] = Array.from({ length: 8 }, (_, i) =>
        new Texture({ source: idleTex.source, frame: new Rectangle(i * FRAME_W, 0, FRAME_W, FRAME_H) })
      )
      const player = new AnimatedSprite(idleFrames)
      let isAttacking = false
      let currentAnim = 'idle'
      if (walkFrames.length > 0) {
        (player as AnimatedSprite).animationSpeed = 0.3;
        (player as AnimatedSprite).stop();
        player.anchor.set(0.5, 1)
      }
      player.x = width * 0.2
      player.y = FLOOR_Y
      const PLAYER_SCALE_X = PLAYER_W / 128
      const PLAYER_SCALE_Y = 60 / 128
      const ATTACK_SCALE_Y = PLAYER_SCALE_Y
      player.scale.set(-PLAYER_SCALE_X, PLAYER_SCALE_Y)
      app.stage.addChild(player)
      let playerWorldX = player.x

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

      function sliceFrames(texture: Texture, frameCount: number, frameW: number, frameH: number): Texture[] {
        return Array.from({ length: frameCount }, (_, i) =>
          new Texture({ source: texture.source, frame: new Rectangle(i * frameW, 0, frameW, frameH) })
        )
      }

      let fireballTex: Texture | null = null
      try { fireballTex = Assets.get(`${base}assets/skills/fireball.png`) } catch { /* not loaded */ }
      const fireballFrames = fireballTex ? sliceFrames(fireballTex, 8, 640, 640) : []
      const fireballs: { sprite: AnimatedSprite, worldX: number, dir: number }[] = []
      let fireballCdLeft = 0

      let iceballTex: Texture | null = null
      try { iceballTex = Assets.get(`${base}assets/skills/iceball.png`) } catch { /* not loaded */ }
      iceballFramesRef.current = iceballTex ? sliceFrames(iceballTex, 12, 640, 640) : []
      iceballsRef.current = []
      iceballCdRef.current = 0
      enemyFrozenRef.current = 0

      let dashTex: Texture | null = null
      try { dashTex = Assets.get(`${base}assets/skills/dash.png`) } catch { /* not loaded */ }
      dashFramesRef.current = dashTex ? sliceFrames(dashTex, 41, 200, 128) : []
      dashCdRef.current = 0
      dashActiveRef.current = false
      dashSpriteRef.current = null

      const ORC_FRAME_W = 96
      const ORC_FRAME_H = 96
      const ENEMY_SCALE_X = ENEMY_W / ORC_FRAME_W
      const ENEMY_SCALE_Y = ENEMY_H / ORC_FRAME_H

      const orcIdleTex = Assets.get(`${base}assets/enemy/orc/Idle.png`)
      const orcRunTex = Assets.get(`${base}assets/enemy/orc/Run.png`)
      const orcAttackTex = Assets.get(`${base}assets/enemy/orc/Attack_1.png`)
      let orcDeadTex: Texture | null = null
      try { orcDeadTex = Assets.get(`${base}assets/enemy/orc/Dead.png`) } catch { /* not loaded */ }

      const orcIdle = new AnimatedSprite(sliceFrames(orcIdleTex, 5, ORC_FRAME_W, ORC_FRAME_H))
      const orcRun  = new AnimatedSprite(sliceFrames(orcRunTex,  6, ORC_FRAME_W, ORC_FRAME_H))
      const orcAtk  = new AnimatedSprite(sliceFrames(orcAttackTex, 4, ORC_FRAME_W, ORC_FRAME_H))
      const orcDead = new AnimatedSprite(
        orcDeadTex
          ? sliceFrames(orcDeadTex, 4, ORC_FRAME_W, ORC_FRAME_H)
          : sliceFrames(orcIdleTex, 5, ORC_FRAME_W, ORC_FRAME_H)
      )

      const orcSprites = [orcIdle, orcRun, orcAtk, orcDead]
      const enemySpawnX = width * 0.75
      for (const spr of orcSprites) {
        spr.anchor.set(0.5, 1)
        spr.x = enemySpawnX
        spr.y = FLOOR_Y
        spr.scale.set(-ENEMY_SCALE_X, ENEMY_SCALE_Y)
        spr.visible = false
        app.stage.addChild(spr)
      }
      orcIdle.loop = true
      orcIdle.animationSpeed = 0.12
      orcIdle.visible = true
      orcIdle.play()

      orcIdleRef.current = orcIdle
      orcRunRef.current  = orcRun
      orcAttackRef.current = orcAtk
      orcDeadRef.current = orcDead
      orcStateRef.current = 'idle'

      function setOrcAnim(state: 'idle' | 'run' | 'attack' | 'dead') {
        if (orcStateRef.current === state) return
        orcStateRef.current = state
        for (const spr of orcSprites) spr.visible = false
        if (state === 'idle') {
          orcIdle.loop = true; orcIdle.animationSpeed = 0.12
          orcIdle.visible = true; orcIdle.gotoAndPlay(0)
        } else if (state === 'run') {
          orcRun.loop = true; orcRun.animationSpeed = 0.15
          orcRun.visible = true; orcRun.gotoAndPlay(0)
        } else if (state === 'attack') {
          orcAtk.loop = true; orcAtk.animationSpeed = 0.15
          orcAtk.visible = true; orcAtk.gotoAndPlay(0)
        } else {
          orcDead.loop = false; orcDead.animationSpeed = 0.1
          orcDead.visible = true; orcDead.gotoAndPlay(0)
        }
      }

      let enemyWorldX = enemySpawnX

      let enemyHp = ENEMY_MAX_HP
      let enemyAlive = true
      let playerHp = initialHp
      let totalDamageTaken = 0
      let skillUses = 0
      let battleEnded = false

      const hpStyle = new TextStyle({ fontSize: 16, fill: 0xffffff })

      const enemyHpText = new Text({ text: `HP: ${enemyHp}`, style: hpStyle })
      enemyHpText.anchor.set(0.5, 1)
      enemyHpText.x = enemySpawnX
      enemyHpText.y = FLOOR_Y - ENEMY_H - 6
      app.stage.addChild(enemyHpText)

      const playerHpText = new Text({ text: `HP: ${playerHp}`, style: hpStyle })
      playerHpText.anchor.set(0.5, 1)
      playerHpText.x = player.x
      playerHpText.y = player.y - 70
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
            onBattleEnd({ won: false, damageTaken: totalDamageTaken, damageDealt: ENEMY_MAX_HP - enemyHp, skillUses: skillUses, actualHpLost: Math.max(0, initialHp - Math.max(0, playerHp)), potionsUsed: potionsUsedRef.current })
          }, 1500)
        }
      }

      attackRef.current = {
        canAttack: true,
        cooldownLeft: 0,
        doAttack() {
          if (battleEnded || cooldownLeft > 0) return
          if (attackFrames.length > 0 && !isAttacking) {
            isAttacking = true
            currentAnim = 'attack'
            const savedScaleX = player.scale.x
            player.textures = attackFrames
            player.loop = false
            player.animationSpeed = 0.4
            player.scale.x = savedScaleX
            player.scale.y = ATTACK_SCALE_Y
            player.gotoAndPlay(0)
            player.onComplete = () => {
              isAttacking = false
              currentAnim = ''
              player.scale.x = savedScaleX
              player.scale.y = PLAYER_SCALE_Y
            }
          }
          const dist = Math.abs(playerWorldX - enemyWorldX)
          if (dist > ATTACK_RANGE) return
          enemyHp -= ATTACK_DAMAGE
          if (enemyHp < 0) enemyHp = 0
          enemyHpText.text = `HP: ${enemyHp}`
          cooldownLeft = ATTACK_COOLDOWN
          if (enemyHp <= 0) {
            enemyAlive = false
            battleEnded = true
            setBattleOver(true)
            setOrcAnim('dead')
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
              onBattleEnd({ won: true, damageTaken: totalDamageTaken, damageDealt: ENEMY_MAX_HP - enemyHp, skillUses: skillUses, actualHpLost: Math.max(0, initialHp - Math.max(0, playerHp)), potionsUsed: potionsUsedRef.current })
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
          }
          setOrcAnim('idle')
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
        playerHpText.text = `HP: ${playerHp}`
      }
      // --- Fireball ---
      const FIREBALL_SCALE = 60 / 640
      fireballRef.current = {
        doFireball() {
          if (battleEnded || fireballCdLeft > 0 || !fireballFrames.length) return
          const dir = enemyWorldX >= playerWorldX ? 1 : -1
          const fb = new AnimatedSprite(fireballFrames)
          fb.anchor.set(0.5)
          fb.scale.set(dir * FIREBALL_SCALE, FIREBALL_SCALE)
          fb.x = playerWorldX - cameraX
          fb.y = FLOOR_Y - 40
          fb.loop = true
          fb.animationSpeed = 0.3
          fb.play()
          app!.stage.addChild(fb)
          fireballs.push({ sprite: fb, worldX: playerWorldX, dir })
          fireballCdLeft = 5
          skillUses += 1
          if (fireballBtnRef.current) fireballBtnRef.current.textContent = '5'
        },
      }
      // --- конец Fireball ---

      // --- Iceball ---
      const ICEBALL_SCALE = 60 / 640
      iceballRef.current = {
        doIceball() {
          if (battleEnded || iceballCdRef.current > 0 || !iceballFramesRef.current.length) return
          const dir = enemyWorldX >= playerWorldX ? 1 : -1
          const ib = new AnimatedSprite(iceballFramesRef.current)
          ib.anchor.set(0.5)
          ib.scale.set(dir * ICEBALL_SCALE, ICEBALL_SCALE)
          ib.x = playerWorldX - cameraX
          ib.y = FLOOR_Y - 40
          ib.loop = true
          ib.animationSpeed = 0.3
          ib.play()
          app!.stage.addChild(ib)
          iceballsRef.current.push({ sprite: ib, worldX: playerWorldX, dir })
          iceballCdRef.current = 5
          skillUses += 1
          if (iceballBtnRef.current) iceballBtnRef.current.textContent = '5'
        },
      }
      // --- конец Iceball ---

      // --- Dash ---
      let dashWorldX = 0
      let dashTimer = 0

      function endDash() {
        dashActiveRef.current = false
        if (dashSpriteRef.current) {
          app!.stage.removeChild(dashSpriteRef.current)
          dashSpriteRef.current = null
        }
      }

      dashRef.current = {
        doDash() {
          if (battleEnded || dashCdRef.current > 0 || dashActiveRef.current || !dashFramesRef.current.length) return
          const dir = enemyWorldX >= playerWorldX ? 1 : -1
          dashDirRef.current = dir
          dashWorldX = playerWorldX + (dir > 0 ? 40 : -40)
          dashTimer = 0
          dashHitRef.current = false
          const ds = new AnimatedSprite(dashFramesRef.current)
          ds.anchor.set(0.5, 0.5)
          ds.scale.set(dir, 80 / 128)
          ds.x = dashWorldX - cameraX
          ds.y = FLOOR_Y - 40
          ds.loop = false
          ds.animationSpeed = 0.4
          ds.onComplete = () => endDash()
          ds.play()
          app!.stage.addChild(ds)
          dashSpriteRef.current = ds
          dashActiveRef.current = true
          dashCdRef.current = 5
          skillUses += 1
          if (dashBtnRef.current) dashBtnRef.current.textContent = '5'
        },
      }
      // --- конец Dash ---

      // --- Slash ---
      let slashTex: Texture | null = null
      try { slashTex = Assets.get(`${base}assets/skills/slash.png`) } catch { /* not loaded */ }
      const slashFrames = slashTex ? sliceFrames(slashTex, 8, 496, 496) : []
      slashCdRef.current = 0
      bleedingRef.current = 0
      bleedTickRef.current = 0

      const SLASH_SCALE_X = 150 / 568
      const SLASH_SCALE_Y = 100 / 395
      slashRef.current = {
        doSlash() {
          if (battleEnded || slashCdRef.current > 0 || !slashFrames.length) return
          const sl = new AnimatedSprite(slashFrames)
          sl.anchor.set(0.5, 0.5)
          if (player.scale.x > 0) {
            sl.scale.set(SLASH_SCALE_X, SLASH_SCALE_Y)
            sl.x = (playerWorldX - cameraX) + 60
          } else {
            sl.scale.set(-SLASH_SCALE_X, SLASH_SCALE_Y)
            sl.x = (playerWorldX - cameraX) - 60
          }
          sl.y = FLOOR_Y - 30
          sl.loop = false
          sl.animationSpeed = 0.4
          sl.onComplete = () => { app?.stage?.removeChild(sl) }
          sl.play()
          app!.stage.addChild(sl)
          bleedingRef.current = 5
          bleedTickRef.current = 1
          slashCdRef.current = 10
          skillUses += 1
          if (slashBtnRef.current) slashBtnRef.current.textContent = '10'
        },
      }
      // --- конец Slash ---

      // --- конец Heal ---

      app.ticker.add((ticker) => {
        if (battleEnded) return
        bgSky.tilePosition.x = -cameraX * 0.1
        bgRuins.tilePosition.x = -cameraX * 0.3
        platform.tilePosition.x = -cameraX
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
        if (fireballCdLeft > 0) {
          fireballCdLeft -= ticker.deltaMS / 1000
          if (fireballCdLeft < 0) fireballCdLeft = 0
          if (fireballBtnRef.current) {
            fireballBtnRef.current.textContent = fireballCdLeft > 0 ? String(Math.ceil(fireballCdLeft)) : '🔥'
          }
        }
        if (iceballCdRef.current > 0) {
          iceballCdRef.current -= ticker.deltaMS / 1000
          if (iceballCdRef.current < 0) iceballCdRef.current = 0
          if (iceballBtnRef.current) {
            iceballBtnRef.current.textContent = iceballCdRef.current > 0 ? String(Math.ceil(iceballCdRef.current)) : '🧊'
          }
        }
        if (enemyFrozenRef.current > 0) {
          enemyFrozenRef.current -= ticker.deltaMS / 1000
          if (enemyFrozenRef.current < 0) enemyFrozenRef.current = 0
        }
        if (dashCdRef.current > 0) {
          dashCdRef.current -= ticker.deltaMS / 1000
          if (dashCdRef.current < 0) dashCdRef.current = 0
          if (dashBtnRef.current) {
            dashBtnRef.current.textContent = dashCdRef.current > 0 ? String(Math.ceil(dashCdRef.current)) : '⚡'
          }
        }
        if (slashCdRef.current > 0) {
          slashCdRef.current -= ticker.deltaMS / 1000
          if (slashCdRef.current < 0) slashCdRef.current = 0
          if (slashBtnRef.current) {
            slashBtnRef.current.textContent = slashCdRef.current > 0 ? String(Math.ceil(slashCdRef.current)) : '🗡️'
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
          playerWorldX += SPEED * directionRef.current
          if (playerWorldX < 0) playerWorldX = 0
          if (playerWorldX > WORLD_WIDTH - PLAYER_W) playerWorldX = WORLD_WIDTH - PLAYER_W
          if (directionRef.current === -1) {
            player.scale.x = -Math.abs(player.scale.x)
          } else {
            player.scale.x = Math.abs(player.scale.x)
          }
          if (!isAttacking && currentAnim !== 'walk') {
            player.textures = walkFrames
            player.loop = true
            player.animationSpeed = 0.3
            player.play()
            currentAnim = 'walk'
          }
          const playerScreenX = playerWorldX - cameraX
          if (playerScreenX < width * 0.1) cameraX = playerWorldX - width * 0.1
          else if (playerScreenX > width * 0.9) cameraX = playerWorldX - width * 0.9
          cameraX = Math.max(0, Math.min(WORLD_WIDTH - width, cameraX))
        } else if (!isAttacking) {
          if (currentAnim !== 'idle') {
            player.textures = idleFrames
            player.loop = true
            player.animationSpeed = 0.15
            player.play()
            currentAnim = 'idle'
          }
        }
        if (dashActiveRef.current && dashSpriteRef.current) {
          dashTimer += ticker.deltaMS / 1000
          playerWorldX += 12 * dashDirRef.current
          if (playerWorldX < 0) playerWorldX = 0
          if (playerWorldX > WORLD_WIDTH - PLAYER_W) playerWorldX = WORLD_WIDTH - PLAYER_W
          dashWorldX += 12 * dashDirRef.current
          const dScreenX = playerWorldX - cameraX
          if (dScreenX < width * 0.1) cameraX = playerWorldX - width * 0.1
          else if (dScreenX > width * 0.9) cameraX = playerWorldX - width * 0.9
          cameraX = Math.max(0, Math.min(WORLD_WIDTH - width, cameraX))
          dashSpriteRef.current.x = dashWorldX - cameraX
          if (enemyAlive && !dashHitRef.current && Math.abs(dashWorldX - enemyWorldX) < 60) {
            dashHitRef.current = true
            enemyHp -= ATTACK_DAMAGE
            if (enemyHp < 0) enemyHp = 0
            enemyHpText.text = `HP: ${enemyHp}`
            if (enemyHp <= 0) {
              enemyAlive = false
              battleEnded = true
              setBattleOver(true)
              setOrcAnim('dead')
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
                onBattleEnd({ won: true, damageTaken: totalDamageTaken, damageDealt: ENEMY_MAX_HP - enemyHp, skillUses: skillUses, actualHpLost: Math.max(0, initialHp - Math.max(0, playerHp)), potionsUsed: potionsUsedRef.current })
              }, 1500)
              return
            }
          }
          if (dashTimer >= 0.4) endDash()
        }

        player.scale.y = isAttacking ? ATTACK_SCALE_Y : PLAYER_SCALE_Y
        player.x = playerWorldX - cameraX
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

        for (let i = fireballs.length - 1; i >= 0; i--) {
          const fb = fireballs[i]
          fb.worldX += 4 * fb.dir
          fb.sprite.x = fb.worldX - cameraX
          const offScreen = fb.worldX < 0 || fb.worldX > WORLD_WIDTH
          const hitEnemy = enemyAlive && Math.abs(fb.worldX - enemyWorldX) < 40
          if (hitEnemy || offScreen) {
            app!.stage.removeChild(fb.sprite)
            fireballs.splice(i, 1)
            if (hitEnemy) {
              enemyHp -= ATTACK_DAMAGE
              if (enemyHp < 0) enemyHp = 0
              enemyHpText.text = `HP: ${enemyHp}`
              if (enemyHp <= 0) {
                enemyAlive = false
                battleEnded = true
                setBattleOver(true)
                setOrcAnim('dead')
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
                  onBattleEnd({ won: true, damageTaken: totalDamageTaken, damageDealt: ENEMY_MAX_HP - enemyHp, skillUses: skillUses, actualHpLost: Math.max(0, initialHp - Math.max(0, playerHp)), potionsUsed: potionsUsedRef.current })
                }, 1500)
                return
              }
            }
          }
        }

        for (let i = iceballsRef.current.length - 1; i >= 0; i--) {
          const ib = iceballsRef.current[i]
          ib.worldX += 4 * ib.dir
          ib.sprite.x = ib.worldX - cameraX
          const offScreen = ib.worldX < 0 || ib.worldX > WORLD_WIDTH
          const hitEnemy = enemyAlive && Math.abs(ib.worldX - enemyWorldX) < 40
          if (hitEnemy || offScreen) {
            app!.stage.removeChild(ib.sprite)
            iceballsRef.current.splice(i, 1)
            if (hitEnemy) {
              enemyFrozenRef.current = 3
            }
          }
        }

        if (bleedingRef.current > 0 && enemyAlive) {
          bleedingRef.current -= ticker.deltaMS / 1000
          if (bleedingRef.current < 0) bleedingRef.current = 0
          bleedTickRef.current -= ticker.deltaMS / 1000
          if (bleedTickRef.current <= 0) {
            bleedTickRef.current = 1
            const bleedDmg = Math.floor(ENEMY_MAX_HP * 0.03)
            enemyHp -= bleedDmg
            if (enemyHp < 0) enemyHp = 0
            enemyHpText.text = `HP: ${enemyHp}`
            const dmgStyle = new TextStyle({ fontSize: 14, fill: 0xff2222, fontWeight: 'bold' })
            const dmgText = new Text({ text: `-${bleedDmg}`, style: dmgStyle })
            dmgText.anchor.set(0.5)
            dmgText.x = enemyWorldX - cameraX
            dmgText.y = FLOOR_Y - ENEMY_H - 24
            app!.stage.addChild(dmgText)
            setTimeout(() => { try { app?.stage?.removeChild(dmgText) } catch { /* app destroyed */ } }, 800)
            if (enemyHp <= 0) {
              enemyAlive = false
              battleEnded = true
              setBattleOver(true)
              setOrcAnim('dead')
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
                onBattleEnd({ won: true, damageTaken: totalDamageTaken, damageDealt: ENEMY_MAX_HP - enemyHp, skillUses: skillUses, actualHpLost: Math.max(0, initialHp - Math.max(0, playerHp)), potionsUsed: potionsUsedRef.current })
              }, 1500)
              return
            }
          }
        }

        if (enemyAlive) {
          const dx = playerWorldX - enemyWorldX
          const dist = Math.abs(dx)
          if (dist > PLAYER_W) {
            if (enemyFrozenRef.current <= 0) {
              enemyWorldX += Math.sign(dx) * ENEMY_SPEED
              if (enemyWorldX < 0) enemyWorldX = 0
              else if (enemyWorldX > WORLD_WIDTH - ENEMY_W) enemyWorldX = WORLD_WIDTH - ENEMY_W
            }
            if (!enemyWindingUp) setOrcAnim(enemyFrozenRef.current > 0 ? 'idle' : 'run')
          } else {
            if (!enemyWindingUp) setOrcAnim('idle')
          }
          if (playerWorldX < enemyWorldX) {
            const sx = -Math.abs(orcIdleRef.current!.scale.x)
            orcIdleRef.current!.scale.x = sx
            orcRunRef.current!.scale.x = sx
            orcAttackRef.current!.scale.x = sx
            orcDeadRef.current!.scale.x = sx
          } else if (playerWorldX > enemyWorldX) {
            const sx = Math.abs(orcIdleRef.current!.scale.x)
            orcIdleRef.current!.scale.x = sx
            orcRunRef.current!.scale.x = sx
            orcAttackRef.current!.scale.x = sx
            orcDeadRef.current!.scale.x = sx
          }
          const enemyScreenX = enemyWorldX - cameraX
          for (const spr of orcSprites) spr.x = enemyScreenX
          enemyHpText.x = enemyScreenX

          if (enemyWindingUp && bossAttackType !== 'aoe' && dist >= ATTACK_RANGE) {
            enemyWindingUp = false
            windupTimer = 0
            bossAttackType = null
            setOrcAnim('idle')
          }

          if (enemyFrozenRef.current <= 0) {
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
                      setOrcAnim('attack')
                    }
                  } else if (roll < 2 / 3) {
                    bossAttackType = 'aoe'
                    enemyWindingUp = true
                    windupTimer = 0
                    if (aoeOverlay) aoeOverlay.visible = true
                    setOrcAnim('attack')
                  } else {
                    const gfx = new Graphics()
                    gfx.circle(0, 0, 6).fill(0xff9800)
                    gfx.x = enemyScreenX
                    gfx.y = FLOOR_Y - ENEMY_H / 2
                    app!.stage.addChild(gfx)
                    const targetX = player.x + PLAYER_W / 2
                    const dir = targetX > gfx.x ? 1 : -1
                    projectiles.push({ gfx, targetX, dir })
                  }
                } else {
                  enemyWindingUp = true
                  windupTimer = 0
                  setOrcAnim('attack')
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
              }
              bossAttackType = null
              setOrcAnim('idle')
              applyDamageToPlayer()
              if (battleEnded) return
            }
          }
          } // end enemyFrozenRef check
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
        background: '#0d0820',
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

            if (skill1El && equippedSkills[0] === 'fireball') { skill1El.onclick = () => fireballRef.current.doFireball(); fireballBtnRef.current = skill1El as HTMLButtonElement }
            if (skill2El && equippedSkills[1] === 'fireball') { skill2El.onclick = () => fireballRef.current.doFireball(); fireballBtnRef.current = skill2El as HTMLButtonElement }
            if (skill1El && equippedSkills[0] === 'iceball') { skill1El.onclick = () => iceballRef.current.doIceball(); iceballBtnRef.current = skill1El as HTMLButtonElement }
            if (skill2El && equippedSkills[1] === 'iceball') { skill2El.onclick = () => iceballRef.current.doIceball(); iceballBtnRef.current = skill2El as HTMLButtonElement }
            if (skill1El && equippedSkills[0] === 'dash') { skill1El.onclick = () => dashRef.current.doDash(); dashBtnRef.current = skill1El as HTMLButtonElement }
            if (skill2El && equippedSkills[1] === 'dash') { skill2El.onclick = () => dashRef.current.doDash(); dashBtnRef.current = skill2El as HTMLButtonElement }
            if (skill1El && equippedSkills[0] === 'slash') { skill1El.onclick = () => slashRef.current.doSlash(); slashBtnRef.current = skill1El as HTMLButtonElement }
            if (skill2El && equippedSkills[1] === 'slash') { skill2El.onclick = () => slashRef.current.doSlash(); slashBtnRef.current = skill2El as HTMLButtonElement }
          }}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, pointerEvents: 'none' }} />
        </div>
      )}
    </div>
  )
}