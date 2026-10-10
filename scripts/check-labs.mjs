import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
for (const script of [
  'cordis-lifecycle/run.mjs', 'dependency-restart/run.mjs',
  'event-modes/run.mjs', 'waterfall/run.mjs', 'runtime/run.mjs',
  'review-preset/verify.mjs', 'profile-patch/run.mjs',
  'review-plugin/run.mjs', 'delivery-gate/run.mjs',
  'delivery-gate/delivery-gate.test.mjs',
  'compaction/run.mjs', 'subagent/run.mjs',
]) {
  const result = spawnSync(process.execPath, [script], { cwd: root, stdio: 'inherit' })
  if (result.status !== 0) process.exit(result.status ?? 1)
}
console.log('All current-baseline learning experiments passed.')
