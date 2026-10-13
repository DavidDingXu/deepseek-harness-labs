import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { setImmediate as nextEventLoopTurn } from 'node:timers/promises'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime, { LlmAdapter, ToolCallId, createUserMessage, createAssistantMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { Session, SessionId, ToolCallRecovery, interruptedTurnClosers, TOOL_NOT_STARTED, TOOL_OUTCOME_UNKNOWN } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'

// Only the adapter's responses and the demonstration tools are scripted.
// The registry, loop, inbox, stream assembly, session and scheduler are official npm code.
const require = createRequire(import.meta.url)
const expected = require('./package.json').dependencies
for (const [name, version] of Object.entries(expected)) {
  assert.equal(require(`${name}/package.json`).version, version, `${name} must match the pinned version`)
}

function deferred() {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}

function textChunks(text) {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

function callsChunks(calls) {
  return [
    ...calls.flatMap(({ id, name, args }, index) => [
      { type: 'block-start', index, blockType: 'tool-call' },
      { type: 'block-end', index, block: {
        type: 'tool-call', id: ToolCallId(id), name, arguments: JSON.stringify(args),
      } },
    ]),
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ]
}

class ScriptedAdapter extends LlmAdapter {
  requests = []
  constructor(script) { super(); this.script = [...script] }
  async resolveModel(provider, model) { return { provider, id: model, name: model } }
  async *stream(options) {
    this.requests.push(options)
    const response = this.script.shift()
    assert.ok(response, 'Unexpected model request: script exhausted')
    const chunks = typeof response === 'function' ? response(options) : response
    for await (const chunk of chunks) {
      options.signal?.throwIfAborted()
      yield chunk
    }
  }
}

async function mount(adapter) {
  const ctx = new Context()
  try {
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime, { mode: 'native' })
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(AgentLoop, { agents: [], maxParallelToolCalls: 2 })
    ctx.llm.registerAdapter(['scripted'], adapter)
    return ctx
  } catch (error) {
    await ctx.fiber.dispose()
    throw error
  }
}

function send(agent) {
  agent.followup(createUserMessage({
    content: [{ type: 'text', text: 'Run the fixed experiment.' }], source: { kind: 'user' },
  }))
}

const eventsOf = agent => agent.session.snapshotEvents()
const eventsNamed = (agent, name) => eventsOf(agent).filter(event => event.type === name)
const textOf = message => message.content.filter(block => block.type === 'text').map(block => block.text).join('')

function observe(ctx, agent) {
  const frames = []
  const order = []
  const errors = []
  ctx.on('session/event', (session, event) => {
    if (session === agent.session) order.push(`commit:${event.seq}`)
  })
  ctx.on('agent/assistant-stream', ({ agent: source, frame }) => {
    if (source !== agent) return
    frames.push(frame)
    if (frame.type === 'end') order.push(`live-end:${frame.outcome.seq}`)
  })
  ctx.on('agent/error', ({ agent: source, error }) => { if (source === agent) errors.push(error) })
  return { frames, order, errors }
}

function assertSettlements(agent, observation, expectedTypes) {
  const log = eventsOf(agent)
  const ends = observation.frames.filter(frame => frame.type === 'end')
  assert.deepEqual(ends.map(frame => frame.outcome.eventType), expectedTypes)
  assert.equal(observation.frames.filter(frame => frame.type === 'start').length, ends.length)
  assert.ok(observation.frames.some(frame => frame.type === 'chunk'))
  assert.equal(log.some(event => event.type === 'assistant/chunk'), false)
  for (const frame of ends) {
    assert.equal(frame.outcome.kind, 'committed')
    const settlement = log.find(event => event.seq === frame.outcome.seq)
    assert.equal(settlement.type, frame.outcome.eventType)
    assert.ok(settlement.data.stream.length > 0, 'Each settlement contains its compact stream')
    assert.ok(observation.order.indexOf(`commit:${settlement.seq}`)
      < observation.order.indexOf(`live-end:${settlement.seq}`), 'Commit precedes the live end frame')
  }
}

async function withRuntime(name, adapter, run) {
  // A deadline detects a broken gate or lifecycle contract; it does not drive successful ordering.
  const watchdog = setTimeout(() => {
    console.error(`FAIL ${name}: 15-second experiment deadline exceeded`)
    process.exit(1)
  }, 15_000)
  let ctx
  try {
    ctx = await mount(adapter)
    await run(ctx)
    assert.equal(adapter.script.length, 0, `${name}: unused scripted response`)
  } finally {
    if (ctx) await ctx.fiber.dispose()
    clearTimeout(watchdog)
  }
}

async function normalTurn() {
  let bodyCalls = 0
  const adapter = new ScriptedAdapter([
    callsChunks([{ id: 'sum-1', name: 'sum', args: { a: 19, b: 23 } }]),
    options => {
      const result = options.messages.find(message => message.role === 'tool')
      assert.ok(result, 'Second real request must include the tool result')
      assert.equal(result.toolCallId, 'sum-1', 'The result must belong to the requested call')
      assert.equal(textOf(result), '42')
      return textChunks(`Verified tool result: ${textOf(result)}`)
    },
  ])
  await withRuntime('normal', adapter, async ctx => {
    ctx.tools.register(defineTool({
      name: 'sum', description: 'Add two numbers for this deterministic experiment.',
      parameters: { a: { type: 'number', required: true }, b: { type: 'number', required: true } },
      output: { schema: { type: 'number' }, render: (_args, value) => [{ type: 'text', text: String(value) }] },
      async execute({ a, b }) { bodyCalls++; return a + b },
    }))
    const agent = await ctx.agentLoop.create(SessionId('normal'), { provider: 'scripted', model: 'fixed' })
    const observation = observe(ctx, agent)
    send(agent)
    await agent.whenIdle()
    assert.equal(bodyCalls, 1)
    assert.equal(adapter.requests.length, 2)
    assert.equal(eventsNamed(agent, 'turn/start').length, 1)
    assert.equal(eventsNamed(agent, 'turn/end').length, 1)
    assert.equal(eventsNamed(agent, 'step/start').length, 2)
    assert.equal(eventsNamed(agent, 'step/end').length, 2)
    assert.equal(eventsNamed(agent, 'tool/result').length, 1)
    assert.equal(eventsNamed(agent, 'tool/result')[0].data.message.toolCallId, 'sum-1')
    assert.equal(textOf(eventsNamed(agent, 'tool/result')[0].data.message), '42')
    assert.equal(eventsNamed(agent, 'assistant/attempt').length, 0)
    assert.equal(eventsNamed(agent, 'turn/end')[0].data.reason.kind, 'completed')
    assert.deepEqual(observation.errors, [])
    assertSettlements(agent, observation, ['assistant/message', 'assistant/message'])
    console.log(`PASS normal: tool=${textOf(eventsNamed(agent, 'tool/result')[0].data.message)}, turns=1, steps=2, requests=2, assistant/message=2, assistant/attempt=0`)
    console.log('  log: ' + eventsOf(agent).map(event => event.type).join(' -> '))
    console.log('  live: start/chunk/end; each end follows its Session commit; Session assistant/chunk=0')
  })
}

async function retryAttempt() {
  const adapter = new ScriptedAdapter([
    [{ type: 'finish', reason: { kind: 'error', failure: { message: 'scripted transient failure', code: 'SERVER_ERROR' } } }],
    textChunks('Retry completed'),
  ])
  await withRuntime('retry', adapter, async ctx => {
    let retries = 0
    ctx.on('agent/request-error', async ({ failure }, next) => {
      if (failure.code === 'SERVER_ERROR' && retries++ === 0) return { kind: 'retry' }
      return next()
    })
    const agent = await ctx.agentLoop.create(SessionId('retry'), { provider: 'scripted', model: 'fixed' })
    const observation = observe(ctx, agent)
    send(agent)
    await agent.whenIdle()
    assert.equal(retries, 1)
    assert.equal(adapter.requests.length, 2)
    assert.equal(eventsNamed(agent, 'user/message').length, 1, 'retry must not accept the input twice')
    const requestUsers = adapter.requests.map(request => request.messages.filter(message => message.role === 'user'))
    assert.equal(requestUsers[0].length, 1)
    assert.deepEqual(requestUsers[1], requestUsers[0], 'both attempts use the same single input')
    assert.equal(eventsNamed(agent, 'turn/start').length, 1)
    assert.equal(eventsNamed(agent, 'step/start').length, 1)
    assert.equal(eventsNamed(agent, 'step/end').length, 1)
    assert.equal(eventsNamed(agent, 'assistant/attempt').length, 1)
    assert.equal(eventsNamed(agent, 'assistant/message').length, 1)
    assert.equal(eventsNamed(agent, 'turn/end')[0].data.reason.kind, 'completed')
    assert.equal(agent.session.deriveMessages().filter(message => message.role === 'assistant').length, 1)
    assert.deepEqual(observation.errors, [])
    assertSettlements(agent, observation, ['assistant/attempt', 'assistant/message'])
    console.log('PASS retry: turns=1, steps=1, requests=2, accepted inputs=1, identical retry input, assistant/attempt=1, surface assistant messages=1')
  })
}

async function parallelOrder() {
  const gateA = deferred(), gateB = deferred(), bothStarted = deferred(), bFinished = deferred()
  const started = [], finished = [], observed = []
  const adapter = new ScriptedAdapter([
    callsChunks([
      { id: 'read-A', name: 'read_demo', args: { key: 'A' } },
      { id: 'read-B', name: 'read_demo', args: { key: 'B' } },
    ]),
    textChunks('Both reads completed'),
  ])
  await withRuntime('parallel', adapter, async ctx => {
    ctx.tools.register(defineTool({
      name: 'read_demo', description: 'Read a fixed value after a controlled gate.',
      parameters: { key: { type: 'string', required: true } },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      isConcurrencySafe: () => true,
      async execute({ key }) {
        assert.ok(key === 'A' || key === 'B')
        started.push(key)
        if (started.length === 2) bothStarted.resolve()
        await (key === 'A' ? gateA.promise : gateB.promise)
        finished.push(key)
        if (key === 'B') bFinished.resolve()
        return key
      },
    }))
    ctx.on('tools/result', (exec) => { observed.push(exec.callId) })
    const agent = await ctx.agentLoop.create(SessionId('parallel'), { provider: 'scripted', model: 'fixed' })
    const observation = observe(ctx, agent)
    try {
      send(agent)
      await bothStarted.promise
      assert.deepEqual(started, ['A', 'B'])
      gateB.resolve()
      await bFinished.promise
      // Drain B's promise continuations while A stays gated; no timing threshold is used.
      await nextEventLoopTurn()
      assert.deepEqual(finished, ['B'])
      assert.deepEqual(observed, [], 'B cannot cross unfinished A at tools/result')
      assert.equal(eventsNamed(agent, 'tool/result').length, 0)
      gateA.resolve()
      await agent.whenIdle()
      assert.deepEqual(finished, ['B', 'A'])
      assert.deepEqual(observed, ['read-A', 'read-B'])
      assert.deepEqual(eventsNamed(agent, 'tool/result').map(event => event.data.message.toolCallId), ['read-A', 'read-B'])
      assert.deepEqual(observation.errors, [])
      assertSettlements(agent, observation, ['assistant/message', 'assistant/message'])
      console.log('PASS parallel: body completion=B,A; tools/result=A,B; Session tool/result=A,B')
    } finally {
      gateA.resolve(); gateB.resolve()
    }
  })
}

async function cancelledStream() {
  const streaming = deferred()
  const adapter = new ScriptedAdapter([
    async function* (options) {
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: 'Visible prefix' }
      streaming.resolve()
      await new Promise((resolve, reject) => {
        const abort = () => reject(options.signal.reason)
        if (options.signal.aborted) abort()
        else options.signal.addEventListener('abort', abort, { once: true })
      })
    },
  ])
  await withRuntime('cancel', adapter, async ctx => {
    const agent = await ctx.agentLoop.create(SessionId('cancel'), { provider: 'scripted', model: 'fixed' })
    const observation = observe(ctx, agent)
    send(agent)
    await streaming.promise
    assert.equal(eventsNamed(agent, 'assistant/message').length, 0, 'Live text precedes message settlement')
    agent.cancel({ kind: 'user' })
    await agent.whenIdle()
    const messages = eventsNamed(agent, 'assistant/message')
    assert.equal(messages.length, 1)
    assert.equal(messages[0].data.interrupted, true)
    assert.equal(textOf(messages[0].data.message), 'Visible prefix')
    assert.equal(eventsNamed(agent, 'assistant/attempt').length, 0)
    assert.equal(eventsNamed(agent, 'turn/end')[0].data.reason.kind, 'aborted')
    assert.equal(eventsNamed(agent, 'step/end').length, 1)
    assertSettlements(agent, observation, ['assistant/message'])
    console.log('PASS cancel: interrupted=true, text="Visible prefix", turn=aborted, step closed')
  })
}

// Construct valid in-memory open tails; this is recovery-algorithm evidence, not a crash test.
async function recoveryAlgorithm() {
  for (const started of [false, true]) {
    const callId = ToolCallId(started ? 'started-call' : 'pending-call')
    const session = Session.create(SessionId(started ? 'recover-started' : 'recover-pending'))
    session.append('turn/start', { turn: 1 })
    session.append('step/start', { turn: 1, step: 1 })
    session.append('assistant/message', {
      turn: 1, step: 1, stream: [],
      message: createAssistantMessage({
        content: [{ type: 'tool-call', id: callId, name: 'demo_write', arguments: '{}' }],
        source: { provider: 'scripted', model: 'fixed' },
      }),
    }, { surfaceOp: 'append' })
    const call = started ? session.append('tool/call', {
      turn: 1, step: 1, callId, name: 'demo_write', arguments: '{}',
    }) : undefined
    const prefix = session.snapshotEvents()
    const tracker = new ToolCallRecovery()
    for (const event of prefix) tracker.observe(event)
    const candidates = tracker.results()
    const expectedCode = started ? TOOL_OUTCOME_UNKNOWN : TOOL_NOT_STARTED
    assert.equal(candidates.length, 1)
    assert.equal(candidates[0].data.error.code, expectedCode)
    assert.equal(candidates[0].data.message.isError, true)
    assert.deepEqual(candidates[0].sourceEventSeqs, call ? [call.seq] : undefined)
    const closers = interruptedTurnClosers(prefix)
    assert.deepEqual(closers.map(event => event.type), ['tool/result', 'step/end', 'turn/end'])
    assert.deepEqual(closers[0], candidates[0])
    assert.deepEqual(closers.map(event => event.seq), [prefix.length, prefix.length + 1, prefix.length + 2])
    assert.equal(closers.at(-1).data.reason.kind, 'interrupted')
    assert.equal(session.snapshotEvents(), prefix, 'Computing repair candidates must not mutate Session')
    for (const event of closers) {
      if (event.type === 'tool/result') {
        const accepted = session.append(event.type, event.data, {
          surfaceOp: event.surfaceOp,
          ...(event.sourceEventSeqs === undefined ? {} : { sourceEventSeqs: event.sourceEventSeqs }),
        })
        tracker.observe(accepted)
      } else session.append(event.type, event.data)
    }
    assert.deepEqual(tracker.results(), [])
    assert.deepEqual(interruptedTurnClosers(session.snapshotEvents()), [], 'A closed log needs no second repair')
    const results = session.deriveMessages().filter(message => message.role === 'tool')
    assert.equal(results.length, 1)
    assert.equal(results[0].isError, true)
    assert.deepEqual(session.snapshotEvents().slice(0, prefix.length), prefix, 'Original prefix must remain intact')
  }
  console.log('PASS recovery: no call=TOOL_NOT_STARTED; call without result=TOOL_OUTCOME_UNKNOWN')
  console.log('  closers: tool/result -> step/end -> turn/end; second repair=0; in-memory algorithm only')
}

const scenarios = { basic: normalTurn, retry: retryAttempt, order: parallelOrder, cancel: cancelledStream, recovery: recoveryAlgorithm }
const args = process.argv.slice(2)
assert.ok(args.length === 0 || (args.length === 2 && args[0] === '--scenario'),
  'Usage: node run.mjs [--scenario basic|retry|order|cancel|recovery|all]')
const selection = args[1] ?? 'all'
assert.ok(selection === 'all' || Object.hasOwn(scenarios, selection), `Unknown scenario: ${selection}`)
console.log('Runtime: dsh 0.2.1-alpha.2; Cordis 4.0.5-alpha.1; official npm packages')
const runs = selection === 'all' ? Object.values(scenarios) : [scenarios[selection]]
for (const run of runs) await run()
console.log(`All ${runs.length} experiments passed; every Context disposed; no profile or persistence files written.`)
