// agent-artifact 在通用节点壳里占的两个位置（正文 + 选中浮条），连同它们的取数一起收在这里。
//
// 为什么单独一个文件：BaseGenerationNode 是全 15 种 kind 共用的壳，每种 kind 往里塞自己的
// 分支就是它变巨壳的方式（R9/R12，门岗上限 713 行）。壳只该问「这个 kind 有没有给我 body /
// 浮条」，不该知道产物有几种文件类型、复制的是哪段文本。所以这里对外只暴露两个插槽 + 一个
// isArtifact 布尔，壳按插槽渲染，产物的事一律不出这个目录。
import React from 'react'
import { useTranslation } from 'react-i18next'
import { lazyWithChunkBoundary } from '../../../../ui/chunkBoundary'
import { canArtifactCopyText, readAgentArtifactMeta } from '../../model/artifactMeta'
import type { GenerationCanvasNode } from '../../model/generationCanvasTypes'
import { resolveNodeVisualSize } from '../nodeSizing'
import { copyToClipboard } from '../../../../design'

const ArtifactBody = lazyWithChunkBoundary('Agent 产物预览', () => import('./ArtifactBody'))
const ArtifactNodeToolbar = lazyWithChunkBoundary('Agent 产物操作', () => import('./ArtifactNodeToolbar'))

export type ArtifactNodeSlotsOptions = {
  reportFeedback: (message: string) => void
  selected: boolean
  isMultiSelectActive: boolean
  readOnly: boolean
}

export type ArtifactNodeSlots = {
  /** 这个节点是不是手艺产物——壳用它关掉 composer / renderKind 推断。 */
  isArtifact: boolean
  /** 正文插槽：非产物节点为 null，壳继续走自己的分支。 */
  body: JSX.Element | null
  /** 选中浮条插槽：不选中 / 多选 / 只读 / 无产物时为 null。 */
  toolbar: JSX.Element | null
}

export function useArtifactNodeSlots(node: GenerationCanvasNode, options: ArtifactNodeSlotsOptions): ArtifactNodeSlots {
  const { t } = useTranslation()
  const isArtifact = node.kind === 'agent-artifact'
  const artifact = isArtifact ? readAgentArtifactMeta(node) : undefined
  const title = node.title || ''

  // 复制产物文本（text/markdown/html）进剪贴板——取 nomi-local 文件原文，只读不执行。
  const copyText = React.useMemo(() => {
    if (!artifact || !canArtifactCopyText(artifact.fileType)) return undefined
    return async () => {
      const response = await fetch(artifact.url)
      if (!response.ok) throw new Error(String(response.status))
      if (!await copyToClipboard(await response.text())) throw new Error('clipboard')
    }
  }, [artifact])

  if (!isArtifact) return { isArtifact: false, body: null, toolbar: null }

  // 尺寸自己取（和壳同一个真相源 resolveNodeVisualSize），壳不用再把宽高转手一遍。
  const size = resolveNodeVisualSize(node)
  const body = artifact ? (
    <React.Suspense fallback={<div className="h-full w-full bg-nomi-ink-05 animate-pulse" />}>
      <ArtifactBody node={node} artifact={artifact} width={size.width} height={size.height} />
    </React.Suspense>
  ) : (
    // 理论不可达：agent-artifact 只能由 Agent 带 meta.artifact 创建。兜底给人话空态而非静默空白。
    <div className="h-full w-full flex items-center justify-center text-nomi-ink-40 text-body-sm">
      {t('runtime.nodeRegistry.agent-artifact.emptyState')}
    </div>
  )

  const showToolbar = Boolean(artifact) && options.selected && !options.isMultiSelectActive && !options.readOnly
  const toolbar = showToolbar && artifact ? (
    <React.Suspense fallback={null}>
      <ArtifactNodeToolbar reportFeedback={options.reportFeedback} nodeId={node.id} title={title} artifact={artifact} canCopyText={Boolean(copyText)} onCopyText={copyText} />
    </React.Suspense>
  ) : null

  return { isArtifact: true, body, toolbar }
}
