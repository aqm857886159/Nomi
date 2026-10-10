#!/usr/bin/env node
/**
 * 门岗 · **动词声明的形状，宿主收得下**。
 *
 * ── 它在治哪一类真实故障 ──
 *
 * 模型看见的是 20 个动词（`verbDeclarations.ts`），宿主认的是各领域契约的语义输入。
 *
 * **2026-09-18 投影化之后，这两端在 11 个动词上已经是同一份 schema** 了（模型面 = 宿主面
 * `.omit(宿主自补的字段)`，`verbs/verbProjections.ts`）。对那 11 个，下面 R1–R3 是按构造成立的——
 * 它们照跑，但跑出来的是恒真，成本是几毫秒。**这道门今天真正在管的是剩下那 9 个**：
 *   · `draft_shots`：唯一的**有损**投影（嵌套层级 / 拍平 / 参考素材身份由宿主补），
 *     `verbs/draftShotsProjection.ts`；
 *   · 七个走 `semanticInputOf` 的动词（读写文稿、时间轴读、五合一素材读、三个画布写）：
 *     它们把模型面**构造**成宿主的某一支，不是投影；
 *   · 两个**双域**动词在生成域那一半的那一条改名（`verbs/verbDualDomain.ts`）。
 * 这三类里那层翻译仍然是手写的，而没有任何东西检查这个**复合**成不成立，于是同一族故障反复回来：
 *
 *   A 类 · 动词声明了宿主 `.strict()` 不认的字段
 *          （2026-09-18 真机：每镜 `title` / `durationSec` → `generation_input_invalid` × 3 次，
 *            分镜天生带标题和时长，这条路 100% 失败）
 *   B 类 · 宿主要求动词给不出的字段
 *          （多镜硬要整只 `candidate`；参考素材硬要 `contentHash`/`version` —— 两个读动词都不返回它们；
 *            `document.read` 必填 `scope` 而动词说它可选）
 *   C 类 · 翻译层改了名字/单位/嵌套，两端对不上
 *          （`durationSec` → 顶层 `durationSeconds`，而宿主的时长在 `parameters.duration` 里）
 *   D 类 · 翻译层**静默丢掉**动词声明过的字段 —— 最阴的一条，因为它连错都不报
 *          （顶层 `taskKind` / `candidate`、逐镜 `candidate`：模型点名「用 apimart 的 image-1」，
 *            宿主照用户默认模型去花钱，没有任何人被告知）
 *
 * 这些全都编译得过、单测过、广播得出去，只有真模型在下一次**付费**运行里用一次失败告诉你。
 *
 * ── 为什么门岗长这样 ──
 *
 * 对外 MCP 面早就有同族的一道（`check-mcp-operation-constructible.mjs`：tools/list 上每个 operation
 * 都必须构造得出来）。内部动词面一直没有对应的那道——这正是为什么 `title`/`durationSec` 这类只在
 * 内部面上出现。这道门是它的内部面同胞，不是第二份实现：判据同样是「照着广播出去的 schema 造实例，
 * 喂进运行时真正用的那个校验器」。
 *
 * 五条判据（前四条对每个动词、每个投影出去的面）。为什么投影化之后它们没有一起删掉：
 * 裁决 §3 的判断「投影之后 R1–R3 退化成一句子集断言」只对**纯投影**的那 11 个成立；剩下 9 个里缝还在，
 * 而 R1/R2/R2b/R3 正是量那条缝的唯一一把尺子（2026-09-18 的 A/B/C/D 四类全出在它们身上）。
 * 恒真地跑那 11 个的成本是几毫秒，删掉的成本是另外 9 个重新变成盲区——所以留着。
 *   R1 最小实例    只填必填 → 宿主必须收（宿主要的东西，动词必须先告诉过模型）
 *   R2 字段填满    动词允许模型填的每个字段都填上 → 宿主必须收（示例只证「照抄示例能过」）
 *   R3 不丢字段    模型填进去的每个值都要在翻译结果里找得到；丢了就得在下面**具名登记**并写明理由
 *   R4 落得了地    翻译出来的 lane 必须有真适配器认（删掉的 `modelSetup` 分支就是死在这条上）
 *   R5 一路活到底  宿主收下之后的**下游投影**不许再手抄字段表：凡是有「穷尽键名常量 + 整只搬的
 *                  helper」的信封类型，任何别的地方都不许用 `{ a: x.a, b: x.b }` 重建它
 *
 * R5 治的是同一条不变量的**下半程**。2026-09-18 同一天：模型拟的镜头 `title` 从动词出发，被宿主收下了，
 * 然后在五处手写的逐字段重建里各死一次（翻译层、草稿信封、密封条目两支、门卡投影、持久化投影），
 * 每一处都编译得过、测试全绿——手写字段表漏掉一个新字段，TypeScript 一个字都不说。修法是
 * `electron/shared/generationShotEnvelope.ts`：键名常量与类型由一行编译期断言钉死，投影处一律 spread
 * `generationShotEnvelopeOf(shot)`。那行断言拦得住「加类型忘了加常量」，拦不住**新长出来的第六处手抄**——
 * R5 就是拦那个的。
 *
 * 阳性对照内置（`selfCheck()`）：拿一份故意写坏的声明跑同一把尺子，四条各必须报红——
 * 不然这道门在尺子失效时会全绿，那比没有门更糟。
 */
import fs from 'node:fs'
import path from 'node:path'
import { importLocal, repoRoot } from './lib/repoPaths.mjs'

const load = (relative) => importLocal(relative)

const { VERB_DECLARATIONS } = await load('electron/shared/agentCapabilities/verbDeclarations.ts')
const { CAPABILITY_CONTRACTS } = await load('electron/shared/agentCapabilities/registry.ts')
const { toPublishedJsonSchema } = await load('electron/shared/agentCapabilities/modelVisibleJsonSchema.ts')
const { toSemanticInput, toModelFacingToolSpec } = await load('electron/shared/agentCapabilities/modelFacingTools.ts')
const { verbToTransportCall, exportJobTransportCall } = await load('electron/agentLane/laneVerbTransport.ts')
const { generationPlanInputSchema, generationStatusInputSchema } = await load('electron/shared/agentCapabilities/generationPlanSchemas.ts')
const { GENERATION_METHODS } = await load('electron/shared/agentCapabilities/generation.ts')
const { PROVENANCE_UNVERIFIABLE } = await load('electron/shared/agentCapabilities/verbs/verbFieldProvenance.ts')
const { assetReadInputForAlias } = await load('electron/shared/agentCapabilities/assetRead.ts')
const { exportReadInputForAlias, exportWriteInputForAlias } = await load('electron/shared/agentCapabilities/exportCapabilities.ts')
const { timelineWriteInputForAlias } = await load('electron/shared/agentCapabilities/timelineWrite.ts')
const { canvasDeleteInputForAlias } = await load('electron/shared/agentCapabilities/canvasDelete.ts')
const { skillReadInputForAlias } = await load('electron/shared/agentCapabilities/skillRead.ts')
const { skillWriteInputForAlias } = await load('electron/shared/agentCapabilities/skillWrite.ts')

/**
 * R3 的具名登记：翻译层**有意**不往下传的字段，以及为什么。
 *
 * 这不是豁免名单，是声明：每条都说清那个字段被谁吃掉了。登记一条的成本是写一句人话，
 * 忘记登记的成本是门岗当场红——这个方向是故意的（R17：能让门岗拦的别留给人）。
 */
const TRANSLATOR_CONSUMED = {
  'check_job/domain': 'laneVerbTransport.verbToTransportCall 消费为 generation/export lane；域内宿主只接收自己的 jobId/operationId，不再次选择任务域',
  'cancel_job/domain': 'laneVerbTransport.verbToTransportCall 消费为 generation/export lane；laneExtendedDesktopPorts 先要求明确任务域，禁止用取消失败探测另一个域',
  'draft_shots/shots[].role': 'patch 分支改的是候选，role 是逐镜信封字段，宿主的 candidatePatch 不收（表上是 refuse：填了就当场拒，不会静默丢）',
  'read_script/scope': 'scope 是契约的 operation 判别值，翻译成 full/selection 后由方法名承载',
  'write_script/where': '同上：where 翻成 document.write 的 operation（insert/replace/append）',
  'arrange_canvas/tidy': '布尔开关本身就是 operation 判别（tidy:true → tidy_canvas），不作为字段下传',
  'stage_shot/staging': '包裹对象摊平进 create_staging_reference 的字段',
  'stage_shot/cameraMove': '包裹对象摊平进 create_camera_move 的字段',
  'make_artifact/fileType': '折进 artifact.fileType（节点内部结构），值仍在 payload 里',
}

/** 每个 lane 的宿主桥 = 各传输适配器**真正调用的那个函数**，不是另写一份校验。 */
function hostBridge(lane, toolName, args) {
  switch (lane) {
    case 'generation': {
      const schema = toolName === GENERATION_METHODS.plan ? generationPlanInputSchema
        : toolName === GENERATION_METHODS.status ? generationStatusInputSchema : undefined
      if (!schema) throw new Error(`生成 lane 没有 ${toolName} 的宿主 schema`)
      const parsed = schema.safeParse(args)
      if (!parsed.success) throw new Error(issuesOf(parsed.error))
      return
    }
    case 'media':
      if (assetReadInputForAlias(toolName, args) || exportReadInputForAlias(toolName, args)) return
      throw new Error(`media lane 的两座桥都不认 ${toolName}`)
    case 'export':
      if (!exportWriteInputForAlias(toolName, args)) throw new Error(`export 桥不认 ${toolName}`)
      return
    case 'timeline':
      if (!timelineWriteInputForAlias(toolName, args)) throw new Error(`timeline 桥不认 ${toolName}`)
      return
    case 'canvas':
      if (!canvasDeleteInputForAlias(toolName, args)) throw new Error(`canvas 桥不认 ${toolName}`)
      return
    case 'skillRead':
      if (!skillReadInputForAlias(toolName, args)) throw new Error(`skillRead 桥不认 ${toolName}`)
      return
    case 'skillWrite':
      if (!skillWriteInputForAlias(toolName, args)) throw new Error(`skillWrite 桥不认 ${toolName}`)
      return
    default:
      // R4：翻出一个没有适配器的 lane = 这个动词被调用时必然 `capability_unsupported`。
      throw new Error(`没有任何传输适配器认 lane "${lane}"`)
  }
}

function issuesOf(error) {
  return (error?.issues ?? []).map((issue) => `${(issue.path ?? []).join('.') || '(root)'}: ${issue.message}`).join(' · ')
}

const isRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const clone = (value) => JSON.parse(JSON.stringify(value))

let numberSeed = 0
/** 按一份 JSON Schema 造实例。`required` 为真时只填必填，否则把允许填的都填上。 */
function instanceFor(schema, requiredOnly) {
  if (!isRecord(schema)) return 'x'
  if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum[0]
  if (schema.const !== undefined) return schema.const
  const branches = schema.anyOf ?? schema.oneOf
  if (Array.isArray(branches) && branches.length) return instanceFor(branches[0], requiredOnly)
  switch (schema.type) {
    case 'object': {
      const out = {}
      const properties = isRecord(schema.properties) ? schema.properties : {}
      const keys = requiredOnly ? (Array.isArray(schema.required) ? schema.required : []) : Object.keys(properties)
      for (const key of keys) if (properties[key] !== undefined) out[key] = instanceFor(properties[key], requiredOnly)
      return out
    }
    case 'array': {
      const count = Math.max(typeof schema.minItems === 'number' ? schema.minItems : 1, 1)
      return Array.from({ length: count }, () => instanceFor(schema.items ?? { type: 'string' }, requiredOnly))
    }
    case 'string': {
      // 字符串值要**互不相同**，否则 R3 的「值还在不在」会被巧合的重复值骗过去。
      numberSeed += 1
      const body = `s${numberSeed}`
      const min = typeof schema.minLength === 'number' ? schema.minLength : 1
      return body.length >= min ? body : body.padEnd(min, 'x')
    }
    case 'integer':
    case 'number': {
      numberSeed += 1
      const inclusive = typeof schema.minimum === 'number' ? schema.minimum : 1
      const exclusive = typeof schema.exclusiveMinimum === 'number' ? schema.exclusiveMinimum + 1 : Number.NEGATIVE_INFINITY
      return Math.max(inclusive, exclusive, numberSeed)
    }
    case 'boolean': return true
    case 'null': return null
    default: return 'x'
  }
}

/**
 * 从一个合法种子出发，把 schema 允许的每个缺席字段逐个试着补上，保留仍然合法的那些。
 * 跨字段约束（`stage_shot` 的二选一、范围的两端同在）因此天然被尊重——不必在门岗里复述一遍。
 */
function saturate(seed, published, verbSchema) {
  let current = clone(seed)
  const at = (root, keys) => keys.reduce((acc, key) => (acc == null ? acc : acc[key]), root)
  for (let round = 0; round < 6; round += 1) {
    const additions = []
    const walk = (schema, keys) => {
      if (!isRecord(schema)) return
      const branches = schema.anyOf ?? schema.oneOf
      if (Array.isArray(branches)) { for (const branch of branches) walk(branch, keys); return }
      const node = at(current, keys)
      if (schema.type === 'object') {
        if (!isRecord(node)) return
        for (const [key, child] of Object.entries(isRecord(schema.properties) ? schema.properties : {})) {
          if (node[key] === undefined) additions.push({ keys: [...keys, key], child })
          else walk(child, [...keys, key])
        }
      } else if (schema.type === 'array' && Array.isArray(node)) {
        node.forEach((_, index) => walk(schema.items ?? {}, [...keys, index]))
      }
    }
    walk(published, [])
    if (!additions.length) break
    let changed = false
    for (const addition of additions) {
      const attempt = clone(current)
      const parent = at(attempt, addition.keys.slice(0, -1))
      if (!parent || typeof parent !== 'object') continue
      parent[addition.keys[addition.keys.length - 1]] = instanceFor(addition.child, false)
      if (verbSchema.safeParse(attempt).success) { current = attempt; changed = true }
    }
    if (!changed) break
  }
  return current
}

/** 一份载荷里出现过的全部叶子值（R3 按值比对，所以改名不算丢）。 */

/**
 * 一份载荷里每个叶子值**第一次出现的路径**（与 `fieldProbes` 同一种路径写法：`shots[].shotId`）。
 * R3 从示例出发时用它把「丢了哪个值」翻回「丢了哪个字段」，好对得上 TRANSLATOR_CONSUMED 的登记键。
 */
function leafPaths(value, keys = [], out = new Map()) {
  if (Array.isArray(value)) { for (const item of value) leafPaths(item, [...keys, '[]'], out); return out }
  if (isRecord(value)) { for (const [key, item] of Object.entries(value)) leafPaths(item, [...keys, key], out); return out }
  if (value === undefined) return out
  const leaf = `${typeof value}:${String(value)}`
  if (!out.has(leaf)) out.set(leaf, keys.join('.').replace(/\.\[\]/g, '[]'))
  return out
}

/**
 * 同一份载荷的叶子值集合。**从 `leafPaths` 派生**：那张表的键就是叶子身份
 * （`${typeof}:${值}`），再写一个同形状的递归遍历只会多一份要一起改的东西。
 */
function leafValues(value) {
  return new Set(leafPaths(value).keys())
}

/** 把一个动词的一次调用走完整条路；返回这次调用的全部问题。 */
function checkCall(verb, spec, contract, label, args) {
  const problems = []
  let transported
  try {
    transported = verbToTransportCall({ toolCallId: 'gate-1', toolName: verb.name, args })
  } catch (error) {
    return { problems: [`${label}：翻译层抛了 — ${error.message}`], translated: undefined }
  }
  let translated
  if (transported) {
    translated = transported.call.args
    try {
      hostBridge(transported.lane, transported.call.toolName, transported.call.args)
    } catch (error) {
      problems.push(`${label} → ${transported.lane}/${transported.call.toolName} 被宿主拒收：${error.message}\n        载荷 ${JSON.stringify(translated)}`)
    }
    if (verb.name === 'check_job' || verb.name === 'cancel_job') {
      const other = exportJobTransportCall({ toolCallId: 'gate-1', toolName: verb.name, args })
      try {
        const accepted = verb.name === 'cancel_job'
          ? exportWriteInputForAlias(other.toolName, other.args)
          : exportReadInputForAlias(other.toolName, other.args)
        if (!accepted) throw new Error('导出域那一半不认这次调用')
      } catch (error) {
        problems.push(`${label} → 导出域 ${other.toolName} 被拒收：${error.message}`)
      }
    }
  } else {
    // 常驻动词：执行绑在 lane 自己的工具上，语义输入经声明的 `semanticInputOf` 过契约。
    try {
      translated = toSemanticInput(spec, args)
      const parsed = contract.inputSchema.safeParse(translated)
      if (!parsed.success) {
        problems.push(`${label} → ${contract.id} 被宿主拒收：${issuesOf(parsed.error)}\n        载荷 ${JSON.stringify(translated)}`)
      }
    } catch (error) {
      return { problems: [...problems, `${label} → ${contract.id}：语义翻译抛了 — ${error.message}`], translated: undefined }
    }
  }
  return { problems, translated }
}

/**
 * R3 · 逐字段探针：从最小实例出发，**一次只加一个字段**，看这个字段的值有没有到达宿主。
 *
 * 为什么不是「把字段填满再整体比对」：填满时一个字段可能被另一个更具体的字段合法地盖掉
 * （顶层 `candidate` 被逐镜 `candidate` 覆盖），整体比对分不清「被覆盖」和「被丢掉」。
 * 一次一个变量，量到的才是这个字段自己的命运。
 */
/**
 * 把最小实例修到「过得了这个动词自己的 refine」为止：**只补它点名缺的那几条路径**，值从示例里取。
 *
 * 为什么不整份换成示例：示例里本来就带着更具体的字段（逐镜 `candidate` / `modelId`），
 * 再去探顶层同名字段时它会被合法地覆盖——那是「被盖掉」，不是「被丢掉」，整份换会把这类误报带回来。
 * 补不齐（示例里也没有那个值）就返回 undefined，由调用方当场报问题，不许静默跳过。
 */
function repairedMinimal(verb, minimal, seeds) {
  const attempt = clone(minimal)
  for (let round = 0; round < 5; round += 1) {
    const parsed = verb.schema.safeParse(attempt)
    if (parsed.success) return attempt
    let changed = false
    for (const issue of parsed.error.issues) {
      if (!issue.path.length) continue
      const key = issue.path[issue.path.length - 1]
      const parent = issue.path.slice(0, -1).reduce((acc, part) => (acc == null ? acc : acc[part]), attempt)
      if (!parent || typeof parent !== 'object' || parent[key] !== undefined) continue
      for (const seed of seeds) {
        const value = issue.path.reduce((acc, part) => (acc == null ? acc : acc[part]), seed.arguments)
        if (value === undefined) continue
        parent[key] = clone(value)
        changed = true
        break
      }
    }
    if (!changed) break
  }
  // 补不齐（判别联合这类，缺口不是「少一个字段」而是「形状不对」）：退到**过得了的那份示例**。
  // 它可能带着更具体的字段，于是同名的上层字段会被合法覆盖——那种误报在下面按 `shadowedBy` 排除。
  return seeds.map((seed) => seed.arguments).find((args) => verb.schema.safeParse(args).success)
}

function fieldProbes(verb, published, minimal) {
  const probes = []
  const walk = (schema, keys, container) => {
    if (!isRecord(schema) || !isRecord(container)) return
    const properties = isRecord(schema.properties) ? schema.properties : {}
    for (const [key, child] of Object.entries(properties)) {
      const pathKeys = [...keys, key]
      const pathLabel = pathKeys.map((part) => (typeof part === 'number' ? '[]' : part)).join('.').replace(/\.\[\]/g, '[]')
      if (container[key] === undefined) {
        const attempt = clone(minimal)
        const parent = pathKeys.slice(0, -1).reduce((acc, part) => (acc == null ? acc : acc[part]), attempt)
        if (!parent || typeof parent !== 'object') continue
        parent[key] = instanceFor(child, false)
        const parsed = verb.schema.safeParse(attempt)
        if (parsed.success) probes.push({ path: pathLabel, field: key, args: parsed.data })
      } else if (isRecord(child) && child.type === 'object') {
        walk(child, pathKeys, container[key])
      } else if (isRecord(child) && child.type === 'array' && Array.isArray(container[key]) && container[key].length) {
        walk(child.items ?? {}, [...pathKeys, 0], container[key][0])
      }
    }
  }
  walk(published, [], minimal)
  return probes
}

function checkVerb(verb) {
  const contract = CAPABILITY_CONTRACTS.find((candidate) => candidate.id === verb.contractId)
  if (!contract) return [`${verb.name} 落在一个没注册的能力上：${verb.contractId}`]
  const spec = toModelFacingToolSpec(verb)
  const published = toPublishedJsonSchema(verb.schema)
  const cases = []
  const minimal = instanceFor(published, true)
  if (verb.schema.safeParse(minimal).success) cases.push({ label: 'R1 最小实例', args: verb.schema.parse(minimal) })
  const seeds = (verb.examples ?? []).filter((example) => verb.schema.safeParse(example.arguments).success)
  for (const [index, example] of seeds.entries()) {
    cases.push({ label: `R2 字段填满 · 示例#${index + 1}`, args: verb.schema.parse(saturate(example.arguments, published, verb.schema)) })
  }
  // R2b · 两两组合。最小实例（一个可选字段都不给）与字段填满（全给）之间还有一大片：
  // 「只有这两个字段同时在场才出问题」的那一类。2026-09-18 实测这条是必需的——把范围约束拿掉、
  // 让翻译层重新替模型编造 `endFrame: 0`，只有 `{assetId, startFrame}` 这种**两字段**调用才暴露它，
  // 最小实例与全字段实例都是绿的。字段数不多，两两全跑得起。
  const optionalFields = Object.entries(isRecord(published.properties) ? published.properties : {})
    .map(([key]) => key)
    .filter((key) => !(Array.isArray(published.required) ? published.required : []).includes(key))
  for (let i = 0; i < optionalFields.length; i += 1) {
    for (let j = i + 1; j < optionalFields.length; j += 1) {
      const attempt = clone(minimal)
      if (!isRecord(attempt)) continue
      attempt[optionalFields[i]] = instanceFor(published.properties[optionalFields[i]], false)
      attempt[optionalFields[j]] = instanceFor(published.properties[optionalFields[j]], false)
      const parsed = verb.schema.safeParse(attempt)
      if (parsed.success) cases.push({ label: `R2b 两字段 · ${optionalFields[i]} + ${optionalFields[j]}`, args: parsed.data })
    }
  }
  const full = instanceFor(published, false)
  if (verb.schema.safeParse(full).success) {
    cases.push({ label: 'R2 字段填满 · 全字段', args: verb.schema.parse(saturate(full, published, verb.schema)) })
  }
  if (!cases.length) return [`${verb.name} 一个可构造的调用都造不出来（示例、最小实例、全字段实例全部过不了它自己的 schema）`]
  const seen = new Set()
  const problems = []
  for (const item of cases) {
    const key = JSON.stringify(item.args)
    if (seen.has(key)) continue
    seen.add(key)
    const outcome = checkCall(verb, spec, contract, item.label, item.args)
    problems.push(...outcome.problems)
    // R1b · 最小实例里**每个必填字段**的值都要到达宿主。R3 只探可选字段（它一次加一个），必填字段
    // 在最小实例里本来就在、从不被单独探——于是「必填字段被翻译层静默丢掉」此前对这把尺子是盲区，
    // 2026-09-18 阳性对照 ⑤ 做成真的那一刻才露出来。最小实例没有可选字段，不存在「被更具体的字段合法盖掉」。
    if (item.label === 'R1 最小实例' && outcome.translated !== undefined) {
      const kept = leafValues(outcome.translated)
      for (const [field, value] of Object.entries(isRecord(item.args) ? item.args : {})) {
        if (TRANSLATOR_CONSUMED[`${verb.name}/${field}`]) continue
        const missing = [...leafValues(value)].filter((leaf) => !kept.has(leaf))
        if (!missing.length) continue
        problems.push(`R1b 必填字段：字段 "${field}" 被翻译层静默丢掉（丢了 ${missing.slice(0, 3).join(', ')}）`
          + '\n        → 要么把它传下去，要么在 TRANSLATOR_CONSUMED 里按这个路径具名登记并写清它被谁吃掉了')
      }
    }
  }
  // 逐字段探针的起点：最小实例过不了这个动词自己的 refine 时，退到**过得了的那份示例**。
  //
  // 2026-09-22 总合并实测到的盲区：`draft_shots` 把「新建必须给 prompt」从 schema 的 required
  // 挪进了 superRefine（为的是让「只改一个参数」的修订不被要求重抄整段提示词），于是
  // `instanceFor` 造出来的最小实例 `{shots:[{}]}` 过不了 refine ——这一整块逐字段探针**一条都没跑**，
  // 而 `if (...success) { ... }` 把这件事吞得无声无息（教训 `vacuous-probe-passes-forever`：
  // 测不到它命名的那件事，断言就永远绿）。C 类变异（时长落到一个语义不对的宿主字段上）因此抓不到。
  // 现在：**按这个动词自己报的缺口**从示例里补最少的那几个字段（只补它点名的路径，不整份换成示例——
  // 整份换会把「顶层 candidate 被逐镜 candidate 合法覆盖」这类误报带回来），补不齐就当场报问题。
  const probeBase = repairedMinimal(verb, minimal, seeds)
  if (probeBase === undefined) {
    problems.push('R3 逐字段：最小实例与全部示例都过不了这个动词自己的 refine，逐字段探针一条都没跑——这把尺子在这个动词上是瞎的'
      + '\n        → 给它补一份过得了 refine 的示例，或把 refine 的前提写回 schema 的 required')
  } else {
    for (const probe of fieldProbes(verb, published, verb.schema.parse(probeBase))) {
      const outcome = checkCall(verb, spec, contract, `R3 逐字段 · ${probe.path}`, probe.args)
      if (outcome.translated === undefined) continue
      const kept = leafValues(outcome.translated)
      const sent = leafValues(probe.args[probe.field] ?? probe.args)
      const missing = [...leafValues(probe.args)].filter((leaf) => !kept.has(leaf) && sent.has(leaf))
      if (!missing.length) continue
      if (TRANSLATOR_CONSUMED[`${verb.name}/${probe.path}`]) continue
      problems.push(`R3 逐字段：字段 "${probe.path}" 被翻译层静默丢掉（丢了 ${missing.slice(0, 3).join(', ')}）`
        + '\n        → 要么把它传下去，要么在 TRANSLATOR_CONSUMED 里按这个路径具名登记并写清它被谁吃掉了')
    }
  }
  // R3 · 从**示例**出发：最小实例一次只加一个字段，够不到那些「只有和另一个字段同在才合法」的字段——
  // `draft_shots` 的 `shots[].shotId` 没有 `draftId` 就过不了动词自己的 refine，探针于是从不碰它；
  // 2026-09-18 它就这样被声明成 drop、且门岗全绿了一整天。示例是动词作者亲手写下的「模型会这么调」，
  // 示例里给了值的每个字段都必须到达宿主——同一把尺子、同一份登记，只是起点换成示例。
  for (const [index, example] of seeds.entries()) {
    const args = verb.schema.parse(example.arguments)
    const outcome = checkCall(verb, spec, contract, `R3 示例#${index + 1}`, args)
    if (outcome.translated === undefined) continue
    const kept = leafValues(outcome.translated)
    const dropped = new Map()
    for (const [leaf, fieldPath] of leafPaths(args)) {
      if (kept.has(leaf) || TRANSLATOR_CONSUMED[`${verb.name}/${fieldPath}`]) continue
      dropped.set(fieldPath, [...(dropped.get(fieldPath) ?? []), leaf])
    }
    for (const [fieldPath, leaves] of dropped) {
      problems.push(`R3 示例#${index + 1}：字段 "${fieldPath}" 在示例里给了值，却没有到达宿主（丢了 ${leaves.slice(0, 3).join(', ')}）`
        + '\n        → 要么把它传下去，要么在 TRANSLATOR_CONSUMED 里按这个路径具名登记并写清它被谁吃掉了')
    }
  }
  return problems
}

// ── 阳性对照：坏声明必须报红 ─────────────────────────────────────────────────

async function selfCheck() {
  const donor = VERB_DECLARATIONS.find((verb) => verb.name === 'read_skill')
  if (!donor) return '阳性对照 ⑤ 失效：拿不到参照声明 read_skill'
  // ① 宿主收不下：给一个真实动词喂一份宿主一定拒的载荷
  let rejected = false
  try { hostBridge('skillRead', 'load_skill', { name: 'x', bogusFieldTheHostNeverDeclared: 1 }) } catch { rejected = true }
  if (!rejected) return '阳性对照 ① 失效：宿主桥连一个多余字段都不拒，这把尺子是坏的'
  // ② 没有适配器的 lane 必须红
  let laneRejected = false
  try { hostBridge('aLaneNobodyAdapts', 'whatever', {}) } catch { laneRejected = true }
  if (!laneRejected) return '阳性对照 ② 失效：不存在的 lane 居然被放行'
  // ③ R3 的丢字段判据必须真能抓到：造一份「翻译把字段吃掉」的载荷
  const dropped = [...leafValues({ keptValue: 'a', droppedValue: 'b' })].filter((leaf) => !leafValues({ keptValue: 'a' }).has(leaf))
  if (dropped.length !== 1) return '阳性对照 ③ 失效：叶子值比对抓不到被丢掉的字段'
  // ④ 最小实例判据必须真的只填必填
  const sample = instanceFor({ type: 'object', properties: { a: { type: 'string' }, b: { type: 'string' } }, required: ['a'] }, true)
  if (Object.keys(sample).length !== 1) return '阳性对照 ④ 失效：最小实例把可选字段也填了，R1 等于没跑'
  // ⑤ 整把尺子的阳性对照：一份**坏声明**（动词面多要一个宿主从没声明过的必填字段）喂进
  //    checkVerb，必须报出至少一条问题。此前这里只判了 `broken` 对象的真假——尺子从没被证明会红。
  const { z } = await import('zod')
  if (typeof donor.schema.extend !== 'function') return '阳性对照 ⑤ 失效：参照声明的 schema 不是可扩展的 zod object'
  const broken = { ...donor, schema: donor.schema.extend({ bogusFieldTheHostNeverDeclared: z.string().min(1) }) }
  if (checkVerb(broken).length === 0) return '阳性对照 ⑤ 失效：动词面多要一个宿主不收的必填字段，checkVerb 一条问题都没报——这把尺子不会红'
  return null
}

const selfCheckFailure = await selfCheck()
if (selfCheckFailure) {
  console.error(`✖ ${selfCheckFailure}`)
  process.exit(1)
}

// ── R5 · 信封类型不许被手抄 ───────────────────────────────────────────────────

/**
 * 登记「整只搬」的信封类型。加一条的成本是三行；不加的成本是下一个字段又死在某处手抄里。
 * `keys` 从真模块读，不在这里抄第二份——抄一份就正好犯了这条规则自己要治的病。
 */
const ENVELOPE_OWNERS = [
  {
    module: 'electron/shared/generationShotEnvelope.ts',
    keysExport: 'GENERATION_SHOT_ENVELOPE_KEYS',
    helper: 'generationShotEnvelopeOf',
    /**
     * 判别键：只有同时给它赋值的对象字面量才算「在重建这个信封」。少了这一条，`role` / `title`
     * 这种到处都有的通用词会把无关对象（工作流卡片、引导页节点）全扫进来——一道天天喊狼来了的门
     * 会被人关掉，那比没有门更糟。
     */
    anchorKey: 'shotId',
    what: '一镜的信封（shotId / role / included / title）',
  },
]

/** 同一个对象字面量里给这个信封的 ≥2 个键赋值 = 一处手写重建。 */
const OBJECT_LITERAL = /\{[^{}]{0,600}\}/gs

async function envelopeRebuildFailures() {
  const problems = []
  for (const owner of ENVELOPE_OWNERS) {
    const loaded = await load(owner.module)
    const keys = loaded[owner.keysExport]
    if (!Array.isArray(keys) || keys.length < 2) {
      problems.push(`R5：${owner.module} 没有导出可枚举的 ${owner.keysExport}，这条规则等于没跑（fail-closed）`)
      continue
    }
    if (typeof loaded[owner.helper] !== 'function') {
      problems.push(`R5：${owner.module} 没有导出 ${owner.helper}，「整只搬」没有落点`)
      continue
    }
    for (const file of sourceFiles()) {
      if (file === owner.module) continue
      const text = fs.readFileSync(path.join(repoRoot, file), 'utf8')
      if (text.includes(owner.helper)) continue
      for (const match of text.matchAll(OBJECT_LITERAL)) {
        const body = match[0]
        const assigned = keys.filter((key) => new RegExp(`(?<![\\w.])${key}\\s*:`).test(body))
        if (!assigned.includes(owner.anchorKey) || assigned.length < 2) continue
        const missing = keys.filter((key) => !assigned.includes(key))
        if (!missing.length) continue
        const line = text.slice(0, match.index).split('\n').length
        if (ENVELOPE_REBUILD_ALLOWED[`${file}:${line}`]) continue
        problems.push(`R5 手抄信封：${file}:${line} 用 {${assigned.join(', ')}} 重建了${owner.what}，漏掉 ${missing.join(', ')}`
          + `\n        → 改成 spread ${owner.helper}(shot)；真要只搬一部分，就在 ENVELOPE_REBUILD_ALLOWED 里按 file:line 登记并写清为什么`)
      }
    }
  }
  return problems
}

/** R5 的具名登记：**有意**只搬一部分的地方，以及为什么。同样是声明，不是豁免。 */
const ENVELOPE_REBUILD_ALLOWED = {
  'electron/agentLane/laneVerbTransport.ts:94': '这不是重建而是**剥离**：改草稿走的是候选 patch，宿主那份 patch 的形状里没有信封，信封字段在动词那层已经被拒绝',
}

function sourceFiles() {
  const out = []
  const walk = (relative) => {
    for (const entry of fs.readdirSync(path.join(repoRoot, relative), { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
      const next = `${relative}/${entry.name}`
      if (entry.isDirectory()) { walk(next); continue }
      if (!/\.(ts|mts|tsx)$/.test(entry.name) || entry.name.includes('.test.')) continue
      out.push(next)
    }
  }
  walk('electron')
  walk('src')
  return out
}

// 来源缺口按动词身份做棘轮，不能删 A 加 B 偷换名额；删掉缺口必须同时缩小基线。
// 沿用 contracts 现有入口和变异自检，不另建一条会被忘记接线的验证链。
function provenanceRatchetFailures() {
  const baseline = JSON.parse(fs.readFileSync(path.join(repoRoot, 'scripts/provenance-unverifiable-baseline.json'), 'utf8'))
  if (!Array.isArray(baseline) || baseline.some((name) => typeof name !== 'string') || new Set(baseline).size !== baseline.length) {
    return ['PROVENANCE_UNVERIFIABLE 棘轮基线必须是无重复的动词身份数组']
  }
  const current = Object.keys(PROVENANCE_UNVERIFIABLE)
  const added = current.filter((name) => !baseline.includes(name))
  const stale = baseline.filter((name) => !Object.hasOwn(PROVENANCE_UNVERIFIABLE, name))
  const problems = [
    ...added.map((name) => `PROVENANCE_UNVERIFIABLE 棘轮禁止新增身份：${name}`),
    ...stale.map((name) => `PROVENANCE_UNVERIFIABLE 基线有陈旧身份：${name}；请随修复删掉，不能留给下次回涨`),
  ]
  if (!problems.length) console.log(`✅ PROVENANCE_UNVERIFIABLE 棘轮：${current.length} 条，身份基线一致`)
  return problems
}

const failures = provenanceRatchetFailures()
let checked = 0
for (const verb of VERB_DECLARATIONS) {
  checked += 1
  const problems = checkVerb(verb)
  if (problems.length) {
    failures.push(...problems.map((problem) => `${verb.name} · ${problem}`))
    console.log(`✗ ${verb.name}`)
  } else {
    console.log(`✓ ${verb.name}`)
  }
}

failures.push(...await envelopeRebuildFailures())

if (checked < 20) {
  console.error(`✖ 只扫到 ${checked} 个动词，设计正本说是 20 个——门岗等于没跑（fail-closed）`)
  process.exit(1)
}
if (failures.length) {
  console.error(`\n✖ ${failures.length} 处动词 → 宿主的形状对不上：`)
  for (const failure of failures) console.error(`  · ${failure}`)
  console.error('\n  → 修在最早的共享边界：约束属于动词声明（模型当场被告知），身份属于宿主（别要求模型发明它拿不到的字段）。')
  console.error('    别靠在某个执行器里补一句默认值——那只修了一个面，另一个面照样红。')
  process.exit(1)
}
console.log(`\n✅ ${checked} 个动词的最小实例与字段填满实例，宿主全部收得下；没有字段被翻译层静默丢掉，也没有信封被下游手抄。`)
