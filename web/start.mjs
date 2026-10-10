import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { resolve, join } from 'node:path'

assert.ok(process.argv[2], 'Pass the prepared acceptance directory')
assert.ok(process.env.OPENAI_API_KEY, 'Provide the model credential in the launch environment')
const root = resolve(process.argv[2])
const port = process.argv[3] ?? '3187'
assert.match(port, /^\d+$/)
const child = spawn(process.execPath, [join(root, 'node_modules/@deepseek-ai/dsh/lib/bin.js'),
  '--profile', 'web', '--patch', join(root, 'web.patch.yml'), '--no-open', '--port', port], {
  cwd: join(root, 'workspace'),
  env: { ...process.env, DSH_HOME: join(root, 'home'), DSH_TELEMETRY_DISABLED: '1' },
  stdio: 'inherit',
})
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal))
child.on('error', error => { console.error(error.message); process.exitCode = 1 })
child.on('exit', code => { process.exitCode = code ?? 1 })
