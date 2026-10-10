import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const source = fileURLToPath(new URL('./fixture', import.meta.url))
const requested = process.argv[2]
const target = requested === undefined
  ? mkdtempSync(join(tmpdir(), 'dsh-delivery-fixture-'))
  : resolve(requested)

if (requested !== undefined) {
  if (existsSync(target) && readdirSync(target).length > 0) {
    throw new Error(`refusing to populate a non-empty directory: ${target}`)
  }
  mkdirSync(target, { recursive: true })
}

cpSync(source, target, { recursive: true })

function git(...args) {
  const result = spawnSync('git', args, { cwd: target, encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed:\n${result.stdout}\n${result.stderr}`)
  }
}

git('init', '-q')
git('config', 'user.name', 'DSH Delivery Lab')
git('config', 'user.email', 'delivery-lab@example.invalid')
git('add', '.')
git('commit', '-qm', 'seed failing delivery fixture')

console.log(target)
