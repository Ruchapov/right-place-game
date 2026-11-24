// Деплой Right Place на свой сервер (24.11.2026).
//
//   npm run deploy          — фронт и сервер
//   npm run deploy:front    — только фронт  (https://rightplace-game.ru)
//   npm run deploy:server   — только сервер (https://api.rightplace-game.ru)
//
// Работает из обычного cmd на Windows 10+: ssh, scp и tar там встроены.
// Вход на сервер — по ключу %USERPROFILE%\.ssh\id_ed25519, без пароля.
//
// ЧТО УХОДИТ НА СЕРВЕР — только две вещи:
//   • фронт: папка dist после vite build (без .map);
//   • сервер: папка server/ из ПОСЛЕДНЕГО КОММИТА (git archive HEAD server).
// Документация, исходники фронта, tools/, .claude/ и любые .env туда не попадают.
// Секреты живут только на сервере, в /opt/rightplace/.env — этот скрипт их не
// читает, не пишет и не печатает.
//
// Сервер: распаковка в /opt/rightplace/releases/<время> → npm ci → prisma generate
// → бэкап базы → prisma migrate deploy → build → переключение ссылки current →
// перезапуск → проверка /health; не ответил «ok» — откат на прошлую версию.
// Фронт: /var/www/releases/<время>, ссылка /var/www/rightplace, хранятся 3 последних.

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const HOST = process.env.RP_HOST || 'root@161.104.30.53'
const SSH_OPTS = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=20', '-o', 'ServerAliveInterval=30']

const what = process.argv[2] || 'all'
if (!['all', 'front', 'server'].includes(what)) {
  console.error('Использование: node tools/deploy.mjs [all|front|server]')
  process.exit(2)
}

function step(msg) { console.log(`\n=== ${msg}`) }
function fail(msg) { console.error(`\n✗ ${msg}`); process.exit(1) }

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit', shell: false, ...opts })
  if (r.error) fail(`${cmd}: ${r.error.message}`)
  return r.status
}
function out(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', shell: false })
  if (r.error) fail(`${cmd}: ${r.error.message}`)
  if (r.status !== 0) fail(`${cmd} ${args.join(' ')} — код ${r.status}\n${r.stderr}`)
  return r.stdout
}

// ssh/scp с повтором ТОЛЬКО если соединение не установилось (сеть до Москвы
// иногда теряет рукопожатие). Если команда уже пошла — не повторяем.
const CONNECT_ERR = /banner exchange|Connection closed|Connection timed out|Connection refused|Connection reset|Could not resolve|Network is unreachable/i
function remote(tool, args) {
  for (let attempt = 1; attempt <= 6; attempt++) {
    const r = spawnSync(tool, [...SSH_OPTS, ...args], { cwd: ROOT, stdio: ['inherit', 'inherit', 'pipe'], encoding: 'utf8' })
    if (r.error) fail(`${tool}: ${r.error.message}`)
    if (r.status === 255 && CONNECT_ERR.test(r.stderr || '')) {
      console.log(`  (${tool}: сервер не ответил, попытка ${attempt}/6, жду 8 с)`)
      spawnSync(process.execPath, ['-e', 'setTimeout(()=>{},8000)'])
      continue
    }
    if (r.stderr) process.stderr.write(r.stderr)
    return r.status
  }
  fail(`${tool}: не удалось подключиться к ${HOST}`)
}

const stamp = (() => {
  const d = new Date(), p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
})()
// Временные файлы — в папке проекта (.deploy-tmp, в .gitignore), пути относительные:
// в пути к %TEMP% бывает кириллица, а tar из Git принимает «C:» за имя хоста.
const rel = `.deploy-tmp/${stamp}`
const work = join(ROOT, rel)
mkdirSync(work, { recursive: true })
process.on('exit', () => rmSync(work, { recursive: true, force: true }))

// ---------- 1. git чист ----------
step('Проверка git')
const status = out('git', ['status', '--porcelain', '--untracked-files=all'])
  .split('\n').map((l) => l.replace(/\r$/, '')).filter(Boolean)
// изменённые файлы под git — всегда стоп; новые файлы — стоп, если они попадут в сборку
const BUILD_INPUTS = /^(src\/|public\/|server\/|index\.html|vite\.config|tsconfig|package(-lock)?\.json)/
const blocking = status.filter((l) => !l.startsWith('??') || BUILD_INPUTS.test(l.slice(3).replace(/^"|"$/g, '')))
if (blocking.length) {
  fail('Есть незакоммиченные изменения — сначала коммит, потом деплой:\n' + blocking.map((l) => '  ' + l).join('\n'))
}
const head = out('git', ['rev-parse', '--short', 'HEAD']).trim()
console.log(`  чисто, коммит ${head}`)

if (remote('ssh', [HOST, 'true']) !== 0) fail('ssh на сервер не работает')

// ---------- 2. фронт ----------
function deployFront() {
  step('Фронт: сборка (npm run build)')
  if (run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build'], { shell: process.platform === 'win32' }) !== 0) fail('сборка фронта упала')
  const dist = join(ROOT, 'dist')
  if (!existsSync(join(dist, 'index.html'))) fail('в dist нет index.html')
  const maps = []
  const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); statSync(p).isDirectory() ? walk(p) : f.endsWith('.map') && maps.push(p) } }
  walk(dist)
  if (maps.length) fail(`в dist есть .map файлы (${maps.length}) — карты исходников на сайт не выкладываем`)

  step('Фронт: архив и отправка')
  const tgz = `${rel}/front.tgz`
  if (run('tar', ['-czf', tgz, '-C', 'dist', '.']) !== 0) fail('tar фронта упал')
  if (remote('scp', ['-q', tgz, `${HOST}:/tmp/rp-front-${stamp}.tgz`]) !== 0) fail('scp фронта упал')

  step('Фронт: распаковка и переключение')
  const sh = `set -euo pipefail
R=/var/www/releases/${stamp}
mkdir -p "$R"
tar -xzf /tmp/rp-front-${stamp}.tgz -C "$R" --no-same-owner
rm -f /tmp/rp-front-${stamp}.tgz
find "$R" -name '*.map' -delete
chmod -R u=rwX,go=rX "$R"
ln -sfn "$R" /var/www/rightplace.new && mv -Tf /var/www/rightplace.new /var/www/rightplace
cur=$(readlink -f /var/www/rightplace)
ls -1dt /var/www/releases/*/ | sed 's#/$##' | { grep -vx "$cur" || true; } | tail -n +3 | xargs -r rm -rf
echo "  фронт: $(readlink /var/www/rightplace)"
echo "  хранится: $(ls /var/www/releases | tr '\\n' ' ')"
`
  writeFileSync(join(work, 'front.sh'), sh.replace(/\r/g, ''))
  if (remote('scp', ['-q', `${rel}/front.sh`, `${HOST}:/tmp/rp-front-${stamp}.sh`]) !== 0) fail('scp скрипта упал')
  if (remote('ssh', [HOST, `bash /tmp/rp-front-${stamp}.sh; c=$?; rm -f /tmp/rp-front-${stamp}.sh; exit $c`]) !== 0) fail('переключение фронта упало')
  console.log('✓ фронт выложен: https://rightplace-game.ru/')
}

// ---------- 3. сервер ----------
function deployServer() {
  step(`Сервер: git archive HEAD server (${head})`)
  const tgz = `${rel}/server.tgz`
  if (run('git', ['archive', '--format=tar.gz', '-o', tgz, 'HEAD', 'server']) !== 0) fail('git archive упал')
  if (remote('scp', ['-q', tgz, `${HOST}:/tmp/rp-server-${stamp}.tgz`]) !== 0) fail('scp сервера упал')

  const sh = `set -euo pipefail
TS=${stamp}
BASE=/opt/rightplace
R=$BASE/releases/$TS
PREV=$(readlink -f $BASE/current 2>/dev/null || true)
mkdir -p "$R"
tar -xzf /tmp/rp-server-$TS.tgz -C "$R" --strip-components=1 --no-same-owner
rm -f /tmp/rp-server-$TS.tgz
echo "${head}" > "$R/REVISION"
cd "$R"
# переменные окружения игры — только в этот процесс, на экран не выводятся
while IFS= read -r line || [ -n "$line" ]; do
  case "$line" in ''|'#'*) continue;; esac
  export "$line"
done < $BASE/.env

echo '--- npm ci'
npm ci --no-audit --no-fund --loglevel=error
echo '--- prisma generate'
npx prisma generate >/dev/null
echo '--- бэкап базы перед миграцией'
$BASE/bin/backup-db.sh predeploy
echo '--- prisma migrate deploy'
npx prisma migrate deploy
echo '--- build'
npm run build --silent
npm prune --omit=dev --no-audit --no-fund --loglevel=error
chmod -R u=rwX,go=rX "$R"

switch_to() { ln -sfn "$1" $BASE/current.new && mv -Tf $BASE/current.new $BASE/current; }
health() {
  for i in $(seq 1 30); do
    if curl -fsS --max-time 3 http://127.0.0.1:3000/health 2>/dev/null | grep -q '"status":"ok"'; then return 0; fi
    sleep 1
  done
  return 1
}
echo '--- переключение и перезапуск'
switch_to "$R"
systemctl restart rightplace
if health; then
  echo "  /health: ok, версия $TS (${head})"
else
  echo "✗ /health не ответил ok — откат"
  journalctl -u rightplace -n 30 --no-pager | sed -E 's/(key|token|secret|password)=[^ &"]+/\\1=***/gi' || true
  if [ -n "$PREV" ] && [ -d "$PREV" ]; then
    switch_to "$PREV"; systemctl restart rightplace
    health && echo "  откат на $(basename "$PREV"): /health ok" || echo "  ✗ и прошлая версия не поднялась"
  fi
  exit 1
fi
cur=$(readlink -f $BASE/current)
ls -1dt $BASE/releases/*/ | sed 's#/$##' | { grep -vx "$cur" || true; } | tail -n +3 | xargs -r rm -rf
echo "  хранится: $(ls $BASE/releases | tr '\\n' ' ')"
`
  writeFileSync(join(work, 'server.sh'), sh.replace(/\r/g, ''))
  if (remote('scp', ['-q', `${rel}/server.sh`, `${HOST}:/tmp/rp-server-${stamp}.sh`]) !== 0) fail('scp скрипта упал')
  step('Сервер: установка, миграции, запуск')
  if (remote('ssh', [HOST, `bash /tmp/rp-server-${stamp}.sh; c=$?; rm -f /tmp/rp-server-${stamp}.sh; exit $c`]) !== 0) {
    fail('деплой сервера не прошёл (см. выше). Если был откат — работает прошлая версия.')
  }
  console.log('✓ сервер выложен: https://api.rightplace-game.ru/health')
}

if (what === 'all' || what === 'server') deployServer()
if (what === 'all' || what === 'front') deployFront()
console.log(`\nГотово (${what}, коммит ${head}). В Telegram: ••• → Reload Page.`)
