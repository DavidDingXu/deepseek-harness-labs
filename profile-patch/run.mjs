import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { load } from 'js-yaml'
import { renderConfigDump } from '@deepseek-ai/dsh-app-boot'
import { applyEntryPatches } from '@deepseek-ai/cordis-plugin-include'
import { SessionId } from '@deepseek-ai/dsh-session'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { checkVersions, createHost, mountFile } from '../preset-runtime/harness.mjs'

checkVersions()
const directory = await mkdtemp(join(tmpdir(), 'dsh-profile-'))
const previousHome = process.env.DSH_HOME
process.env.DSH_HOME = directory
const base = await readFile(new URL('./base.cordis.yml', import.meta.url), 'utf8')
const basePath = join(directory, 'base.cordis.yml')
const patch = load(await readFile(new URL('./session-title.patch.yml', import.meta.url), 'utf8'))
await writeFile(basePath, base)
const warnings = []
const before = load(renderConfigDump('profile-lab', basePath, [], warning => warnings.push(warning)))
const after = load(renderConfigDump('profile-lab', basePath, [{ label: 'experiment overlay', patches: patch }], warning => warnings.push(warning)))
assert.equal(before[0].config.fallbackMaxWords, 5)
assert.equal(after[0].config.fallbackMaxWords, 9)
assert.deepEqual(warnings, [])
const sparse = applyEntryPatches(load(base), [{ id: 'session-title', config: { fallbackMaxWords: 9 } }])
assert.deepEqual(sparse[0].config, { fallbackMaxWords: 9 }, 'config replaces the entire object')
const titles = []
try {
  for (const index of [0, 1]) {
    // The temp file contains package names; resolve them relative to this installed lab.
    const ctx = await createHost(new URL('.', import.meta.url).href, directory)
    try {
      // Include changes baseUrl to its file directory, so use an absolute official module URL.
      const runtimeRows = structuredClone(before)
      runtimeRows[0].name = import.meta.resolve('@deepseek-ai/dsh-session-title')
      const runtimePath = join(directory, `runtime-${index}.yml`)
      await writeFile(runtimePath, JSON.stringify(runtimeRows))
      const tree = await mountFile(ctx, runtimePath, index === 0 ? [] : patch)
      assert.deepEqual(tree.resolve('session-title').options.config, (index === 0 ? before : after)[0].config)
      const session = ctx.sessions.create(SessionId(`title-${index}`))
      session.append('turn/start', { turn: 1 })
      session.append('user/message', createUserMessage({
        source: { kind: 'user' }, content: [{ type: 'text', text: 'a b c d e f g h i j' }],
      }), { surfaceOp: 'append' })
      const snapshot = await ctx.sessionTitle.refresh(session)
      titles.push(snapshot.title)
      assert.equal(snapshot.source.kind, 'fallback')
    } finally { await ctx.fiber.dispose() }
  }
  assert.deepEqual(titles, ['a b c d e', 'a b c d e f g h i'])
  assert.equal(await readFile(basePath, 'utf8'), base)
  assert.equal(await readFile(new URL('./base.cordis.yml', import.meta.url), 'utf8'), base)
  console.log('PASS patch: official renderConfigDump fallbackMaxWords=5 -> 9; whole config replacement asserted')
  console.log(`PASS activation: real sessionTitle fallback="${titles[0]}" -> "${titles[1]}"; no model provider`)
  console.log('PASS isolation: temporary DSH_HOME; source and copied base unchanged; runtime disposed')
} finally {
  if (previousHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = previousHome
  await rm(directory, { recursive: true, force: true })
}
