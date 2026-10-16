import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'review-plugin'
export const inject = ['tools']

const severities = ['critical', 'high', 'medium', 'low']

// defineTool 的属性 DSL：required 写在属性上，由工具运行时编译并校验。
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
      // 程序读取规范数据 value；模型收到 render 生成的简短文本。
      render: (_args, value) => [{
        type: 'text',
        text: `Review ${value.verdict}: ${value.findings.length} finding(s). ${value.summary}`,
      }],
    },
    async execute(args) {
      return args
    },
  }))

  // write/edit 仍在模型可见的工具表里，Guard 在主体执行前拒绝调用。
  // 它也覆盖同 Scope 的注册；限制范围仅是这两个名称，不是文件系统沙箱。
  ctx.tools.guard(exec => ['write', 'edit'].includes(exec.name)
    ? 'Review mode denies file mutation through write/edit.'
    : undefined)
}
