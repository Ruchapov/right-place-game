// Кодирует PNG в WebP тем же порядком ступеней, что сборщики слоёв карт
// (build_map_art_new_six.mjs, build_map_art.mjs): без потерь → почти без потерь
// 60 → 40 → с потерями q98…82, первая, что влезла в лимит части слоя.
//
//   node tools/encode_webp_ladder.mjs <in.png> <out.webp> [макс. байт = 1500000]
//
// Печатает одну строку JSON: {label, bytes}. Зовёт tools/clean_trap_decor.py.
import fs from 'node:fs'
import sharp from 'sharp'

const [src, dst, maxArg] = process.argv.slice(2)
const MAX = Number(maxArg || 1_500_000)
const ladder = [
  ['без потерь', { lossless: true, effort: 6 }],
  ['почти без потерь 60', { nearLossless: true, quality: 60, effort: 6 }],
  ['почти без потерь 40', { nearLossless: true, quality: 40, effort: 6 }],
  ...[98, 96, 94, 92, 90, 86, 82].map((q) => [`q${q}`, { quality: q, alphaQuality: 100, effort: 6, smartSubsample: true }]),
]
const png = fs.readFileSync(src)
for (const [label, opts] of ladder) {
  const buf = await sharp(png).webp(opts).toBuffer()
  if (buf.length <= MAX) {
    fs.writeFileSync(dst, buf)
    console.log(JSON.stringify({ label, bytes: buf.length }))
    process.exit(0)
  }
}
console.error(`не влезло в ${MAX} байт ни на одной ступени: ${src}`)
process.exit(1)
