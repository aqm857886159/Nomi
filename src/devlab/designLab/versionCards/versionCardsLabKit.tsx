// 设计实验室 · 屏「画布 · 版本卡片（宫格）」的取景台与夹具（V2 接线后）。
//
// 每一格渲染的都是**现役 BaseGenerationNode 本体**：节点身后的叠卡入口、铺开的宫格、悬停条、生成中占位、
// 被压住的邻居藏标题，全是节点自己按真实数据画出来的（versionCards/NodeVersionCardsHost）。夹具只给数据：
// 几版、谁是主图、铺没铺开（`resultStackOpen`）、在不在生成；悬停 / 点「+N」走**真实的指针与点击事件**
// （挂载后派发），不给组件加「默认悬停」之类只有实验室用的开关。
//
// 唯一不是现役宿主的是提示条：它在真画布上由应用根上的 Mantine 通知容器画，实验室没有那个容器，
// 所以这里用同一份 buildToastNotification 的产物、交给 Mantine 的 Notification 画（外观同一份）。
// 画面是 data URI 的几何占位（实验室不依赖机器上的素材），每一版换一个色调好分清。
import React, { type JSX } from 'react'
import { Notification } from '@mantine/core'
import '../../../workbench/generationCanvas/styles/generationCanvas.css'
import i18n from '../../../i18n'
import BaseGenerationNode from '../../../workbench/generationCanvas/nodes/BaseGenerationNode'
import type { GenerationCanvasNode, GenerationNodeResult } from '../../../workbench/generationCanvas/model/generationCanvasTypes'
import { useGenerationCanvasStore } from '../../../workbench/generationCanvas/store/generationCanvasStore'
import { useWorkbenchStore } from '../../../workbench/workbenchStore'
import { buildToastNotification } from '../../../ui/toast'
import { holdDesignLabReady } from '../labReadyHold'

export const VERSION_CARDS_CELL_WIDTH = 1400
export const VERSION_CARDS_CELL_HEIGHT = 760

/** 节点 240×135（16:9）：图片节点最小宽附近，宫格 4×3 也装得进一格取景框。 */
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

function result(nodeId: string, versionNo: number): GenerationNodeResult {
  const url = frame(versionNo)
  return { id: `${nodeId}-v${versionNo}`, type: 'image', url, thumbnailUrl: url, createdAt: versionNo, versionNo }
}

function canvasNode(input: {
  id: string; title: string; position: { x: number; y: number }; count: number; primary: number
  removed?: readonly number[]; expanded?: boolean; pending?: boolean
}): GenerationCanvasNode {
  const history = Array.from({ length: input.count }, (_, index) => input.count - index)
    .filter((versionNo) => !(input.removed ?? []).includes(versionNo))
    .map((versionNo) => result(input.id, versionNo))
  return {
    id: input.id,
    kind: 'image',
    title: input.title,
    categoryId: 'shots',
    position: input.position,
    size: { ...NODE },
    status: input.pending ? 'running' : 'success',
    prompt: '',
    result: history.find((entry) => entry.versionNo === input.primary) ?? history[0],
    history,
    resultVersionMax: input.count,
    ...(input.expanded ? { resultStackOpen: true } : {}),
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

/** 挂载后按真实指针 / 点击事件把格子摆到要看的那一刻（悬停某张卡、悬停叠卡、点开「+N」），摆好才举就绪旗。 */
function useDriveOnMount(rootRef: React.RefObject<HTMLDivElement | null>, ready: boolean, drive: { hoverVersion?: number; hoverStack?: boolean; showAll?: boolean }): void {
  React.useEffect(() => {
    if (!ready || (!drive.hoverVersion && !drive.hoverStack && !drive.showAll)) return undefined
    const release = holdDesignLabReady('version-cards:drive')
    let frame = 0
    let tries = 0
    const tick = (): void => {
      const root = rootRef.current
      tries += 1
      const more = drive.showAll ? root?.querySelector<HTMLButtonElement>('[data-version-card="more"] button') : null
      if (more) more.click()
      const target = drive.hoverVersion
        ? root?.querySelector<HTMLElement>(`[data-version-grid="vc-source"] [data-version-card="${drive.hoverVersion}"]`)
        : drive.hoverStack ? root?.querySelector<HTMLElement>('[data-node-id="vc-source"] [data-version-stack-handle]') : null
      if (target) target.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' }))
      const done = drive.hoverVersion
        ? Boolean(root?.querySelector('[data-version-card-bar]'))
        : drive.hoverStack ? Boolean(root?.querySelector('[data-version-stack-count]')) : !root?.querySelector('[data-version-card="more"]')
      if (done || tries > 120) { release(); return }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => { cancelAnimationFrame(frame); release() }
  }, [drive.hoverStack, drive.hoverVersion, drive.showAll, ready, rootRef])
}

export type VersionCardsStageProps = {
  locale?: 'zh-CN' | 'en'
  /** 这个节点攒了几版（出过的最大号）。 */
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
  /** 旁边的邻居节点（铺开会盖住它们）。 */
  neighbours?: ReadonlyArray<{ id: string; title: string; x: number; y: number; versionNo: number }>
  /** 已经删掉的版本号（删了留空号）。 */
  removed?: readonly number[]
  toast?: 'deleted' | 'primary-set'
}

// 缺省值必须是稳定引用：它们进了 nodes 的 useMemo，每次渲染一份新数组就是「写 store → 重渲 → 再写」的死循环。
const DEFAULT_AT = { x: 80, y: 120 }
const NO_NEIGHBOURS: NonNullable<VersionCardsStageProps['neighbours']> = []
const NO_REMOVED: readonly number[] = []

export function VersionCardsStage({
  locale = 'zh-CN', count, expanded = false, hoverStack = false, hoverVersion, primaryVersion, showAll = false, pending = false,
  at = DEFAULT_AT, neighbours = NO_NEIGHBOURS, removed = NO_REMOVED, toast,
}: VersionCardsStageProps): JSX.Element {
  const localeReady = useLabLocale(locale)
  const rootRef = React.useRef<HTMLDivElement | null>(null)
  const primary = primaryVersion ?? count
  const zh = locale === 'zh-CN'
  const nodes = React.useMemo(() => [
    canvasNode({ id: 'vc-source', title: zh ? '场景 · 雨巷' : 'Scene · Rain alley', position: at, count, primary, removed, expanded, pending }),
    ...neighbours.map((neighbour) => canvasNode({ id: neighbour.id, title: neighbour.title, position: { x: neighbour.x, y: neighbour.y }, count: neighbour.versionNo, primary: neighbour.versionNo })),
  ], [at, count, expanded, neighbours, pending, primary, removed, zh])
  const ready = useCanvasStores(nodes) && localeReady
  useDriveOnMount(rootRef, ready, { hoverVersion, hoverStack, showAll })
  const liveNodes = useGenerationCanvasStore((state) => state.nodes)
  const toastProps = toast ? buildToastNotification({
    id: 'vc-toast',
    reason: 'version-card-undo',
    message: toast === 'primary-set'
      ? i18n.t('generationCommon.versionCards.primarySet', { n: primary, count: 3 })
      : i18n.t('generationCommon.versionCards.deleted', { n: removed[0] ?? count }),
    actionLabel: i18n.t('generationCommon.versionCards.undo'),
    onAction: () => undefined,
  }) : null
  return (
    <div
      ref={rootRef}
      data-design-lab-stage="version-cards"
      className="relative overflow-hidden rounded-nomi border border-nomi-line"
      style={{ width: VERSION_CARDS_CELL_WIDTH, height: VERSION_CARDS_CELL_HEIGHT }}
    >
      <div className="generation-canvas-v2__stage group/canvas">
        {ready ? liveNodes.map((node) => (
          // 层级同真画布：铺开的那一组盖在普通节点上面（画布内核里是 zIndex 4，见 generationCanvasReactFlowAdapter）。
          <div key={node.id} className={node.resultStackOpen ? 'absolute left-0 top-0 z-[4]' : 'absolute left-0 top-0 z-[1]'}>
            <BaseGenerationNode node={node} selected={false} />
          </div>
        )) : null}
        {toastProps ? (
          <div className="absolute right-3 top-3 z-[20] w-[340px]">
            <Notification icon={toastProps.icon} color={toastProps.color} withBorder={toastProps.withBorder} withCloseButton={toastProps.withCloseButton} onClose={() => undefined}>{toastProps.message}</Notification>
          </div>
        ) : null}
      </div>
    </div>
  )
}
