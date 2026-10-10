import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SessionId } from '@deepseek-ai/dsh-session'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import { checkVersions, createHost, mountFile } from '../preset-runtime/harness.mjs'
import * as WebReadonly from './web-readonly.mjs'

checkVersions()
const directory = await mkdtemp(join(tmpdir(), 'dsh-review-'))
const previousHome = process.env.DSH_HOME
process.env.DSH_HOME = directory
const filename = join(directory, 'evidence.txt')
await writeFile(filename, 'review evidence: no mutations\n')
let ctx
const watchdog = setTimeout(() => { console.error('Preset experiment timed out'); process.exit(1) }, 15000)
try {
  ctx = await createHost(new URL('.', import.meta.url).href, directory, { preset: true })
  await mountFile(ctx, fileURLToPath(new URL('./preset.yml', import.meta.url)))
  const roster = await ctx.agentPresets.list()
  assert.deepEqual(roster.map(row => row.id), ['review-config'])
  assert.equal(roster[0].broken, undefined, 'all preset rows activated')
  const createAgent = async (id, restrict) => (await ctx.agents.create({
    sessionId: SessionId(id),
    meta: { cwd: directory },
    setup: async agentCtx => {
      await ctx.agentPresets.mount(agentCtx, 'review-config')
      if (restrict) agentCtx.tools.restrict({ allow: ['read'] })
    },
  })).agent
  const review = await createAgent('review', true)
  const baseline = await createAgent('baseline', false)
  const names = agent => ctx.tools.schemas(agent).map(tool => tool.name).sort()
  assert.deepEqual(names(baseline), ['edit', 'read', 'write'])
  assert.deepEqual(names(review), ['read'])
  assert.deepEqual(ctx.tools.schemas(), [], 'preset tools must not leak into the global view')
  const assembly = await ctx.systemPrompt.assemble({ agent: review, scope: review })
  assert.deepEqual(assembly.tools.map(tool => tool.name), ['read'])
  assert.match(renderPrompt(assembly), /You review code/)
  assert.doesNotMatch(renderPrompt(assembly), /before overwriting it with write/)
  const execute = (name, args) => ctx.tools.execute({
    agent: review, signal: new AbortController().signal,
    callId: ToolCallId(`review-${name}`), name, arguments: args,
  })
  const read = await execute('read', { file_path: filename })
  assert.equal(read.isError, false)
  assert.match(JSON.stringify(read.content), /review evidence/)
  const blocked = await execute('write', { file_path: filename, content: 'changed' })
  assert.equal(blocked.isError, true)
  assert.match(JSON.stringify(blocked.content), /unknown tool.*write/i)
  assert.equal(await readFile(filename, 'utf8'), 'review evidence: no mutations\n')
  assert.throws(() => review.ctx.tools.restrict({ allow: ['typo'] }), /unknown global tool/)
  assert.throws(() => ctx.tools.restrict({ allow: ['read'] }), /requires a scoped context/)
  console.log('PASS preset: Loader -> declaration -> Registry -> Agent; persona and read tool assembled')
  console.log('PASS restriction: baseline=edit,read,write; review=read; write dispatch rejected; file unchanged')
  // The same-scope registration exemption is deliberate. Register only; never execute a write.
  const liftOwn = review.ctx.tools.register(ctx.tools.get('write', baseline))
  assert.deepEqual(names(review), ['read', 'write'])
  liftOwn()
  assert.deepEqual(names(review), ['read'])
  assert.deepEqual(names(baseline), ['edit', 'read', 'write'])
  assert.deepEqual(ctx.agentPresets.inspectCompositions(review.ctx)[0].leakedServices, [])
  console.log('PASS boundary: own-scope registration survives restriction; lifting it restores read-only surface')
  const webHook = await ctx.plugin(WebReadonly)
  const webReview = await createAgent('web-review', false)
  assert.deepEqual(names(webReview), ['read'], 'Web creation hook applies the scoped filter')
  assert.deepEqual(names(baseline), ['edit', 'read', 'write'], 'existing Agent is not retroactively changed')
  const removeOther = await ctx.agentPresets.register({ id: 'other-web', plugins: [] })
  await ctx.agentPresets.select(webReview, 'other-web')
  assert.deepEqual(names(webReview), [], 'switching away removes the old composition')
  await ctx.agentPresets.select(webReview, 'review-config')
  assert.deepEqual(names(webReview), ['read'], 'blank-session selection reapplies the filter')
  await removeOther()
  await webHook.dispose()
  assert.deepEqual(names(webReview), ['edit', 'read', 'write'], 'unloading the hook revokes its filter')
  console.log('PASS Web hook: creation and blank-session switching filtered; existing Agent unchanged; unload revokes filter')
} finally {
  clearTimeout(watchdog)
  if (previousHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = previousHome
  try { if (ctx) await ctx.fiber.dispose() } finally { await rm(directory, { recursive: true, force: true }) }
}
