import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'delivery-gate'
export const inject = ['tools', 'agents']

const defaultChecks = [
  { id: 'tests', command: 'node --test', tools: ['bash', 'pwsh'] },
  { id: 'diff-check', command: 'git diff --check', tools: ['bash', 'pwsh'] },
]

const mutationTools = new Set(['write', 'edit', 'str_replace_editor'])
const shellTools = new Set(['bash', 'pwsh'])

const checkResultSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    command: { type: 'string', required: true },
    status: { type: 'string', required: true, enum: ['missing', 'failed', 'passed', 'stale'] },
  },
}

const statusSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ready: { type: 'boolean', required: true },
    generation: { type: 'integer', required: true },
    checks: { type: 'array', required: true, items: checkResultSchema },
  },
}

function normalizeCommand(value) {
  return value.trim()
}

export function normalizeConfig(config = {}) {
  const source = config.checks ?? defaultChecks
  if (!Array.isArray(source) || source.length === 0) {
    throw new Error('delivery-gate requires at least one check')
  }

  const ids = new Set()
  const checks = source.map((check) => {
    if (typeof check?.id !== 'string' || check.id.trim() === '') {
      throw new Error('each delivery check needs a non-empty id')
    }
    if (ids.has(check.id)) throw new Error(`duplicate delivery check id: ${check.id}`)
    ids.add(check.id)
    if (typeof check.command !== 'string' || check.command.trim() === '') {
      throw new Error(`delivery check "${check.id}" needs a command`)
    }
    const tools = check.tools ?? ['bash', 'pwsh']
    if (!Array.isArray(tools) || tools.some((tool) => !shellTools.has(tool))) {
      throw new Error(`delivery check "${check.id}" has an unsupported shell tool`)
    }
    return {
      id: check.id,
      command: normalizeCommand(check.command),
      tools: new Set(tools),
    }
  })
  return { checks }
}

export function createDeliveryState() {
  return { generation: 0, evidence: new Map() }
}

function matchingCheck(config, exec) {
  if (!shellTools.has(exec.name)) return undefined
  const command = exec.arguments?.command
  if (typeof command !== 'string') return undefined
  const normalized = normalizeCommand(command)
  return config.checks.find((check) => check.command === normalized && check.tools.has(exec.name))
}

function commandPassed(result) {
  return result.isError === false
    && result.value?.kind === 'foreground'
    && result.value.exitCode === 0
    && result.value.timedOut === false
    && result.value.aborted === false
}

export function observeToolResult(state, config, exec, result) {
  const check = matchingCheck(config, exec)
  if (check !== undefined) {
    state.evidence.set(check.id, {
      generation: state.generation,
      passed: commandPassed(result),
    })
    return
  }

  if (mutationTools.has(exec.name) || shellTools.has(exec.name)) {
    state.generation += 1
  }
}

export function deliveryStatus(state, config) {
  const checks = config.checks.map((check) => {
    const evidence = state.evidence.get(check.id)
    let status = 'missing'
    if (evidence !== undefined && evidence.generation !== state.generation) status = 'stale'
    else if (evidence !== undefined && evidence.passed === false) status = 'failed'
    else if (evidence?.passed === true) status = 'passed'
    return { id: check.id, command: check.command, status }
  })
  return {
    ready: checks.every((check) => check.status === 'passed'),
    generation: state.generation,
    checks,
  }
}

export function gateDecision(state, config) {
  const status = deliveryStatus(state, config)
  if (status.ready) return { kind: 'allow' }
  const details = status.checks
    .filter((check) => check.status !== 'passed')
    .map((check) => `${check.id}=${check.status}; run: ${check.command}`)
    .join(' | ')
  return { kind: 'deny', reason: `delivery evidence is incomplete: ${details}` }
}

export function apply(ctx, rawConfig = {}) {
  const config = normalizeConfig(rawConfig)
  const states = new WeakMap()
  const stateFor = agent => {
    if (agent === undefined || ctx.agents.get(agent.id) !== agent) return undefined
    let state = states.get(agent)
    // A blank Web Agent can select this preset after its creation event.
    // Begin with missing evidence, never reuse another Agent's checks.
    if (state === undefined) { state = createDeliveryState(); states.set(agent, state) }
    return state
  }

  ctx.on('agent/created', ({ agent }) => {
    states.set(agent, createDeliveryState())
  })

  ctx.on('agent/disposed', ({ agent }) => {
    states.delete(agent)
  })

  ctx.on('tools/result', (exec, result) => {
    const state = stateFor(exec.agent)
    if (state !== undefined) observeToolResult(state, config, exec, result)
  })

  ctx.tools.guard(exec => {
    if (exec.name !== 'finish_delivery') return undefined
    const state = stateFor(exec.agent)
    if (state === undefined) return 'finish_delivery requires a live Agent owner'
    const decision = gateDecision(state, config)
    return decision.kind === 'deny' ? decision.reason : undefined
  })

  ctx.tools.register(defineTool({
    name: 'delivery_status',
    description: 'Show which configured delivery checks are missing, failed, passed, or stale.',
    parameters: {},
    output: {
      schema: statusSchema,
      render: (_args, value) => [{
        type: 'text',
        text: value.ready
          ? 'Delivery evidence is ready.'
          : `Delivery evidence is not ready: ${value.checks.map((check) => `${check.id}=${check.status}`).join(', ')}.`,
      }],
    },
    async execute(_args, exec) {
      const state = stateFor(exec.agent)
      if (state === undefined) throw new Error('delivery_status requires a live Agent owner')
      return deliveryStatus(state, config)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'finish_delivery',
    description: 'Finish only after every configured delivery command has passed after the last workspace mutation.',
    parameters: {},
    output: {
      schema: statusSchema,
      render: (_args, value) => [{
        type: 'text',
        text: `Delivery verified at workspace generation ${value.generation}: ${value.checks.map((check) => check.id).join(', ')}.`,
      }],
    },
    async execute(_args, exec) {
      const state = stateFor(exec.agent)
      if (state === undefined) throw new Error('finish_delivery requires a live Agent owner')
      return deliveryStatus(state, config)
    },
  }))
}
