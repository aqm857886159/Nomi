#!/usr/bin/env node
/**
 * 门岗 · **tools/list 里每个 operation 枚举值都必须构造得出来**。
 *
 * 治的是这一族：对外广播的传输 schema 与真正的执行校验器是两份定义，于是某些 operation
 * 在传输层就被 `additionalProperties:false` 打掉，宿主无论怎么写都调不通 —— 而 tools/list
 * 照样把它列成一个可用动作。实测基线（修复前，2026-09-05 外部宿主探针）：
 * nomi_canvas_edit / nomi_canvas_plan 各公开 9 个 operation，其中
 * propose_storyboard_plan、create_camera_move、create_staging_reference 结构性不可达
 * （必填字段根本不在传输 schema 的 properties 里），加上另一份重名工具共 7 条不可构造。
 *
 * 判据（对每个带 `operation` 枚举的工具、每个枚举值）：
 *   ① 按传输 schema 生成一份最小实例（必填全填、数组按 minItems 给样本）；
 *   ② 过 validateToolArguments（= 运行时真正用的那个校验器）；
 *   ③ 过 tool.build(args)（= capability adapter 的 parseCall，里面是 Zod 执行边界）。
 * ②③ 任一过不去 ⇒ 红，并指出缺哪个字段、这个字段在不在传输 schema 里。
 *
 * 「缺字段就自动补」不是放水：补的**只能是传输 schema 自己声明过的属性**。
 * 一旦校验器要一个传输 schema 里没有的字段，这个 operation 就是结构性不可达 —— 正是要拦的东西。
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const { MCP_TOOL_RESOLVER } = await import(path.join(repoRoot, 'electron/capabilityCore/mcpToolCatalog.ts'))
const { validateToolArguments } = await import(path.join(repoRoot, 'electron/capabilityCore/mcpArgValidation.ts'))

/** 补字段的最多轮数：每轮至少解决一个缺失字段，超过就是环，当作不可构造。 */
const MAX_REPAIR_ROUNDS = 24

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

/** 按一份 schema 造一个最小合法样本（只填必填，数组按 minItems 补足）。 */
function sampleFor(schema) {
  if (!isRecord(schema)) return 'x'
  if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum[0]
  switch (schema.type) {
    case 'object': {
      const out = {}
      const properties = isRecord(schema.properties) ? schema.properties : {}
      for (const key of Array.isArray(schema.required) ? schema.required : []) {
        if (properties[key] !== undefined) out[key] = sampleFor(properties[key])
      }
      return out
    }
    case 'array': {
      const count = typeof schema.minItems === 'number' ? schema.minItems : 0
      return Array.from({ length: count }, () => sampleFor(schema.items))
    }
    case 'integer':
    case 'number': {
      const minimum = typeof schema.minimum === 'number' ? schema.minimum : 1
      return Math.max(minimum, typeof schema.maximum === 'number' ? Math.min(minimum, schema.maximum) : minimum)
    }
    case 'boolean':
      return true
    case 'string':
    default: {
      const minLength = typeof schema.minLength === 'number' ? schema.minLength : 1
      return 'x'.repeat(Math.max(1, minLength))
    }
  }
}

/** 沿 issue 的 path 找到对应的 schema 节点（找不到 ⇒ 这个字段传输层根本没声明）。 */
function schemaAtPath(schema, segments) {
  let node = schema
  for (const segment of segments) {
    if (!isRecord(node)) return undefined
    if (typeof segment === 'number') {
      node = node.items
      continue
    }
    const properties = isRecord(node.properties) ? node.properties : {}
    node = properties[segment]
  }
  return isRecord(node) ? node : undefined
}

function valueAtPath(root, segments) {
  let node = root
  for (const segment of segments) {
    if (node === undefined || node === null) return undefined
    node = node[segment]
  }
  return node
}

function setAtPath(root, segments, value) {
  if (segments.length === 0) return
  let node = root
  for (const segment of segments.slice(0, -1)) {
    if (node[segment] === undefined) node[segment] = typeof segments[segments.indexOf(segment) + 1] === 'number' ? [] : {}
    node = node[segment]
  }
  node[segments[segments.length - 1]] = value
}

/** 这条问题机器补得了吗（用来给 union 分支排序，别挑一条注定死的支路）。 */
function isRepairable(issue) {
  return (issue.code === 'invalid_type' && issue.received === 'undefined')
    || issue.code === 'too_small'
    || issue.code === 'invalid_literal'
    || issue.code === 'invalid_enum_value'
}

/**
 * union 报错本身不指路（`Invalid input`），真正的缺口在 unionErrors 里。
 * 展开成「最容易走通的那条支路」的问题清单：全都补得了的分支优先，其次问题最少的分支。
 * 不展开就会把「这条 operation 其实有活路」误判成不可构造（timeline plan.operations 就是这样假红过）。
 */
function expandIssues(issues) {
  return issues.flatMap((issue) => {
    if (issue.code !== 'invalid_union' || !Array.isArray(issue.unionErrors)) return [issue]
    const branches = issue.unionErrors.map((error) => expandIssues(issuesOf(error)))
    const fullyRepairable = branches.filter((branch) => branch.length > 0 && branch.every(isRepairable))
    const pool = fullyRepairable.length ? fullyRepairable : branches.filter((branch) => branch.length > 0)
    if (!pool.length) return [issue]
    return pool.reduce((best, branch) => (branch.length < best.length ? branch : best))
  })
}

/** Zod 报的问题 → 「往哪儿填什么」。返回 null = 这条问题补不了（结构性不可达或真冲突）。 */
function repairFromIssue(issue, schema, args) {
  const segments = Array.isArray(issue.path) ? issue.path : []
  if (issue.code === 'invalid_literal') {
    setAtPath(args, segments, issue.expected)
    return { repaired: true }
  }
  if (issue.code === 'invalid_enum_value' && Array.isArray(issue.options) && issue.options.length) {
    setAtPath(args, segments, issue.options[0])
    return { repaired: true }
  }
  if (issue.code === 'invalid_type' && issue.received === 'undefined') {
    const node = schemaAtPath(schema, segments)
    if (!node) return { blocked: `校验器要 ${segments.join('.') || '<root>'}，但传输 schema 里没有这个字段` }
    setAtPath(args, segments, sampleFor(node))
    return { repaired: true }
  }
  if (issue.code === 'too_small') {
    const node = schemaAtPath(schema, segments)
    if (!node) return { blocked: `校验器对 ${segments.join('.') || '<root>'} 有下界要求，但传输 schema 里没有这个字段` }
    const current = valueAtPath(args, segments)
    if (Array.isArray(current)) {
      const want = typeof issue.minimum === 'number' ? Number(issue.minimum) : current.length + 1
      while (current.length < want) current.push(sampleFor(node.items))
      return { repaired: true }
    }
    setAtPath(args, segments, sampleFor(node))
    return { repaired: true }
  }
  return null
}

/**
 * 自定义 refine（如「characters 或 customBlocking 二选一」「patch 至少写一个字段」）没有可填的 path。
 * 对这类问题，在**报错所在的那层**按传输 schema 的属性顺序逐个试补一个可选字段：
 * 补进去的仍然只能是传输 schema 声明过的属性，所以这不是放水，而是「这个 operation 到底有没有一条活路」。
 */
function candidateOptionalKeys(schema, segments, args) {
  const node = schemaAtPath(schema, segments) ?? schema
  if (!isRecord(node) || !isRecord(node.properties)) return []
  const present = valueAtPath(args, segments)
  const already = isRecord(present) ? new Set(Object.keys(present)) : new Set()
  return Object.keys(node.properties).filter((key) => !already.has(key))
}

function attemptBuild(tool, args) {
  try {
    tool.build(args)
    return { ok: true }
  } catch (error) {
    return { ok: false, error }
  }
}

function issuesOf(error) {
  return Array.isArray(error?.issues) ? error.issues : []
}

function constructOperation(tool, operationValue, seed) {
  const schema = tool.inputSchema
  const args = seed ?? sampleFor(schema)
  args.operation = operationValue
  for (const key of Array.isArray(schema.required) ? schema.required : []) {
    if (args[key] === undefined) args[key] = sampleFor(schema.properties?.[key])
  }

  for (let round = 0; round < MAX_REPAIR_ROUNDS; round += 1) {
    const transportError = validateToolArguments(tool.name, schema, args)
    if (transportError) return { ok: false, reason: `传输 schema 拒绝了自己生成的最小实例：${transportError.message}` }
    const built = attemptBuild(tool, args)
    if (built.ok) return { ok: true, args }

    const issues = expandIssues(issuesOf(built.error))
    if (!issues.length) return { ok: false, reason: `构造失败：${built.error?.message ?? String(built.error)}` }

    let progressed = false
    for (const issue of issues) {
      const repair = repairFromIssue(issue, schema, args)
      if (repair?.blocked) return { ok: false, reason: repair.blocked }
      if (repair?.repaired) progressed = true
    }
    if (progressed) continue

    // 只剩自定义 refine（「二选一」「至少写一个字段」这类没有可填 path 的约束）：
    // 在报错那一层按传输 schema 的属性表逐个试补**一个**可选字段，只接受**整体构造成功**的那次。
    // 只接受完全成功是刻意的：接受「错误变了」会把无关字段一路堆进参数里，反而制造假红。
    const custom = issues.find((issue) => issue.code === 'custom') ?? issues[0]
    const segments = Array.isArray(custom.path) ? custom.path : []
    for (const key of candidateOptionalKeys(schema, segments, args)) {
      const node = schemaAtPath(schema, [...segments, key])
      if (!node) continue
      const probe = JSON.parse(JSON.stringify(args))
      setAtPath(probe, [...segments, key], sampleFor(node))
      if (validateToolArguments(tool.name, schema, probe)) continue
      if (attemptBuild(tool, probe).ok) return { ok: true, args: probe }
      // 补一个字段后如果还剩**可补**的问题，接着走主循环（例如 select 与 patch 同时缺）。
      const remaining = expandIssues(issuesOf(attemptBuild(tool, probe).error))
      if (remaining.length && remaining.every(isRepairable)) {
        setAtPath(args, [...segments, key], sampleFor(node))
        return constructOperation(tool, args.operation, args)
      }
    }
    return { ok: false, reason: `构造失败（补不出一条活路）：${issues.map((issue) => `${(issue.path ?? []).join('.') || '<root>'}: ${issue.message}`).join('；')}` }
  }
  return { ok: false, reason: `补了 ${MAX_REPAIR_ROUNDS} 轮仍构造不出合法参数` }
}

function operationEnumOf(tool) {
  const property = tool.inputSchema?.properties?.operation
  return Array.isArray(property?.enum) ? property.enum : null
}

const failures = []
let checked = 0
for (const tool of MCP_TOOL_RESOLVER.list()) {
  const operations = operationEnumOf(tool)
  if (!operations) continue
  for (const operation of operations) {
    checked += 1
    const outcome = constructOperation(tool, operation)
    if (outcome.ok) {
      console.log(`✓ ${tool.name}(operation=${operation})`)
    } else {
      failures.push(`${tool.name}(operation=${operation}) — ${outcome.reason}`)
      console.log(`✗ ${tool.name}(operation=${operation}) — ${outcome.reason}`)
    }
  }
}

if (!checked) {
  console.error('✖ 没有找到任何带 operation 枚举的工具——门岗等于没跑（fail-closed）')
  process.exit(1)
}
if (failures.length) {
  console.error(`\n✖ ${failures.length}/${checked} 个 operation 构造不出合法参数：`)
  for (const failure of failures) console.error(`  · ${failure}`)
  console.error('\n  → 传输 schema 必须派生自执行校验器（见 electron/capabilityCore/mcpTransportSchemaFromZod.ts），不要再手写第二份。')
  process.exit(1)
}
console.log(`\n✅ ${checked} 个 operation 全部可构造。`)
