import { cpSync, mkdirSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const srcDir = join(here, '..', 'src', 'maps')
const destDir = join(here, '..', 'dist', 'maps')

mkdirSync(destDir, { recursive: true })
for (const file of readdirSync(srcDir)) {
  if (file.endsWith('.json')) {
    cpSync(join(srcDir, file), join(destDir, file))
  }
}
