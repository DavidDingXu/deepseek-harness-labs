import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SessionStore from '@deepseek-ai/dsh-session'
import SessionProjections from '@deepseek-ai/dsh-session-projection'
import FileSystem from '@deepseek-ai/dsh-fs-local'
import Subprocess from '@deepseek-ai/dsh-subprocess-local'
import Sandbox from '@deepseek-ai/dsh-sandbox-local'
import SandboxPolicy from '@deepseek-ai/dsh-sandbox-policy'
import NodeRuntime from '@deepseek-ai/dsh-ptc-runtime-node'

const require = createRequire(import.meta.url)
for (const [name, version] of Object.entries(require('./package.json').dependencies)) {
  assert.equal(require(`${name}/package.json`).version, version, name)
}
const directory = await mkdtemp(join(tmpdir(), 'dsh-ptc-state-'))
const ctx = new Context()
try {
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjections)
  await ctx.plugin(FileSystem, { cwd: directory })
  await ctx.plugin(Subprocess)
  await ctx.plugin(Sandbox, {})
  // 这里只验证真实进程及内存寿命，不承诺 read-only 等 OS 约束已验证。
  await ctx.plugin(SandboxPolicy, { mode: 'danger-full-access', workspaceRoot: directory })

  const perCallFiber = await ctx.plugin(NodeRuntime)
  const perCall = ctx.ptcRuntime
  const first = await perCall.run(perCall.resolve({
    program: 'globalThis.retained = 17; return { value: retained, pid: process.pid };',
    bindings: [],
  }))
  assert.equal(first.error, undefined)
  assert.equal(first.value.value, 17)
  assert.notEqual(first.value.pid, process.pid)
  const second = await perCall.run(perCall.resolve({
    program: 'return { value: typeof retained, pid: process.pid };', bindings: [],
  }))
  assert.equal(second.error, undefined)
  assert.equal(second.value.value, 'undefined')
  assert.notEqual(second.value.pid, first.value.pid)
  assert.equal(perCall.programFormat, 'function-body')
  console.log('PASS per-call: actual child process changes; the second call cannot see the first variable')
  await perCallFiber.dispose()

  await ctx.plugin(NodeRuntime, { executionMode: 'persistent-in-memory' })
  const memory = ctx.ptcRuntime
  const owner = {}, anotherOwner = {}
  const run = (program, stateOwner = owner) => memory.run(memory.resolve({ program, bindings: [], stateOwner }))
  const stored = await run('let retained = 17; ({ value: retained, pid: process.pid })')
  assert.equal(stored.error, undefined)
  assert.equal(stored.value.value, 17)
  assert.notEqual(stored.value.pid, process.pid)
  const reused = await run('retained++; ({ value: retained, pid: process.pid })')
  assert.equal(reused.error, undefined)
  assert.deepEqual(reused.value, { value: 18, pid: stored.value.pid })
  assert.equal(memory.programFormat, 'repl')
  console.log('PASS persistent: the same owner reuses its process and reads the changed variable')

  const separate = await run('({ value: typeof retained, pid: process.pid })', anotherOwner)
  assert.equal(separate.error, undefined)
  assert.equal(separate.value.value, 'undefined')
  assert.notEqual(separate.value.pid, stored.value.pid)
  console.log('PASS owner: a second owner has a separate process and cannot see the first variable')

  const failed = await run('retained = 23; throw new Error("controlled evaluation failure")')
  assert.equal(failed.error.kind, 'exception')
  assert.equal((await run('retained')).value, 23)
  console.log('PASS exception: a failed evaluation can leave its earlier memory mutation in place')

  // 超时要终止执行环境，不能把“普通表达式异常”的保留规则套到这里。
  const timedOut = await memory.run(memory.resolve({
    program: 'while (true) {}', bindings: [], stateOwner: owner, timeoutMs: 50,
  }))
  assert.equal(timedOut.error.kind, 'timeout')
  assert.equal((await run('typeof retained')).value, 'undefined')
  console.log('PASS timeout: the terminated environment loses its retained variables')

  await run('let fresh = 31')

  await memory.release(owner)
  assert.equal((await run('typeof fresh')).value, 'undefined')
  await memory.release(owner)
  await memory.release(anotherOwner)
  console.log('PASS release: waiting for owner cleanup removes its retained state')

  // 需要本机具备官方 OS 沙箱后端，显式选择后才运行；不以进程分离冒充沙箱。
  if (process.argv.includes('--sandbox')) {
    const confinedOwner = {}
    const confined = program => memory.run(memory.resolve({
      program, bindings: [], stateOwner: confinedOwner,
      sandboxPolicy: { mode: 'read-only', workspaceRoot: directory },
    }))
    assert.equal((await confined('var count = 1; count')).value, 1)
    assert.equal((await confined('++count')).value, 2)
    const denied = await confined('await (await import("node:fs/promises")).writeFile("denied.txt", String(count))')
    assert.equal(denied.sandbox?.mode, 'read-only')
    assert.equal(denied.sandbox?.denied, true)
    await assert.rejects(readFile(join(directory, 'denied.txt')), { code: 'ENOENT' })
    assert.equal((await confined('count')).value, 2)
    await memory.release(confinedOwner)
    console.log('PASS sandbox: read-only retains variables, denies a real write, and creates no file')
  }
} finally {
  try { await ctx.fiber.dispose() } finally { await rm(directory, { recursive: true, force: true }) }
}
console.log('Official Node PTC provider, real child processes; no model call. OS confinement is checked only with --sandbox.')
