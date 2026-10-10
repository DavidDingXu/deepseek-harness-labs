// Web creates the Agent; apply the chapter's scoped filter before queued work
// starts. Only the explicitly named course preset is affected.
export const name = 'course-review-readonly'
export const inject = ['agentPresets', 'agents', 'tools']

export function apply(ctx) {
  const active = new WeakMap()
  const release = agent => {
    const entry = active.get(agent)
    if (!entry) return
    active.delete(agent)
    entry.lift() // Remove the filter synchronously before the next request.
    void entry.dispose()
  }
  const reconcile = agent => {
    const review = ctx.agentPresets.inspectCompositions(agent.ctx).some(item => item.id === 'review-config')
    if (!review) return release(agent)
    if (active.has(agent)) return
    const lift = agent.ctx.tools.restrict({ allow: ['read'] })
    const dispose = ctx.effect(() => () => { lift(); active.delete(agent) })
    active.set(agent, { lift, dispose })
  }
  ctx.on('agent/created', ({ agent }) => { reconcile(agent) })
  ctx.on('agent-preset/selected', sessionId => {
    const agent = ctx.agents.get(sessionId)
    if (agent) reconcile(agent)
  })
  ctx.on('agent/disposed', ({ agent }) => { release(agent) })
}
