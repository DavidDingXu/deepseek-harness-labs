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
  // 只去首尾空白，保留命令内部及引号内字符串的原意。
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
  // generation 是已观察变更的计数；不是磁盘内容版本或快照。
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
  // 工具成功交回进程结果，进程仍可能失败。必须同时检查退出码、超时和取消。
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
    // 未匹配的 Shell 可能改文件；即便返回失败，也保守地让旧证据过期。
    state.generation += 1
  }
}

export function deliveryStatus(state, config) {
  const checks = config.checks.map((check) => {
    const evidence = state.evidence.get(check.id)
    let status = 'missing'
    // 先比较计数：上一次通过或失败的结果，都不能代表修改后的代码。
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
    // 必须是 Registry 当前持有的同一个实例，不能仅凭相同 id 借用结果。
    if (agent === undefined || ctx.agents.get(agent.id) !== agent) return undefined
    let state = states.get(agent)
    // Web 可能先创建空白 Agent，再选中这个 Preset。首次使用时补建状态，
    // 从缺少证据开始，不借用别的 Agent 或上一次挂载留下的检查。
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
    // 在结果事件处记录事实；模型声称“测试通过”不会进入这份证据表。
    const state = stateFor(exec.agent)
    if (state !== undefined) observeToolResult(state, config, exec, result)
  })

  ctx.tools.guard(exec => {
    if (exec.name !== 'finish_delivery') return undefined
    const state = stateFor(exec.agent)
    if (state === undefined) return 'finish_delivery requires a live Agent owner'
    const decision = gateDecision(state, config)
    // 本插件只提出拒绝；返回 undefined 不会越过其他 Guard 的限制。
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
