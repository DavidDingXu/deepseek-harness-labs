import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createScope, scopeOf, scopeParentOf } from '@deepseek-ai/dsh-scope'
import { checkVersions, createHost } from '../preset-runtime/harness.mjs'
import { lifecycle } from './revision-plugin.mjs'

checkVersions()
const directory = await mkdtemp(join(tmpdir(), 'dsh-generation-'))
const previousHome = process.env.DSH_HOME
process.env.DSH_HOME = directory
let ctx
const scopes = []
const definitions = []
try {
  ctx = await createHost(new URL('.', import.meta.url).href, directory, { preset: true })
  const registry = ctx.agentPresets
  const declare = async revision => {
    const dispose = await registry.register({
      id: 'review-config',
      plugins: [{ name: new URL('./revision-plugin.mjs', import.meta.url).href, config: { revision } }],
    })
    definitions.push(dispose)
    const declaration = await registry.resolve('review-config')
    assert.equal(declaration.broken, undefined)
    return dispose
  }
  const scope = () => { const value = createScope(ctx, {}); scopes.push(value); return value }
  const names = value => ctx.tools.schemas(scopeOf(value.ctx)).map(tool => tool.name)
  const generation = value => scopeParentOf(scopeOf(value.ctx))
  const retained = () => registry.inspectCompositions().length

  const retireG1 = await declare('G1')
  const parent = scope()
  await registry.mount(parent.ctx, 'review-config')
  const g1 = generation(parent)
  assert.ok(g1)
  assert.deepEqual(names(parent), ['revision_G1'])

  // Replacing the definition retires G1; the existing scope still retains it.
  await retireG1()
  assert.equal(retained(), 1)
  assert.deepEqual(lifecycle, ['mount:G1'])
  const retireG2 = await declare('G2')
  const fresh = scope()
  await registry.mount(fresh.ctx, 'review-config')
  assert.notEqual(generation(fresh), g1)
  assert.deepEqual(names(fresh), ['revision_G2'])
  assert.deepEqual(names(parent), ['revision_G1'])
  assert.equal(retained(), 2)
  assert.deepEqual(ctx.tools.schemas(), [], 'Neither generation leaks tools into the Host')
  console.log('PASS replacement: parent=G1; fresh=G2; retained generations=2')

  const child = scope()
  assert.equal(registry.composeFrom(child.ctx, parent.ctx), 'review-config')
  assert.equal(generation(child), g1, 'Child joins the exact old generation, not the current preset name')
  assert.deepEqual(names(child), ['revision_G1'])
  assert.throws(() => registry.composeFrom(child.ctx, parent.ctx), /already joined/)
  assert.throws(() => registry.composeFrom(ctx, parent.ctx), /requires a scope/)
  assert.deepEqual(lifecycle, ['mount:G1', 'mount:G2'], 'Joining a child does not remount G1')
  console.log('PASS composeFrom: child=G1; exact generation identity matched; duplicate/unscoped joins rejected')

  await parent.dispose()
  assert.equal(retained(), 2)
  assert.deepEqual(names(child), ['revision_G1'])
  assert.equal(lifecycle.includes('dispose:G1'), false)
  console.log('PASS parent scope released: child still retains G1; G1 disposer has not run')
  await child.dispose()
  assert.equal(retained(), 1)
  assert.deepEqual(lifecycle, ['mount:G1', 'mount:G2', 'dispose:G1'])
  assert.deepEqual(names(fresh), ['revision_G2'])
  console.log('PASS last G1 scope released: G1 collected; G2 tool remains visible')

  await fresh.dispose()
  assert.equal(retained(), 1, 'No users is insufficient while the declaration is current')
  assert.equal(lifecycle.includes('dispose:G2'), false)
  await retireG2()
  assert.equal(retained(), 0)
  assert.deepEqual(lifecycle, ['mount:G1', 'mount:G2', 'dispose:G1', 'dispose:G2'])
  console.log('PASS collection: current G2 survives zero users; retiring it runs its disposer; retained=0')
} finally {
  try {
    for (const value of scopes.reverse()) await value.dispose()
    for (const dispose of definitions.reverse()) await dispose()
  } finally {
    try { if (ctx) await ctx.fiber.dispose() } finally {
      if (previousHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previousHome
      await rm(directory, { recursive: true, force: true })
    }
  }
}
console.log('All generation checks passed; no model or SubagentManager run; temporary directory removed.')
