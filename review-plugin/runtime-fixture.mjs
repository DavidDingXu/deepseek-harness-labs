import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime, { LlmAdapter, ToolCallId } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'

class UnusedAdapter extends LlmAdapter {
  async resolveModel(provider, model) { return { provider, id: model, name: model } }
  async *stream() { throw new Error('This pipeline experiment must not request a model') }
}

export async function withRuntime(run) {
  const require = createRequire(import.meta.url)
  for (const name of ['agent', 'agent-loop', 'llm', 'session', 'session-projection', 'system-prompt', 'tools']) {
    assert.equal(require(`@deepseek-ai/dsh-${name}/package.json`).version, '0.2.1-rc.2')
  }
  assert.equal(require('@deepseek-ai/cordis/package.json').version, '4.0.5')
  const ctx = new Context()
  try {
    for (const plugin of [LlmRuntime, SessionStore, SessionProjectionRegistry, SystemPrompt]) await ctx.plugin(plugin)
    await ctx.plugin(ToolRuntime, { mode: 'native' })
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(AgentLoop, { agents: [] })
    ctx.llm.registerAdapter(['fixture'], new UnusedAdapter())
    let sequence = 0
    const createAgent = id => ctx.agentLoop.create(SessionId(id), { provider: 'fixture', model: 'unused' })
    const execute = (agent, name, args = {}) => ctx.tools.execute({
      agent, name, arguments: args, signal: new AbortController().signal,
      callId: ToolCallId(`fixture-${++sequence}`),
    })
    await run({ ctx, createAgent, execute })
  } finally { await ctx.fiber.dispose() }
}

export function textOutput(schema) {
  return { schema, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] }
}
