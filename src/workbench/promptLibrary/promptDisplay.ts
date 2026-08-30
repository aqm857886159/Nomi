// 提示词条目的**显示边界**:标题与来源标签在这里按当前界面语言定型。
//
// 为什么要有这一层:这两个字段会**落盘**(userPromptStore 写进 .nomi 下的库文件)。存一句本地化过的
// 「未命名提示词」/「我的」等于把建条目那一刻的界面语言焊死在数据里——英文用户建的条目永远带中文,
// 之后换语言也回不来。所以存储侧只存稳定值(未命名 = 空串;来源由 origin 表达),显示名一律在这里取。
import i18n from '../../i18n'
import type { LibraryPrompt } from '../api/promptLibraryApi'

// 2026-08-28 之前的版本把本地化字符串写进了库文件,老条目里躺着这两句。读侧照旧当「未命名」认,
// 这样存量条目不用迁移也能跟着界面语言走(写侧已经不再产生它们)。
const LEGACY_UNTITLED = new Set(['未命名提示词', 'Untitled prompt'])

export function isUntitledPrompt(title: string | undefined): boolean {
  const trimmed = (title ?? '').trim()
  return trimmed === '' || LEGACY_UNTITLED.has(trimmed)
}

/** 卡片/悬浮框上显示的标题:未命名走本地化占位,其余用用户自己起的名。 */
export function promptDisplayTitle(prompt: Pick<LibraryPrompt, 'title'>): string {
  return isUntitledPrompt(prompt.title) ? i18n.t('libraries.prompt.card.unnamed') : prompt.title
}

/**
 * 来源标签:自建条目显本地化的「我的库」;站外精选条目显它真实的来源名——那是专名,不翻译。
 * 老条目 source 里存着「我的」,这里按 origin 判断,不读那个字段,故存量也一并纠正。
 */
export function promptSourceLabel(prompt: Pick<LibraryPrompt, 'origin' | 'source'>): string {
  return prompt.origin === 'user' ? i18n.t('libraries.prompt.source.mine') : prompt.source
}
