/**
 * 「找素材」AI 归组服务 —— 读没连卡镜头的提示词，用 Nomi 已有的文本大脑归成命名堆。
 * 复用现成文本管线(getTextBrain + runWorkbenchTextTaskStream)，不新建通道；
 * 防错闸/解析在领域层(parseGroupingResult)。结果写 node.meta.autoGroup（自动持久化），
 * 是缓存：分过的不再调，省额度。不是图像模型——纯文本调用。
 */
import { getTextBrain } from '../../api/promptLibraryApi'
import { runWorkbenchTextTaskStream } from '../../api/taskApi'
import { buildGroupingPrompt, parseGroupingResult, type GroupingResult } from './autoGroup'

export type GroupingInput = { nodeId: string; prompt?: string; title?: string }

/**
 * 把一批"没连卡但有提示词"的镜头交给文本大脑归命名组。
 * <2 条直接全落未分组（不值得调）。无文本模型则抛错（调用方提示去接入）。
 */
export async function runContentGrouping(items: GroupingInput[], signal?: AbortSignal): Promise<GroupingResult> {
  const ids = items.map((i) => i.nodeId)
  if (items.length < 2) return { groups: [], ungroupedIds: ids }
  const brain = await getTextBrain()
  if (!brain) throw new Error('请先在「模型接入」里启用一个文本模型')
  const prompt = buildGroupingPrompt(items)
  let acc = ''
  await runWorkbenchTextTaskStream(
    brain.vendor,
    { kind: 'chat', prompt, extras: { modelKey: brain.modelKey } },
    { signal, onDelta: (delta) => { acc += delta } },
  )
  return parseGroupingResult(acc, ids)
}
