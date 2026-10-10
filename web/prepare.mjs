import assert from 'node:assert/strict'
import { copyFile, cp, mkdir, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'

assert.ok(process.argv[2], 'Pass a new, explicit acceptance directory')
assert.ok(process.env.OPENAI_BASE_URL, 'Set OPENAI_BASE_URL explicitly')
const endpoint = new URL(process.env.OPENAI_BASE_URL)
assert.ok(endpoint.protocol === 'https:' && !endpoint.username && !endpoint.password && !endpoint.search && !endpoint.hash)
const root = resolve(process.argv[2])
const home = join(root, 'home'), workspace = join(root, 'workspace')
// Exclusive create: do not overwrite an existing profile or fixture.
await mkdir(home)
await mkdir(workspace)
await cp(new URL('../delivery-gate/fixture/', import.meta.url), workspace, { recursive: true })
await writeFile(join(workspace, 'evidence.txt'), 'HARNESS_WEB_EVIDENCE_72941\n')
for (const args of [['init', '-q'], ['add', '.']]) {
  assert.equal(spawnSync('git', args, { cwd: workspace, stdio: 'pipe' }).status, 0)
}
const inserts = []
for (const name of ['review-preset', 'review-plugin', 'delivery-gate']) {
  const target = join(home, 'column-plugins', name)
  await mkdir(target, { recursive: true })
  for (const file of name === 'review-preset' ? ['preset.yml', 'web-readonly.mjs'] : ['preset.yml', `${name}.mjs`]) {
    await copyFile(new URL(`../${name}/${file}`, import.meta.url), join(target, file))
  }
  inserts.push({ id: `course-${name}`, name: 'cordis:include', config: { path: pathToFileURL(join(target, 'preset.yml')).href } })
}
inserts.push({ id: 'course-readonly-setup', name: pathToFileURL(join(home, 'column-plugins/review-preset/web-readonly.mjs')).href })
inserts.push({ id: 'course-directory-picker-host', name: '@deepseek-ai/dsh-host-directory-picker-browse' })
inserts.push({ id: 'course-directory-picker-ui', name: '@deepseek-ai/dsh-client-ui-directory-picker-browse' })
const patch = [
  { id: 'workspace-controller', config: { documentsDirectory: join(root, 'documents') } },
  { id: 'directory-picker', disabled: true },
  { id: 'agent-default-model', config: { provider: 'course-live', model: 'gpt-6-luna' } },
  { id: 'llm-pi-ai', config: { providers: { 'course-live': {
    displayName: 'Course Live', api: 'openai-responses', apiKeyEnv: 'OPENAI_API_KEY',
    baseURL: process.env.OPENAI_BASE_URL,
    models: [{ id: 'gpt-6-luna', contextWindow: 32768, maxTokens: 4096 }],
    retryPolicy: { mode: 'normal', maxRetries: 0 },
  } } } },
  { insert: inserts },
]
// JSON is valid YAML; avoid an extra serializer dependency for this installer.
await writeFile(join(root, 'web.patch.yml'), JSON.stringify(patch, null, 2) + '\n')
console.log('Prepared isolated home, disposable workspace, and web.patch.yml. No credential is stored.')
