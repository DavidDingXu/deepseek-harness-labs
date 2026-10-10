import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Group from '@deepseek-ai/cordis-plugin-group'
import Include from '@deepseek-ai/cordis-plugin-include'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import AgentPresets from '@deepseek-ai/dsh-agent-preset-registry'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import WorkingDirectory from '@deepseek-ai/dsh-working-directory'

export function checkVersions() {
  const require = createRequire(import.meta.url)
  for (const [name, version] of Object.entries(require('./package.json').dependencies)) {
    assert.equal(require(`${name}/package.json`).version, version, name)
  }
}

export async function createHost(baseUrl, cwd, { preset = false } = {}) {
  const ctx = new Context()
  ctx.baseUrl = baseUrl
  try {
    await ctx.plugin(Loader)
    ctx.loader.builtins.group = Group
    ctx.loader.builtins.include = Include
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime, { mode: 'native' })
    if (preset) {
      await ctx.plugin(AgentRegistry)
      await ctx.plugin(AgentLoop, { agents: [] })
      await ctx.plugin(LocalFileSystem, { cwd })
      await ctx.plugin(WorkingDirectory, { defaultDirectory: cwd })
      await ctx.plugin(AgentPresets, { default: 'review-config' })
    }
    return ctx
  } catch (error) {
    await ctx.fiber.dispose()
    throw error
  }
}

export async function mountFile(ctx, file, patches = []) {
  // Use Loader entries so the Include instance owns the real subtree.
  await ctx.loader.root.update([{ id: 'experiment', name: 'cordis:include', config: { path: pathToFileURL(file).href, patches } }])
  await ctx.loader.await()
  const entry = ctx.loader.resolve('experiment')
  assert.ok(entry.fiber, 'Include imported')
  await entry.fiber.await()
  const tree = entry.subtree
  assert.ok(tree, 'Include created a subtree')
  for (const child of tree.entries()) {
    if (child.disabled) continue
    assert.ok(child.fiber, `${child.options.id} imported`)
    await child.fiber.await()
    // Cordis FiberState.ACTIVE = 2; its const enum is erased in the JS export.
    assert.equal(child.fiber.state, 2, `${child.options.id} must be ACTIVE`)
  }
  return tree
}
