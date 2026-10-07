/**
 * [INPUT]: 依赖 react-i18next、../../useDirectorShotFocus、../../directorSessionRegistry 的 clearDirectorShotFocus、./shotLabels、开关
 * [OUTPUT]: 对外提供 useShotFocusTag：「正在改：镜头 N」标签的文字与动作（没有焦点 = null），Agent 输入框容器拿去画 AgentPanelV4FocusTag
 * [POS]: 标签措辞的唯一拼字点（画布「3D-BOX · 正在改：镜头 N」七态）：一镜「正在改：镜头 2」+ 实测「· 中近景 · 固定」；
 *        两到三镜「正在改：镜头 1、3」；超过三镜「正在改：4 个镜头」。实测与镜头卡同一份 shotLabels，一字不差。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { useTranslation } from 'react-i18next'
import { isDirector3DBoxEnabled } from '../../../../../../featureFlags/director3dbox'
import { clearDirectorShotFocus } from '../../directorSessionRegistry'
import { useDirectorShotFocus } from '../../useDirectorShotFocus'
import { useShotLabels } from './shotLabels'
import type { DirectorShotFocus } from '../../model/directorShotFocus'

export type ShotFocusTag = Readonly<{ label: string; detail?: string; hint: string; clearLabel: string; onClear: () => void }>

/** 列多少镜就写编号；再多写个数。 */
const LIST_MAX = 3

type Translate = (key: string, options?: Record<string, unknown>) => string

/** 纯函数：焦点 → 标签文字（测试直接调；界面经 useShotFocusTag）。 */
export function shotFocusTagText(focus: DirectorShotFocus | null, t: Translate, headline: (shot: NonNullable<DirectorShotFocus['shots'][number]['measured']>) => string): Omit<ShotFocusTag, 'onClear'> | null {
  if (!focus || focus.shots.length === 0) return null
  const indices = focus.shots.map((shot) => shot.index)
  const single = focus.shots.length === 1 ? focus.shots[0] : null
  const label = single
    ? t('director.view.focusOne', { index: single.index })
    : indices.length <= LIST_MAX
      ? t('director.view.focusList', { list: indices.join(t('director.view.focusListSeparator')) })
      : t('director.view.focusCount', { count: indices.length })
  return {
    label,
    ...(single?.measured ? { detail: `· ${headline(single.measured as never)}` } : {}),
    hint: t(single ? 'director.view.focusHintOne' : 'director.view.focusHintMany'),
    clearLabel: t('director.view.focusClear'),
  }
}

export function useShotFocusTag(): ShotFocusTag | null {
  const { t } = useTranslation()
  const labels = useShotLabels()
  const focus = useDirectorShotFocus(isDirector3DBoxEnabled())
  const text = shotFocusTagText(focus, t as unknown as Translate, labels.headline as never)
  return text ? { ...text, onClear: clearDirectorShotFocus } : null
}
