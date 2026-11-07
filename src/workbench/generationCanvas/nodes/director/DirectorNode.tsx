/**
 * [INPUT]: 依赖 react、react-i18next、../../../../ui/chunkBoundary 的 lazyWithChunkBoundary、../../../../utils/cn、
 *          ../../../generation/pageLayer 的 GenerationPageLayer（导演台挂进生成页那一格）、
 *          ../../../../design 的 WorkbenchButton、@tabler/icons-react 图标、../../store/generationCanvasStore、
 *          ../../model/generationCanvasTypes、
 *          ../../../project/workbenchProjectSession 的 persistActiveWorkbenchProjectNow、./model/directorProject（normalize/stats）、./model/assetKinds（连线文件类型判定）
 * [OUTPUT]: 对外提供 DirectorNode（default，React.memo）：画布上的导演台节点卡片 —— 统计摘要 + 入连摘要 + 打开按钮，
 *           打开时懒加载 DirectorEditor 并经 GenerationPageLayer 挂进生成页那一格，关闭时把工程写回 node.meta.directorProject 并立即落盘
 * [POS]: director 与画布的接缝（方案 §2.2）：节点数据只在这里读写；编辑期真相在 DirectorEditor 的 store 里。
 *        打开状态归 pageLayerContext 按节点 id 保存；画布裁剪后重挂仍开着，删节点 / 释放项目时清掉。
 *        模板参考 V1 Scene3DEditor（meta 读写、chunk 预热、关闭落盘），但作为顶层节点组件注册（不改 BaseGenerationNode）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { IconMaximize, IconMovie } from '@tabler/icons-react'
import { WorkbenchButton } from '../../../../design'
import { lazyWithChunkBoundary } from '../../../../ui/chunkBoundary'
import { cn } from '../../../../utils/cn'
import { GenerationPageLayer } from '../../../generation/pageLayer'
import { setGenerationPageLayerTenantOpen, useGenerationPageLayerTenantOpen } from '../../../generation/pageLayerContext'
import { persistActiveWorkbenchProjectNow } from '../../../project/workbenchProjectSession'
import type { GenerationCanvasNode } from '../../model/generationCanvasTypes'
import { useGenerationCanvasStore } from '../../store/generationCanvasStore'
import { resolveNodeVisualSize } from '../nodeSizing'
import { NodeEmptyState } from '../render/NodeEmptyState'
import { useNodeEmptyStateContext } from '../render/NodeEmptyStateContext'
import { getGenerationNodeIcon } from '../renderRegistry'
import { assetKindOfFileName } from './model/assetKinds'
import { DIRECTOR_PREVIEW_META_KEY, DIRECTOR_PROJECT_META_KEY } from './model/directorNodeMeta'
import { DIRECTOR_PREVIEW_MAX_SECONDS, readDirectorPreview } from './model/directorPreviewState'
import { requestDirectorPreviewRender } from './agent/directorPreviewCapture'
import { normalizeDirectorProject, projectStats } from './model/directorProject'
import type { DirectorLinkedAsset, DirectorProject } from './model/directorTypes'
import type { DirectorOutput } from './OutputsContext'

// 资产节点连进来的文件只认泼溅 / 模型（全景走全景节点，场景 JSON 不从连线来）
function linkedAssetKindOf(url: string): DirectorLinkedAsset['kind'] | null {
  const kind = assetKindOfFileName(url)
  return kind === 'splat' || kind === 'model' ? kind : null
}

const loadDirectorEditor = () => import('./DirectorEditor')
const DirectorEditor = lazyWithChunkBoundary('i18n:director.editor.loading', loadDirectorEditor)

type Props = { node: unknown; selected: boolean; readOnly?: boolean }

function DirectorNode({ node: rawNode, selected, readOnly = false }: Props): JSX.Element {
  const { engaged } = useNodeEmptyStateContext()
  const EmptyIcon = getGenerationNodeIcon('director')
  const { t } = useTranslation()
  const node = rawNode as GenerationCanvasNode
  const updateNode = useGenerationCanvasStore((state) => state.updateNode)
  const incomingKey = useGenerationCanvasStore((state) =>
    state.edges
      .filter((edge) => edge.target === node.id)
      .map((edge) => {
        const source = state.nodes.find((candidate) => candidate.id === edge.source)
        return source ? `${source.id}:${source.kind}:${source.title ?? ''}:${source.result?.url ?? ''}` : ''
      })
      .join('|'),
  )
  // 入连摘要 + 连线引用列表（全景节点 → 全景；资产节点按文件后缀分泼溅 / 模型），key 变了才重算，避免每次画布更新都造新数组
  const { incoming, linkedAssets } = React.useMemo(() => {
    const state = useGenerationCanvasStore.getState()
    let images = 0
    let panoramas = 0
    let assets = 0
    const linked: DirectorLinkedAsset[] = []
    for (const edge of state.edges) {
      if (edge.target !== node.id) continue
      const source = state.nodes.find((candidate) => candidate.id === edge.source)
      if (!source) continue
      const url = (source.result?.url || '').trim()
      if (source.kind === 'panorama') {
        panoramas += 1
        if (url) linked.push({ id: source.id, name: source.title || t('director.assets.kind.panorama'), kind: 'panorama', url })
      } else if (source.kind === 'image') images += 1
      else if (source.kind === 'asset') {
        assets += 1
        const kind = linkedAssetKindOf(url)
        if (url && kind) linked.push({ id: source.id, name: source.title || url.split('/').pop() || kind, kind, url })
      }
    }
    return { incoming: { images, panoramas, assets }, linkedAssets: linked }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- incomingKey 已把 edges/nodes 里会影响结果的字段折进来
  }, [incomingKey, node.id, t])
  const open = useGenerationPageLayerTenantOpen('director', node.id)
  const rawProject = node.meta?.[DIRECTOR_PROJECT_META_KEY]
  const stats = React.useMemo(() => projectStats(normalizeDirectorProject(rawProject, t('director.node.sceneDefaultName'))), [rawProject, t])
  const visualSize = resolveNodeVisualSize(node)
  const hasContent = stats.objectCount > 0 || stats.cameraCount > 0 || stats.hasPanorama

  const incomingSummary = React.useMemo(() => {
    const parts: string[] = []
    if (incoming.panoramas > 0) parts.push(t('director.node.incomingPanoramas', { count: incoming.panoramas }))
    if (incoming.images > 0) parts.push(t('director.node.incomingImages', { count: incoming.images }))
    if (incoming.assets > 0) parts.push(t('director.node.incomingAssets', { count: incoming.assets }))
    return parts.length ? t('director.node.incoming', { summary: parts.join(' · ') }) : ''
  }, [incoming, t])

  const handleProjectChange = React.useCallback(
    (project: DirectorProject) => {
      const current = useGenerationCanvasStore.getState().nodes.find((candidate) => candidate.id === node.id)
      updateNode(node.id, { meta: { ...(current?.meta || {}), [DIRECTOR_PROJECT_META_KEY]: project } })
    },
    [node.id, updateNode],
  )

  // 产物 → 画布：截图落成 Image 节点、录像落成 Video 节点，放在导演台节点右侧并连一条 reference 边回来
  const handleSendToCanvas = React.useCallback(
    (output: DirectorOutput) => {
      const canvas = useGenerationCanvasStore.getState()
      const current = canvas.nodes.find((candidate) => candidate.id === node.id)
      // 产物卡 + 出处边是一个原子动作（addDerivedOutput）。
      const created = canvas.addDerivedOutput({
        sourceNodeId: node.id,
        kind: 'director-output',
        mode: 'reference',
        node: {
          kind: output.kind === 'image' ? 'image' : 'video',
          title: output.kind === 'image' ? t('director.timeline.screenshotNodeTitle') : t('director.timeline.videoNodeTitle'),
          prompt: output.name,
          position: { x: Math.round((current?.position.x ?? 0) + 420), y: Math.round(current?.position.y ?? 0) },
        },
      })
      if (!created) return
      const createdAt = Date.now()
      const result = { id: `director-output-${output.id}-${createdAt}`, type: output.kind, url: output.assetUrl, createdAt, ...(output.kind === 'video' ? { durationSeconds: output.duration } : {}) }
      canvas.updateNode(created.id, { result, history: [result], status: 'success', meta: { ...(created.meta || {}), source: 'director', sourceNodeId: node.id } })
    },
    [node.id, t],
  )

  // 3D-BOX 预演状态：渲染中 / 失败要让人看见，失败给重试——重试走预演的唯一写口 requestDirectorPreviewRender
  // （与导演视图「出成片」同一个），常驻 Host 扫到即重渲；超长的不给重试（改短才行）。
  const preview = readDirectorPreview(node)
  const handleRetryPreview = React.useCallback(() => {
    if (readDirectorPreview(useGenerationCanvasStore.getState().nodes.find((candidate) => candidate.id === node.id))?.status !== 'failed') return
    requestDirectorPreviewRender(node.id)
  }, [node.id])

  const handleClose = React.useCallback(() => {
    setGenerationPageLayerTenantOpen('director', node.id, false)
    void persistActiveWorkbenchProjectNow().catch(() => {})
  }, [node.id])

  return (
    <article
      className={cn(
        'generation-canvas-v2-node relative block isolate group/node cursor-grab select-none touch-none overflow-visible',
        'p-0 border-0 rounded-none bg-transparent shadow-none',
        selected ? 'z-[5]' : '',
      )}
      style={{ width: visualSize.width, height: visualSize.height }}
      data-node-id={node.id}
      data-kind={node.kind}
      data-selected={selected ? 'true' : 'false'}
      data-testid="director-node"
    >
      <div
        className={cn(
          'generation-canvas-v2-node__preview flex h-full w-full flex-col overflow-hidden rounded-nomi border bg-nomi-paper shadow-nomi-md',
          'border-nomi-line',
        )}
      >
        <header className="flex h-8 shrink-0 items-center gap-2 px-3 text-body-sm text-nomi-ink">
          <IconMovie size={16} stroke={1.9} className="text-nomi-ink-60" />
          <span className="truncate font-medium">{node.title || t('director.node.title')}</span>
          <div className="flex-1" />
          {!readOnly && (hasContent || engaged) ? (
            <button
              type="button"
              className="inline-flex h-6 w-6 items-center justify-center rounded-nomi-sm text-nomi-ink-60 hover:bg-workbench-hover hover:text-nomi-ink"
              title={t('director.node.open')}
              aria-label={t('director.node.open')}
              onPointerEnter={() => void loadDirectorEditor()}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation()
                setGenerationPageLayerTenantOpen('director', node.id, true)
              }}
            >
              <IconMaximize size={15} stroke={1.9} />
            </button>
          ) : null}
        </header>
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 bg-nomi-bg px-4 text-center">
          {hasContent ? (
            <>
              <span className="rounded-nomi-sm bg-nomi-ink-05 px-2 py-0.5 text-micro font-nomi-mono text-nomi-ink-60">{t('director.node.badge3d')}</span>
              <span className="text-body-sm text-nomi-ink">{t('director.node.stats', { objects: stats.objectCount, cameras: stats.cameraCount })}</span>
            </>
          ) : (
            <div className="min-h-0 w-full flex-1">
              <NodeEmptyState compact icon={<EmptyIcon size={18} stroke={1.5} />} description={t('director.node.empty')} />
            </div>
          )}
          {incomingSummary ? <span className="text-micro text-nomi-ink-40">{incomingSummary}</span> : null}
          {preview?.status === 'rendering' ? (
            <span className="text-micro text-nomi-ink-60" data-testid="director-node-preview-status" data-status="rendering">{t('director.agent.previewRendering')}</span>
          ) : null}
          {preview?.status === 'failed' ? (
            <span className="flex items-center gap-2 text-micro text-nomi-danger" data-testid="director-node-preview-status" data-status="failed">
              {preview.reason === 'too_long' ? t('director.agent.previewTooLong', { seconds: DIRECTOR_PREVIEW_MAX_SECONDS }) : t('director.agent.previewFailed')}
              {preview.reason !== 'too_long' && !readOnly ? (
                <WorkbenchButton
                  size="sm"
                  variant="default"
                  data-testid="director-node-preview-retry"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation()
                    handleRetryPreview()
                  }}
                >
                  {t('director.agent.previewRetry')}
                </WorkbenchButton>
              ) : null}
            </span>
          ) : null}
          {!readOnly && (hasContent || engaged) ? (
            <WorkbenchButton
              size="sm"
              variant="primary"
              data-testid="director-node-open"
              onPointerEnter={() => void loadDirectorEditor()}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation()
                setGenerationPageLayerTenantOpen('director', node.id, true)
              }}
            >
              {t('director.node.openShort')}
            </WorkbenchButton>
          ) : null}
        </div>
      </div>
      {open ? (
        <React.Suspense fallback={null}>
          <GenerationPageLayer>
            <DirectorEditor
              rawProject={rawProject}
              nodeTitle={node.title || t('director.node.title')}
              readOnly={readOnly}
              linkedAssets={linkedAssets}
              nodeId={node.id}
              onSendToCanvas={handleSendToCanvas}
              onClose={handleClose}
              onProjectChange={handleProjectChange}
            />
          </GenerationPageLayer>
        </React.Suspense>
      ) : null}
    </article>
  )
}

export default React.memo(
  DirectorNode,
  (previous, next) =>
    (previous.node as GenerationCanvasNode).id === (next.node as GenerationCanvasNode).id &&
    (previous.node as GenerationCanvasNode).title === (next.node as GenerationCanvasNode).title &&
    (previous.node as GenerationCanvasNode).meta?.[DIRECTOR_PROJECT_META_KEY] === (next.node as GenerationCanvasNode).meta?.[DIRECTOR_PROJECT_META_KEY] &&
    (previous.node as GenerationCanvasNode).meta?.[DIRECTOR_PREVIEW_META_KEY] === (next.node as GenerationCanvasNode).meta?.[DIRECTOR_PREVIEW_META_KEY] &&
    (previous.node as GenerationCanvasNode).size === (next.node as GenerationCanvasNode).size &&
    previous.selected === next.selected &&
    previous.readOnly === next.readOnly,
)
