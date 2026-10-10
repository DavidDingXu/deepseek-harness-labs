import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'

const root = new Context()
try {
  // A falsey value is not necessarily an abstention: 0 and '' stop serial/bail.
  for (const [label, first, expected] of [
    ['undefined', undefined, 'fallback'], ['null', null, 'fallback'],
    ['false', false, 'fallback'], ['zero', 0, 0], ['empty', '', ''],
  ]) {
    const visited = []
    const name = `lab/serial/${label}`
    root.on(name, () => { visited.push('A'); return first })
    root.on(name, () => { visited.push('B'); return 'fallback' })
    assert.equal(await root.serial(name), expected)
    assert.equal(root.bail(name), expected)
    assert.deepEqual(visited, expected === 'fallback' ? ['A', 'B', 'A', 'B'] : ['A', 'A'])
    console.log(`serial/bail ${label}: ${JSON.stringify(expected)}`)
  }

  // Explicit gates expose waiting semantics without depending on timer speed.
  let release
  const gate = new Promise(resolve => { release = resolve })
  const notified = []
  root.on('lab/emit', async () => { notified.push('start'); await gate; notified.push('end') })
  root.emit('lab/emit')
  assert.deepEqual(notified, ['start'])
  release()
  await gate
  assert.deepEqual(notified, ['start', 'end'])
  console.log('emit: caller continues before async listener finishes')

  let finishSlow
  const slow = new Promise(resolve => { finishSlow = resolve })
  let settled = false
  root.on('lab/parallel', async () => { throw new Error('A failed') })
  root.on('lab/parallel', async () => { await slow; throw new Error('B failed') })
  const pending = root.parallel('lab/parallel').then(
    () => { settled = true; throw new Error('expected rejection') },
    error => { settled = true; return error },
  )
  await Promise.resolve()
  assert.equal(settled, false)
  finishSlow()
  const error = await pending
  assert.ok(error instanceof AggregateError)
  assert.deepEqual(error.errors.map(item => item.message), ['A failed', 'B failed'])
  console.log('parallel: waits for both listeners; AggregateError has 2 errors')
} finally {
  await root.fiber.dispose()
}
