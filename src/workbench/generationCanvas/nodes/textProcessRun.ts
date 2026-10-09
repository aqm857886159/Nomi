import i18n from '../../../i18n'
import { notify } from '../../../ui/notificationPolicy'
import { projectConnectedTextInputs } from '../runner/connectedTextPrompt'
import { resolveGenerationReferences } from '../runner/generationReferenceResolver'
import { docToPlainText } from '../runner/textGenerationDocument'
import { TEXT_PROCESS_PRESETS, type TextProcessPresetId } from '../runner/textProcessPresets'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { startGenerationFromComposer } from './composerRun'

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
  const graph = { nodes: state.nodes, edges: state.edges }
  const preset = TEXT_PROCESS_PRESETS[id]
  if (preset.needsImage) {
    if (resolveGenerationReferences(node, graph).referenceImages.length === 0) return say(i18n.t('generationCommon.textProcess.needImage'))
  } else {
    const hasMaterial = docToPlainText(node.contentJson).length > 0
      || (node.prompt || '').trim().length > 0
      || projectConnectedTextInputs(node, graph).length > 0
    if (!hasMaterial) return say(i18n.t('generationCommon.textProcess.needText'))
  }
  state.updateNode(nodeId, { meta: { ...(node.meta || {}), textGenPreset: id } })
  const latest = useGenerationCanvasStore.getState().nodes.find((candidate) => candidate.id === nodeId)
  if (latest) void startGenerationFromComposer(latest, false).catch((error: unknown) => say(error instanceof Error ? error.message : String(error)))
}
