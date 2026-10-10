import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const requestedHome = process.argv[2] || process.env.DSH_HOME
if (!requestedHome) {
  throw new Error('Pass DSH_HOME as the first argument or environment variable')
}

const source = fileURLToPath(new URL('.', import.meta.url))
const target = resolve(requestedHome, 'column-plugins', 'delivery-gate')
mkdirSync(target, { recursive: true })

for (const name of ['preset.yml', 'delivery-gate.mjs']) {
  const from = join(source, name)
  const to = join(target, name)
  if (existsSync(to) && !readFileSync(from).equals(readFileSync(to))) {
    throw new Error(`refusing to overwrite a different file: ${to}`)
  }
  copyFileSync(from, to)
}

console.log(`Copied declaration to ${join(target, 'preset.yml')}. Include it explicitly in a 0.2.1-alpha.2 composition; no profile was changed.`)
