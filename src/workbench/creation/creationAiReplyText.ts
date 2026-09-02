// 创作区回复的两个纯工具函数（由旧 Agent shell 抽出，R9 防巨壳）：
// 都不依赖组件状态，纯输入→输出，单独成模块便于单测、也让面板壳只留交互逻辑。
import type { WriteToolName } from './creationToolContracts'

// The creation agent's write tools map 1:1 to the editor's document mutations.
// Read tools auto-confirm without a card; write tools queue a confirmation card.
// 写工具名/类型/守卫/待批卡形态已收口到无状态 creationToolContracts，避免把旧 turn store 带入生产图。
export function writeToolLabelKey(
  name: WriteToolName,
): 'creationAi.writeTool.insert' | 'creationAi.writeTool.replace' | 'creationAi.writeTool.append' {
  if (name === 'insert_at_cursor') return 'creationAi.writeTool.insert'
  if (name === 'replace_selection') return 'creationAi.writeTool.replace'
  return 'creationAi.writeTool.append'
}

/** 从后端回包里取回复正文：兼容 `{ text }` 与 `{ response: { text } }` 两种形状。 */
export function readWorkbenchAiReplyText(response: unknown): string {
  if (!response || typeof response !== 'object' || Array.isArray(response)) return ''
  const record = response as Record<string, unknown>
  const text = typeof record.text === 'string' ? record.text.trim() : ''
  if (text) return text
  const responseValue = record.response
  if (responseValue && typeof responseValue === 'object' && !Array.isArray(responseValue)) {
    const nestedText = (responseValue as Record<string, unknown>).text
    return typeof nestedText === 'string' ? nestedText.trim() : ''
  }
  return ''
}
