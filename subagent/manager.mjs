import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LlmAdapter } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import * as Spawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import * as Fork from '@deepseek-ai/dsh-subagent-fork-in-process'
import { createHost } from '../preset-runtime/harness.mjs'

const require = createRequire(import.meta.url)
for (const [name, version] of Object.entries(require('./package.json').dependencies)) {
  assert.equal(require(`${name}/package.json`).version, version, name)
}

// 模型只返回预定文本；记录的工具表来自官方 Loop 真正发出的子请求。
class ScriptedAdapter extends LlmAdapter {
  requests = []
  async resolveModel(provider, model) { return { provider, id: model, name: model } }
  async *stream(options) {
    this.requests.push(options)
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: 'done' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'done' } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

const directory = await mkdtemp(join(tmpdir(), 'dsh-child-composition-'))
const previousHome = process.env.DSH_HOME
process.env.DSH_HOME = directory
let ctx
try {
  ctx = await createHost(new URL('.', import.meta.url).href, directory, { preset: true })
  await ctx.plugin(SubagentRuntime)
  await ctx.plugin(Spawn, { providerName: 'spawn' })
  await ctx.plugin(Fork, { providerName: 'fork' })
  const adapter = new ScriptedAdapter()
  ctx.llm.registerAdapter(['script'], adapter)
  const publishedSessions = []
  ctx.on('session/created', session => { publishedSessions.push(session.id) })
  const createdEvents = new Map()
  ctx.on('agent/created', ({ agent }) => {
    // setup 在发布前追加的选择与描述不会重放到 session/event。
    // 创建完成时直接取得真实 Session 的自有日志，不能用实时通知代替它。
    const session = agent.session
    createdEvents.set(agent.id, session.snapshotEvents().slice(session.inheritedEventCount))
  })
  const events = new Map()
  ctx.on('session/event', (session, event) => {
    const own = events.get(session.id) ?? []
    own.push(event)
    events.set(session.id, own)
  })
  const register = revision => ctx.agentPresets.register({
    id: 'review-config',
    plugins: [{ name: new URL('./revision-plugin.mjs', import.meta.url).href, config: { revision } }],
  })
  const retireG1 = await register('G1')
  const parentHandle = await ctx.agents.create({
    sessionId: SessionId('parent'),
    meta: { agentPreset: 'review-config' },
    agentOptions: { provider: 'script', model: 'script' },
    setup: async childCtx => { await ctx.agentPresets.mount(childCtx, 'review-config') },
  })
  const parent = parentHandle.agent
  await retireG1()
  await register('G2')

  const start = (provider, agentPreset) => ctx.subagents.startActivation({
    provider,
    label: 'composition probe',
    delivery: 'caller',
    request: {
      parent,
      prompt: [{ type: 'text', text: 'Reply done without calling a tool.' }],
      ...(agentPreset === undefined ? {} : { agentPreset }),
    },
    signal: new AbortController().signal,
  })
  const toolNames = () => adapter.requests.at(-1).tools.map(tool => tool.name)

  const independent = await start('spawn', 'review-config')
  try {
    await independent.result
    assert.deepEqual(toolNames(), ['revision_G2'])
    const own = createdEvents.get(independent.childId)
    assert.ok(own, 'The child must have been published through the real Agent registry')
    const selected = own.findIndex(event => event.type === 'agent-preset/selected')
    const descriptor = own.findIndex(event => event.type === 'subagent/descriptor')
    assert.ok(selected >= 0 && selected < descriptor,
      'The independent selection must precede the descriptor in the actual child log')
    assert.equal(own[selected].data.agentPreset, 'review-config')
    assert.equal(own.filter(event => event.type === 'agent-preset/selected').length, 1)
    assert.equal(own.some(event => event.type === 'turn/start'), false,
      'Creation metadata must already exist before the child starts its turn')
    assert.equal(events.get(independent.childId).some(event =>
      event.type === 'agent-preset/selected' || event.type === 'subagent/descriptor'), false,
    'Pre-publication metadata is in the log but is not replayed into the live append feed')
  } finally { await independent.dispose() }
  console.log('PASS independent: explicit same preset id uses G2; selection precedes the child descriptor')

  const inherited = await start('spawn')
  try {
    await inherited.result
    assert.deepEqual(toolNames(), ['revision_G1'])
    assert.equal(createdEvents.get(inherited.childId).some(event => event.type === 'agent-preset/selected'), false)
  } finally { await inherited.dispose() }
  assert.deepEqual(ctx.tools.schemas(parent).map(tool => tool.name), ['revision_G1'])
  console.log('PASS inherited: omitted preset uses parent G1; parent tools remain unchanged')

  const beforeRequests = adapter.requests.length
  const beforeSessions = ctx.sessions.list().length
  const beforePublishedSessions = [...publishedSessions]
  const beforePublishedAgents = createdEvents.size
  await assert.rejects(start('fork', 'review-config'), error => error.code === 'UNSUPPORTED_CAPABILITY')
  assert.equal(adapter.requests.length, beforeRequests)
  assert.equal(ctx.sessions.list().length, beforeSessions)
  assert.deepEqual(publishedSessions, beforePublishedSessions)
  assert.equal(createdEvents.size, beforePublishedAgents)
  assert.deepEqual(ctx.agents.list().map(agent => agent.id), [parent.id])
  console.log('PASS admission: fork rejects independent preset before creating a child or requesting the model')
} finally {
  try { if (ctx) await ctx.fiber.dispose() } finally {
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    await rm(directory, { recursive: true, force: true })
  }
}
console.log('Real SubagentManager and spawn/fork providers; scripted model; no network or disk persistence.')
