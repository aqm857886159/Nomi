import type { GenerationCanvasNode, GenerationNodeResult, TiptapDocJson } from '../model/generationCanvasTypes'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { markdownToTiptapContent } from '../../creation/markdownToTiptap'
import { runCatalogGenerationTask, type CatalogTaskRunOptions } from './catalogTaskActions'
import { nodeRunOutcomePatch } from '../store/nodeRunOutcome'
import { deliverRunOutcome, whenRunTargetLoaded } from './runProjectDelivery'
import { docToPlainText, getTextGenMode, textDocumentDigest, type TextGenMode } from './textGenerationDocument'
export { docToPlainText, getTextGenMode, type TextGenMode } from './textGenerationDocument'

export type GenerateTextOptions = CatalogTaskRunOptions

export async function generateText(
  node: GenerationCanvasNode,
  options: GenerateTextOptions,
): Promise<GenerationNodeResult> {
  const runId = node.runs?.[0]?.id
  const userPrompt = (node.prompt || '').trim()
  const docText = docToPlainText(node.contentJson)
  const selText = typeof node.meta?.textGenSelection === 'string' ? node.meta.textGenSelection.trim() : ''
  // 改写但没有选区 → 退回续写（prompt 与落地都按续写）。
  const mode: TextGenMode = getTextGenMode(node) === 'rewrite' && !selText ? 'append' : getTextGenMode(node)

  const prompt = buildTextPrompt(mode, { userPrompt, docText, selText })

  // 续写起点：流式期间把新文本接在「原有内容」之后逐块重渲染，原内容快照锁在开头。
  const baseContent = mode === 'append' && Array.isArray(node.contentJson?.content)
    ? node.contentJson!.content
    : []

  // 续写/重写：数据层逐 token 增量重渲染（persist:false 草稿）。
  // 改写：替换的是 ProseMirror 选区，数据层拿不到位置 → 不流式，完成时交编辑器一次性替换。
  let streamBuffer = ''
  // 流式草稿只给前台看：运行所属项目不在画布上时不写 store（那是别的项目）。
  const target = options.projectTarget
  const onTextDelta = mode === 'rewrite'
    ? undefined
    : (delta: string) => {
        streamBuffer += delta
        whenRunTargetLoaded(target, () => writeStreamingDraft(node.id, buildStreamingDoc(mode, baseContent, streamBuffer), runId))
      }

  const result = await runCatalogGenerationTask(
    { ...node, prompt },
    { ...options, ...(onTextDelta ? { onTextDelta } : {}) },
  )
  const text = (result.text || '').trim()
  if (!text) return result

  if (mode === 'rewrite') {
    // 让节点内编辑器替换当前选区（见 TextDocumentNode 的 apply effect）。选区只存在于打开着的编辑器里；
    // 原项目不在前台时改写结果留在节点结果历史里，不去碰别的项目。
    whenRunTargetLoaded(target, () => markPendingSelectionApply(node.id, result.id))
  } else {
    // 完成：用最终文本定稿并持久化到运行所属项目（覆盖流式过程的 persist:false 草稿；不在前台则写它的盘上副本）。
    const contentJson = buildStreamingDoc(mode, baseContent, text)
    if (contentJson) await deliverRunOutcome(target, node.id, { kind: 'content', contentJson, runId })
  }
  return result
}

function buildTextPrompt(
  mode: TextGenMode,
  ctx: { userPrompt: string; docText: string; selText: string },
): string {
  const { userPrompt, docText, selText } = ctx
  if (mode === 'rewrite') {
    return [
      '请改写下面这段文字：',
      `"""\n${selText}\n"""`,
      `要求：${userPrompt || '保持原意，让它更通顺自然'}`,
      '只输出改写后的文字本身，不要解释、不要加引号。',
    ].join('\n')
  }
  if (mode === 'replace') {
    return [
      `请按下面的要求写一篇完整文本：${userPrompt || '自由发挥'}`,
      docText ? `（可参考现有内容：\n"""\n${docText}\n"""）` : '',
      '只输出正文本身，不要解释。',
    ].filter(Boolean).join('\n')
  }
  // append（续写）
  if (docText) {
    return [
      '这是当前文档内容：',
      `"""\n${docText}\n"""`,
      `请接着往下写${userPrompt ? `，要求：${userPrompt}` : ''}。`,
      '只输出新增的正文内容，不要重复已有内容，不要解释。',
    ].join('\n')
  }
  return [
    `请按要求写一段文本：${userPrompt || '自由发挥'}`,
    '只输出正文本身，不要解释。',
  ].join('\n')
}

/**
 * 续写/重写的统一文档形状（流式草稿 + 完成定稿共用一份）：
 * - append：新内容接在 baseContent（流式起点的原有内容快照）之后。
 * - replace：新内容整篇替换。
 */
function buildStreamingDoc(
  mode: TextGenMode,
  baseContent: TiptapDocJson['content'],
  text: string,
): TiptapDocJson | null {
  const blocks = markdownToTiptapContent(text)
  if (!blocks.length) return null
  return { type: 'doc', content: mode === 'replace' ? blocks : [...(baseContent || []), ...blocks] }
}

/** 流式过程中的草稿：不进撤销、不落盘，定稿时被覆盖。 */
function writeStreamingDraft(nodeId: string, contentJson: TiptapDocJson | null, runId?: string): void {
  if (!contentJson) return
  const store = useGenerationCanvasStore.getState()
  const node = store.nodes.find(candidate => candidate.id === nodeId)
  if (node) store.updateNode(nodeId, nodeRunOutcomePatch(node, { kind: 'content', contentJson, runId }), { persist: false })
}

/**
 * 改写落地第二步：节点编辑器把选区换成这次结果之后（TextDocumentNode 的 effect），把换好的整篇作为这次付费结果的
 * 落地写进节点——与续写 / 重写同一个落地写口（landNodeContent），撤销 / 重做不撤掉它。
 * replacedDoc 为空 = 结果没有可替换的文本，只收掉待替换标记。
 */
export function landSelectionRewrite(nodeId: string, resultId: string, replacedDoc: TiptapDocJson | null): void {
  const store = useGenerationCanvasStore.getState()
  const current = store.nodes.find((candidate) => candidate.id === nodeId)
  if (!current?.result || current.result.id !== resultId) return
  if (replacedDoc) store.landNodeContent(nodeId, replacedDoc)
  const latest = useGenerationCanvasStore.getState().nodes.find((candidate) => candidate.id === nodeId)
  if (!latest) return
  const appliedRun = latest.runs?.find((run) => run.resultId === resultId)
  const runs = latest.runs?.map((run) => run.id === appliedRun?.id
    ? { ...run, textDocumentDigest: textDocumentDigest(latest.contentJson) } : run)
  // 收掉待替换标记 + 记下正文摘要是系统记账，不是用户编辑：不打撤销点（否则落地后第一下 Ctrl+Z 撤的是它，看不出变化）。
  store.updateNode(nodeId, { runs, meta: { ...(latest.meta || {}), textPendingSelectionApply: null } }, { history: false })
}

/** 改写：打标记，交给 TextDocumentNode 的 effect 用 editor.replaceSelection 替换选区，再经 landSelectionRewrite 落地。 */
function markPendingSelectionApply(nodeId: string, resultId: string): void {
  const state = useGenerationCanvasStore.getState()
  const current = state.nodes.find((candidate) => candidate.id === nodeId)
  state.updateNode(
    nodeId,
    { meta: { ...(current?.meta || {}), textPendingSelectionApply: resultId } },
    { persist: false },
  )
}
