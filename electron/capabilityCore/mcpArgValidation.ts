// The published JSON Schema is the executable MCP boundary. Ajv owns draft-07
// semantics, including recursive local references and typed open dictionaries.
import Ajv, { type ErrorObject, type ValidateFunction } from 'ajv'

export type SchemaLike = Record<string, unknown>
export type ValidationIssue = { path: string; message: string }
export const SUPPORTED_SCHEMA_KEYWORDS = new Set([
  'type', 'properties', 'required', 'items', 'enum', 'additionalProperties',
  'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'minItems', 'maxItems',
  'minLength', 'maxLength', 'default', 'description', '$ref', '$schema', '$defs', 'definitions',
  'anyOf', 'oneOf', 'allOf',
])
export const SUPPORTED_SCHEMA_TYPES = new Set(['object', 'string', 'array', 'number', 'integer', 'boolean', 'null'])
const ajv = new Ajv({ allErrors: true, strictSchema: true, strictTypes: false, strictRequired: false, strictNumbers: true, verbose: true, allowUnionTypes: true, addUsedSchema: false })
const validators = new WeakMap<object, ValidateFunction>()

function describeType(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return '数组'
  const names: Record<string, string> = { string: '字符串', number: '数字', boolean: '布尔值', object: '对象' }
  return names[typeof value] ?? typeof value
}
function issueFrom(error: ErrorObject): ValidationIssue {
  const parts = error.instancePath.split('/').slice(1).map(x => x.replace(/~1/g, '/').replace(/~0/g, '~'))
  if (error.keyword === 'required') parts.push(String(error.params.missingProperty))
  if (error.keyword === 'additionalProperties') parts.push(String(error.params.additionalProperty))
  const path = parts.reduce((parent, part) => /^\d+$/.test(part) ? `${parent}[${part}]` : parent ? `${parent}.${part}` : part, '')
  const limit = error.params.limit
  let message = error.message ?? '参数不符合契约'
  switch (error.keyword) {
    case 'required': message = '缺少必填参数'; break
    case 'additionalProperties': message = Object.keys(error.parentSchema?.properties ?? {}).length ? '未知参数' : '这个工具不接受任何参数'; break
    case 'type': message = `必须是${error.params.type === 'integer' ? '整数' : error.params.type === 'boolean' ? ' true / false' : describeTypeForSchema(String(error.params.type))}（收到 ${describeType(error.data)}）`; break
    case 'enum': message = `必须是以下之一：${error.params.allowedValues.map((v: unknown) => JSON.stringify(v)).join(' / ')}`; break
    case 'minimum': message = `不能小于 ${limit}`; break
    case 'maximum': message = `不能大于 ${limit}`; break
    case 'exclusiveMinimum': message = `必须大于 ${limit}`; break
    case 'exclusiveMaximum': message = `必须小于 ${limit}`; break
    case 'minLength': message = limit === 1 ? '不能为空' : `至少 ${limit} 个字符`; break
    case 'maxLength': message = `最多 ${limit} 个字符`; break
    case 'minItems': message = `至少 ${limit} 项`; break
    case 'maxItems': message = `最多 ${limit} 项`; break
  }
  return { path, message }
}
function describeTypeForSchema(type: string): string {
  return ({ object: '对象', string: '字符串', array: '数组', number: '数字' } as Record<string, string>)[type] ?? type
}
export function validateToolArguments(toolName: string, schema: unknown, args: unknown): Error | null {
  if (!schema || typeof schema !== 'object') return null
  let validate = validators.get(schema)
  if (!validate) {
    try {
      validate = ajv.compile(schema as SchemaLike)
      validators.set(schema, validate)
    } catch (error) {
      return Object.assign(new Error(`参数不符合 ${toolName} 的契约 —— 无效工具 schema：${error instanceof Error ? error.message : String(error)}`), { code: 'capability_input_invalid' })
    }
  }
  if (validate(args)) return null
  const detail = (validate.errors ?? []).map(issueFrom).map(issue => issue.path ? `${issue.path}：${issue.message}` : issue.message).join('；')
  return Object.assign(new Error(`参数不符合 ${toolName} 的契约 —— ${detail}`), { code: 'capability_input_invalid' })
}

export function findUnsupportedSchemaFeatures(schema: unknown, path = ''): string[] {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return []
  const found: string[] = []
  for (const [key, value] of Object.entries(schema)) {
    if (!SUPPORTED_SCHEMA_KEYWORDS.has(key)) { found.push(`${path || '<root>'}: 不支持的关键字 "${key}"`); continue }
    if (key === 'type') for (const type of Array.isArray(value) ? value : [value]) {
      if (typeof type === 'string' && !SUPPORTED_SCHEMA_TYPES.has(type)) found.push(`${path || '<root>'}: 不支持的 type "${type}"`)
    }
    if (['properties', 'definitions', '$defs'].includes(key) && value && typeof value === 'object') {
      for (const [child, childSchema] of Object.entries(value)) found.push(...findUnsupportedSchemaFeatures(childSchema, path ? `${path}.${child}` : child))
    }
    if (key === 'items' || key === 'additionalProperties') found.push(...findUnsupportedSchemaFeatures(value, `${path}[]`))
    if (['anyOf', 'oneOf', 'allOf'].includes(key) && Array.isArray(value)) value.forEach((branch, index) => found.push(...findUnsupportedSchemaFeatures(branch, `${path}/${key}/${index}`)))
  }
  return found
}
