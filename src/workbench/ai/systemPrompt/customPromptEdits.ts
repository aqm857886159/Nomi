// 设置页「自定义提示词」的纯编辑规则（新建 / 改名 / 改正文 / 删除 / 删除后的选择回退）。
//
// 为什么单独一个文件而不是写在 SystemPromptSection.tsx 里：这几条是**规则**不是渲染
// —— 尤其「删掉当前选中的那条之后该选谁」，写在组件里就只能靠点开界面才验得到，
// 抽出来才能被单测钉死（R9 分层 + P2 结构保证）。组件只负责把它们接到 state 上。

import {
  CUSTOM_PROMPT_MAX_COUNT,
  CUSTOM_PROMPT_NAME_MAX_LENGTH,
  type CustomSystemPrompt,
} from '../../../../electron/settings/systemPromptsContract'

/** 删除当前选中项后的回退目标：内置的第一个模式。它永远存在，不会再指向一个死 id。 */
export const FALLBACK_MODE_ID = 'general'

/** 还能不能再建：到顶了就不能，「＋ 新建」要据此 disabled + 说明理由（§1.6 C1）。 */
export function canAddCustomPrompt(custom: CustomSystemPrompt[]): boolean {
  return custom.length < CUSTOM_PROMPT_MAX_COUNT
}

/**
 * 名字的输入侧约束：截到上限。
 * 这里**不做 trim**——用户正打「口播 带货体」时中间/末尾的空格是他还没打完的字，
 * 边打边 trim 会让光标后的空格凭空消失。落盘那一刻由主进程净化器统一 trim。
 */
export function clampCustomPromptName(name: string): string {
  return name.length > CUSTOM_PROMPT_NAME_MAX_LENGTH ? name.slice(0, CUSTOM_PROMPT_NAME_MAX_LENGTH) : name
}

/** 追加一条新的自定义提示词。到顶了就原样返回（调用方本该已经 disabled 掉入口）。 */
export function appendCustomPrompt(
  custom: CustomSystemPrompt[],
  entry: CustomSystemPrompt,
): CustomSystemPrompt[] {
  if (!canAddCustomPrompt(custom)) return custom
  return [...custom, entry]
}

/** 改一条自定义提示词的某些字段；id 认不出就原样返回（不凭空造条目）。 */
export function updateCustomPrompt(
  custom: CustomSystemPrompt[],
  id: string,
  patch: Partial<Omit<CustomSystemPrompt, 'id'>>,
): CustomSystemPrompt[] {
  if (!custom.some((item) => item.id === id)) return custom
  return custom.map((item) => (item.id === id ? { ...item, ...patch } : item))
}

export function removeCustomPrompt(custom: CustomSystemPrompt[], id: string): CustomSystemPrompt[] {
  return custom.filter((item) => item.id !== id)
}

/**
 * 删掉 `deletedId` 之后，选择该落在哪。
 *
 * 根因备忘：删的要是**当前选中**那条，不回退就会留下一个指向死 id 的 `creationAiModeId`
 * ——设置页 chip 行没有一个是选中态、创作面板的 chip 标签也认不出它。
 * 删的是别的条目时**不许动**用户当前的选择（那是无关的一次编辑，动了才叫 bug）。
 */
export function selectionAfterDelete(selectedId: string, deletedId: string): string {
  return selectedId === deletedId ? FALLBACK_MODE_ID : selectedId
}
