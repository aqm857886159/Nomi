import React from 'react'
import i18n from '../../../i18n'
import { notify } from '../../../ui/notificationPolicy'
import { projectConnectedTextInputs } from '../runner/connectedTextPrompt'
import { resolveGenerationReferences } from '../runner/generationReferenceResolver'
import { docToPlainText } from '../runner/textGenerationDocument'
import type { GenerationCanvasEdge, GenerationCanvasNode } from '../model/generationCanvasTypes'
import { TEXT_PROCESS_PRESETS, TEXT_PROCESS_PRESET_IDS, type TextProcessPresetId } from '../runner/textProcessPresets'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { startGenerationFromComposer } from './composerRun'

export type PresetBlockReason = 'needImage' | 'needText'

type PresetGraph = { nodes: readonly GenerationCanvasNode[]; edges: readonly GenerationCanvasEdge[] }

/**
 * 这个预设此刻为什么做不了（null = 做得了）：看图写描述要有图；其余要有正文 / 一句话 / 连进来的文字。
 * 加工框、空节点「试试」把它做成「不可点 + 说明原因」（和生成钮缺参考时同一种做法），点击路径里再核一次兜底。
 */
export function presetBlockReason(node: GenerationCanvasNode, graph: PresetGraph, id: TextProcessPresetId): PresetBlockReason | null {
  if (TEXT_PROCESS_PRESETS[id].needsImage) {
    return resolveGenerationReferences(node, { nodes: [...graph.nodes], edges: [...graph.edges] }).referenceImages.length === 0 ? 'needImage' : null
  }
  const hasMaterial = docToPlainText(node.contentJson).length > 0
    || (node.prompt || '').trim().length > 0
    || projectConnectedTextInputs(node, graph).length > 0
  return hasMaterial ? null : 'needText'
}

/** 订阅一个节点的四个预设此刻各自被什么挡着（订阅字符串，不随无关画布写入重渲）。 */
export function useTextPresetBlocks(nodeId: string): Readonly<Partial<Record<TextProcessPresetId, PresetBlockReason>>> {
  const key = useGenerationCanvasStore((state) => {
    const node = state.nodes.find((candidate) => candidate.id === nodeId)
    if (!node) return '{}'
    const blocks: Partial<Record<TextProcessPresetId, PresetBlockReason>> = {}
    for (const id of TEXT_PROCESS_PRESET_IDS) {
      const reason = presetBlockReason(node, state, id)
      if (reason) blocks[id] = reason
    }
    return JSON.stringify(blocks)
  })
  return React.useMemo(() => JSON.parse(key) as Partial<Record<TextProcessPresetId, PresetBlockReason>>, [key])
}

/** 被挡住时按钮上的说明（title）。 */
export function presetBlockHint(reason: PresetBlockReason): string {
  return i18n.t(reason === 'needImage' ? 'generationCommon.textProcess.needImageHint' : 'generationCommon.textProcess.needText')
}

/**
 * 点一个加工预设（扩写 / 看图写描述 / 翻译 / 拆成多条）之后发生的事——加工框与空文本节点的「试试」共用这一条。
 *
 * 做什么：先看有没有东西可加工（看图写描述要有图；其余要有正文 / 一句话 / 连进来的文字），没有就当场说清缺什么，
 * 不空转；有就把 `meta.textGenPreset` 写到节点上，再走和 ↑ 同一条生成路径。
 */
export function runTextPreset(nodeId: string, id: TextProcessPresetId, present: (message: string) => void): void {
  const state = useGenerationCanvasStore.getState()
  const node = state.nodes.find((candidate) => candidate.id === nodeId)
  if (!node || node.locked) return
  const say = (message: string) => notify({ identity: `text-process:${nodeId}`, reason: 'interaction', level: 'inline', message, present })
  const blocked = presetBlockReason(node, state, id)
  if (blocked) return say(i18n.t(blocked === 'needImage' ? 'generationCommon.textProcess.needImage' : 'generationCommon.textProcess.needText'))
  state.updateNode(nodeId, { meta: { ...(node.meta || {}), textGenPreset: id } })
  const latest = useGenerationCanvasStore.getState().nodes.find((candidate) => candidate.id === nodeId)
  if (latest) void startGenerationFromComposer(latest, false).catch((error: unknown) => say(error instanceof Error ? error.message : String(error)))
}
