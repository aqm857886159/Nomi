// 渲染层读「分镜镜头叫什么」的唯一口：画布角标、列表卡、时间轴片段名都从这里拿（概念 owner 在
// electron/shared/canvas/storyboardShotLabel.ts，Agent 的画布摘要走同一个解析口）。
// 名字是派生的，不落盘：分镜改名 / 调序之后，四处一起变。
import React from 'react'
import i18n from '../../../i18n'
import { useWorkbenchStore } from '../../workbenchStore'
import type { StoryboardDesign } from '../../workbenchTypes'
import {
  resolveStoryboardShotLabel,
  storyboardLabelSourceFromDesigns,
  type StoryboardLabelSource,
  type StoryboardShotLabel,
} from '../../../../electron/shared/canvas/storyboardShotLabel'

type Translate = (key: string, options?: Record<string, unknown>) => string
type DesignsByDocumentId = Readonly<Record<string, readonly StoryboardDesign[]>>

const sourceCache = new WeakMap<object, StoryboardLabelSource>()

/** 分镜方案 → 编号源；同一份 designs 引用只算一次。 */
export function storyboardLabelSource(designsByDocumentId: DesignsByDocumentId): StoryboardLabelSource {
  const cached = sourceCache.get(designsByDocumentId)
  if (cached) return cached
  const source = storyboardLabelSourceFromDesigns(designsByDocumentId)
  sourceCache.set(designsByDocumentId, source)
  return source
}

/** 「镜 03」/「雨夜 · 镜 03」（首帧图再加「 · 首帧图」）。 */
export function formatStoryboardShotLabel(t: Translate, label: Pick<StoryboardShotLabel, 'number' | 'scoped' | 'designTitle'> & { firstFrame?: boolean }): string {
  const index = String(label.number).padStart(2, '0')
  const base = label.scoped && label.designTitle
    ? t('generationList.shotScoped', { storyboard: label.designTitle, index })
    : t('generationList.shot', { index })
  return label.firstFrame ? `${base} · ${t('generationCommon.shotConversion.firstFrame')}` : base
}

/**
 * 分镜落画布时节点的默认标题就是「镜头 N」（generationCommon.agentRuntime.shotTitle）。
 * 有了分镜号之后它就是第二个号：标题是这句默认话时不再显示，用户改过的标题照常显示。
 */
export function isAutoStoryboardShotTitle(title: string | undefined, number: number): boolean {
  const value = (title || '').trim()
  if (!value) return true
  return ['zh-CN', 'en'].some((lng) => value === i18n.t('generationCommon.agentRuntime.shotTitle', { index: number, lng })
    || value === i18n.t('generationCommon.agentRuntime.shotKeyframeTitle', { index: number, lng }))
}

/** 这个节点的分镜编号（不是分镜镜头 = null）。 */
export function useStoryboardShotLabel(node: { meta?: Record<string, unknown> | null } | undefined): StoryboardShotLabel | null {
  const designs = useWorkbenchStore((state) => state.storyboardDesignsByDocumentId)
  return React.useMemo(() => (node ? resolveStoryboardShotLabel(node, storyboardLabelSource(designs)) : null), [designs, node])
}

/** 画布全局镜号写进文字的那几句默认话（「镜头 7」「Shot 7」「镜头 7 首帧」…），两种语言都认。 */
function defaultShotTextPatterns(): RegExp[] {
  const marker = 'INDEX_PLACEHOLDER'
  const escapeText = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return ['zh-CN', 'en'].flatMap((lng) => [
    i18n.t('generationCommon.agentRuntime.shotTitle', { index: marker, lng }),
    i18n.t('generationCommon.agentRuntime.shotKeyframeTitle', { index: marker, lng }),
    i18n.t('generationCommon.shotConversion.shot', { index: marker, lng }),
  ].map((template) => new RegExp('^' + escapeText(template).split(marker).join('\\d+') + '$')))
}

/** 持久化在时间轴片段 / 节点里的老文字是不是「镜头 N」这种全局号——是就不能给人看。 */
export function isPersistedGlobalShotText(value: string | undefined): boolean {
  const text = (value || '').trim()
  return Boolean(text) && defaultShotTextPatterns().some((pattern) => pattern.test(text))
}

/**
 * 时间轴片段的名字：每次都按 resolver 重新算，不拿持久化的旧文字当真。
 *   - 来自分镜镜头：分镜号（+ 用户改过的标题）；
 *   - 来自别的节点（没挂分镜 / 元数据对不上）：只显示节点名，**没有镜号**；
 *   - 节点没了：片段自己的名字，但「镜头 N」这种老全局号不显示；
 *   - 不是节点生成的片段（导入的素材 / 文字片段）：照旧用片段自己的名字。
 */
export function timelineClipDisplayName(
  clip: { label?: string; text?: string; sourceNodeId?: string },
  node: { title?: string; meta?: Record<string, unknown> | null } | undefined,
  source: StoryboardLabelSource,
  t: Translate,
): string {
  const own = clip.label || clip.text || ''
  const label = node ? resolveStoryboardShotLabel(node, source) : null
  if (label && node) {
    const name = formatStoryboardShotLabel(t, label)
    return isAutoStoryboardShotTitle(node.title, label.number) ? name : `${name} · ${(node.title || '').trim()}`
  }
  if (node) return isPersistedGlobalShotText(node.title) ? '' : (node.title || '').trim()
  if (clip.sourceNodeId) return isPersistedGlobalShotText(own) ? '' : own
  return own || clip.sourceNodeId || ''
}
