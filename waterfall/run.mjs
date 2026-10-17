import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'

const root = new Context()
const trace = []

const outer = await root.plugin((ctx) => {
  ctx.on('lab/request', (request, next) => {
    trace.push(`outer:before:${request}`)
    const result = next()
    trace.push(`outer:after:${result}`)
    return `outer(${result})`
  })
})

const inner = await root.plugin((ctx) => {
  ctx.on('lab/request', (request, next) => {
    trace.push(`inner:before:${request}`)
    const result = next()
    trace.push(`inner:after:${result}`)
    return `inner(${result})`
  })
})

const completed = root.waterfall('lab/request', 'R1', () => {
  trace.push('default:R1')
  return 'done'
})

assert.equal(completed, 'outer(inner(done))')
assert.deepEqual(trace, [
  'outer:before:R1',
  'inner:before:R1',
  'default:R1',
  'inner:after:done',
  'outer:after:inner(done)',
])

await outer.dispose()
await inner.dispose()
trace.length = 0

await root.plugin((ctx) => {
  ctx.on('lab/request', (request) => {
    trace.push(`blocked:${request}`)
    return 'denied'
  })
})

const blocked = root.waterfall('lab/request', 'R2', () => {
  trace.push('default:R2')
  return 'should-not-run'
})

assert.equal(blocked, 'denied')
assert.deepEqual(trace, ['blocked:R2'])

await root.fiber.dispose()
console.log(`completed=${completed}`)
console.log(`blocked=${blocked}`)

const timingRoot = new Context()
try {
  for (const waitForDownstream of [false, true]) {
    const mode = waitForDownstream ? 'return await next()' : 'return next()'
    const event = `lab/finally/${waitForDownstream}`
    const gate = Promise.withResolvers()
    const order = []
    timingRoot.on(event, async (next) => {
      try {
        if (waitForDownstream) return await next()
        return next()
      } finally {
        order.push('finally')
      }
    })
    const pending = timingRoot.waterfall(event, async () => {
      order.push('body:start')
      await gate.promise
      order.push('body:end')
      return 'done'
    })

    // 闸门没打开时，两种 finally 的时点已经不同。
    assert.deepEqual(order, waitForDownstream ? ['body:start'] : ['body:start', 'finally'])
    gate.resolve()
    assert.equal(await pending, 'done')
    assert.deepEqual(order, waitForDownstream
      ? ['body:start', 'body:end', 'finally']
      : ['body:start', 'finally', 'body:end'])
    console.log(`${mode}: ${order.join(' -> ')}`)
  }

  const repeatedTrace = []
  let defaultCalls = 0
  let innerCalls = 0
  timingRoot.on('lab/repeated-next', (request, next) => {
    repeatedTrace.push('outer:before')
    const first = next()
    const second = next()
    repeatedTrace.push('outer:after')
    return [first, second]
  })
  timingRoot.on('lab/repeated-next', (request, next) => {
    innerCalls += 1
    repeatedTrace.push('inner')
    return next()
  })
  const repeated = timingRoot.waterfall('lab/repeated-next', 'R3', () => {
    defaultCalls += 1
    repeatedTrace.push(`default:${defaultCalls}`)
    return defaultCalls
  })
  assert.deepEqual(repeated, [1, 2])
  assert.equal(innerCalls, 1)
  assert.equal(defaultCalls, 2)
  assert.deepEqual(repeatedTrace, ['outer:before', 'inner', 'default:1', 'default:2', 'outer:after'])
  console.log(`repeated next: inner=${innerCalls}; default=${defaultCalls}; result=${JSON.stringify(repeated)}`)
} finally {
  await timingRoot.fiber.dispose()
}
