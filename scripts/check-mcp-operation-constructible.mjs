#!/usr/bin/env node
/**
 * 门岗 · **tools/list 里每个 operation 枚举值都必须构造得出来，而且每个必填字段都填得出来**。
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
 *
 * ── 2026-09-18：从「可构造」升级成「可填」 ──
 *
 * 上面三条只证「**我们这台机器**能造出一份合法参数」。它证不了另一半：**外部调用方从哪拿到这个值**。
 * 内部动词面上这条缝已经有了名字与代价——宿主曾硬要 `contentHash`/`version`，而两个读动词都不返回
 * 它们，于是带参考图的分镜 100% 失败，而所有门岗全绿（判据见
 * `electron/shared/agentCapabilities/verbs/verbFieldProvenance.ts`）。外部面同一条缝一直没有尺子：
 * 这道门自己会把缺的字段**自动补上**，然后宣布可构造——补出来的那个值，现实里没有人拿得到。
 *
 * 判据 ④：校验器真的要过的每个字段（加上传输 schema 的根级 `required`），都必须在下面
 * `MCP_INPUT_PROVENANCE` 里有一条来源。四档，与内部面同一套判据：
 *   · `caller-authored`            外部模型/宿主自己写得出（提示词、标题、摘要）
 *   · `from-tool:<工具名>`          另一个 MCP 工具的返回里有它——**工具名机器核**，指向一个不存在的
 *                                  工具当场红（这一条拦的是「那个工具后来被删了/改名了」）
 *   · `branch-discriminator`       这个字段就是调用方在选动作（`operation` 自己）
 *   · `from-user-surface:<哪儿>`   值只在 Nomi 界面上（用户看得见），没有任何工具返回它。
 *                                  **这一档是缺口登记，不是来源**：写一条就等于承认「外部宿主只能靠
 *                                  用户念给它听」，它应当随着外部面补齐而减少。
 * 两个方向都红：demand 了却没登记 = 有人往外发了一个没人填得出的必填字段；登记了却再没被 demand
 * = 一条过期的声明（那个字段已经不必填了，或者那个 operation 没了）。
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const { MCP_TOOL_RESOLVER } = await import(path.join(repoRoot, 'electron/capabilityCore/mcpToolCatalog.ts'))
const { validateToolArguments } = await import(path.join(repoRoot, 'electron/capabilityCore/mcpProtocol.ts'))

/**
 * 外部调用方从哪拿到这个值。键是 `<工具名> :: <字段路径>`，数组路径写成 `[]`。
 * 加一条的成本是写一句人话，忘记登记的成本是门岗当场红（R17：能让门岗拦的别留给人）。
 */
const MCP_INPUT_PROVENANCE = {
  // ── 每个工具都要的两件 ──
  'nomi_canvas_edit :: leaseHandle': 'from-tool:nomi_session_open',
  'nomi_canvas_edit :: operation': 'branch-discriminator',
  'nomi_canvas_maintenance :: leaseHandle': 'from-tool:nomi_session_open',
  'nomi_canvas_maintenance :: operation': 'branch-discriminator',
  'nomi_timeline_edit :: leaseHandle': 'from-tool:nomi_session_open',
  'nomi_timeline_edit :: operation': 'branch-discriminator',
  'nomi_export_job :: leaseHandle': 'from-tool:nomi_session_open',
  'nomi_export_job :: operation': 'branch-discriminator',
  // ── 画布：id 全部来自只读投影，一个都不许模型发明 ──
  'nomi_canvas_edit :: nodeId': 'from-tool:nomi_read',
  'nomi_canvas_edit :: nodeIds': 'from-tool:nomi_read',
  'nomi_canvas_edit :: edges': 'from-tool:nomi_read',
  'nomi_canvas_edit :: select': 'from-tool:nomi_read',
  'nomi_canvas_maintenance :: nodeIds': 'from-tool:nomi_read',
  // ── 画布：模型自己写得出的内容 ──
  'nomi_canvas_edit :: nodes': 'caller-authored',
  'nomi_canvas_edit :: summary': 'caller-authored',
  'nomi_canvas_edit :: prompt': 'caller-authored',
  'nomi_canvas_edit :: title': 'caller-authored',
  'nomi_canvas_edit :: anchors': 'caller-authored',
  'nomi_canvas_edit :: shots': 'caller-authored',
  'nomi_canvas_edit :: patch': 'caller-authored',
  // ── 时间轴：改动内容自己写，版本号与撤销令牌都来自上一次读/写的返回 ──
  'nomi_timeline_edit :: plan': 'caller-authored',
  'nomi_timeline_edit :: expectedRevision': 'from-tool:nomi_timeline_read',
  'nomi_timeline_edit :: undoToken': 'from-tool:nomi_timeline_edit',
  /**
   * **缺口登记，不是来源。** 导出在对外面上只有「读一个任务」这一半：`export.write` 是
   * `internal_only`（`exportCapabilities.ts` 的 EXPORT_WRITE_CAPABILITY），而 `nomi_read` 的 target
   * 名单里没有导出任务。所以外部宿主拿到导出 jobId 的唯一途径是**用户在 Nomi 界面上念给它听**。
   * 这条不是 bug 判定——这个工具本来就是给「用户自己在 Nomi 里导出、再让 agent 去核」那条路用的。
   * 但它是一条要拍板的产品缺口（要么对外开一个导出启动/列举，要么这个工具的描述里说清这件事），
   * 所以在这里具名写出来，而不是让门岗自动补一个谁也拿不到的值然后宣布绿。
   */
  'nomi_export_job :: jobId': 'from-user-surface:Nomi 导出任务卡上的任务号',
}

const PROVENANCE_ARCHETYPE = /^(caller-authored|branch-discriminator|from-tool:[a-z0-9_]+|from-user-surface:.+)$/
/** 校验器真的要过的字段（根级 required + 逐条修补时被点名缺的那些）。 */
const demanded = new Set()

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
      // `exclusiveMinimum` 必须一起看：`.positive()` 生成的是 exclusive 边界，而 `.safe()`
      // 同时留下一个 `minimum: -9007199254740991`。只读 `minimum` 会造出一个**负数**样本，
      // 然后被传输 schema 自己拒掉——那是仪器坏了，不是被测对象坏了。
      const inclusive = typeof schema.minimum === 'number' ? schema.minimum : 1
      const exclusive = typeof schema.exclusiveMinimum === 'number'
        ? schema.exclusiveMinimum + (schema.type === 'integer' ? 1 : Number.EPSILON)
        : Number.NEGATIVE_INFINITY
      const minimum = Math.max(inclusive, exclusive)
      return typeof schema.maximum === 'number' ? Math.min(minimum, schema.maximum) : minimum
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
function repairFromIssue(issue, schema, args, toolName) {
  const segments = Array.isArray(issue.path) ? issue.path : []
  // 判据 ④ 的采集点：校验器点名说「缺这个」的字段，就是外部调用方必须填得出来的那些。
  if (issue.code === 'invalid_type' || issue.code === 'too_small') {
    demanded.add(`${toolName} :: ${segments.map((part) => (typeof part === 'number' ? '[]' : part)).join('.')}`)
  }
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
    demanded.add(`${tool.name} :: ${key}`)
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
      const repair = repairFromIssue(issue, schema, args, tool.name)
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
// ── 判据 ④ · 可填：每个必填字段都要答得出「外部调用方从哪拿到它」──

const toolNames = new Set(MCP_TOOL_RESOLVER.list().map((tool) => tool.name))
const fillable = []
for (const key of [...demanded].sort()) {
  const source = MCP_INPUT_PROVENANCE[key]
  if (!source) {
    fillable.push(`${key} — 校验器要这个字段，但没人说得出外部调用方从哪拿到它。`
      + '四档选一：caller-authored / from-tool:<工具名> / branch-discriminator / from-user-surface:<哪儿>。'
      + '答不出来不是登记问题，是这个字段外面根本填不出来。')
    continue
  }
  if (!PROVENANCE_ARCHETYPE.test(source)) {
    fillable.push(`${key} — 来源 "${source}" 不是合法的一档`)
    continue
  }
  if (source.startsWith('from-tool:') && !toolNames.has(source.slice('from-tool:'.length))) {
    fillable.push(`${key} — 说它来自 ${source.slice('from-tool:'.length)}，但 tools/list 上没有这个工具`)
  }
}
for (const key of Object.keys(MCP_INPUT_PROVENANCE)) {
  if (!demanded.has(key)) {
    fillable.push(`${key} — 登记了一条来源，但今天没有任何 operation 需要这个字段。`
      + '过期的声明会让人以为有人想过它——删掉它，或者查清那个 operation 是不是没了。')
  }
}

if (failures.length) {
  console.error(`\n✖ ${failures.length}/${checked} 个 operation 构造不出合法参数：`)
  for (const failure of failures) console.error(`  · ${failure}`)
  console.error('\n  → 传输 schema 必须派生自执行校验器（见 electron/capabilityCore/mcpTransportSchemaFromZod.ts），不要再手写第二份。')
  process.exit(1)
}
if (fillable.length) {
  console.error(`\n✖ ${fillable.length} 个必填字段答不出「外部调用方从哪拿到它」：`)
  for (const failure of fillable) console.error(`  · ${failure}`)
  console.error('\n  → 可构造 ≠ 可填。门岗自己补出来的那个值，现实里得有人拿得到。')
  process.exit(1)
}
console.log(`scanned=${checked}`)
console.log(`\n✅ ${checked} 个 operation 全部可构造，${demanded.size} 个必填字段全部说得出外部调用方从哪拿到。`)
