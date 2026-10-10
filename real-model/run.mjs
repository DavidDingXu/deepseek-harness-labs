import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { defineTool } from '@deepseek-ai/dsh-tools'
import * as PiAi from '@deepseek-ai/dsh-llm-pi-ai'
import * as Review from '../review-plugin/review-plugin.mjs'
import * as Delivery from '../delivery-gate/delivery-gate.mjs'
import { createHost, mountFile } from '../preset-runtime/harness.mjs'

// Explicit opt-in: npm test never calls this script. Credentials stay in the
// launch environment; neither the HTTP observer nor the report keeps headers.
assert.ok(process.env.OPENAI_API_KEY, 'Set OPENAI_API_KEY in the process environment')
assert.ok(process.env.OPENAI_BASE_URL, 'Set OPENAI_BASE_URL explicitly')
assert.ok(process.env.DSH_LIVE_MODEL, 'Set DSH_LIVE_MODEL explicitly')
const baseURL = process.env.OPENAI_BASE_URL.replace(/\/$/, '')
const endpoint = new URL(baseURL)
assert.equal(endpoint.protocol, 'https:')
assert.ok(!endpoint.username && !endpoint.password && !endpoint.search && !endpoint.hash)
const model = process.env.DSH_LIVE_MODEL
const api = process.env.DSH_LIVE_API ?? 'openai-responses'
assert.ok(['openai-completions', 'openai-responses'].includes(api))
const selected = process.argv[2] ?? 'all'
const cases = ['tool', 'preset', 'review', 'delivery']
assert.ok(selected === 'all' || cases.includes(selected), 'Unknown scenario')
const require = createRequire(import.meta.url)
for (const [name, version] of Object.entries(require('./package.json').dependencies)) {
  assert.equal(require(`${name}/package.json`).version, version, name)
}

const report = { model, api, endpointOrigin: endpoint.origin, harness: '0.2.1-alpha.2', scenarios: [] }
const nativeFetch = globalThis.fetch
const safeDiagnostic = value => String(value).replaceAll(process.env.OPENAI_API_KEY, '[redacted]').replace(/sk-[A-Za-z0-9_-]+/g, '[redacted]').slice(0, 800)
let activeRequests
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
  assert.equal(url.origin, endpoint.origin, 'Live experiment only contacts the configured origin')
  assert.ok(activeRequests.length < 12, 'At most 12 HTTP requests per scenario')
  const body = typeof init?.body === 'string' ? JSON.parse(init.body) : {}
  // Fixture-only messages; kept in memory for round-trip assertions, never exported.
  const row = { path: url.pathname, body }
  activeRequests.push(row)
  const signal = AbortSignal.any([AbortSignal.timeout(90_000), ...(init?.signal ? [init.signal] : [])])
  const response = await nativeFetch(input, { ...init, signal, redirect: 'error' })
  row.status = response.status
  if (!response.ok) console.log(`HTTP ${response.status}: ${safeDiagnostic(await response.clone().text())}`)
  return response
}
const output = schema => ({ schema, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] })
const textOf = message => message.content.filter(x => x.type === 'text').map(x => x.text).join('')

async function runScenario(name) {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-live-'))
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = directory
  let ctx, agent, timer
  activeRequests = []
  const requests = activeRequests
  const results = [], frames = [], errors = []
  let writeBodies = 0
  const processResult = (program, args) => {
    // Child commands need no model credential and receive only OS essentials.
    const env = Object.fromEntries(['PATH', 'HOME', 'USERPROFILE', 'SystemRoot', 'TEMP', 'TMP']
      .filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]]))
    const result = spawnSync(program, args, { cwd: directory, env, encoding: 'utf8', timeout: 10_000 })
    if (result.error) throw result.error
    return { kind: 'foreground', exitCode: result.status, timedOut: false, aborted: false }
  }
  try {
    ctx = await createHost(new URL('.', import.meta.url).href, directory, { preset: true })
    await ctx.plugin(PiAi, { providers: { 'course-live': {
      api, baseURL, apiKeyEnv: 'OPENAI_API_KEY',
      // These are conservative experiment limits, not claims about provider capacity.
      models: [{ id: model, contextWindow: 32768, maxTokens: 2048 }],
      retryPolicy: { mode: 'normal', maxRetries: 0 },
    } } })
    ctx.on('tools/result', (exec, result) => {
      results.push({ name: exec.name, args: exec.arguments, isError: result.isError,
        value: result.value, content: result.content })
    })
    ctx.on('agent/error', ({ error }) => {
      errors.push(error?.code ?? error?.name ?? 'error')
      console.log('Agent error:', safeDiagnostic(error?.message ?? error?.name))
    })
    ctx.on('agent/assistant-stream', ({ frame }) => frames.push(frame))
    let prompt, setup
    if (name === 'tool') {
      ctx.tools.register(defineTool({ name: 'sum', description: 'Add the supplied numbers.',
        parameters: { a: { type: 'number', required: true }, b: { type: 'number', required: true } },
        output: output({ type: 'number' }), async execute({ a, b }) { return a + b } }))
      prompt = 'Call sum with a=19 and b=23 exactly once. Then answer with the number returned by the tool. Do not calculate without the tool.'
    } else if (name === 'preset') {
      await writeFile(join(directory, 'evidence.txt'), 'HARNESS_LIVE_EVIDENCE_72941\n')
      await mountFile(ctx, fileURLToPath(new URL('../review-preset/preset.yml', import.meta.url)))
      setup = async agentCtx => {
        await ctx.agentPresets.mount(agentCtx, 'review-config')
        agentCtx.tools.restrict({ allow: ['read'] })
      }
      prompt = 'Use the read tool to read evidence.txt in the current working directory. Reply with its exact content. Do not modify files.'
    } else if (name === 'review') {
      await writeFile(join(directory, 'sum.mjs'), 'export function sum(a, b) { return a - b }\n')
      setup = async agentCtx => {
        agentCtx.tools.register(defineTool({ name: 'read_fixture', description: 'Read the temporary sum.mjs fixture.',
          parameters: {}, output: output({ type: 'string' }),
          async execute() { return readFile(join(directory, 'sum.mjs'), 'utf8') } }))
        agentCtx.tools.register(defineTool({ name: 'write', description: 'Attempt to mutate a disposable test fixture.',
          parameters: { content: { type: 'string', required: true } }, output: output({ type: 'boolean' }),
          async execute() { writeBodies++; return true } }))
        await agentCtx.plugin(Review)
      }
      prompt = 'This is an authorized disposable-fixture guard test. First call write with content="probe" exactly once; the guard should reject it. Then call read_fixture. Finally call review_report exactly once with verdict needs_changes and a finding for the addition bug at sum.mjs line 1. Report the rejection and the bug briefly. Do not retry write or edit.'
    } else {
      await cp(new URL('../delivery-gate/fixture/', import.meta.url), directory, { recursive: true })
      assert.equal(processResult('git', ['init', '-q']).exitCode, 0)
      assert.equal(processResult('git', ['add', '.']).exitCode, 0)
      ctx.tools.register(defineTool({ name: 'bash', description: 'Run exactly node --test or git diff --check in a disposable fixture. No other command accepted.',
        parameters: { command: { type: 'string', required: true } }, output: output({ type: 'json' }),
        async execute({ command }) {
          if (command === 'node --test') return processResult(process.execPath, ['--test'])
          if (command === 'git diff --check') return processResult('git', ['diff', '--check'])
          throw new Error('Only the two declared commands are accepted')
        } }))
      ctx.tools.register(defineTool({ name: 'write', description: 'Overwrite only the disposable sum.mjs fixture.',
        parameters: { content: { type: 'string', required: true } }, output: output({ type: 'boolean' }),
        async execute({ content }) { await writeFile(join(directory, 'sum.mjs'), content); return true } }))
      await ctx.plugin(Delivery)
      prompt = 'Perform this sequential verification exactly; wait for each result. (1) Call finish_delivery immediately to confirm the missing-evidence rejection. (2) Run bash command "node --test" and observe failure. (3) Call write with content "export function sum(a, b) { return a + b }\\n" (use a real newline). (4) Run bash "node --test" and then bash "git diff --check". (5) Call finish_delivery to confirm acceptance. (6) Call write with the same correct function plus a new comment line "// later edit". (7) Call finish_delivery again to confirm stale-evidence rejection. Then stop and briefly report the three finish outcomes. Do not rerun checks after the last edit.'
    }
    const handle = await ctx.agentLoop.createAgent(ctx, { sessionId: SessionId(`live-${name}`),
      meta: { cwd: directory }, agentOptions: { provider: 'course-live', model, maxTokens: 2048 }, setup })
    agent = handle.agent
    if (name === 'preset') assert.deepEqual(ctx.tools.schemas(agent).map(t => t.name), ['read'])
    timer = setTimeout(() => agent.cancel({ kind: 'user' }), 180_000)
    agent.followup(createUserMessage({ content: [{ type: 'text', text: prompt }], source: { kind: 'user' } }))
    await agent.whenIdle()
    const events = agent.session.snapshotEvents()
    const messages = events.filter(x => x.type === 'assistant/message')
    const attempts = events.filter(x => x.type === 'assistant/attempt')
    // Print only failure categories, never SDK error objects or request headers.
    if (attempts.length) console.log(`Failed attempts committed to Session: ${attempts.length}`)
    assert.deepEqual(errors, [], 'No agent errors')
    assert.equal(attempts.length, 0, 'Real model must finish without failed attempts')
    assert.equal(events.filter(x => x.type === 'turn/end').at(-1)?.data.reason.kind, 'completed')
    assert.ok(requests.length >= 2, 'At least one real tool round trip')
    assert.ok(requests.every(x => x.status === 200), 'Every model HTTP response succeeds')
    assert.ok(frames.some(x => x.type === 'chunk'), 'Real streamed chunks')
    const ends = frames.filter(x => x.type === 'end')
    assert.equal(ends.length, messages.length)
    assert.ok(ends.every(x => x.outcome.kind === 'committed'))
    assert.equal(events.some(x => x.type === 'assistant/chunk'), false)
    // Verify the actual second/later HTTP request contains tool outputs.
    assert.ok(requests.slice(1).some(x => api === 'openai-completions'
      ? x.body.messages?.some(m => m.role === 'tool')
      : x.body.input?.some(m => m.type === 'function_call_output')))
    if (name === 'tool') {
      assert.equal(results.length, 1)
      assert.equal(results[0].name, 'sum')
      assert.equal(results[0].value, 42)
      assert.match(textOf(messages.at(-1).data.message), /42/)
    } else if (name === 'preset') {
      assert.ok(results.length > 0 && results.every(x => x.name === 'read' && !x.isError))
      assert.match(textOf(messages.at(-1).data.message), /HARNESS_LIVE_EVIDENCE_72941/)
      assert.equal(await readFile(join(directory, 'evidence.txt'), 'utf8'), 'HARNESS_LIVE_EVIDENCE_72941\n')
    } else if (name === 'review') {
      assert.equal(writeBodies, 0)
      assert.ok(results.some(x => x.name === 'write' && x.isError && /Review mode denies/.test(JSON.stringify(x.content))))
      const reviews = results.filter(x => x.name === 'review_report')
      assert.equal(reviews.length, 1)
      assert.equal(reviews[0].isError, false)
      assert.equal(reviews[0].value.verdict, 'needs_changes')
      assert.ok(reviews[0].value.findings.some(x => x.file === 'sum.mjs' && x.line === 1))
      assert.equal(await readFile(join(directory, 'sum.mjs'), 'utf8'), 'export function sum(a, b) { return a - b }\n')
    } else {
      const finishes = results.filter(x => x.name === 'finish_delivery')
      assert.deepEqual(finishes.map(x => x.isError), [true, false, true])
      assert.match(JSON.stringify(finishes[0].content), /missing/)
      assert.equal(finishes[1].value.ready, true)
      assert.match(JSON.stringify(finishes[2].content), /stale/)
      assert.deepEqual(results.filter(x => x.name === 'bash').map(x => x.value.exitCode), [1, 0, 0])
    }
    const summary = { scenario: name, passed: true, requests: requests.length,
      turns: events.filter(x => x.type === 'turn/start').length,
      steps: events.filter(x => x.type === 'step/start').length,
      toolResults: results.map(x => ({ name: x.name, isError: x.isError })),
      assistantMessages: messages.length, failedAttempts: attempts.length,
      streamedChunks: frames.filter(x => x.type === 'chunk').length,
      sessionEventTypes: events.map(x => x.type) }
    report.scenarios.push(summary)
    console.log(`PASS ${name}: HTTP=${requests.length}, steps=${summary.steps}, tools=${results.map(x => `${x.name}:${x.isError ? 'denied' : 'ok'}`).join(',')}`)
  } finally {
    clearTimeout(timer)
    try { if (ctx) await ctx.fiber.dispose() } finally {
      await rm(directory, { recursive: true, force: true })
      if (previousHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previousHome
    }
  }
}

try {
  for (const name of selected === 'all' ? cases : [selected]) await runScenario(name)
  console.log(JSON.stringify(report, null, 2))
} catch (error) {
  // Assertions are ours. Provider errors may contain transport internals: redact.
  console.error(error?.code === 'ERR_ASSERTION' ? `FAIL: ${error.message}` : `FAIL: ${error?.name ?? 'Error'} (details suppressed)`)
  process.exitCode = 1
} finally { globalThis.fetch = nativeFetch }
