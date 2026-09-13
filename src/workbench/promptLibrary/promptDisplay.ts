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

type LocalizedText = { readonly 'zh-CN': string; readonly en: string }
/** getter 只消费 curation 的 title/group 两个双语字段；用最小结构而非整个 SkillCuration，调用方免带全量。 */
type CurationTexts = { curation?: { title?: LocalizedText; group?: LocalizedText } }

/**
 * 按当前界面语言取 curation 的双语字段(2026-09-10 走查反馈:数据里 title/summary/group 本就
 * 强制双语——skillCuration 的 localizedText schema——但库投影写死 ["zh-CN"],切语言不跟)。
 * 与 libraryGroup 的取法同一纪律:zh 开头 → zh-CN,否则 en;缺该语言回退 zh-CN 再回退 en。
 */
function pickLocalized(value: LocalizedText | undefined): string {
  if (!value) return ''
  const key: keyof LocalizedText = i18n.language?.startsWith('zh') ? 'zh-CN' : 'en'
  return value[key] || value['zh-CN'] || value.en || ''
}

/** 卡片/悬浮框上显示的标题:精选条目按界面语言取 curation 双语标题;未命名走本地化占位;其余用用户自己起的名。 */
export function promptDisplayTitle(prompt: Pick<LibraryPrompt, 'title'> & CurationTexts): string {
  const localized = pickLocalized(prompt.curation?.title)
  if (localized) return localized
  return isUntitledPrompt(prompt.title) ? i18n.t('libraries.prompt.card.unnamed') : prompt.title
}

/**
 * 来源标签:自建条目显本地化的「我的库」;站外精选条目按界面语言取 curation 的双语组名
 * (广告/Advertising),不再显示投影时写死的中文;无 curation 的存量条目回退 source 字段。
 * 老条目 source 里存着「我的」,这里按 origin 判断,不读那个字段,故存量也一并纠正。
 */
export function promptSourceLabel(prompt: Pick<LibraryPrompt, 'origin' | 'source'> & CurationTexts): string {
  if (prompt.origin === 'user') return i18n.t('libraries.prompt.source.mine')
  const localized = pickLocalized(prompt.curation?.group)
  return localized || prompt.source
}

/**
 * 来源的**稳定过滤键**(不随界面语言变):精选条目用 curation 组名的 en 值(与 libraryGroup 的
 * category id 同源),否则回退 source。过滤比较、chips 的 value 都用它;显示标签另取
 * promptSourceDisplayLabel——键和显示分离,切语言时已选中的过滤不失效、标签跟着换。
 */
export function promptSourceKey(prompt: Pick<LibraryPrompt, 'source'> & CurationTexts): string {
  const group = prompt.curation?.group
  return (group?.en || group?.['zh-CN'] || prompt.source).trim()
}

/** 来源 chips 上显示的人话标签:按界面语言取双语组名;无 curation 回退 source 字段。 */
export function promptSourceDisplayLabel(prompt: Pick<LibraryPrompt, 'source'> & CurationTexts): string {
  const localized = pickLocalized(prompt.curation?.group)
  return localized || prompt.source
}
