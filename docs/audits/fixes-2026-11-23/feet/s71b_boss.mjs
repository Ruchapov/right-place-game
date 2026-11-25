// s71b (23.11.2026): посадка босса — нижняя строка с альфой > 40 против кромки пола.
//   node s71b_boss.mjs <port> <label> <map> <kind: werewolf|abbot|serpent|crowking> [seeds…]
// Перебирает seed, пока в забеге не будет босса; меряет рендером (мир без остального).
import fs from 'node:fs'
import { openPage, urlFor, waitMenu, startRunFromMenu, waitRun, bindRefs, sleep, save } from './cdp.mjs'
const [portS, label, map, kind, ...seedsS] = process.argv.slice(2)
const seeds = seedsS.length ? seedsS.map(Number) : [4, 1, 2, 3, 5, 6, 7, 8, 9, 10, 11, 12]
const mapFile = fs.readdirSync('D:/dev/telegram-game/public/assets/maps').find((f) => f.startsWith(`map_${map}_`) && f.endsWith('.txt'))
const grid = fs.readFileSync(`D:/dev/telegram-game/public/assets/maps/${mapFile}`, 'utf8').replace(/\r/g, '').split('\n').filter(Boolean)
const out = { label, map, kind, rows: [] }
for (const seed of seeds) {
  const page = await openPage({ width: 390, height: 844, seed })
  try {
    await page.goto(urlFor(Number(portS)) + `?boss=${kind}`)
    await waitMenu(page); await startRunFromMenu(page, map); await waitRun(page); await bindRefs(page)
    await page.evaluate(`(() => { setInterval(() => { const b = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Понятно'); if (b) b.click(); const t = document.querySelector('[data-skill-tip]'); if (t) t.click() }, 100); return true })()`)
    await sleep(1500)
    const r = await page.evaluate(`(() => { const R = __pt.R, b = R.bossRef.current; if (!b || !b.sprite) return null
      const w = __pt.world(), G = ${JSON.stringify(grid)}, o = b.sprite
      const solid = (x, y) => G[y] !== undefined && '#='.includes(G[y][x] || '')
      const saved = [], chain = new Set(); for (let p = o; p; p = p.parent) chain.add(p)
      const hideAll = (c) => { for (const k of c.children || []) { if (chain.has(k)) { if (k !== o) hideAll(k) } else { saved.push([k, k.visible]); k.visible = false } } }
      hideAll(w)
      try {
        const lb = o.getBounds(), a = w.toLocal({ x: lb.x, y: lb.y }), z = w.toLocal({ x: lb.x + lb.width, y: lb.y + lb.height })
        const fx = Math.floor(a.x) - 2, fy = Math.floor(a.y) - 2, fw = Math.ceil(z.x - a.x) + 4, fh = Math.ceil(z.y - a.y) + 4
        const ex = __pt.app.renderer.extract.pixels({ target: w, frame: new __pt.app.screen.constructor(fx, fy, fw, fh), resolution: 1 })
        const px = ex.pixels, W = ex.width, H = ex.height
        let y1 = -1, xs = 0, xn = 0
        for (let y = H - 1; y >= 0 && y1 < 0; y--) for (let x = 0; x < W; x++) if (px[(y * W + x) * 4 + 3] > 40) { y1 = y; break }
        for (let x = 0; x < W; x++) if (px[(y1 * W + x) * 4 + 3] > 40) { xs += x; xn++ }
        const k = fh / H, bottom = fy + (y1 + 1) * k, cx = fx + (xs / Math.max(1, xn)) * (fw / W)
        const gx = Math.floor(cx / 64); let fl = null
        for (let gy = Math.floor((bottom - 40) / 64); gy <= Math.floor((bottom + 40) / 64); gy++) if (solid(gx, gy) && !solid(gx, gy - 1)) fl = gy
        return { kind: b.kind || b.bossKind || '?', anim: o.texture && o.texture.source && String(o.texture.source.label || '').split('/').pop(), frame: o.currentFrame, bottom: +bottom.toFixed(1), floor: fl === null ? null : fl * 64, d: fl === null ? null : +(bottom - fl * 64).toFixed(1), spriteY: Math.round(o.y) }
      } finally { for (const [k, v] of saved) k.visible = v }
    })()`)
    if (r) { r.seed = seed; out.rows.push(r); console.log(map, kind, JSON.stringify(r)); break }
    console.log(map, kind, 'seed', seed, 'нет босса')
  } catch (e) { console.log('ERR', e.message) } finally { await page.close() }
}
save(`s71b_${label}_${map}_${kind}`, out)
