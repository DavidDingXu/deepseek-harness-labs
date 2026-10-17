import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'

const trace = []
const root = new Context()

const active = await root.plugin((ctx) => {
  ctx.effect(() => {
    trace.push('install:A')
    return () => trace.push('dispose:A')
  }, 'resource-A')

  ctx.effect(() => {
    trace.push('install:B')
    return () => trace.push('dispose:B')
  }, 'resource-B')
})

await active.dispose()
assert.deepEqual(trace, [
  'install:A',
  'install:B',
  'dispose:B',
  'dispose:A',
])

const failed = root.plugin((ctx) => {
  ctx.effect(() => {
    trace.push('fail:A')
    return () => trace.push('rollback:A')
  }, 'failed-resource-A')

  ctx.effect(() => {
    trace.push('fail:B')
    return () => trace.push('rollback:B')
  }, 'failed-resource-B')

  throw new Error('install failed')
})

await assert.rejects(() => failed.await(), /install failed/)
assert.deepEqual(trace.slice(-4), [
  'fail:A',
  'fail:B',
  'rollback:B',
  'rollback:A',
])

await root.fiber.dispose()
console.log(trace.join(' -> '))

// Separate effects begin in reverse order, but do not await one another.
const concurrentRoot = new Context()
const concurrent = []
let releaseB
const gateB = new Promise(resolve => { releaseB = resolve })
let markBStarted
const startedB = new Promise(resolve => { markBStarted = resolve })
const concurrentFiber = await concurrentRoot.plugin((ctx) => {
  ctx.effect(() => () => { concurrent.push('A:start', 'A:end') })
  ctx.effect(() => async () => {
    concurrent.push('B:start')
    markBStarted()
    await gateB
    concurrent.push('B:end')
  })
})
const disposing = concurrentFiber.dispose()
await startedB
await Promise.resolve()
assert.deepEqual(concurrent, ['B:start', 'A:start', 'A:end'])
releaseB()
await disposing
assert.deepEqual(concurrent, ['B:start', 'A:start', 'A:end', 'B:end'])
console.log(`separate effects: ${concurrent.join(' -> ')}`)
await concurrentRoot.fiber.dispose()

// A generator effect collects multiple disposers into ONE ordered cleanup chain.
const groupedRoot = new Context()
const grouped = []
let releaseInner
const innerGate = new Promise(resolve => { releaseInner = resolve })
let markInnerStarted
const innerStarted = new Promise(resolve => { markInnerStarted = resolve })
const groupedFiber = await groupedRoot.plugin((ctx) => {
  ctx.effect(function* () {
    yield () => { grouped.push('A:start', 'A:end') }
    yield async () => {
      grouped.push('B:start')
      markInnerStarted()
      await innerGate
      grouped.push('B:end')
    }
  })
})
const groupedDisposing = groupedFiber.dispose()
await innerStarted
assert.deepEqual(grouped, ['B:start'])
releaseInner()
await groupedDisposing
assert.deepEqual(grouped, ['B:start', 'B:end', 'A:start', 'A:end'])
console.log(`one effect: ${grouped.join(' -> ')}`)
await groupedRoot.fiber.dispose()

// 组内拒绝会跳过后面的清理；Fiber 仍等待其他独立 Effect。
const rejectedRoot = new Context()
const rejectedTrace = []
const cleanupErrors = []
rejectedRoot.logger.error = error => { cleanupErrors.push(error) }
const rejectGate = Promise.withResolvers()
const rejectStarted = Promise.withResolvers()
const rejectedFiber = await rejectedRoot.plugin((ctx) => {
  ctx.effect(() => () => { rejectedTrace.push('independent:done') })
  ctx.effect(function* () {
    yield () => { rejectedTrace.push('A:close') }
    yield async () => {
      rejectedTrace.push('B:start')
      rejectStarted.resolve()
      await rejectGate.promise
      rejectedTrace.push('B:reject')
      throw new Error('B could not stop')
    }
  })
})
let rejectedOwnerSettled = false
const rejectedDisposing = rejectedFiber.dispose().then(() => { rejectedOwnerSettled = true })
await rejectStarted.promise
await Promise.resolve()
assert.equal(rejectedOwnerSettled, false)
assert.deepEqual(rejectedTrace, ['B:start', 'independent:done'])
rejectGate.resolve()
await rejectedDisposing
assert.deepEqual(rejectedTrace, ['B:start', 'independent:done', 'B:reject'])
assert.equal(cleanupErrors.length, 1)
assert.match(cleanupErrors[0].message, /B could not stop/)
console.log(`grouped failure: ${rejectedTrace.join(' -> ')}; A:close skipped; errors=1`)
await rejectedRoot.fiber.dispose()
