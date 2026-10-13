import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import SandboxedFileSystem from '@deepseek-ai/dsh-fs-sandbox'
import SandboxPolicy from '@deepseek-ai/dsh-sandbox-policy'
import WorkingDirectory from '@deepseek-ai/dsh-working-directory'
import * as FileTools from '@deepseek-ai/dsh-tool-fs'
import { checkVersions, createHost } from '../preset-runtime/harness.mjs'

checkVersions()
const directory = await mkdtemp(join(tmpdir(), 'dsh-capability-'))
const target = join(directory, 'report.txt')
const request = Object.freeze({ file_path: 'report.txt', content: 'review complete\n' })
const previousHome = process.env.DSH_HOME
process.env.DSH_HOME = directory
let ctx

try {
  ctx = await createHost(new URL('.', import.meta.url).href, directory)
  // Keep the policy fixed: only the provider changes between calls.
  await ctx.plugin(SandboxPolicy, { mode: 'read-only', workspaceRoot: directory })
  let provider = await ctx.plugin(LocalFileSystem, { cwd: directory })
  const workingDirectory = await ctx.plugin(WorkingDirectory, { defaultDirectory: directory })
  // Mount this official consumer exactly once. Cordis reactivates it as its fs dependency changes.
  const consumer = await ctx.plugin(FileTools, {})
  let sequence = 0
  const executeWrite = () => ctx.tools.execute({
    name: 'write', arguments: request,
    callId: ToolCallId(`capability-${++sequence}`),
    signal: new AbortController().signal,
  })
  const awaitConsumer = async () => {
    await workingDirectory.await()
    await consumer.await()
    assert.equal(consumer.state, 2, 'official tool-fs consumer must be ACTIVE')
    assert.ok(ctx.tools.get('write'), 'write is registered by the official consumer')
    assert.equal(ctx.sandboxPolicy.defaultMode, 'read-only', 'the policy never changes')
  }
  const detachProvider = async () => {
    await provider.dispose()
    await workingDirectory.await()
    await consumer.await()
    assert.notEqual(consumer.state, 2, 'consumer must stop when its provider disappears')
    assert.equal(ctx.tools.get('write'), undefined, 'dependency loss revokes the tool registration')
  }

  await awaitConsumer()
  assert.equal(ctx.fs.sandboxMode, undefined, 'local provider does not enforce the standing policy')
  const localResult = await executeWrite()
  assert.equal(localResult.isError, false)
  assert.equal(localResult.value.operation, 'create')
  assert.equal(await readFile(target, 'utf8'), request.content)
  console.log('PASS local: official write creates report.txt; fs-local does not enforce the read-only policy')

  await detachProvider()
  const missingResult = await executeWrite()
  assert.equal(missingResult.isError, true)
  assert.equal(missingResult.error.info.code, 'UNKNOWN_TOOL')
  assert.equal(await readFile(target, 'utf8'), request.content)
  console.log('PASS dependency: removing fs-local revokes write; a direct call returns UNKNOWN_TOOL')

  provider = await ctx.plugin(SandboxedFileSystem, { cwd: directory })
  await awaitConsumer()
  assert.equal(ctx.fs.sandboxMode, 'read-only')
  // Reset only test data. The consumer, policy, path and write payload stay the same.
  await rm(target)
  const deniedCreate = await executeWrite()
  assert.equal(deniedCreate.isError, true)
  assert.equal(deniedCreate.error.info.code, 'FS_SANDBOX_DENIED')
  assert.equal(existsSync(target), false, 'a denied write must not create a file')
  const original = 'existing content must survive\n'
  await writeFile(target, original)
  const deniedOverwrite = await executeWrite()
  assert.equal(deniedOverwrite.isError, true)
  assert.equal(deniedOverwrite.error.info.code, 'FS_SANDBOX_DENIED')
  assert.equal(await readFile(target, 'utf8'), original, 'a denied overwrite must preserve existing bytes')
  console.log('PASS replacement: the same write returns FS_SANDBOX_DENIED; creation and overwrite leave disk unchanged')

  await detachProvider()
  provider = await ctx.plugin(LocalFileSystem, { cwd: directory })
  await awaitConsumer()
  assert.equal(ctx.fs.sandboxMode, undefined)
  const restoredResult = await executeWrite()
  assert.equal(restoredResult.isError, false)
  assert.equal(restoredResult.value.operation, 'update')
  assert.equal(await readFile(target, 'utf8'), request.content)
  console.log('PASS restoration: fs-local reactivates the same consumer; the same write succeeds again')
} finally {
  try { await ctx?.fiber.dispose() }
  finally {
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    await rm(directory, { recursive: true, force: true })
  }
}
assert.equal(existsSync(directory), false)
console.log('PASS cleanup: official runtime disposed; temporary files removed; no model or OS sandbox used')
