// s71 (23.11.2026): посадка на пол — герой, фехтовальщик и зверь на ровном полу,
// на '=' и на ступени (кадры ×2) + обход ВСЕХ спрайтов мира: на сколько px нижняя
// непрозрачная строка (альфа > 40) ниже (+) или выше (−) верха клетки пола под ней.
//   node s71_ground.mjs <port> <label> <map> '<spots json>'
// spots: {"flat":[x,y],"eq":[x,y]|null,"step":[x,y]|null} — ряд героя, опора y+1.
// Кадры: shots/s71/<label>_<map>_<kind>.png; числа: out/s71_<label>_<map>.json
import fs from 'node:fs'
import path from 'node:path'
import { openPage, urlFor, waitMenu, startRunFromMenu, waitRun, bindRefs, sleep, save, SHOTS } from './cdp.mjs'
const [portS, label, map, spotsS] = process.argv.slice(2)
const spots = JSON.parse(spotsS)
const mapFile = fs.readdirSync('D:/dev/telegram-game/public/assets/maps').find((f) => f.startsWith(`map_${map}_`) && f.endsWith('.txt'))
const grid = fs.readFileSync(`D:/dev/telegram-game/public/assets/maps/${mapFile}`, 'utf8').replace(/\r/g, '').split('\n').filter(Boolean)
const dir = path.join(SHOTS, 's71'); fs.mkdirSync(dir, { recursive: true })
const out = { label, map, poses: [], sprites: [], problems: [] }
const page = await openPage({ width: 390, height: 844, seed: 4 })
try {
  await page.goto(urlFor(Number(portS)) + '?enemy=fencer,beast')
  await waitMenu(page); await startRunFromMenu(page, map); await waitRun(page); await bindRefs(page)
  await page.evaluate(`(() => { window.__grid = ${JSON.stringify(grid)}
    setInterval(() => { const b = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Понятно'); if (b) b.click(); const t = document.querySelector('[data-skill-tip]'); if (t) t.click() }, 100)
    const st = document.createElement('style'); st.textContent = '* { visibility: hidden !important } canvas { visibility: visible !important }'; document.head.appendChild(st); return true })()`)
  await sleep(900)
  const found = await page.evaluate(`(() => { const R = __pt.R
    const all = R.enemiesRef.current.filter((x) => !x.dead)
    const F = all.find((x) => x.kind === 'fencer'), B = all.find((x) => x.kind === 'beast')
    window.__F = F; window.__B = B
    for (const o of all) if (o !== F && o !== B) { o.x += 9000; o.stunTimer = 1e12 }
    window.__pose = null
    const hold = (e, x, y) => { if (!e) return; e.x = x; e.y = y - e.height; e.vx = 0; e.vy = 0; e.facing = -1; e.aggroMemoryTimer = 0; e.noticePending = false; e.attackCooldown = 99999; if (e.nc) e.nc.cooldownMs = 99999 }
    __pt.app.ticker.add(() => {
      const P = window.__pose; if (!P) return
      const p = R.physicsRef.current
      p.x = P.hx; p.y = P.hy; p.vx = 0; p.vy = 0; R.facingRef.current = 1
      if (P.f) hold(window.__F, P.f[0], P.f[1]); else if (window.__F) window.__F.x = -9000
      if (P.b) hold(window.__B, P.b[0], P.b[1]); else if (window.__B) window.__B.x = -9000
      R.hpRef.current = Math.max(R.hpRef.current, 300)
    }, null, 1000)
    return { F: !!F, B: !!B } })()`)
  if (!found.F || !found.B) out.problems.push('нет ' + (!found.F ? 'фехтовальщика ' : '') + (!found.B ? 'зверя' : ''))
  const g = (x, y) => (grid[y] && grid[y][x]) || '#'
  const standable = (x, y) => '#='.includes(g(x, y + 1)) && !'#='.includes(g(x, y)) && !'#='.includes(g(x, y - 1))
  for (const kind of ['flat', 'eq', 'step']) {
    const c = spots[kind]; if (!c) continue
    const [x, y] = c
    // Враги: на ровном и на '=' — справа через клетку и через две, если там можно стоять;
    // на ступени — фехтовальщик на нижней площадке слева, зверь справа на верхней.
    const fc = kind === 'step' ? [x - 2, y + 1] : [x + 2, y]
    const bc = kind === 'step' ? [x + 2, y] : [x + 4, y]
    const pos = (cc, w) => standable(cc[0], cc[1]) ? [cc[0] * 64 + 32, (cc[1] + 1) * 64] : null
    await page.evaluate(`(() => { const F = window.__F, B = window.__B
      const f = ${JSON.stringify(pos(fc))}, b = ${JSON.stringify(pos(bc))}
      window.__pose = { hx: ${x} * 64 + 32 - 27, hy: (${y} + 1) * 64 - 128,
        f: f && F ? [f[0] - F.width / 2, f[1]] : null, b: b && B ? [b[0] - B.width / 2, b[1]] : null }
      return true })()`)
    await sleep(900)
    console.log(kind, await page.evaluate(`(() => { const R = __pt.R, p = R.physicsRef.current, F = window.__F, B = window.__B, h = R.heroSpriteRef.current
      const f = (e) => e ? { x: Math.round(e.x), y: Math.round(e.y), sx: Math.round(e.sprite.x), sy: Math.round(e.sprite.y), vis: e.sprite.visible, dead: e.dead } : null
      return JSON.stringify({ hero: { x: Math.round(p.x), y: Math.round(p.y), sx: Math.round(h.x), sy: Math.round(h.y) }, F: f(F), B: f(B), pose: window.__pose }) })()`))
    const box = await page.evaluate(`(() => { const R = __pt.R, h = R.heroSpriteRef.current, w = h.parent
      const ys = [${y}, ${fc[1]}, ${bc[1]}]
      const a = w.toGlobal({ x: h.x - 150, y: (Math.min(...ys) + 1) * 64 - 170 })
      const b = w.toGlobal({ x: h.x + 330, y: (Math.max(...ys) + 1) * 64 + 50 })
      return { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y } })()`)
    await page.shot(`s71/${label}_${map}_${kind}`, { x: Math.max(0, box.x), y: Math.max(0, box.y), width: Math.min(390 - Math.max(0, box.x), box.w), height: box.h, scale: 2 })
    out.poses.push({ kind, cell: c, fencer: pos(fc) ? fc : null, beast: pos(bc) ? bc : null })
  }
  // Обход всех спрайтов мира: нижняя непрозрачная строка против пола под ней.
  out.sprites = await page.evaluate(`(() => {
    const w = __pt.world(), G = window.__grid, res = [], R = __pt.R
    const who = new Map()
    who.set(R.heroSpriteRef.current, 'HERO')
    for (const e of R.enemiesRef.current) if (e.sprite) who.set(e.sprite, 'ENEMY:' + e.kind)
    if (R.bossRef.current && R.bossRef.current.sprite) who.set(R.bossRef.current.sprite, 'BOSS:' + (R.bossRef.current.kind || 'boss'))
    for (const c of R.chestsRef.current || []) if (c.sprite) who.set(c.sprite, 'CHEST' + (c.isMimic ? ':mimic' : ''))
    for (const o of R.obelisksRef.current || []) if (o.sprite) who.set(o.sprite, 'OBELISK')
    for (const o of R.smugglersRef.current || []) if (o.sprite) who.set(o.sprite, 'SMUGGLER')
    const solid = (x, y) => G[y] !== undefined && '#='.includes(G[y][x] || '')
    const walk = (o) => {
      if (!o.visible || o.alpha === 0) return
      if (o.texture && o.texture.source && o.anchor) {
        const lab = String(o.texture.source.label || ''), b = __pt.alphaBox(o.texture)
        const name = who.get(o) || (lab ? lab.split('/').slice(-2).join('/').split('?')[0] : 'NOLABEL')
        let fig = null
        if (b && !b.err) {
          const tr = o.texture.trim, orig = o.texture.orig
          const ox = (tr ? tr.x : 0) - o.anchor.x * orig.width, oy = (tr ? tr.y : 0) - o.anchor.y * orig.height
          const p0 = w.toLocal(o.toGlobal({ x: ox + b.x0, y: oy + b.y1 + 1 })), p1 = w.toLocal(o.toGlobal({ x: ox + b.x1 + 1, y: oy + b.y1 + 1 }))
          const top = w.toLocal(o.toGlobal({ x: ox + b.x0, y: oy + b.y0 }))
          fig = { bottom: Math.max(p0.y, p1.y, top.y), top: top.y, cx: (p0.x + p1.x) / 2 }
        }
        let figX = null
        const lbH = (() => { const lb = o.getBounds(); return lb.height / w.scale.y })()
        if ((who.has(o) || lbH >= 12) && !/maps\\/art|backgrounds|walls/.test(lab)) {
          // Текстура без читаемого источника (перекрашенный лист героя): снимок самого
          // спрайта рендером, в мировых px (масштаб мира учтён через bounds).
          // Скрываем в мире всё, кроме ветки с этим спрайтом, и снимаем пиксели МИРА в
          // рамке вокруг спрайта (мировые координаты, 1 px = 1 px мира).
          const saved = []
          try {
            const chain = new Set(); for (let p = o; p; p = p.parent) chain.add(p)
            const hideAll = (c) => { for (const k of c.children || []) { if (chain.has(k)) { if (k !== o) hideAll(k) } else { saved.push([k, k.visible]); k.visible = false } } }
            hideAll(w)
            const lb = o.getBounds(), a = w.toLocal({ x: lb.x, y: lb.y }), z = w.toLocal({ x: lb.x + lb.width, y: lb.y + lb.height })
            const fx = Math.floor(a.x) - 2, fyy = Math.floor(a.y) - 2, fw = Math.ceil(z.x - a.x) + 4, fh = Math.ceil(z.y - a.y) + 4
            const ex = __pt.app.renderer.extract.pixels({ target: w, frame: new __pt.app.screen.constructor(fx, fyy, fw, fh), resolution: 1 })
            const px = ex.pixels, W = ex.width, H = ex.height
            let y1 = -1, y0 = -1, xs = 0, xn = 0
            for (let y = H - 1; y >= 0 && y1 < 0; y--) for (let x = 0; x < W; x++) if (px[(y * W + x) * 4 + 3] > 40) { y1 = y; break }
            for (let y = 0; y < H && y0 < 0; y++) for (let x = 0; x < W; x++) if (px[(y * W + x) * 4 + 3] > 40) { y0 = y; break }
            if (y1 >= 0) for (let x = 0; x < W; x++) if (px[(y1 * W + x) * 4 + 3] > 40) { xs += x; xn++ }
            const k = fh / H
            if (y1 >= 0) figX = { bottom: fyy + (y1 + 1) * k, top: fyy + y0 * k, cx: fx + (xs / Math.max(1, xn)) * (fw / W), via: 'extract' }
            else res.push({ lab: name, err: 'extract: пусто ' + W + 'x' + H })
          } catch (e) { res.push({ lab: name, err: String(e).slice(0, 80) }) }
          finally { for (const [k, v] of saved) k.visible = v }
        }
        const dX = figX && fig ? +(fig.bottom - figX.bottom).toFixed(1) : null
        if (figX) fig = figX
        if (fig && !/maps\\/art|backgrounds|walls/.test(lab)) {
          const bottom = fig.bottom, top = { y: fig.top }, cx = fig.cx
          const gx = Math.floor(cx / 64)
          let fy = null
          for (let gy = Math.floor((bottom - 40) / 64); gy <= Math.floor((bottom + 40) / 64); gy++) {
            if (solid(gx, gy) && !solid(gx, gy - 1)) { if (fy === null || Math.abs(bottom - gy * 64) < Math.abs(bottom - fy * 64)) fy = gy }
          }
          res.push({ lab: name, dX, frame: o.currentFrame ?? null, x: Math.round(cx), bottom: +bottom.toFixed(1),
            h: +Math.abs(bottom - top.y).toFixed(1), floor: fy === null ? null : fy * 64, d: fy === null ? null : +(bottom - fy * 64).toFixed(1) })
        }
      }
      for (const c of (o.children || [])) walk(c)
    }
    walk(w)
    return res })()`)
  out.exceptions = page.problems().exceptions
} catch (e) {
  console.log('ERR', e.message); out.err = e.message
} finally {
  // сводка по видам спрайтов, что стоят у пола (|d| ≤ 40)
  const by = {}
  for (const s of out.sprites) { if (s.d == null || Math.abs(s.d) > 40 || s.h < 6) continue; (by[s.lab] ||= []).push(s.d) }
  out.summary = Object.fromEntries(Object.entries(by).map(([k, v]) => { v.sort((a, b) => a - b); return [k, { n: v.length, min: v[0], med: v[v.length >> 1], max: v[v.length - 1] }] }))
  for (const [k, v] of Object.entries(out.summary)) console.log(`${map} ${k.padEnd(44)} n=${v.n} d min ${v.min} med ${v.med} max ${v.max}`)
  if (out.problems.length) console.log('PROBLEMS', out.problems)
  save(`s71_${label}_${map}`, out)
  await page.close()
}
