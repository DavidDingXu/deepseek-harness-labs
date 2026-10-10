import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'review-plugin'
export const inject = ['tools']

const severities = ['critical', 'high', 'medium', 'low']

const findingSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    severity: { type: 'string', required: true, enum: severities },
    file: { type: 'string', required: true },
    line: { type: 'integer', required: true },
    problem: { type: 'string', required: true },
  },
}

const reportSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    verdict: { type: 'string', required: true, enum: ['pass', 'needs_changes'] },
    summary: { type: 'string', required: true },
    findings: { type: 'array', required: true, items: findingSchema },
  },
}

export function apply(ctx) {
  ctx.tools.register(defineTool({
    name: 'review_report',
    description: 'Submit the final structured code review. Call exactly once after inspecting evidence.',
    parameters: reportSchema.properties,
    output: {
      schema: reportSchema,
      render: (_args, value) => [{
        type: 'text',
        text: `Review ${value.verdict}: ${value.findings.length} finding(s). ${value.summary}`,
      }],
    },
    async execute(args) {
      return args
    },
  }))

  // A guard also covers tools registered in this same scope. It does not hide schemas.
  ctx.tools.guard(exec => ['write', 'edit'].includes(exec.name)
    ? 'Review mode denies file mutation through write/edit.'
    : undefined)
}
