// 能力核 · MCP tools/call 入参运行时校验（让工具目录里那份 JSON Schema 成为**唯一**校验边界）。
//
// 治的是审计 2026-08-25 §2 那条：`params.arguments` 直接 cast 后就进 `tool.build`，目录里的 JSON Schema
// 只在 tools/list 里对外广播、从不参与校验。根因是「**schema 是广告，不是边界**」——同一份契约对外声明、
// 对内没人执行，于是非法/缺失/未知字段被 build 里的 `a.foo` 取值吞成 undefined，一路默认值往下走，
// 用户看到的是「参数明明给错了却生成了别的东西」。
//
// 为什么不引 ajv、也不为每个工具手写 zod（P1 不造第二份真相源）：
// 仓库已有 zod@3.25，但为 24 个工具各写一份 zod schema = 目录里那份 JSON Schema 之外的第二份契约，
// 两份必然漂移（改了一处忘另一处），而对外广播的仍是 JSON Schema 那份 → 广告与执行不一致，比现在更糟。
// 正解是让**广播的那份**直接可执行。实扫两份目录（mcpToolCatalog.ts + mcpGenerationTools.ts）得出的
// 关键字全集只有 11 个、类型只有 5 种，写一个只认这个子集的校验器比接一整个 ajv 更小更可控。
//
// 「只认子集」的风险由结构门兜住：mcpArgValidation.test.ts 遍历整个 catalog 断言每个 inputSchema 只用
// 白名单关键字——将来有人写了 `pattern` 却以为在校验，测试当场报红，而不是运行时静默放过（P2 结构保证）。
//
// 错误形态按规范（MCP spec 2025-11-25 changelog 明写，经 Context7 实查 R5）：
// 「Input validation errors should now be returned as **Tool Execution Errors** rather than Protocol Errors」
// —— 即 isError:true 的 result，不是 -32602。理由是让模型能看见错误并自纠重试；协议级 error 对模型
// 基本不可恢复。故本模块只**判定并给出人话原因**，回复形态交给调用方走既有 buildToolErrorOutcome 漏斗。

/** 校验器认识的 JSON Schema 关键字。目录里出现白名单以外的关键字 = 有人以为在校验其实没有 → 结构门报红。 */
export const SUPPORTED_SCHEMA_KEYWORDS = new Set([
  'type', 'properties', 'required', 'items', 'enum',
  'additionalProperties', 'minimum', 'maximum', 'minItems', 'maxItems',
  'minLength', 'maxLength',
  // 以下两个是纯描述性的（不产生校验行为），列入白名单以免结构门误报。
  'default', 'description',
])

/** 校验器认识的 type。目录里只用到这 5 种。 */
export const SUPPORTED_SCHEMA_TYPES = new Set(['object', 'string', 'array', 'number', 'integer', 'boolean'])

export type SchemaLike = Record<string, unknown>

export type ValidationIssue = {
  /** 出问题的字段路径（人话用，如 `nodes[0].kind`）；根层为空串。 */
  path: string
  message: string
}

/** 把路径拼成人话：根层字段直接给名字，嵌套用 . 与 []。 */
function joinPath(parent: string, key: string): string {
  return parent ? `${parent}.${key}` : key
}

/**
 * 按一份 JSON Schema 校验一个值，收集**所有**问题（不是遇到第一个就返回）——
 * 模型自纠时一次看全比来回试几轮强。
 */
function validateValue(value: unknown, schema: SchemaLike, path: string, issues: ValidationIssue[]): void {
  const type = typeof schema.type === 'string' ? schema.type : undefined

  // enum 先判：它比 type 更具体，报「必须是 a/b/c 之一」比报「必须是 string」有用。
  if (Array.isArray(schema.enum)) {
    if (!schema.enum.includes(value as never)) {
      issues.push({ path, message: `必须是以下之一：${schema.enum.map((v) => JSON.stringify(v)).join(' / ')}（收到 ${JSON.stringify(value)}）` })
      return
    }
  }

  if (type === 'object') {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      issues.push({ path, message: `必须是对象（收到 ${describeType(value)}）` })
      return
    }
    const record = value as Record<string, unknown>
    const properties = (schema.properties && typeof schema.properties === 'object' ? schema.properties : {}) as Record<string, SchemaLike>

    // required：缺失字段。undefined 与「没给这个键」等价（JS 语义），两者都算缺。
    const required = Array.isArray(schema.required) ? schema.required : []
    for (const key of required) {
      if (typeof key !== 'string') continue
      if (record[key] === undefined) {
        issues.push({ path: joinPath(path, key), message: '缺少必填参数' })
      }
    }

    // additionalProperties:false → 未知字段要报出来，别静默吞掉（模型幻觉出的参数早拒）。
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(record)) {
        if (!(key in properties)) {
          const known = Object.keys(properties)
          issues.push({
            path: joinPath(path, key),
            message: known.length ? `未知参数（这个工具只接受：${known.join(' / ')}）` : '这个工具不接受任何参数',
          })
        }
      }
    }

    // 逐字段递归。只校验给了值的字段——没给且非必填 = 合法省略。
    for (const [key, childSchema] of Object.entries(properties)) {
      const child = record[key]
      if (child === undefined) continue
      if (childSchema && typeof childSchema === 'object') {
        validateValue(child, childSchema, joinPath(path, key), issues)
      }
    }
    return
  }

  if (type === 'array') {
    if (!Array.isArray(value)) {
      issues.push({ path, message: `必须是数组（收到 ${describeType(value)}）` })
      return
    }
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) {
      issues.push({ path, message: `至少 ${schema.minItems} 项（收到 ${value.length} 项）` })
    }
    if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) {
      issues.push({ path, message: `最多 ${schema.maxItems} 项（收到 ${value.length} 项）` })
    }
    const items = schema.items && typeof schema.items === 'object' ? schema.items as SchemaLike : undefined
    if (items) {
      value.forEach((entry, index) => validateValue(entry, items, `${path}[${index}]`, issues))
    }
    return
  }

  if (type === 'string') {
    if (typeof value !== 'string') {
      issues.push({ path, message: `必须是字符串（收到 ${describeType(value)}）` })
      return
    }
    const characterCount = Array.from(value).length
    // minLength:1 在目录里是「不许给空串」的写法（如修改指令），必须真拦——否则空指令被当成合法定点修改。
    if (typeof schema.minLength === 'number' && characterCount < schema.minLength) {
      issues.push({
        path,
        message: schema.minLength === 1 ? '不能为空' : `至少 ${schema.minLength} 个字符（收到 ${characterCount} 个）`,
      })
    }
    if (typeof schema.maxLength === 'number' && characterCount > schema.maxLength) {
      issues.push({ path, message: `最多 ${schema.maxLength} 个字符（收到 ${characterCount} 个）` })
    }
    return
  }

  if (type === 'number' || type === 'integer') {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      issues.push({ path, message: `必须是${type === 'integer' ? '整数' : '数字'}（收到 ${describeType(value)}）` })
      return
    }
    if (type === 'integer' && !Number.isInteger(value)) {
      issues.push({ path, message: `必须是整数（收到 ${value}）` })
      return
    }
    if (typeof schema.minimum === 'number' && value < schema.minimum) {
      issues.push({ path, message: `不能小于 ${schema.minimum}（收到 ${value}）` })
    }
    if (typeof schema.maximum === 'number' && value > schema.maximum) {
      issues.push({ path, message: `不能大于 ${schema.maximum}（收到 ${value}）` })
    }
    return
  }

  if (type === 'boolean') {
    if (typeof value !== 'boolean') issues.push({ path, message: `必须是 true / false（收到 ${describeType(value)}）` })
  }
}

/** 人话类型名（报错文案用，别把 null 说成 object）。 */
function describeType(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return '数组'
  const t = typeof value
  return t === 'string' ? '字符串' : t === 'number' ? '数字' : t === 'boolean' ? '布尔值' : t === 'object' ? '对象' : t
}

/**
 * 校验一次 tools/call 的 arguments。返回 null = 合法（**不改写入参**，合法负载逐字节原样往下走）；
 * 返回 Error = 非法，调用方按规范回 Tool Execution Error（isError result），不是协议级 -32602。
 */
export function validateToolArguments(toolName: string, schema: unknown, args: unknown): Error | null {
  if (!schema || typeof schema !== 'object') return null // 工具没声明 schema → 无可校验（目录里目前不存在这种）
  const issues: ValidationIssue[] = []
  validateValue(args, schema as SchemaLike, '', issues)
  if (!issues.length) return null
  const detail = issues
    .map((issue) => (issue.path ? `${issue.path}：${issue.message}` : issue.message))
    .join('；')
  return Object.assign(new Error(`参数不符合 ${toolName} 的契约 —— ${detail}`), { code: 'capability_input_invalid' })
}

/**
 * 结构门用：一份 schema 里是否有校验器不认识的关键字/类型。返回问题列表（空 = 全认识）。
 * 这条不在运行时跑，只在测试里遍历整个 catalog（把「以为在校验其实没有」变成当场报红）。
 */
export function findUnsupportedSchemaFeatures(schema: unknown, path = ''): string[] {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return []
  const found: string[] = []
  const record = schema as SchemaLike
  for (const [key, value] of Object.entries(record)) {
    if (!SUPPORTED_SCHEMA_KEYWORDS.has(key)) {
      found.push(`${path || '<root>'}: 不支持的关键字 "${key}"`)
      continue
    }
    if (key === 'type' && typeof value === 'string' && !SUPPORTED_SCHEMA_TYPES.has(value)) {
      found.push(`${path || '<root>'}: 不支持的 type "${value}"`)
    }
    if (key === 'properties' && value && typeof value === 'object') {
      for (const [child, childSchema] of Object.entries(value as Record<string, unknown>)) {
        found.push(...findUnsupportedSchemaFeatures(childSchema, joinPath(path, child)))
      }
    }
    if (key === 'items') {
      found.push(...findUnsupportedSchemaFeatures(value, `${path}[]`))
    }
  }
  return found
}
