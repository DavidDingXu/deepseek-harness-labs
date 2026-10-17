import assert from 'node:assert/strict'
import * as ReviewPlugin from './review-plugin.mjs'
import { withRuntime, textOutput } from './runtime-fixture.mjs'

await withRuntime(async ({ ctx, createAgent, execute }) => {
  const agent = await createAgent('review')
  const other = await createAgent('other')
  let writes = 0
  // Register in the same Agent scope as the guard: restrict() cannot mask these local tools.
  for (const name of ['write', 'edit']) agent.ctx.tools.register({
    name, description: 'Count fixture mutations; no filesystem write', parameters: {},
    output: textOutput({ type: 'integer' }), async execute() { return ++writes },
  })
  other.ctx.tools.register({
    name: 'write', description: 'Independent scope fixture', parameters: {},
    output: textOutput({ type: 'integer' }), async execute() { return ++writes },
  })
  const fork = await agent.ctx.plugin(ReviewPlugin)
  // Even a waterfall listener returning allow cannot override a guard denial.
  ctx.on('tools/pre-execute', () => ({ kind: 'allow' }))
  assert.ok(ctx.tools.schemas(agent).some(tool => tool.name === 'write'))
  for (const name of ['write', 'edit']) {
    const result = await execute(agent, name)
    assert.equal(result.isError, true)
    assert.match(JSON.stringify(result.content), /Review mode denies/)
  }
  assert.equal(writes, 0)
  const report = { verdict: 'needs_changes', summary: 'Missing validation', findings: [
    { severity: 'high', file: 'sum.mjs', line: 1, problem: 'Input is not checked' },
  ] }
  const result = await execute(agent, 'review_report', report)
  assert.equal(result.isError, false)
  assert.deepEqual(result.value, report)
  assert.match(result.content[0].text, /1 finding/)
  assert.equal((await execute(agent, 'review_report', { ...report, verdict: 'invalid' })).isError, true)
  assert.equal((await execute(other, 'write')).isError, false)
  assert.equal(writes, 1)
  await fork.dispose()
  assert.equal(ctx.tools.schemas(agent).some(tool => tool.name === 'review_report'), false)
  assert.equal((await execute(agent, 'write')).isError, false)
  assert.equal(writes, 2)
  console.log('PASS review: schema validated; local write/edit denied before body; other Agent allowed; disposal restores write')
})
console.log('Official runtime 0.2.1-rc.2; no model, Web, filesystem or persistence experiment.')
