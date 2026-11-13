// 「输入变了之后，节点上存着的方式偏好还算不算数」——唯一一处（设计卡「11-12 改向」④⑤⑥）。
//
// 方式按输入现算（modeForInputs）。偏好放得下全部输入就照用；放不下时 owner 已经换成放得下的那种——这里在**输入变化的那一刻**
// 把放不下的偏好忘掉，于是之后输入再减少，方式不会自己跳回原来那种（④ 加多自动换、⑤ 减少不跳回、⑥ 删光回文生）。
// 同时，方式因为「加多了」被换掉时记一条短暂的标记，参考行行尾说一句「放了 N 张，已改成 X」。
//
// 只看前后两态都存在、且这次输入真的变了的节点：加载项目、粘贴、新建都不在这里改盘；撤销 / 重做带着自己的状态，不重算。
import type { ModelArchetype } from '../../../../electron/shared/modelArchetypes'
import { modeForInputs, type ModeInput } from '../../../../electron/shared/modelArchetypes/modeForInputs'
import { archetypeForNode } from '../agent/referenceEdgeCapability'
import { collectModeInputs, forgetModePreference, type ModeGraph } from '../nodes/controls/archetypeMeta'
import { readModePreference } from '../nodes/controls/modePreference'
import type { GenerationCanvasEdge, GenerationCanvasNode } from '../model/generationCanvasTypes'

/** 方式刚被输入改掉的短暂标记：只在输入数、现算方式都还和写下时一样才显示（再动一下输入就失效）。 */
export const MODE_SWITCH_NOTICE_META_KEY = 'modeSwitchNotice'
export type ModeSwitchNoticeMeta = { modeId: string; count: number }

type Graph = { nodes: readonly GenerationCanvasNode[]; edges: readonly GenerationCanvasEdge[] }
type Write = (nodeId: string, meta: Record<string, unknown>) => void

export function readModeSwitchNotice(meta: Record<string, unknown> | undefined): ModeSwitchNoticeMeta | null {
  const value = meta?.[MODE_SWITCH_NOTICE_META_KEY]
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  return typeof record.modeId === 'string' && typeof record.count === 'number' ? { modeId: record.modeId, count: record.count } : null
}

function inputSignature(inputs: readonly ModeInput[]): string {
  return inputs.map((input) => `${input.asset}:${input.slots.join('/')}`).join('|')
}

/** 这次写入里输入可能变了的节点：进出边变了的目标 + 自己 meta 变了的节点（上传列表住在 meta）。 */
function touchedNodeIds(previous: Graph, next: Graph): Set<string> {
  const touched = new Set<string>()
  if (previous.edges !== next.edges) {
    const before = new Set(previous.edges)
    const after = new Set(next.edges)
    for (const edge of next.edges) if (!before.has(edge)) touched.add(edge.target)
    for (const edge of previous.edges) if (!after.has(edge)) touched.add(edge.target)
  }
  if (previous.nodes !== next.nodes) {
    const before = new Map(previous.nodes.map((node) => [node.id, node]))
    for (const node of next.nodes) {
      const old = before.get(node.id)
      if (old && old !== node && old.meta !== node.meta) touched.add(node.id)
    }
  }
  return touched
}

function isTextMode(archetype: ModelArchetype, modeId: string): boolean {
  return (archetype.modes.find((mode) => mode.id === modeId)?.slots.length ?? 0) === 0
}

/**
 * 输入变了的节点：偏好放不下了就忘掉；方式因为加多而换掉就记「已改成」标记；输入再动一下标记就清掉。
 * write 由 store 边界传（不进撤销栈：这是连线 / 放图这个手势的后果，撤销那一步时一起回去）。
 */
export function forgetUnfitModeChoices(previous: Graph, next: Graph, write: Write): void {
  const touched = touchedNodeIds(previous, next)
  if (!touched.size) return
  const previousById = new Map(previous.nodes.map((node) => [node.id, node]))
  for (const node of next.nodes) {
    if (!touched.has(node.id)) continue
    const old = previousById.get(node.id)
    if (!old) continue
    const archetype = archetypeForNode(node)
    if (!archetype || archetype.kind === 'audio') continue
    if (archetypeForNode(old)?.id !== archetype.id) continue // 换模型不是输入变化（偏好随模型带，见 carryHumanModePreference）
    const before = collectModeInputs(old, previous as ModeGraph)
    const after = collectModeInputs(node, next as ModeGraph)
    if (inputSignature(before.inputs) === inputSignature(after.inputs)) continue
    const meta = (node.meta || {}) as Record<string, unknown>
    const preference = readModePreference(archetype, meta)
    const resolved = modeForInputs(archetype, after.inputs, preference, { firstFrameEmpty: after.firstFrameEmpty }).mode
    const wasResolved = modeForInputs(archetype, before.inputs, readModePreference(archetype, (old.meta || {}) as Record<string, unknown>), { firstFrameEmpty: before.firstFrameEmpty }).mode
    let nextMeta = meta
    if (preference && preference.modeId !== resolved.id) nextMeta = forgetModePreference(nextMeta, archetype)
    const grew = after.inputs.length > before.inputs.length
    const switched = grew && before.inputs.length > 0 && wasResolved.id !== resolved.id && !isTextMode(archetype, resolved.id)
    if (switched) nextMeta = { ...nextMeta, [MODE_SWITCH_NOTICE_META_KEY]: { modeId: resolved.id, count: after.inputs.length } }
    else if (MODE_SWITCH_NOTICE_META_KEY in nextMeta) {
      const { [MODE_SWITCH_NOTICE_META_KEY]: _dropped, ...rest } = nextMeta
      nextMeta = rest
    }
    if (nextMeta !== meta) write(node.id, nextMeta)
  }
}

/** 行尾要不要说「已改成 X」：标记还对得上这次的输入数和现算方式才说。 */
export function liveModeSwitchNotice(meta: Record<string, unknown> | undefined, inputCount: number, resolvedModeId: string): ModeSwitchNoticeMeta | null {
  const notice = readModeSwitchNotice(meta)
  return notice && notice.count === inputCount && notice.modeId === resolvedModeId ? notice : null
}
