import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime, { LlmAdapter, createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { Session, SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import BasicCompactionEngine from '@deepseek-ai/dsh-compaction-basic'

const require = createRequire(import.meta.url)
for (const [name, version] of Object.entries(require('./package.json').dependencies)) {
  assert.equal(require(`${name}/package.json`).version, version, name)
}

const HISTORY = 'ORIGINAL-EVIDENCE: retain decisions, pending tasks and exact file paths. '.repeat(100)
const SUMMARY = 'Checkpoint: inspect src/main.ts; the review is still pending.'
const textOf = messages => messages.flatMap(message => message.content)
  .filter(block => block.type === 'text').map(block => block.text).join('\n')

const deferred = () => {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}

class ScriptedAdapter extends LlmAdapter {
  requests = []
  constructor(scenario) {
    super()
    this.scenario = scenario
    this.summaryEntered = deferred()
    this.releaseSummary = deferred()
  }
  async resolveModel(provider, model) {
    return { provider, id: model, name: model, context: { contextWindow: 100000 } }
  }
  async *stream(options) {
    this.requests.push(options)
    const summary = options.purpose === 'compaction'
    if (summary) {
      // The real summarizer must pass replayed evidence and append its own directive.
      assert.match(textOf(options.messages.slice(0, -1)), /ORIGINAL-EVIDENCE/)
      assert.match(textOf(options.messages.slice(-1)), /compaction engine/)
      if (this.scenario === 'failure') throw new Error('scripted summary failure')
      if (this.scenario === 'changed') {
        this.summaryEntered.resolve()
        await this.releaseSummary.promise
      }
    }
    const text = summary ? SUMMARY : 'Review acknowledged.'
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text }
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

async function run(scenario) {
  const failSummary = scenario === 'failure'
  const ctx = new Context()
  const adapter = new ScriptedAdapter(scenario)
  try {
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime, { mode: 'native' })
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(AgentLoop, { agents: [] })
    await ctx.plugin(TokenMeter)
    await ctx.plugin(BasicCompactionEngine, { auto: false, compactionRetries: 0 })
    ctx.llm.registerAdapter(['scripted'], adapter)
    const agent = await ctx.agentLoop.create(SessionId(`summary-${scenario}`), {
      provider: 'scripted', model: 'fixture',
    })
    agent.followup(createUserMessage({
      source: { kind: 'user' }, content: [{ type: 'text', text: HISTORY }],
    }))
    await agent.whenIdle()
    const session = agent.session
    assert.equal(adapter.requests.length, 1, 'one real loop request builds the history')
    const beforeLog = session.snapshotEvents()
    const beforeSurface = [...session.surface.nodes]
    const beforeMessages = session.deriveMessages()
    const signal = new AbortController().signal
    let result, competingEvent, changedSurface, changedMessages
    if (scenario === 'changed') {
      // Keep the production summarizer pending, then replace a selected user node.
      const rejected = assert.rejects(ctx.compaction.compactNow(agent, signal), error => {
        assert.equal(error.code, 'changed')
        return true
      })
      await adapter.summaryEntered.promise
      try {
        const selected = beforeLog.find(event => event.type === 'user/message')
        assert.ok(selected && beforeSurface.includes(selected.seq))
        session.append('user/message', createUserMessage({
          source: { kind: 'rival' },
          content: [{ type: 'text', text: 'UPDATED-EVIDENCE: tests now fail; inspect the new failure.' }],
        }), {
          surfaceOp: { op: 'replace', startSeq: selected.seq, endSeq: selected.seq },
          sourceEventSeqs: [selected.seq],
        })
        competingEvent = session.snapshotEvents().at(-1)
        changedSurface = [...session.surface.nodes]
        changedMessages = session.deriveMessages()
      } finally {
        adapter.releaseSummary.resolve()
      }
      await rejected
    } else if (failSummary) {
      await assert.rejects(ctx.compaction.compactNow(agent, signal), error => {
        assert.equal(error.code, 'summary')
        assert.match(String(error.cause), /scripted summary failure/)
        return true
      })
    } else {
      result = await ctx.compaction.compactNow(agent, signal)
      assert.ok(result, 'manual compaction found a useful range')
    }
    const log = session.snapshotEvents()
    const added = log.slice(beforeLog.length)
    assert.deepEqual(log.slice(0, beforeLog.length), beforeLog, 'compaction retains every old event unchanged')
    assert.equal(adapter.requests.filter(request => request.purpose === 'compaction').length, 1)
    assert.equal(added.filter(event => event.type === 'compaction/start').length, 1)
    const end = added.find(event => event.type === 'compaction/end')
    assert.ok(end, 'the maintenance operation closes its lifecycle')
    assert.equal(end.data.turn, null, 'manual compaction does not pretend to be an active turn')
    const replacements = added.filter(event => typeof event.surfaceOp === 'object' && event.surfaceOp.op === 'replace')
    if (scenario === 'changed') {
      assert.equal(added.some(event => event.type === 'compaction/summary'), false)
      assert.deepEqual(replacements, [competingEvent], 'only the competing edit changes the surface')
      assert.deepEqual(session.surface.nodes, changedSurface)
      assert.deepEqual(session.deriveMessages(), changedMessages)
      assert.match(textOf(changedMessages), /UPDATED-EVIDENCE/)
      assert.doesNotMatch(textOf(changedMessages), /Checkpoint:|ORIGINAL-EVIDENCE/)
      assert.ok(end.data.error)
      const replay = Session.create(SessionId('replayed-changed-history'), log)
      assert.deepEqual(replay.surface.nodes, changedSurface)
      assert.deepEqual(replay.deriveMessages(), changedMessages)
      console.log('PASS changed: selected history replaced while summary waits; stale summary rejected; competing edit survives replay')
    } else if (failSummary) {
      assert.equal(added.some(event => event.type === 'compaction/summary'), false)
      assert.equal(replacements.length, 0)
      assert.deepEqual(session.surface.nodes, beforeSurface)
      assert.deepEqual(session.deriveMessages(), beforeMessages)
      assert.match(end.data.error, /scripted summary failure/)
      console.log('PASS failure: summary request rejected; surface unchanged; no summary or replacement; start/end closed')
    } else {
      const summary = added.find(event => event.type === 'compaction/summary')
      assert.ok(summary)
      assert.equal(summary.surfaceOp, undefined, 'summary itself is log-only')
      assert.equal(session.surface.nodes.includes(summary.seq), false)
      assert.equal(summary.data.llmStreamCall, true, 'the official summarizer called the LLM seam')
      assert.deepEqual(summary.data.shadowedSeqs, result.shadowedSeqs)
      assert.equal(replacements.length, 1)
      const replacement = replacements[0]
      assert.equal(replacement.type, 'user/message')
      assert.ok(replacement.sourceEventSeqs.includes(summary.seq))
      assert.ok(session.surface.nodes.includes(replacement.seq))
      for (const seq of result.shadowedSeqs) {
        assert.ok(beforeSurface.includes(seq))
        assert.equal(session.surface.nodes.includes(seq), false)
        assert.ok(log.some(event => event.seq === seq), 'shadowed events remain in the log')
      }
      assert.match(textOf(session.deriveMessages()), /<compacted-summary>/)
      assert.match(textOf(session.deriveMessages()), /review is still pending/)
      assert.doesNotMatch(textOf(session.deriveMessages()), /ORIGINAL-EVIDENCE/)
      assert.ok(result.shadowedTokenCount > 0)
      const replay = Session.create(SessionId('replayed-compaction'), log)
      assert.deepEqual(replay.deriveMessages(), session.deriveMessages())
      assert.deepEqual(replay.surface.nodes, session.surface.nodes)
      assert.equal(end.data.error, undefined)
      console.log('PASS success: real BasicCompactionEngine + scripted LLM; summary=log-only; user/message=replace')
      console.log('PASS history: original log prefix unchanged; shadowed nodes leave surface; replay derives the same messages')
      console.log(`  appended: ${added.map(event => event.type).join(' -> ')}`)
    }
  } finally {
    await ctx.fiber.dispose()
  }
}

const watchdog = setTimeout(() => { console.error('Compaction experiment timed out'); process.exit(1) }, 15000)
try {
  await run('success')
  await run('failure')
  await run('changed')
  console.log('All 3 compaction experiments passed; no model network call or persistence backend.')
} finally { clearTimeout(watchdog) }
