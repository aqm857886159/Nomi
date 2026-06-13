import React from 'react'
import { cn } from '../../../utils/cn'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { isImageLikeGenerationNodeKind, isVideoLikeGenerationNodeKind } from '../model/generationNodeKinds'
import { deriveGenerationModelCatalogStatus, useGenerationModelOptionsState } from '../adapters/modelOptionsAdapter'
import { resolveArchetypeForOption, resolveRenderedControls } from './nodeModelArchetype'
import { NodeLockBadge } from './NodeLockBadge'
import InlineParameterBar from './InlineParameterBar'
import { GENERATE_BUTTON_CLASS } from './nodeComposerStyles'

// 离屏测量：把该节点**所有候选模型**的底栏（锁 + 参数行 + 生成钮）各渲染一份，取最宽的一份宽度
// 上报给 composer → 卡片用这个「恒定最宽宽度」。这样换模型时参数行内容变、卡宽不变，生成钮锁死
// 右下角（用户拍板 2026-06-13：以最长模型宽度作为恒定卡宽，任何模型参数都一行放得下、不滚动）。
//
// 为什么离屏渲染而不是估算：底栏全是真实组件（NomiSelect 芯片/pill），pill 宽取决于字体+标签+值，
// 估算必有偏差。复用真实 InlineParameterBar（R1 单一渲染真相）离屏量，零偏差。
// NomiSelect 的下拉只在点击时才挂 DOM（Combobox.Dropdown 默认不渲染），故 mount N 份只生成 trigger，
// 无 portal 副作用。position:absolute + visibility:hidden 保留布局尺寸但不可见、不可点、不占可见空间。
const NOOP = () => {}

// ⚠ 用**空 meta** 测量（每个模型渲染各自的默认模式+默认参数值），而非节点当前 live meta：
// 否则切模型时 live meta 跟着变 → 测出的「最宽」随当前选中模型浮动 → 卡宽仍会跳。空 meta 下
// 每个模型的行宽只取决于「模型名 + 该模型默认参数集」，与当前选了谁无关 → 最宽值恒定、卡宽锁死。
const EMPTY_META: Record<string, unknown> = {}

export default function NodeComposerWidthMeasurer({
  node,
  onWidest,
}: {
  node: GenerationCanvasNode
  onWidest: (footerWidthPx: number) => void
}): JSX.Element | null {
  const modelOptionsState = useGenerationModelOptionsState(node.kind)
  const modelOptions = modelOptionsState.options
  const modelCatalogStatus = deriveGenerationModelCatalogStatus(node.kind, modelOptionsState)
  const isImageLike = isImageLikeGenerationNodeKind(node.kind)
  const isVideoLike = isVideoLikeGenerationNodeKind(node.kind)
  const rootRef = React.useRef<HTMLDivElement>(null)

  React.useLayoutEffect(() => {
    const root = rootRef.current
    if (!root) return
    const rows = Array.from(root.querySelectorAll<HTMLElement>('[data-measure-footer]'))
    if (rows.length === 0) return
    const measure = () => {
      const max = rows.reduce((acc, row) => Math.max(acc, row.scrollWidth), 0)
      if (max > 0) onWidest(max)
    }
    measure()
    // 字体异步加载完 → pill 宽变 → 重测（ResizeObserver 覆盖布局变化）。meta 不入依赖：测量用空 meta，
    // 与节点当前状态无关，故只随「模型列表」变化重测。
    const ro = new ResizeObserver(measure)
    rows.forEach((row) => ro.observe(row))
    return () => ro.disconnect()
  }, [modelOptions, isImageLike, isVideoLike, onWidest])

  if (modelOptions.length === 0) return null

  return (
    <div
      ref={rootRef}
      aria-hidden
      className={cn('pointer-events-none select-none')}
      style={{ position: 'absolute', left: -99999, top: 0, visibility: 'hidden' }}
    >
      {modelOptions.map((option) => (
        <div
          key={option.value}
          data-measure-footer
          // 与真实底栏同款一行结构（flex + gap-2 + w-max），w-max 让 scrollWidth = 真实内容宽。
          className={cn('flex items-center gap-2 w-max')}
        >
          <NodeLockBadge nodeId={node.id} locked={node.locked} selected />
          <InlineParameterBar
            modelOptions={modelOptions}
            modelCatalogStatus={modelCatalogStatus}
            renderedControls={resolveRenderedControls(option, EMPTY_META, isImageLike, isVideoLike)}
            selectedModelOption={option}
            archetype={resolveArchetypeForOption(option)}
            meta={EMPTY_META}
            onModelChange={NOOP}
            onCatalogControlChange={NOOP}
            onParameterControlChange={NOOP}
          />
          {/* 生成钮占位：与真实底栏同款尺寸（共享 GENERATE_BUTTON_CLASS），让测出的宽含它。 */}
          <button type="button" className={GENERATE_BUTTON_CLASS} tabIndex={-1} aria-hidden disabled>
            ↑
          </button>
        </div>
      ))}
    </div>
  )
}
