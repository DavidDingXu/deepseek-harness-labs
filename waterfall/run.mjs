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
