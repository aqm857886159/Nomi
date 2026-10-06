// 设计实验室 · 屏「画布 · 版本卡片（宫格）」的取景台与夹具。
//
// 用户 2026-10-06 改向：版本卡和节点一模一样、按宫格排、去掉版本图标（入口就是节点身后的叠卡）。
// 这一屏给他拍板看。真身：
// - 节点本体是现役 `BaseGenerationNode`（只有 1 版的节点外观；多版的节点它会画旧的「N 版」胶囊，
//   那正是要被替换掉的东西，所以夹具让节点只带主图，叠卡入口与宫格由新组件画）；
// - 叠卡入口 `NodeVersionStackHandle`、宫格 `NodeVersionGrid` 是 V2 要接进节点的生产组件本体；
// - 几何全部来自 `versionGridLayout.ts`（纯函数），这里不手填任何一格的位置；
// - 提示条是现役 toast 的同一份外观（`buildToastNotification` → Mantine Notification）。
// 画面是 data URI 的几何占位（实验室不依赖机器上的素材），每一版换一个色调好分清。
import React, { type JSX } from 'react'
import { Notification } from '@mantine/core'
import '../../../workbench/generationCanvas/styles/generationCanvas.css'
import i18n from '../../../i18n'
import BaseGenerationNode from '../../../workbench/generationCanvas/nodes/BaseGenerationNode'
import type { GenerationCanvasNode } from '../../../workbench/generationCanvas/model/generationCanvasTypes'
import { useGenerationCanvasStore } from '../../../workbench/generationCanvas/store/generationCanvasStore'
import { useWorkbenchStore } from '../../../workbench/workbenchStore'
import { NodeVersionGrid, NodeVersionStackHandle, type VersionCardEntry } from '../../../workbench/generationCanvas/nodes/versionCards/NodeVersionCards'
import { isNodeLabelCoveredByGrid, layoutVersionGrid, versionGridItems, type VersionGridPlacement } from '../../../workbench/generationCanvas/nodes/versionCards/versionGridLayout'
import { buildToastNotification } from '../../../ui/toast'
import { holdDesignLabReady } from '../labReadyHold'

export const VERSION_CARDS_CELL_WIDTH = 1400
export const VERSION_CARDS_CELL_HEIGHT = 760

/** 节点 240×135（16:9）：图片节点最小宽附近，宫格 3×3 也装得进一格取景框。 */
const NODE = { width: 240, height: 135 } as const

const HUES = [210, 28, 160, 330, 260, 95, 190, 12, 285, 50, 140, 350]

function frame(versionNo: number): string {
  const hue = HUES[(versionNo - 1) % HUES.length]
  const body = `
    <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="hsl(${hue} 45% 32%)"/><stop offset="1" stop-color="hsl(${(hue + 40) % 360} 35% 18%)"/></linearGradient></defs>
    <rect width="640" height="360" fill="url(#g)"/>
    <rect x="40" y="${90 + (versionNo % 3) * 12}" width="120" height="200" fill="hsl(${hue} 20% 14%)"/>
    <rect x="${470 - (versionNo % 4) * 14}" y="70" width="140" height="220" fill="hsl(${hue} 18% 12%)"/>
    <circle cx="${300 + (versionNo % 5) * 22}" cy="110" r="38" fill="hsl(${(hue + 180) % 360} 70% 78%)" opacity=".85"/>
    <rect y="290" width="640" height="70" fill="hsl(${hue} 25% 10%)"/>
    <ellipse cx="320" cy="318" rx="210" ry="16" fill="hsl(${hue} 40% 40%)" opacity=".5"/>`
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">${body}</svg>`)
}

/** 第 1…count 版，新 → 旧；`removed` 里的号已经被删掉（删了留空号）。 */
function versions(count: number, removed: readonly number[] = []): VersionCardEntry[] {
  return Array.from({ length: count }, (_, index) => count - index)
    .filter((versionNo) => !removed.includes(versionNo))
    .map((versionNo) => ({ identity: `v${versionNo}`, versionNo, type: 'image' as const, previewUrl: frame(versionNo) }))
}

/** 节点自己的 position 归零：现役外壳在非画布内核下按 position 自己 translate，舞台位置由外面那层 div 给（同 nodeQuickActions 夹具）。 */
function canvasNode(id: string, title: string, versionNo: number): GenerationCanvasNode {
  return {
    id,
    kind: 'image',
    title,
    categoryId: 'shots',
    position: { x: 0, y: 0 },
    size: { ...NODE },
    status: 'success',
    prompt: '',
    result: { id: `${id}-v${versionNo}`, type: 'image', url: frame(versionNo), thumbnailUrl: frame(versionNo), createdAt: versionNo, versionNo },
    history: [{ id: `${id}-v${versionNo}`, type: 'image', url: frame(versionNo), thumbnailUrl: frame(versionNo), createdAt: versionNo, versionNo }],
    meta: { imageWidth: 640, imageHeight: 360, imageAspectRatio: 16 / 9 },
  } as GenerationCanvasNode
}

function useLabLocale(locale: 'zh-CN' | 'en'): boolean {
  const [ready, setReady] = React.useState(i18n.language === locale)
  React.useLayoutEffect(() => {
    if (i18n.language === locale) { setReady(true); return undefined }
    const release = holdDesignLabReady(`version-cards:${locale}`)
    void i18n.changeLanguage(locale).then(() => { setReady(true); release() })
    return release
  }, [locale])
  return ready
}

function useCanvasStores(nodes: readonly GenerationCanvasNode[]): boolean {
  const [ready, setReady] = React.useState(false)
  React.useLayoutEffect(() => {
    useWorkbenchStore.setState({ activeCategoryId: 'shots' })
    useGenerationCanvasStore.setState({ nodes: [...nodes], edges: [], selectedNodeIds: [] })
    setReady(true)
  }, [nodes])
  return ready
}

export type VersionCardsStageProps = {
  locale?: 'zh-CN' | 'en'
  /** 这个节点攒了几版。 */
  count: number
  expanded?: boolean
  hoverStack?: boolean
  /** 悬停在第几版上（出动作条）。 */
  hoverVersion?: number
  primaryVersion?: number
  showAll?: boolean
  pending?: boolean
  /** 节点在舞台上的位置（画布坐标 = 舞台像素，缩放 1）。 */
  at?: { x: number; y: number }
  placement?: VersionGridPlacement
  /** 旁边的邻居节点（铺开会盖住它们）。 */
  neighbours?: ReadonlyArray<{ id: string; title: string; x: number; y: number; versionNo: number }>
  /** 已经删掉的版本号（删了留空号）。 */
  removed?: readonly number[]
  /** 舞台宽（4×3 那一格要更宽）。 */
  stageWidth?: number
  toast?: 'deleted' | 'primary-set'
}

export function VersionCardsStage({
  locale = 'zh-CN', count, expanded = false, hoverStack = false, hoverVersion, primaryVersion, showAll = false, pending = false,
  at = { x: 80, y: 120 }, placement = 'right', neighbours = [], removed = [], toast, stageWidth = VERSION_CARDS_CELL_WIDTH,
}: VersionCardsStageProps): JSX.Element {
  const localeReady = useLabLocale(locale)
  const entries = React.useMemo(() => versions(count, removed), [count, removed])
  const primary = primaryVersion ?? count
  const zh = locale === 'zh-CN'
  const nodes = React.useMemo(() => [
    canvasNode('vc-source', zh ? '场景 · 雨巷' : 'Scene · Rain alley', primary),
    ...neighbours.map((neighbour) => canvasNode(neighbour.id, neighbour.title, neighbour.versionNo)),
  ], [neighbours, primary, zh])
  const ready = useCanvasStores(nodes) && localeReady
  const layout = React.useMemo(
    () => layoutVersionGrid(versionGridItems(entries, { pending, showAll }), NODE, placement),
    [entries, pending, placement, showAll],
  )
  const toastProps = toast ? buildToastNotification({
    id: 'vc-toast',
    reason: 'version-deleted',
    message: toast === 'primary-set'
      ? i18n.t('generationCommon.versionCards.primarySet', { n: primary, count: 3 })
      : i18n.t('generationCommon.versionCards.deleted', { n: removed[0] ?? count }),
    actionLabel: i18n.t('generationCommon.versionCards.undo'),
    onAction: () => undefined,
  }) : null
  return (
    <div
      data-design-lab-stage="version-cards"
      className="relative overflow-hidden rounded-nomi border border-nomi-line"
      style={{ width: stageWidth, height: VERSION_CARDS_CELL_HEIGHT }}
    >
      <div className="generation-canvas-v2__stage group/canvas">
        {ready ? (
          <>
            {neighbours.map((neighbour) => {
              const live = nodes.find((node) => node.id === neighbour.id)!
              const covered = expanded && isNodeLabelCoveredByGrid({ ...neighbour, ...NODE }, at, layout.cells.map((cell) => ({ ...cell, ...NODE })))
              return (
                <div key={neighbour.id} className={covered ? 'absolute z-[1] [&_[data-node-label-row]]:invisible' : 'absolute z-[1]'} style={{ left: neighbour.x, top: neighbour.y, width: NODE.width, height: NODE.height }}>
                  <BaseGenerationNode node={live} selected={false} />
                </div>
              )
            })}
            {/* 铺开的这一组：层级介于普通节点与选中节点之间（盖在邻居上面）。 */}
            <div className="absolute z-[3]" style={{ left: at.x, top: at.y, width: NODE.width, height: NODE.height }}>
              <NodeVersionStackHandle count={count} expanded={expanded} forceHover={hoverStack} onToggle={() => undefined} />
              <div className="relative z-[1] h-full w-full">
                <BaseGenerationNode node={nodes[0]} selected={false} />
              </div>
              {expanded ? (
                <NodeVersionGrid
                  layout={layout}
                  node={NODE}
                  primaryIdentity={`v${primary}`}
                  hoveredIdentity={hoverVersion ? `v${hoverVersion}` : undefined}
                />
              ) : null}
            </div>
            {toastProps ? (
              <div className="absolute right-3 top-3 z-[20] w-[340px]">
                <Notification icon={toastProps.icon} color={toastProps.color} withBorder={toastProps.withBorder} withCloseButton={toastProps.withCloseButton} onClose={() => undefined}>{toastProps.message}</Notification>
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  )
}
