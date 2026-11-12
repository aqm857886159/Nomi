// 「这个方式这次发哪些参数」的唯一 owner（概念 generation.mode-params，设计卡 docs/plan/2026-11-12-mode-params-owner.md）。
//
// 方式由 modeForInputs 现算（渲染层），参数由这里按「档案 + 这次的方式 + 变体 + 节点上存的值」读出来：
// 只留这个方式声明的键、默认值只取这个方式自己控件上的、固定参数用这个方式的。节点上存的东西一个不动（不写回）。
// 渲染层拼请求时调一次，主进程发送前对同一份请求再调一次——纯函数、同步、幂等，两边结果相同。
//
// 为什么只剥「档案管辖的键」而不是剥光所有未知键：请求的 extras 是混装袋（路由、参考、幂等键、archetypeInput…都在里面），
// 整袋剥会剥坏；管辖范围 = 这个档案所有方式声明过的控件键 ∪ 所有方式的固定参数键（都按供应商、变体特化后）。
import { resolveModelParams } from '../videoCapabilities/resolveModelParams'
import { modeTransportFor } from '../videoCapabilities/modeTransport'
import type { ModelParameterControl } from '../videoCapabilities/types'
import { specializeArchetypeForVariant } from './index'
import type { ArchetypeMode, ModelArchetype } from './types'

export type DeclaredModeParams = {
  /** 这个方式声明的控件（已按供应商 + 变体特化）。参数面板、Agent 准入、发送都读这一份。 */
  controls: readonly ModelParameterControl[]
  /** 这个方式的固定参数（传输判别键等），发送时一定以它为准。 */
  fixedParams: Readonly<Record<string, string>>
}

export type ModeParamsSelection = {
  /** 已按供应商特化的档案（resolveArchetypeForModel 的结果）。 */
  archetype: ModelArchetype
  /** 这次的变体；空 / 认不出 → 档案默认变体（唯一 owner resolveArchetypeVariant 的规则）。 */
  variantId?: string | null
  modeId: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

/** 档案按变体特化后的这一个方式；方式 id 认不出 → null。 */
function specializedMode(selection: ModeParamsSelection): { archetype: ModelArchetype; mode: ArchetypeMode } | null {
  const archetype = specializeArchetypeForVariant(selection.archetype, selection.variantId)
  const mode = archetype.modes.find((candidate) => candidate.id === selection.modeId)
  return mode ? { archetype, mode } : null
}

/** 这个方式声明了哪些控件和固定参数（按供应商 + 变体特化后）。方式认不出 → null。 */
export function declaredModeParams(selection: ModeParamsSelection): DeclaredModeParams | null {
  const resolved = specializedMode(selection)
  if (!resolved) return null
  return { controls: resolved.mode.params, fixedParams: resolved.mode.fixedParams ?? {} }
}

/** 档案管辖的键：所有方式声明过的控件键 ∪ 所有方式的固定参数键（传进来的档案已特化）。 */
function governedKeys(archetype: ModelArchetype): Set<string> {
  const keys = new Set<string>()
  for (const mode of archetype.modes) {
    for (const control of mode.params) keys.add(control.key)
    for (const key of Object.keys(mode.fixedParams ?? {})) keys.add(key)
  }
  return keys
}

/**
 * 这个方式这次发哪些参数。四步，顺序固定：
 *   1. 管辖的键 = 档案所有方式声明过的控件键 ∪ 固定参数键；管辖外的键原样留。
 *   2. 管辖内、这个方式没声明的键不进结果（记进 dropped，不写回节点）。
 *   3. 这个方式声明了、存值缺的：填它自己控件上的默认值；控件没有默认值就不填（键不存在）。
 *   4. 下拉值合法性交给 resolveModelParams（「只修下拉不管数值」），最后铺这个方式的固定参数（archetypeInput 子袋同样覆盖）。
 * 纯函数、同步、不写回、幂等（过两遍 = 过一遍）。方式认不出 → 原样返回。
 */
export function effectiveModeParams(input: ModeParamsSelection & { stored: Readonly<Record<string, unknown>> }): {
  params: Record<string, unknown>
  dropped: string[]
} {
  const resolved = specializedMode(input)
  if (!resolved) return { params: { ...input.stored }, dropped: [] }
  const { archetype, mode } = resolved
  const declared = new Set([...mode.params.map((control) => control.key), ...Object.keys(mode.fixedParams ?? {})])
  const governed = governedKeys(archetype)
  const dropped: string[] = []
  const kept: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input.stored)) {
    if (governed.has(key) && !declared.has(key)) dropped.push(key)
    else kept[key] = value
  }
  for (const control of mode.params) {
    if (kept[control.key] === undefined && control.defaultValue !== undefined) kept[control.key] = control.defaultValue
  }
  const clamped = resolveModelParams({ controls: mode.params, intent: {}, previousParams: kept, policy: { author: '人手', invalid: '只修下拉不管数值' } }).params
  const fixed = mode.fixedParams
  if (!fixed || Object.keys(fixed).length === 0) return { params: clamped === kept ? { ...kept } : clamped, dropped }
  return {
    params: {
      ...clamped,
      ...fixed,
      ...(isRecord(clamped.archetypeInput) ? { archetypeInput: { ...clamped.archetypeInput, ...fixed } } : {}),
    },
    dropped,
  }
}

/**
 * 请求里没有方式记录时（Agent / MCP 无界面发送不带 modeId）按 (供应商, 任务类型) 选「主方式」：
 * 档案默认方式落在这个任务类型就用它，否则取这个任务类型首个声明的方式。
 * 供应商桶优先：有方式为这家单独声明了参数或传输桶（vendorParams / vendorTransportTaskKind），就只在这些方式里选；
 * 这家没有单独声明的，按通用传输桶选。规则原样来自 scripts/gen-archetype-wire-defaults.ts 的「主模式判据」。
 */
export function modeWhenUnrecorded(archetype: ModelArchetype, taskKind: string, vendorKey: string | null | undefined): ArchetypeMode | undefined {
  const vendor = typeof vendorKey === 'string' ? vendorKey.trim() : ''
  const pick = (modes: readonly ArchetypeMode[]) => modes.find((mode) => mode.id === archetype.defaultModeId) ?? modes[0]
  if (vendor) {
    const own = archetype.modes.filter((mode) => (mode.vendorParams?.[vendor] || mode.vendorTransportTaskKind?.[vendor])
      && modeTransportFor(mode, archetype, vendor) === taskKind)
    if (own.length) return pick(own)
  }
  return pick(archetype.modes.filter((mode) => modeTransportFor(mode, archetype, null) === taskKind))
}
