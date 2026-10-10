import assert from 'node:assert/strict'
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { defineTool } from '@deepseek-ai/dsh-tools'
import * as DeliveryGate from './delivery-gate.mjs'
import { withRuntime, textOutput } from '../review-plugin/runtime-fixture.mjs'

const directory = await mkdtemp(join(tmpdir(), 'dsh-gate-runtime-'))
function processResult(program, args) {
  const result = spawnSync(program, args, { cwd: directory, encoding: 'utf8', timeout: 10_000 })
  if (result.error) throw result.error
  return { kind: 'foreground', exitCode: result.status, timedOut: false, aborted: false }
}
try {
  await cp(new URL('./fixture/', import.meta.url), directory, { recursive: true })
  assert.equal(processResult('git', ['init', '-q']).exitCode, 0)
  assert.equal(processResult('git', ['add', '.']).exitCode, 0)
  await withRuntime(async ({ ctx, createAgent, execute }) => {
    // The gate is real; these small tools are fixtures, not dsh-tool-bash/dsh-tool-fs.
    // No isConcurrencySafe flag: both retain the runtime's exclusive classification.
    ctx.tools.register(defineTool({
      name: 'bash', description: 'Fixture executor for two exact commands; no shell parsing',
      parameters: { command: { type: 'string', required: true } }, output: textOutput({ type: 'json' }),
      async execute({ command }) {
        if (command === 'node --test') return processResult(process.execPath, ['--test'])
        if (command === 'git diff --check') return processResult('git', ['diff', '--check'])
        throw new Error('Fixture accepts only the two declared commands')
      },
    }))
    ctx.tools.register(defineTool({
      name: 'write', description: 'Write only the temporary sum fixture',
      parameters: { content: { type: 'string', required: true } }, output: textOutput({ type: 'boolean' }),
      async execute({ content }) { await writeFile(join(directory, 'sum.mjs'), content); return true },
    }))
    const agent = await createAgent('delivery')
    // Web can create a blank Agent before selecting a preset that mounts this plugin.
    const fork = await ctx.plugin(DeliveryGate)
    const other = await createAgent('independent-delivery')
    ctx.on('tools/pre-execute', () => ({ kind: 'allow' }))
    const call = (name, args) => execute(agent, name, args)
    const status = async () => {
      const result = await call('delivery_status'); assert.equal(result.isError, false); return result.value
    }
    assert.equal((await call('finish_delivery')).isError, true)
    assert.deepEqual((await status()).checks.map(check => check.status), ['missing', 'missing'])
    await call('bash', { command: 'node --test' })
    assert.equal((await status()).checks[0].status, 'failed')
    assert.equal((await call('finish_delivery')).isError, true)
    const fixed = 'export function sum(a, b) { return a + b }\n'
    assert.equal((await call('write', { content: fixed })).isError, false)
    assert.equal((await status()).generation, 1)
    assert.equal((await status()).checks[0].status, 'stale')
    for (const command of ['node --test', 'git diff --check']) {
      const result = await call('bash', { command })
      assert.equal(result.isError, false)
      assert.equal(result.value.exitCode, 0)
    }
    const accepted = await call('finish_delivery')
    assert.equal(accepted.isError, false)
    assert.equal(accepted.value.ready, true)
    assert.equal((await execute(other, 'finish_delivery')).isError, true)
    assert.equal((await execute(undefined, 'finish_delivery')).isError, true)
    await call('write', { content: `${fixed}// later edit\n` })
    assert.deepEqual((await status()).checks.map(check => check.status), ['stale', 'stale'])
    assert.equal((await call('finish_delivery')).isError, true)
    await fork.dispose()
    assert.equal(ctx.tools.schemas(agent).some(tool => tool.name === 'finish_delivery'), false)
    console.log('PASS delivery: missing -> failed -> stale -> passed -> stale; finish denied/allowed/denied')
    console.log('  real child processes: failing Node test, passing Node test, git diff --check; independent Agent and missing owner denied')
    console.log('  registered plugin disposed; official ToolRuntime 0.2.1-alpha.2')
  })
} finally { await rm(directory, { recursive: true, force: true }) }
console.log('Temporary repository removed.')
