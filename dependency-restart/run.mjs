import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'

const root = new Context()
const trace = []
let activations = 0

// State created inside apply belongs to this activation; this outer counter does not.
function consumer(ctx) {
  activations += 1
  let localCount = 0
  const providerId = ctx.labValue.id
  ctx.on('lab/ping', () => trace.push(`${providerId}:${++localCount}`))
  ctx.effect(() => () => trace.push(`cleanup:${providerId}`))
}
consumer.inject = ['labValue']

try {
  const instance = await root.plugin(consumer)
  assert.equal(activations, 0)
  root.emit('lab/ping')
  assert.deepEqual(trace, [])
  console.log('before provider: activations=0, ping has no listener')

  const providerA = await root.plugin(ctx => ctx.provide('labValue', { id: 'A' }))
  await instance.await()
  root.emit('lab/ping')
  root.emit('lab/ping')
  assert.equal(activations, 1)
  assert.deepEqual(trace, ['A:1', 'A:2'])

  await providerA.dispose()
  await instance.await()
  assert.deepEqual(trace, ['A:1', 'A:2', 'cleanup:A'])
  root.emit('lab/ping')
  assert.deepEqual(trace, ['A:1', 'A:2', 'cleanup:A'])
  console.log('provider A disposed: consumer cleaned up, ping has no listener')

  const providerB = await root.plugin(ctx => ctx.provide('labValue', { id: 'B' }))
  await instance.await()
  root.emit('lab/ping')
  assert.equal(activations, 2)
  assert.deepEqual(trace, ['A:1', 'A:2', 'cleanup:A', 'B:1'])
  console.log(`reactivated: activations=${activations}, ${trace.join(' -> ')}`)

  await providerB.dispose()
  await instance.await()
  assert.deepEqual(trace, ['A:1', 'A:2', 'cleanup:A', 'B:1', 'cleanup:B'])
} finally {
  await root.fiber.dispose()
}
