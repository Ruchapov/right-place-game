// Посредник Telegram для Right Place (Cloudflare Worker, 25.11.2026).
//
// Зачем: с московского сервера (REG.RU) все адреса Telegram закрыты на уровне
// сети, и Telegram, скорее всего, тоже не достаёт до нас. Cloudflare видят обе
// стороны, поэтому ходим через него.
//
//   /tg/<что угодно>  → https://api.telegram.org/<что угодно>
//       Только с заголовком X-Proxy-Key == PROXY_KEY, иначе 403 — воркер не
//       должен стать открытым прокси к Telegram.
//   /hook             → POST на наш вебхук ORIGIN_HOOK_URL, заголовок
//       X-Telegram-Bot-Api-Secret-Token передаётся как есть; секрет проверяет
//       сам сервер игры (BOT_WEBHOOK_SECRET), воркер его не знает.
//   /art/<файл>       → картинки бота (лежат В САМОМ воркере: static assets из
//       public/bot, wrangler.toml). Сервер шлёт sendPhoto / editMessageMedia со
//       ссылкой на /art/<файл>, а воркер подменяет ссылку самим файлом
//       (multipart) — см. artAsUpload. Почему так (проверено 25.11.2026):
//       Telegram по ссылке с workers.dev фото не качает (запроса нет вовсе),
//       до московского сервера тоже не достаёт, а сам сервер не может
//       отправить через Cloudflare больше ~16 КБ — соединение замирает.
//       ⚠️ Поменяли картинку в public/bot — выложить воркер заново.
//
// Секреты — только `wrangler secret put PROXY_KEY`. В этом файле и в
// wrangler.toml секретов нет и быть не должно.

const TG_API = 'https://api.telegram.org'

function notFound() {
  return new Response('Not found', { status: 404 })
}

// сравнение без раннего выхода — длина ключа и место расхождения не утекают по времени
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false
  const ea = new TextEncoder().encode(a)
  const eb = new TextEncoder().encode(b)
  let diff = ea.length ^ eb.length
  for (let i = 0; i < Math.max(ea.length, eb.length); i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0)
  return diff === 0
}

async function proxyTelegram(request, env, url) {
  if (!env.PROXY_KEY || !safeEqual(request.headers.get('X-Proxy-Key') || '', env.PROXY_KEY)) {
    return new Response('Forbidden', { status: 403 })
  }
  const rest = url.pathname.slice('/tg'.length) // /bot<token>/<method>
  if (!rest.startsWith('/bot')) return new Response('Forbidden', { status: 403 })
  const headers = new Headers()
  const ct = request.headers.get('Content-Type')
  let body = request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body
  // Фото по ссылке на /art/ этого же воркера — загружаем файлом отсюда.
  // Telegram сам с workers.dev не качает, а сервер в Москве не может отправить
  // через Cloudflare больше ~16 КБ: короткий JSON приходит сюда, файл уходит отсюда.
  const method = rest.split('/')[2] || ''
  if (env.ASSETS && ct && ct.includes('application/json') && (method === 'sendPhoto' || method === 'editMessageMedia')) {
    const json = await request.json()
    const form = await artAsUpload(json, method, env, url)
    body = form ?? JSON.stringify(json)
    if (!form) headers.set('Content-Type', 'application/json')
  } else if (ct) {
    headers.set('Content-Type', ct)
  }
  const res = await fetch(TG_API + rest + url.search, { method: request.method, headers, body })
  return new Response(res.body, {
    status: res.status,
    headers: { 'Content-Type': res.headers.get('Content-Type') || 'application/json', 'Cache-Control': 'no-store' },
  })
}

// Тело sendPhoto / editMessageMedia со ссылкой на <этот воркер>/art/<файл> →
// multipart с самим файлом из ASSETS. Не наша ссылка или файла нет — null.
async function artAsUpload(json, method, env, url) {
  const prefix = `${url.origin}/art/`
  const link = method === 'sendPhoto' ? json.photo : json.media && json.media.media
  if (typeof link !== 'string' || !link.startsWith(prefix)) return null
  const name = link.slice(prefix.length)
  if (!/^[A-Za-z0-9_-]+\.(jpg|jpeg|png|webp)$/.test(name)) return null
  const asset = await env.ASSETS.fetch(new Request(`${url.origin}/${name}`))
  if (!asset.ok) return null
  const file = new File([await asset.arrayBuffer()], name, { type: asset.headers.get('Content-Type') || 'image/jpeg' })
  const fields = { ...json }
  if (method === 'sendPhoto') delete fields.photo
  else fields.media = { ...json.media, media: 'attach://photo' }
  const form = new FormData()
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined || v === null) continue
    form.append(k, typeof v === 'object' ? JSON.stringify(v) : String(v))
  }
  form.append('photo', file)
  return form
}

async function proxyHook(request, env) {
  if (request.method !== 'POST') return notFound()
  const secret = request.headers.get('X-Telegram-Bot-Api-Secret-Token')
  if (!secret) return new Response('Forbidden', { status: 403 })
  const headers = new Headers({ 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': secret })
  const res = await fetch(env.ORIGIN_HOOK_URL, { method: 'POST', headers, body: request.body })
  // Telegram смотрит только на код ответа: 200 — доставлено, иначе повторит позже
  return new Response(await res.text(), { status: res.status, headers: { 'Content-Type': 'application/json' } })
}

async function proxyArt(request, env, url, ctx) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return notFound()
  const name = url.pathname.slice('/art/'.length)
  // только картинки бота, без подпапок и выхода наверх
  if (!/^[A-Za-z0-9_-]+\.(jpg|jpeg|png|webp)$/.test(name)) return notFound()
  if (env.ASSETS) {
    const asset = await env.ASSETS.fetch(new Request(`${url.origin}/${name}`, { method: 'GET' }))
    if (asset.ok) {
      const headers = new Headers(asset.headers)
      headers.set('Cache-Control', 'public, max-age=86400')
      return new Response(request.method === 'HEAD' ? null : asset.body, { status: 200, headers })
    }
  }
  const cache = caches.default
  const key = new Request(url.origin + url.pathname, { method: 'GET' })
  let res = await cache.match(key)
  if (!res) {
    const origin = await fetch(`${env.ORIGIN_ART_URL.replace(/\/+$/, '')}/${name}`, { cf: { cacheTtl: 86400, cacheEverything: true } })
    if (!origin.ok) return notFound()
    res = new Response(origin.body, {
      status: 200,
      headers: { 'Content-Type': origin.headers.get('Content-Type') || 'image/jpeg', 'Cache-Control': 'public, max-age=86400' },
    })
    ctx.waitUntil(cache.put(key, res.clone()))
  }
  return request.method === 'HEAD' ? new Response(null, { status: 200, headers: res.headers }) : res
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url)
    try {
      if (url.pathname.startsWith('/tg/')) return await proxyTelegram(request, env, url)
      if (url.pathname === '/hook') return await proxyHook(request, env)
      if (url.pathname.startsWith('/art/')) return await proxyArt(request, env, url, ctx)
      return notFound()
    } catch (e) {
      return new Response('Bad gateway', { status: 502 })
    }
  },
}
