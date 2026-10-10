import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'revision-observer'
export const inject = ['tools']
// Observation only: the official Registry owns generations and reference counting.
export const lifecycle = []

export function apply(ctx, { revision }) {
  lifecycle.push(`mount:${revision}`)
  ctx.effect(() => () => { lifecycle.push(`dispose:${revision}`) })
  ctx.tools.register(defineTool({
    name: `revision_${revision}`,
    description: `Marker contributed by ${revision}`,
    parameters: {},
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute() { return revision },
  }))
}
