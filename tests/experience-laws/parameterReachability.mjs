// 铁律 ⑪「能选到」：模型档案声明的每个参数，在每个用户入口都能选到。
//
// 这份清单**不手抄**：
//   · 「发布了哪些模型」= 内置目录种子（`applyBuiltinSeeds` 落到一份空目录上）里，按 `derivePublishedExecution`
//     真有已发布执行通道的那些行——和用户装好 App 后模型框里能看到的是同一批；
//   · 「每个模型有哪些模式 / 参数」= 用户在那一行上实际吃到的档案（`resolveArchetypeForModel`，带供应商特化、
//     默认变体特化），模式只取这家真发得出的那几个（档案模式的传输类型在已发布执行里）；
//   · 「每个入口能选到什么」= 入口自己渲染时调的那个函数，原样调：
//       节点底栏   `resolveRenderedControls`（NodeParameterControls → InlineParameterBar，摘要 pill 的面板装全部控件）
//                  + `archetypeModeChoices`（模式栏）+ `archetypeVariantChoices`（变体下拉）；
//       Agent 付费卡 `projectSpendNode` 投影出卡体那张生成框，再走同一个 `resolveRenderedControls`
//                  （卡体就是 `NodeGenerationComposer host="panel"`，chips + ⚙ 合起来装全部控件）；
//       分镜表行底栏 `resolveShotArchetypeMode` + `composerBarParams`（select / boolean）+ 画幅覆盖
//                  （`shotAspectChoices`，行菜单与批量条另给 `ASPECT_OPTIONS`）+ 时长胶囊（`shotDurationChoices`）
//                  + `composerModeOptions`；分镜行没有变体选择器。
//
// 判据只有一条：declared ⊆ reachable。做不到的要么在豁免表（`reachabilityWaivers.json`，写清为什么这个入口
// 本来就不该给），要么在已知缺口表（`reachabilityKnownGaps.json`，第一次跑出来、等协调会话决定修哪些的那批）。
// 两张表之外冒出新缺口 = 红；表里登记的缺口已经不存在 = 也红（棘轮只减不增，修好了就从表里删）。
//
// 公开仓库：这里只写用户看得见的事实与代码位置，不写价格、供应商合作信息或私有待办编号。
import { applyBuiltinSeeds } from '../../electron/catalog/seedBuiltins'
import { derivePublishedExecution } from '../../electron/shared/modelPublication'
import { resolveArchetypeForModel, specializeArchetypeForVariant } from '../../electron/shared/modelArchetypes'
import { modeTransportFor } from '../../electron/shared/videoCapabilities'
import { ASPECT_OPTIONS } from '../../electron/shared/storyboard/storyboardShotScope'
import { toCatalogModelOptions } from '../../src/config/modelOptionMappers'
import { resolveRenderedControls } from '../../src/workbench/generationCanvas/nodes/nodeModelArchetype'
import { archetypeModeChoices } from '../../src/workbench/generationCanvas/nodes/controls/channelModeReach'
import { archetypeVariantChoices } from '../../src/workbench/generationCanvas/nodes/controls/archetypeMeta'
import { isParameterReferenceControl } from '../../src/workbench/generationCanvas/model/parameterReferenceSlots'
import { projectSpendNode } from '../../src/workbench/ai/v4/spendCardDraft'
import { resolveShotArchetypeMode } from '../../src/workbench/creation/storyboard/shotRow/shotRowModel'
import {
  composerBarParams,
  composerModeOptions,
  shotAspectChoices,
  shotDurationChoices,
} from '../../src/workbench/creation/storyboard/shotRow/composerBarModel'
import { DURATION_OPTIONS_SEC } from '../../src/workbench/generationCanvas/agent/storyboardPlanEdits'

/** 变体轴与模式轴不是档案参数，但同样是「用户要能选到」的东西；用保留键名进同一张表。 */
export const MODE_AXIS = '(生成方式)'
export const VARIANT_AXIS = '(变体)'

/** 三个入口。`kinds` = 这个入口本来就接哪几类模型（不接的不算缺口，算「不适用」）。 */
export const REACHABILITY_ENTRIES = Object.freeze([
  Object.freeze({
    id: 'node-bar',
    title: '画布节点底栏',
    kinds: Object.freeze(['image', 'video', 'audio', 'model3d']),
    owner: 'src/workbench/generationCanvas/nodes/nodeModelArchetype.ts#resolveRenderedControls',
  }),
  Object.freeze({
    id: 'spend-card',
    title: 'Agent 付费卡',
    kinds: Object.freeze(['image', 'video']),
    owner: 'src/workbench/ai/v4/spendCardDraft.ts#projectSpendNode',
  }),
  Object.freeze({
    id: 'storyboard-row',
    title: '分镜表行底栏',
    kinds: Object.freeze(['image', 'video']),
    owner: 'src/workbench/creation/storyboard/shotRow/composerBarModel.ts#composerBarParams',
  }),
])

const SEED_NOW = '2026-10-05T00:00:00.000Z'

function emptyCatalog() {
  return { version: 4, vendors: [], models: [], mappings: [], apiKeysByVendor: {} }
}

/**
 * 发布模型清单：内置目录种子里每一行（vendor × modelKey），带它已发布的执行模式、
 * 渲染层拿到的 ModelOption（`toCatalogModelOptions`，和模型框同一个映射）与它吃到的档案。
 * 认不出档案的行（通用 flat 解析）不进 ⑪ 第一批：它们没有「档案声明」可对账。
 */
export function publishedModelRows() {
  const state = applyBuiltinSeeds(emptyCatalog(), SEED_NOW).state
  const rows = []
  for (const model of state.models) {
    const execution = derivePublishedExecution(model, { mappings: state.mappings })
    if (!execution.published || execution.publishedModes.length === 0) continue
    const [option] = toCatalogModelOptions([model])
    if (!option) continue
    const archetype = resolveArchetypeForModel({ modelKey: model.modelKey, modelAlias: model.modelAlias ?? null, vendorKey: model.vendorKey, meta: model.meta })
    if (!archetype) continue
    rows.push({ vendorKey: model.vendorKey, modelKey: model.modelKey, kind: model.kind, option, archetype, publishedModes: execution.publishedModes })
  }
  return rows.sort((a, b) => `${a.vendorKey}/${a.modelKey}`.localeCompare(`${b.vendorKey}/${b.modelKey}`))
}

/** 这家真发得出的模式（档案模式的传输类型在已发布执行里）。 */
function sendableModes(row) {
  const specialized = specializeArchetypeForVariant(row.archetype, row.archetype.defaultVariantId)
  return specialized.modes.filter((mode) => row.publishedModes.includes(modeTransportFor(mode, specialized, row.vendorKey)))
}

/**
 * 一个模式**声明**的参数：档案参数里的标量控件。参考类控件（image-url / 带 mediaKind）住参考区，
 * 是另一根轴，不在 ⑪ 第一批的口径里——在这里就按同一个判据（`isParameterReferenceControl`）剔掉，
 * 不在后面再豁免一遍。
 */
function declaredParams(mode) {
  return mode.params.filter((control) => !isParameterReferenceControl(control))
}

function nodeMetaFor(row, mode) {
  return {
    modelKey: row.option.modelKey,
    modelVendor: row.vendorKey,
    archetype: { id: row.archetype.id, modeId: mode.id },
  }
}

function controlsReach(controls) {
  const reach = new Map()
  for (const control of controls) {
    const options = Array.isArray(control.options)
      ? control.options.map((option) => String(typeof option === 'object' && option !== null ? option.value : option))
      : []
    reach.set(control.key, options)
  }
  return reach
}

/** 节点底栏：在这个模式下能选到的参数键（及每键的可选值）、能切到的模式、能切到的变体。 */
function nodeBarReach(row, mode) {
  const meta = nodeMetaFor(row, mode)
  const controls = resolveRenderedControls(row.option, meta, row.kind === 'image', row.kind === 'video')
  return {
    params: controlsReach(controls),
    modes: archetypeModeChoices(row.archetype).map((choice) => choice.id),
    variants: archetypeVariantChoices(row.archetype).map((choice) => choice.id),
  }
}

/** 付费卡：宿主那一镜 → 卡体那张生成框（`projectSpendNode`）→ 同一个控件解析。 */
function spendCardReach(row, mode) {
  const shot = {
    shotId: 'reach-1', index: 1, prompt: 'reach', providerId: row.vendorKey, modelId: row.option.modelKey,
    kind: row.kind, modeId: mode.id, parameters: {}, price: { known: false },
  }
  const node = projectSpendNode(shot, undefined, row.option)
  if (!node) return { params: new Map(), modes: [], variants: [] }
  const controls = resolveRenderedControls(row.option, node.meta ?? {}, row.kind === 'image', row.kind === 'video')
  return {
    params: controlsReach(controls),
    modes: archetypeModeChoices(row.archetype).map((choice) => choice.id),
    variants: archetypeVariantChoices(row.archetype).map((choice) => choice.id),
  }
}

/**
 * 分镜表行：行底栏（select 胶囊 + ⋯ 里的开关）+ 画幅（行菜单 / 批量条给项目预设，覆盖后胶囊再并上档案的档）
 * + 时长胶囊（固定档 ∪ 当前值）+ 模式胶囊。分镜行没有变体选择器。
 */
function storyboardReach(row, mode) {
  const resolved = resolveShotArchetypeMode(row.option, mode.id)
  const params = new Map()
  if (resolved) {
    for (const control of composerBarParams(resolved.mode)) {
      params.set(control.key, control.options.map((option) => String(option.value)))
    }
    if (resolved.mode.params.some((control) => control.key === 'aspect_ratio')) {
      params.set('aspect_ratio', shotAspectChoices(ASPECT_OPTIONS, resolved.mode, ''))
    }
    if (resolved.mode.params.some((control) => control.key === 'duration')) {
      // 时长胶囊永远在（视频镜写生成时长、图片镜写停留时长）；可选值与这镜当前值无关的那部分就是固定档。
      params.set('duration', shotDurationChoices(row.kind === 'image', Number.NaN, DURATION_OPTIONS_SEC).map(String))
    }
  }
  return {
    params,
    modes: composerModeOptions(resolved?.archetype ?? row.archetype).map((option) => option.value),
    variants: [],
  }
}

const REACH_BY_ENTRY = Object.freeze({ 'node-bar': nodeBarReach, 'spend-card': spendCardReach, 'storyboard-row': storyboardReach })

/**
 * 全量矩阵：发布模型 × 这家发得出的模式 × 声明的参数 × 入口。
 * 每一格：`reached`（参数键在入口出现）、`missingOptions`（select 声明的可选值里入口给不出的那些）。
 * 模式轴与变体轴各占一行（`MODE_AXIS` / `VARIANT_AXIS`）。
 */
export function buildReachabilityMatrix(rows = publishedModelRows()) {
  const cells = []
  for (const row of rows) {
    const modes = sendableModes(row)
    const modeIds = modes.map((mode) => mode.id)
    const variants = (row.archetype.variants ?? []).map((variant) => variant.id)
    for (const entry of REACHABILITY_ENTRIES) {
      if (!entry.kinds.includes(row.kind)) continue
      const reachOf = REACH_BY_ENTRY[entry.id]
      const base = { entry: entry.id, vendorKey: row.vendorKey, modelKey: row.modelKey, archetypeId: row.archetype.id, kind: row.kind }
      // 模式轴：只有一种模式时没有「选」这件事。
      if (modeIds.length > 1) {
        const reachable = new Set(reachOf(row, modes[0]).modes)
        const missing = modeIds.filter((id) => !reachable.has(id))
        cells.push({ ...base, modeId: '*', param: MODE_AXIS, type: 'axis', reached: missing.length === 0, missingOptions: missing })
      }
      if (variants.length > 1) {
        const reachable = new Set(reachOf(row, modes[0] ?? row.archetype.modes[0]).variants)
        const missing = variants.filter((id) => !reachable.has(id))
        cells.push({ ...base, modeId: '*', param: VARIANT_AXIS, type: 'axis', reached: missing.length === 0, missingOptions: missing })
      }
      for (const mode of modes) {
        const reach = reachOf(row, mode)
        for (const control of declaredParams(mode)) {
          const offered = reach.params.get(control.key)
          const reached = offered !== undefined
          const declaredOptions = control.type === 'select' ? control.options.map((option) => String(option.value)) : []
          const missingOptions = reached ? declaredOptions.filter((value) => !offered.includes(value)) : []
          cells.push({ ...base, modeId: mode.id, param: control.key, type: control.type, reached, missingOptions })
        }
      }
    }
  }
  return cells
}

/** 一格的缺口：键够不着是 `param`，键够得着但有声明的值选不到是 `options`。 */
export function gapsOf(cells) {
  const gaps = []
  for (const cell of cells) {
    if (!cell.reached && cell.type !== 'axis') gaps.push({ ...cell, gap: 'param' })
    else if (cell.missingOptions.length > 0) gaps.push({ ...cell, gap: cell.type === 'axis' ? 'axis' : 'options' })
  }
  return gaps
}

/**
 * 缺口按「入口 × 参数键 × 缺口形状」归成一类，同一类在多少个模型 / 模式上出现都是同一个结构原因
 * （例如分镜行不给数字输入）。登记表按类登记，不按 (模型, 模式) 一格一格抄——抄格子的表会随每次接新模型变长，
 * 而类只在结构变了的时候变。
 */
export function gapClassKey(gap) {
  return `${gap.entry}|${gap.param}|${gap.gap}${gap.gap === 'param' ? `:${gap.type}` : ''}`
}

export function classifyGaps(gaps) {
  const classes = new Map()
  for (const gap of gaps) {
    const key = gapClassKey(gap)
    const current = classes.get(key) ?? { key, entry: gap.entry, param: gap.param, gap: gap.gap, type: gap.type, models: new Set(), cells: 0, missingOptions: new Set() }
    current.models.add(`${gap.vendorKey}/${gap.modelKey}`)
    current.cells += 1
    for (const value of gap.missingOptions) current.missingOptions.add(value)
    classes.set(key, current)
  }
  return [...classes.values()].sort((a, b) => a.key.localeCompare(b.key))
}

/** 覆盖表（Markdown）：总数、各入口的缺口类、每类影响几个模型。 */
export function renderCoverageTable({ cells, gapClasses, waived, known }) {
  const lines = []
  const entryTitle = new Map(REACHABILITY_ENTRIES.map((entry) => [entry.id, entry.title]))
  const combos = new Set(cells.map((cell) => `${cell.vendorKey}/${cell.modelKey}|${cell.modeId}|${cell.param}`))
  lines.push('# 铁律 ⑪「能选到」覆盖表')
  lines.push('')
  lines.push('由 `tests/experience-laws/parameterReachability.test.mjs` 生成（每次跑测试重写 `artifacts/experience-laws/parameter-reachability.md`）。')
  lines.push('')
  lines.push(`- 发布模型 × 模式 × 参数（含模式轴 / 变体轴）：**${combos.size}** 个组合；乘上适用入口共 **${cells.length}** 格`)
  lines.push(`- 缺口格：**${cells.filter((cell) => !cell.reached || cell.missingOptions.length > 0).length}**；归成 **${gapClasses.length}** 类（豁免 ${waived} 类 · 已知待定 ${known} 类）`)
  lines.push('')
  for (const entry of REACHABILITY_ENTRIES) {
    const entryCells = cells.filter((cell) => cell.entry === entry.id)
    const entryGaps = gapClasses.filter((gap) => gap.entry === entry.id)
    lines.push(`## ${entry.title}（\`${entry.id}\`）`)
    lines.push('')
    lines.push(`覆盖格 ${entryCells.length}，缺口格 ${entryCells.filter((cell) => !cell.reached || cell.missingOptions.length > 0).length}，缺口类 ${entryGaps.length}。渲染真相：\`${entry.owner}\`。`)
    lines.push('')
    if (entryGaps.length === 0) {
      lines.push('无缺口。')
      lines.push('')
      continue
    }
    lines.push('| 参数 | 缺口形状 | 影响模型数 | 影响格数 | 选不到的值 | 归属 |')
    lines.push('|---|---|---|---|---|---|')
    for (const gap of entryGaps) {
      const shape = gap.gap === 'param' ? `整个参数够不着（${gap.type}）` : gap.gap === 'axis' ? '轴上有选项够不着' : '部分取值选不到'
      const values = [...gap.missingOptions].slice(0, 12).join(' / ') + (gap.missingOptions.size > 12 ? ` …共 ${gap.missingOptions.size} 个` : '')
      lines.push(`| \`${gap.param}\` | ${shape} | ${gap.models.size} | ${gap.cells} | ${values || '—'} | ${gap.status} |`)
    }
    lines.push('')
  }
  lines.push(`入口标题：${[...entryTitle.entries()].map(([id, title]) => `\`${id}\` = ${title}`).join('；')}`)
  return `${lines.join('\n')}\n`
}
