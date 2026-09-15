// 4 个 MCP 工具定义 —— **全部从 declarations.ts 派生**，本文件不含任何手写描述或必填清单。
//
// 派生三处（第一性原理 §6.1「一份声明三处派生」）：
//   ① tools/list 广播的 description（五槽 + 派生的 consequence）
//   ② inputSchema（该工具全部 action 字段的并集；required 就是运行时校验的 required）
//   ③ build() 里的一次性缺字段聚合校验（缺什么一次列全，不逐个抛）
//
// 为什么 schema 是扁平的、条件必填只写在描述里而不用 allOf + if/then：
// 模型看到的 schema 要先过各家适配器。Anthropic 适配器会静默丢掉根上的 allOf（模型会看到一个
// **没有 schema** 的工具）；Google 的 OpenAPI 3.0.3 路径不认 const。仓库的 check:model-schema
// 门岗守的就是这条。所以选「扁平 schema + 描述里说真话 + 运行时一次说全」。
import { IntegrationRequestError } from '../../shared/integrationContract'
import type { JsonSchemaObject } from '../../shared/agentCapabilities/modelVisibleJsonSchema'
import {
  ONBOARDING_TOOL_NAMES,
  ONBOARDING_VERBS,
  renderDescription,
  resolveVerb,
  verbsOfTool,
  type VerbDeclaration,
} from './declarations'

const TITLE_BY_TOOL: Record<string, { 'zh-CN': string; en: string }> = {
  nomi_list_models: { 'zh-CN': '查看模型与接入状态', en: 'List models and setup state' },
  nomi_await_setup: { 'zh-CN': '等接入走到下一步', en: 'Wait for a model setup' },
  nomi_model_setup: { 'zh-CN': '接入或调整模型', en: 'Set up or adjust a model connection' },
  nomi_remove_provider: { 'zh-CN': '永久删除连接或模型', en: 'Permanently delete a connection or model' },
}

/** 合并工具的 description：工具级开场 + 每个 action 的五槽，逐字从声明生成。 */
function renderToolDescription(tool: string): string {
  const verbs = verbsOfTool(tool)
  if (verbs.length === 1 && verbs[0].action === null) return renderDescription(verbs[0])
  const head = 'Change the user\'s model settings one step at a time, by action. Every step is reversible, local and free: nothing here spends money or deletes anything. Repeating a step is safe — it returns the same result and never undoes a click the user already made.'
  return [head, ...verbs.map((verb) => `[action=${verb.action}] ${renderDescription(verb)}`)].join('\n\n')
}

/** 广播给模型的必填清单，逐字从声明生成——描述里写的和运行时校验的是同一份（门岗 O4）。 */
function renderActionDescription(tool: string): string {
  const verbs = verbsOfTool(tool)
  const lines = verbs.map((verb) => {
    const base = verb.required.length ? verb.required.join(' + ') : 'no other required field'
    const cond = verb.conditionalRequired
      ? `; when ${verb.conditionalRequired.whenText}, also ${verb.conditionalRequired.fields.join(' + ')}`
      : ''
    return `${verb.action} requires ${base}${cond}`
  })
  return `Which step to take. Required fields depend on it: ${lines.join('; ')}.`
}

/** 该工具的字段并集（同名字段必须同形，装配期断言）。 */
function mergedFields(tool: string): Record<string, JsonSchemaObject> {
  const out: Record<string, JsonSchemaObject> = {}
  for (const verb of verbsOfTool(tool)) {
    for (const [name, schema] of Object.entries(verb.fields)) {
      const existing = out[name]
      if (existing && JSON.stringify(existing) !== JSON.stringify(schema)) {
        throw new Error(`Field ${name} is declared with two different shapes inside ${tool}`)
      }
      out[name] = schema
    }
  }
  return out
}

/** 这一跳的完整必填集（基础 + 条件）。声明是唯一 owner。 */
export function requiredFor(verb: VerbDeclaration, args: Record<string, unknown>): readonly string[] {
  const conditional = verb.conditionalRequired && verb.conditionalRequired.when(args)
    ? verb.conditionalRequired.fields
    : []
  return [...verb.required, ...conditional]
}

/** 缺什么**一次说全**，并带上这一步的完整必填清单（实测 22 次失败里 9 次死在逐个抛）。 */
function assertRequired(tool: string, verb: VerbDeclaration, args: Record<string, unknown>): void {
  const expected = requiredFor(verb, args)
  const missing = expected.filter((field) => args[field] === undefined || args[field] === null || args[field] === '')
  if (!missing.length) return
  const label = verb.action ? `${tool} action="${verb.action}"` : tool
  throw new IntegrationRequestError(
    'integration_required_fields_missing',
    `${label} is missing ${missing.join(', ')}. This step requires: ${expected.join(', ')}`,
    { action: verb.action ?? tool, missing: missing.join(','), required: expected.join(',') },
  )
}

function buildTool(tool: string) {
  const verbs = verbsOfTool(tool)
  const merged = mergedFields(tool)
  const isMerged = verbs.length > 1
  const readOnly = verbs.every((verb) => verb.effect === 'read')
  const soleVerb = isMerged ? undefined : verbs[0]
  const properties: Record<string, JsonSchemaObject> = isMerged
    ? { action: { type: 'string', enum: verbs.map((verb) => verb.action as string), description: renderActionDescription(tool) }, ...merged }
    : merged
  return {
    name: tool,
    title: TITLE_BY_TOOL[tool]['zh-CN'],
    titleByLocale: Object.freeze(TITLE_BY_TOOL[tool]),
    description: renderToolDescription(tool),
    inputSchema: {
      type: 'object',
      properties,
      // 合并工具：顶层只有 action 必填，其余随 action 变（描述里逐条说全）。
      // 独立工具：声明里的 required 直接上 schema——广播的就是运行时校验的那一份。
      required: isMerged ? ['action'] : [...(soleVerb?.required ?? [])],
      additionalProperties: false,
    },
    ...(readOnly ? { annotations: { readOnlyHint: true as const } } : {}),
    method: verbs[0].method,
    resolveMethod: (args: Record<string, unknown>): string => resolveVerb(tool, args)?.method ?? verbs[0].method,
    build: (args: Record<string, unknown>): Record<string, unknown> => {
      const verb = resolveVerb(tool, args)
      if (!verb) {
        throw new IntegrationRequestError(
          'integration_required_fields_missing',
          `${tool} needs one of these actions: ${verbs.map((v) => v.action).join(', ')}`,
          { action: String(args.action ?? ''), missing: 'action', required: 'action' },
        )
      }
      assertRequired(tool, verb, args)
      const allowed = new Set(Object.keys(verb.fields))
      const params: Record<string, unknown> = { action: verb.action ?? tool }
      for (const [name, value] of Object.entries(args)) {
        if (name === 'action') continue
        if (allowed.has(name) && value !== undefined) params[name] = value
      }
      return params
    },
  } as const
}

/** 对外发布的 4 个工具（顺序 = 读优先：主入口先出现在 tools/list 里）。 */
export const MODEL_ONBOARDING_TOOLS = Object.freeze(ONBOARDING_TOOL_NAMES.map(buildTool))

/** 内部路由键集合（dispatcher 与测试共用，真相单一）。 */
export const MODEL_ONBOARDING_METHODS = Object.freeze(ONBOARDING_VERBS.map((verb) => verb.method))
