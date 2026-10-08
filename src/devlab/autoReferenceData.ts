import { refCopy, type PickRow, type Suggestion } from './referencePromptKit'
import { REFS, refName, type ListViewLocale, type RefId } from './storyboardListViewData'

export const SUGGEST_WORD: Record<ListViewLocale, string> = { zh: '怀表', en: 'watch' }

/** 「怀表」的候选，按匹配策略排好：同名 > 别名 > 最近用过。 */
export function watchCandidates(locale: ListViewLocale): Suggestion {
  const t = refCopy[locale]
  const row = (id: RefId, tag: string): PickRow => ({ key: id, label: refName(id, locale), art: REFS[id].art, tag })
  return {
    key: 'watch',
    word: SUGGEST_WORD[locale],
    groups: [{ key: 'candidates', rows: [row('watch', t.same), row('oldWatch', t.alias), row('chain', t.recent)] }],
  }
}
