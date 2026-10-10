import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createDeliveryState,
  deliveryStatus,
  gateDecision,
  normalizeConfig,
  observeToolResult,
} from './delivery-gate.mjs'

const config = normalizeConfig()

function shell(command, exitCode = 0) {
  return {
    exec: { name: 'bash', arguments: { command } },
    result: {
      isError: false,
      value: {
        kind: 'foreground',
        exitCode,
        timedOut: false,
        aborted: false,
      },
    },
  }
}

test('denies completion until every check passes', () => {
  const state = createDeliveryState()
  assert.equal(gateDecision(state, config).kind, 'deny')

  const tests = shell('node --test')
  observeToolResult(state, config, tests.exec, tests.result)
  assert.equal(gateDecision(state, config).kind, 'deny')

  const diff = shell('  git diff --check  ')
  observeToolResult(state, config, diff.exec, diff.result)
  assert.equal(gateDecision(state, config).kind, 'allow')
})

test('keeps failed and stale evidence distinguishable', () => {
  const state = createDeliveryState()
  const failed = shell('node --test', 1)
  observeToolResult(state, config, failed.exec, failed.result)
  assert.equal(deliveryStatus(state, config).checks[0].status, 'failed')

  const passed = shell('node --test')
  observeToolResult(state, config, passed.exec, passed.result)
  const diff = shell('git diff --check')
  observeToolResult(state, config, diff.exec, diff.result)
  assert.equal(gateDecision(state, config).kind, 'allow')

  observeToolResult(state, config, { name: 'edit', arguments: {} }, { isError: false })
  assert.deepEqual(
    deliveryStatus(state, config).checks.map((check) => check.status),
    ['stale', 'stale'],
  )
})

test('treats an unrecognized shell command as a possible mutation', () => {
  const state = createDeliveryState()
  for (const command of ['node --test', 'git diff --check']) {
    const execution = shell(command)
    observeToolResult(state, config, execution.exec, execution.result)
  }
  const status = shell('git status --short')
  observeToolResult(state, config, status.exec, status.result)
  assert.equal(state.generation, 1)
  assert.equal(gateDecision(state, config).kind, 'deny')
})

test('does not collapse whitespace inside a command', () => {
  const state = createDeliveryState()
  const execution = shell('git   diff --check')
  observeToolResult(state, config, execution.exec, execution.result)
  assert.equal(state.generation, 1)
  assert.equal(deliveryStatus(state, config).checks[1].status, 'missing')
})
