import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Explicit destination, not a legacy .agent-presets auto-discovery directory.
const requested = process.argv[2]
if (!requested) throw new Error('Pass an explicit destination YAML path; this does not edit or select a profile')
const source = fileURLToPath(new URL('./preset.yml', import.meta.url))
const target = resolve(requested)
if (existsSync(target) && !readFileSync(source).equals(readFileSync(target))) {
  throw new Error(`refusing to overwrite a different file: ${target}`)
}
mkdirSync(dirname(target), { recursive: true })
copyFileSync(source, target)
console.log(`Copied declaration: ${target}`)
console.log('Include this YAML from a host that provides agentPresets, tools, systemPrompt, fs and workingDirectory.')
console.log('Agent setup must mount review-config and apply the scoped restriction; copying alone changes no tool surface.')
