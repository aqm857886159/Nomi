// 版本卡片接进节点（V2）：节点身后的叠卡入口 + 原地铺开的宫格 + 悬停条的三个动作 + 预览。
//
// 数据只从唯一主人读写：版本列表 / 编号 / 主图 → model/nodeResultLifecycle.ts；铺开状态 → store.setNodeResultStackOpen；
// 设主图 → store.setNodeMainResult（一个撤销步）；删一版 → assets/deleteAssetResult（文件延后真删）。
// 提示条上的「撤销」只在这一步仍是撤销日志的头时给（canvasUndoJournal.getUndoHeadToken）：撤销是前缀重放，
// 头变了（又有手势 / 有生成结果落地）再撤，会把那之后落地的结果也撤掉（已报协调会话的老问题），那时请用户走 ⌘Z。
import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import type { GenerationCanvasNode } from '../../model/generationCanvasTypes'
import { listNodeResultVersions, resultIdentity } from '../../model/nodeResultLifecycle'
import { useGenerationCanvasStore } from '../../store/generationCanvasStore'
import { canvasNodeToAssetRefs } from '../../../assets/assetTypes'
import { deleteAssetResult } from '../../../assets/deleteAssetResult'
import { isProjectExecutionContextCurrent, withProjectAction } from '../../../project/projectCanvasReadSurface'
import { getDesktopBridge } from '../../../../desktop/bridge'
import { logRendererError } from '../../../../desktop/rendererLog'
import { findCanvasResultMediaDimensions } from '../../../project/projectMediaMigration'
import { computeMediaMetaPatch } from '../nodeSizing'
import { downloadNodeResult } from '../useResultDownload'
import NodeMediaPreviewDialog from '../NodeMediaPreviewDialog'
import { beginCanvasResultCopyDrag } from '../../components/canvasResultDrag'
import { getUndoHeadToken } from '../../events/canvasUndoJournal'
import { notify } from '../../../../ui/notificationPolicy'
import { useToastStore } from '../../../../ui/toast'
import { NodeVersionGrid, NodeVersionStackHandle, type VersionCardEntry } from './NodeVersionCards'
import { chooseVersionGridPlacement, layoutVersionGrid, versionGridItems, type VersionGridPlacement } from './versionGridLayout'
import { publishVersionGridCoverage } from './versionGridCoverage'
import { nodeVersionEntries } from './nodeVersionEntries'
import { getGenerationNodeIcon } from '../renderRegistry'

/** 叠卡上的媒体示能：复用 getGenerationNodeIcon 这个唯一出口；插件节点解析不到就不画，不猜一个错的媒体类型。 */
function StackMediaGlyph({ kind }: { kind: GenerationCanvasNode['kind'] }): JSX.Element | null {
  const Icon = React.useMemo(() => {
    try {
      return getGenerationNodeIcon(kind)
    } catch {
      return null
    }
  }, [kind])
  if (!Icon) return null
  return <Icon size={11} stroke={1.8} aria-hidden="true" />
}

function useAltHeld(enabled: boolean): boolean {
  const [held, setHeld] = React.useState(false)
  React.useEffect(() => {
    if (!enabled) { setHeld(false); return undefined }
    const update = (event: KeyboardEvent): void => setHeld(event.altKey)
    const release = (): void => setHeld(false)
    window.addEventListener('keydown', update)
    window.addEventListener('keyup', update)
    window.addEventListener('blur', release)
    return () => {
      window.removeEventListener('keydown', update)
      window.removeEventListener('keyup', update)
      window.removeEventListener('blur', release)
    }
  }, [enabled])
  return held
}

/**
 * 提示条带「撤销」：只在撤销日志的头还是这一步时给。头一变（任何新手势、生成落地）提示条立刻撤掉，
 * 之后要撤就走 ⌘Z（用户看得见画布上发生了什么）。
 */
function notifyUndoable(identity: string, message: string, undoLabel: string): void {
  const head = getUndoHeadToken()
  notify({
    identity,
    reason: 'version-card-undo',
    message,
    level: 'background',
    actionLabel: undoLabel,
    onAction: () => {
      if (getUndoHeadToken() === head) useGenerationCanvasStore.getState().undo()
    },
  })
  const unsubscribe = useGenerationCanvasStore.subscribe(() => {
    if (getUndoHeadToken() === head) return
    useToastStore.getState().remove(identity)
    unsubscribe()
  })
  window.setTimeout(unsubscribe, 10_000)
}

export function NodeVersionCardsHost({ node, readOnly, nodeSize, onFeedback }: {
  node: GenerationCanvasNode
  readOnly: boolean
  nodeSize: Readonly<{ width: number; height: number }>
  onFeedback: (message: string) => void
}): JSX.Element | null {
  const { t } = useTranslation()
  const entries = React.useMemo(() => nodeVersionEntries(node), [node])
  const expanded = Boolean(node.resultStackOpen) && entries.length >= 2
  const [showAll, setShowAll] = React.useState(false)
  const [hovered, setHovered] = React.useState('')
  // 没存边的（老项目 / 别处写进来的铺开状态）挂载时量一次，只放在本地；用户自己点开的都存了边。
  const [measuredPlacement, setMeasuredPlacement] = React.useState<VersionGridPlacement>('right')
  const placement: VersionGridPlacement = node.resultStackSide ?? measuredPlacement
  const [preview, setPreview] = React.useState<VersionCardEntry | null>(null)
  const anchorRef = React.useRef<HTMLSpanElement | null>(null)
  const altHeld = useAltHeld(expanded && !readOnly)
  const pending = node.status === 'queued' || node.status === 'running'
  const primaryIdentity = node.result ? resultIdentity(node.result) : ''

  const layout = React.useMemo(
    () => layoutVersionGrid(versionGridItems(entries, { pending, showAll }), nodeSize, placement),
    [entries, nodeSize, pending, placement, showAll],
  )

  React.useEffect(() => { if (!expanded) { setShowAll(false); setHovered('') } }, [expanded])

  // 往右还是往左：点开那一刻按可见画布量一次（不挪节点、不动视口，09-25 拍板），随铺开状态一起存下，之后不再变。
  const requiredCanvasWidth = layoutVersionGrid(versionGridItems(entries, { pending, showAll }), nodeSize, 'right').bounds.width
  const measurePlacement = React.useCallback((): VersionGridPlacement | null => {
    const anchor = anchorRef.current
    const nodeHost = anchor?.closest<HTMLElement>('.generation-canvas-v2-node')
    const stage = anchor?.closest<HTMLElement>('.generation-canvas-v2__stage')
    if (!nodeHost || !stage) return null
    const nodeRect = nodeHost.getBoundingClientRect()
    const stageRect = stage.getBoundingClientRect()
    const zoom = nodeSize.width > 0 ? nodeRect.width / nodeSize.width : 1
    const gap = 44 * zoom
    const edge = 12
    return chooseVersionGridPlacement({
      requiredWidth: requiredCanvasWidth * zoom + gap,
      rightSpace: stageRect.right - nodeRect.right - edge,
      leftSpace: nodeRect.left - stageRect.left - edge,
    })
  }, [requiredCanvasWidth, nodeSize.width])
  const storedSide = node.resultStackSide
  React.useLayoutEffect(() => {
    if (!expanded || storedSide) return
    const measured = measurePlacement()
    if (measured) setMeasuredPlacement(measured)
  }, [expanded, storedSide, measurePlacement])

  // 登记这一组占着哪些地方，给被压住的邻居藏标题用（画布坐标）。
  React.useEffect(() => {
    if (!expanded) { publishVersionGridCoverage(node.id, null); return undefined }
    publishVersionGridCoverage(node.id, {
      origin: node.position,
      cells: layout.cells.map((cell) => ({ x: cell.x, y: cell.y, width: nodeSize.width, height: nodeSize.height })),
    })
    return () => publishVersionGridCoverage(node.id, null)
  }, [expanded, layout, node.id, node.position, nodeSize.height, nodeSize.width])

  const toggle = React.useCallback(() => {
    if (readOnly && !expanded) return
    useGenerationCanvasStore.getState().setNodeResultStackOpen(node.id, !expanded, expanded ? undefined : measurePlacement() ?? 'right')
  }, [expanded, measurePlacement, node.id, readOnly])

  const setPrimary = React.useCallback(async (entry: VersionCardEntry) => {
    if (readOnly) return
    const live = useGenerationCanvasStore.getState().nodes.find((candidate) => candidate.id === node.id)
    const target = live ? listNodeResultVersions(live).find((candidate) => resultIdentity(candidate) === entry.identity) : undefined
    if (!live || !target) return
    // 换主图时节点按这一版的真实比例重算尺寸元数据（读素材侧车里量过的像素；读不到照样能换）。
    let meta: Record<string, unknown> | undefined
    const project = withProjectAction((loaded) => loaded)
    if (project) {
      try {
        const assets = [] as Array<{ id?: string; data?: Record<string, unknown> }>
        let cursor: string | null = null
        do {
          const desktop = getDesktopBridge()
          if (!desktop?.assets?.list) break
          const page = await desktop.assets.list({ projectId: project.binding.projectId, cursor, limit: 500 })
          if (!page) break
          assets.push(...page.items)
          cursor = page.cursor || null
        } while (cursor)
        if (!isProjectExecutionContextCurrent(project)) return
        const dimensions = findCanvasResultMediaDimensions(target, assets)
        const patch = dimensions ? computeMediaMetaPatch({ resultType: target.type, meta: live.meta || {}, ...dimensions, durationSeconds: target.durationSeconds }) : null
        if (patch) meta = patch.meta
      } catch (error) {
        logRendererError('version-card-dimensions-unreadable', error)
      }
    }
    useGenerationCanvasStore.getState().setNodeMainResult(node.id, entry.identity, meta)
    const downstream = new Set(useGenerationCanvasStore.getState().edges.filter((edge) => edge.source === node.id).map((edge) => edge.target)).size
    notifyUndoable(`version-card:${node.id}`, t('generationCommon.versionCards.primarySet', { n: entry.versionNo, count: downstream }), t('generationCommon.versionCards.undo'))
  }, [node.id, readOnly, t])

  const remove = React.useCallback(async (entry: VersionCardEntry) => {
    if (readOnly) return
    const loaded = withProjectAction((project) => project)
    if (!loaded) return
    const latest = useGenerationCanvasStore.getState().nodes.find((candidate) => candidate.id === node.id)
    const asset = latest ? canvasNodeToAssetRefs(latest).find((candidate) => candidate.ownerResultId === entry.identity) : undefined
    if (!asset) {
      onFeedback(t('generationCommon.versionCards.assetUnavailable'))
      return
    }
    const wasPrimary = latest?.result ? resultIdentity(latest.result) === entry.identity : false
    try {
      const outcome = await deleteAssetResult(asset, loaded)
      if (outcome.failedFileCount > 0) onFeedback(t('generationCommon.versionCards.deleteFileFailed'))
      if (outcome.removedResultCount === 0) return
      const after = useGenerationCanvasStore.getState().nodes.find((candidate) => candidate.id === node.id)
      const nextPrimary = after?.result?.versionNo
      notifyUndoable(
        `version-card:${node.id}`,
        wasPrimary && nextPrimary
          ? t('generationCommon.versionCards.deletedPrimary', { n: entry.versionNo, m: nextPrimary })
          : t('generationCommon.versionCards.deleted', { n: entry.versionNo }),
        t('generationCommon.versionCards.undo'),
      )
    } catch (error) {
      logRendererError('version-card-delete-failed', error)
      onFeedback(t('generationCommon.versionCards.deleteFailed'))
    }
  }, [node.id, onFeedback, readOnly, t])

  const download = React.useCallback((entry: VersionCardEntry) => {
    const target = listNodeResultVersions(node).find((candidate) => resultIdentity(candidate) === entry.identity)
    void downloadNodeResult({ title: node.title, result: target }, t, onFeedback)
  }, [node, onFeedback, t])

  if (entries.length < 2) return null
  const previewIndex = preview ? entries.findIndex((entry) => entry.identity === preview.identity) : -1
  const previewUrl = preview ? preview.url || preview.previewUrl : ''
  return (
    <>
      <span ref={anchorRef} className="hidden" aria-hidden="true" />
      <NodeVersionStackHandle count={entries.length} expanded={expanded} mediaGlyph={<StackMediaGlyph kind={node.kind} />} onToggle={toggle} />
      {expanded ? (
        <NodeVersionGrid
          nodeId={node.id}
          layout={layout}
          node={nodeSize}
          primaryIdentity={primaryIdentity}
          readOnly={readOnly}
          altHeld={altHeld}
          hoveredIdentity={hovered}
          onHoverChange={setHovered}
          onPreview={setPreview}
          onSetPrimary={(entry) => { void setPrimary(entry) }}
          onDownload={download}
          onDelete={(entry) => { void remove(entry) }}
          onShowAll={() => setShowAll(true)}
          onCopyDragStart={(event, entry) => {
            beginCanvasResultCopyDrag(event.nativeEvent, { sourceNodeId: node.id, resultIdentity: entry.identity, url: entry.url })
          }}
          onEscape={toggle}
        />
      ) : null}
      {preview && previewUrl ? (
        <NodeMediaPreviewDialog
          mediaType={preview.type}
          url={previewUrl}
          title={`${node.title || ''} · ${t('generationCommon.versionCards.versionShort', { n: preview.versionNo })}`.trim()}
          onClose={() => setPreview(null)}
          {...(entries.length > 1 ? {
            onStep: (delta: 1 | -1) => {
              const next = entries[(previewIndex + delta + entries.length) % entries.length]
              if (next) setPreview(next)
            },
          } : {})}
        />
      ) : null}
    </>
  )
}
