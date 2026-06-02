import React from 'react'
import {
  Icon3dCubeSphere,
  IconAlertCircle,
  IconBraces,
  IconClipboard,
  IconDeviceFloppy,
  IconLink,
  IconLinkOff,
  IconWand,
} from '@tabler/icons-react'
import { cn } from '../../../utils/cn'
import { toast } from '../../../ui/toast'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { analyzeSemanticSceneFromSource } from './semanticScene/semanticSceneAnalyzer'
import {
  createEmptySemanticScene,
  normalizeSemanticScene,
  summarizeSemanticScene,
} from './semanticScene/semanticSceneSerializer'
import { semanticSceneToScene3D } from './semanticScene/semanticSceneToScene3D'
import type { SemanticScene } from './semanticScene/semanticSceneTypes'

type SemanticSceneNodeProps = {
  node: GenerationCanvasNode
  width: number
  height: number
  selected: boolean
  readOnly?: boolean
}

const SOURCE_LABEL: Record<SemanticScene['sourceType'], string> = {
  panorama: '全景图',
  image: '图片',
  multi_view: '多视图',
  manual: '手动',
}

const CLASS_LABEL: Record<SemanticScene['sceneClass'], string> = {
  indoor_architecture: '室内建筑',
  outdoor_open: '开放场景',
  mixed: '混合场景',
  unknown: '未知场景',
}

function readSemanticScene(node: GenerationCanvasNode): SemanticScene {
  return normalizeSemanticScene(node.meta?.semanticScene || createEmptySemanticScene())
}

function sourceImageUrlForNode(node: GenerationCanvasNode): string {
  if (node.kind === 'panorama') {
    return node.result?.url || (typeof node.meta?.imageUrl === 'string' ? node.meta.imageUrl : '')
  }
  if (node.result?.type === 'image') return node.result.url || ''
  return ''
}

function sourceTypeForNode(node: GenerationCanvasNode): SemanticScene['sourceType'] {
  if (node.kind === 'panorama') return 'panorama'
  return node.result?.type === 'image' ? 'image' : 'manual'
}

function inferSourceScene(
  scene: SemanticScene,
  node: GenerationCanvasNode,
  nodes: GenerationCanvasNode[],
  edges: ReturnType<typeof useGenerationCanvasStore.getState>['edges'],
): SemanticScene {
  if (scene.sourceImageUrls.length) return scene
  const incoming = edges.find((edge) => edge.target === node.id)
  if (!incoming) return scene
  const sourceNode = nodes.find((candidate) => candidate.id === incoming.source)
  if (!sourceNode) return scene
  const sourceUrl = sourceImageUrlForNode(sourceNode)
  if (!sourceUrl) return scene
  return normalizeSemanticScene({
    ...scene,
    sourceType: sourceTypeForNode(sourceNode),
    sourceNodeId: sourceNode.id,
    sourceImageUrls: [sourceUrl],
    updatedAt: Date.now(),
  })
}

function sceneJson(scene: SemanticScene): string {
  return JSON.stringify(scene, null, 2)
}

function sceneEditorJson(scene: SemanticScene): string {
  return JSON.stringify({
    ...scene,
    sourceImageUrls: scene.sourceImageUrls.map((url, index) => (
      url.length > 160 ? `<source-image-${index + 1} omitted; preserved on save>` : url
    )),
  }, null, 2)
}

function restoreEditorSourceUrls(parsed: unknown, fallback: SemanticScene): unknown {
  const raw = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  const sourceImageUrls = Array.isArray(raw.sourceImageUrls)
    ? raw.sourceImageUrls.map((item, index) => {
      if (typeof item === 'string' && item.startsWith('<source-image-') && item.includes('preserved on save')) {
        return fallback.sourceImageUrls[index] || ''
      }
      return item
    }).filter(Boolean)
    : raw.sourceImageUrls
  return {
    ...raw,
    sourceImageUrls,
  }
}

function stopPointer(event: React.SyntheticEvent): void {
  event.stopPropagation()
}

export default function SemanticSceneNode({
  node,
  width,
  height,
  selected,
  readOnly = false,
}: SemanticSceneNodeProps): JSX.Element {
  const updateNode = useGenerationCanvasStore((state) => state.updateNode)
  const addNode = useGenerationCanvasStore((state) => state.addNode)
  const connectNodes = useGenerationCanvasStore((state) => state.connectNodes)
  const nodes = useGenerationCanvasStore((state) => state.nodes)
  const edges = useGenerationCanvasStore((state) => state.edges)
  const [analyzing, setAnalyzing] = React.useState(false)
  const scene = React.useMemo(() => inferSourceScene(readSemanticScene(node), node, nodes, edges), [edges, node, nodes])
  const sceneKey = React.useMemo(() => JSON.stringify(scene), [scene])
  const summary = React.useMemo(() => summarizeSemanticScene(scene), [scene])
  const [draft, setDraft] = React.useState(() => sceneEditorJson(scene))
  const [error, setError] = React.useState('')

  React.useEffect(() => {
    setDraft(sceneEditorJson(scene))
    setError('')
  }, [node.id, sceneKey, scene])

  const saveScene = React.useCallback(() => {
    try {
      const parsed = restoreEditorSourceUrls(JSON.parse(draft), scene)
      const normalized = normalizeSemanticScene({
        ...parsed,
        updatedAt: Date.now(),
      })
      updateNode(node.id, {
        meta: {
          ...(node.meta || {}),
          semanticScene: normalized,
        },
      })
      setError('')
      setDraft(sceneEditorJson(normalized))
      toast('语义场景 JSON 已保存', 'success')
    } catch {
      setError('JSON 格式无法解析')
    }
  }, [draft, node.id, node.meta, scene, updateNode])

  const copyScene = React.useCallback(() => {
    const text = sceneJson(scene)
    if (!navigator.clipboard) {
      setError('当前环境不支持剪贴板')
      return
    }
    void navigator.clipboard.writeText(text).then(
      () => toast('语义场景 JSON 已复制', 'success'),
      () => setError('复制失败'),
    )
  }, [scene])

  const analyzeScene = React.useCallback(async () => {
    if (analyzing) return
    setAnalyzing(true)
    setError('')
    updateNode(node.id, { status: 'running', error: undefined })
    try {
      const analyzed = await analyzeSemanticSceneFromSource({
        node,
        scene,
        draftJson: draft,
      })
      updateNode(node.id, {
        status: 'success',
        error: undefined,
        meta: {
          ...(node.meta || {}),
          semanticScene: analyzed.scene,
          semanticSceneAnalysis: {
            modelVendor: analyzed.model.vendor,
            modelKey: analyzed.model.modelKey,
            modelAlias: analyzed.model.modelAlias,
            modelLabel: analyzed.model.label,
            analyzedAt: Date.now(),
            raw: analyzed.raw,
          },
        },
      })
      setDraft(sceneEditorJson(analyzed.scene))
      toast('AI 已写入语义场景 JSON', 'success')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'AI 分析失败'
      setError(message)
      updateNode(node.id, { status: 'error', error: message })
      toast(message, 'error')
    } finally {
      setAnalyzing(false)
    }
  }, [analyzing, draft, node, scene, updateNode])

  const createScene3D = React.useCallback(() => {
    let semanticScene = scene
    try {
      semanticScene = normalizeSemanticScene(JSON.parse(draft))
    } catch {
      semanticScene = scene
    }
    const scene3dState = semanticSceneToScene3D(semanticScene)
    const scene3dNode = addNode({
      kind: 'scene3d',
      title: `${node.title || '语义场景'} 3D`,
      prompt: '由语义场景图转换生成，可继续进入 3D 编辑器调整。',
      position: {
        x: Math.round(node.position.x + width + 90),
        y: Math.round(node.position.y),
      },
    })
    updateNode(scene3dNode.id, {
      status: 'success',
      meta: {
        ...(scene3dNode.meta || {}),
        source: 'semantic-scene',
        sourceNodeId: node.id,
        scene3dState,
      },
    })
    connectNodes(node.id, scene3dNode.id, 'reference')
    toast('已创建 3D 场景节点', 'success')
  }, [addNode, connectNodes, draft, node.id, node.position.x, node.position.y, node.title, scene, updateNode, width])

  const statItems = [
    ['空间', summary.spaces],
    ['边界', summary.boundaries],
    ['开口', summary.openings],
    ['表面', summary.surfaces],
    ['对象', summary.objects],
    ['相机', summary.cameras],
  ] as const
  const confidence = Math.round(scene.confidence * 100)
  const compact = height < 240
  const hasSourceImage = scene.sourceImageUrls.length > 0
  const sourceStatusText = hasSourceImage ? '源图已绑定' : '未绑定源图'
  const sourceStatusTitle = hasSourceImage
    ? '已绑定源图，可直接进行 AI 分析'
    : '请从全景图/图片节点创建，或先连接一个有图片结果的节点'
  const analyzeTitle = hasSourceImage ? '从源图 AI 分析语义场景' : sourceStatusTitle

  return (
    <div
      className={cn(
        'flex h-full w-full flex-col overflow-hidden',
        'bg-[linear-gradient(135deg,#f8faf7_0%,#eef4f5_46%,#f7f1ea_100%)]',
        'text-nomi-ink',
      )}
    >
      <div className={cn('flex items-start justify-between gap-3 px-4 pt-4')}>
        <div className="min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className="grid size-8 shrink-0 place-items-center rounded-[8px] bg-nomi-paper/[0.76] text-nomi-ink-65 shadow-nomi-sm">
              <IconBraces size={17} stroke={1.8} />
            </span>
            <div className="min-w-0">
              <div className="truncate text-[13px] font-semibold leading-tight text-nomi-ink-85">
                {node.title || '语义场景'}
              </div>
              <div className="mt-1 truncate text-[11px] text-nomi-ink-50">
                {SOURCE_LABEL[scene.sourceType]} · {CLASS_LABEL[scene.sceneClass]} · {confidence}%
              </div>
            </div>
          </div>
        </div>
        {!readOnly ? (
          <div className="flex shrink-0 items-center gap-1">
            <button
              className={cn(
                'inline-flex h-8 items-center justify-center gap-1.5 px-2.5',
                'rounded-[8px] border border-nomi-line-soft bg-nomi-paper/[0.78]',
                'text-[11.5px] font-medium text-nomi-ink-70 shadow-nomi-sm',
                'transition hover:bg-nomi-paper hover:text-nomi-ink',
                'disabled:opacity-50 disabled:cursor-not-allowed',
              )}
              type="button"
              title={analyzeTitle}
              disabled={analyzing || !hasSourceImage}
              onPointerDown={stopPointer}
              onClick={(event) => {
                event.stopPropagation()
                void analyzeScene()
              }}
            >
              <IconWand size={15} stroke={1.8} />
              <span>{analyzing ? '分析中' : 'AI 分析'}</span>
            </button>
            <button
              className={cn(
                'inline-flex h-8 items-center justify-center gap-1.5 px-2.5',
                'rounded-[8px] border border-nomi-line-soft bg-nomi-paper/[0.78]',
                'text-[11.5px] font-medium text-nomi-ink-70 shadow-nomi-sm',
                'transition hover:bg-nomi-paper hover:text-nomi-ink',
              )}
              type="button"
              title="转换为 3D 场景"
              onPointerDown={stopPointer}
              onClick={(event) => {
                event.stopPropagation()
                createScene3D()
              }}
            >
              <Icon3dCubeSphere size={15} stroke={1.8} />
              <span>转 3D</span>
            </button>
          </div>
        ) : null}
      </div>

      <div className="flex items-center gap-1.5 px-4 pt-2">
        <span
          className={cn(
            'inline-flex min-w-0 items-center gap-1.5 rounded-[999px] border px-2 py-1',
            'bg-white/[0.58] text-[10.5px] leading-none shadow-[0_4px_14px_rgba(31,41,55,0.04)]',
            hasSourceImage
              ? 'border-workbench-success-soft text-workbench-success-ink'
              : 'border-workbench-danger-soft text-workbench-danger',
          )}
          title={sourceStatusTitle}
        >
          {hasSourceImage ? <IconLink size={13} stroke={1.8} /> : <IconLinkOff size={13} stroke={1.8} />}
          <span className="truncate">{sourceStatusText}</span>
        </span>
        {scene.sourceNodeId ? (
          <span className="min-w-0 truncate text-[10.5px] text-nomi-ink-40" title={scene.sourceNodeId}>
            {scene.sourceNodeId}
          </span>
        ) : null}
      </div>

      <div className={cn('grid grid-cols-3 gap-1.5 px-4 pt-2.5', compact && 'grid-cols-6')}>
        {statItems.map(([label, value]) => (
          <div
            key={label}
            className={cn(
              'min-w-0 rounded-[8px] border border-white/[0.62] bg-white/[0.56] px-2 py-1.5',
              'shadow-[0_4px_16px_rgba(31,41,55,0.05)]',
            )}
          >
            <div className="truncate text-[10px] text-nomi-ink-45">{label}</div>
            <div className="mt-0.5 text-[14px] font-semibold leading-none text-nomi-ink-80">{value}</div>
          </div>
        ))}
      </div>

      {scene.graph.uncertainties.length ? (
        <div className={cn('mx-4 mt-3 flex items-start gap-2 rounded-[8px] bg-white/[0.58] px-2.5 py-2 text-[11px] leading-[1.35] text-nomi-ink-55')}>
          <IconAlertCircle className="mt-[1px] shrink-0 text-nomi-ink-45" size={14} stroke={1.8} />
          <span className="line-clamp-2">{scene.graph.uncertainties[0]}</span>
        </div>
      ) : null}

      {selected && !readOnly ? (
        <div className="mt-3 flex min-h-0 flex-1 flex-col gap-2 px-4 pb-4">
          <textarea
            className={cn(
              'min-h-0 flex-1 resize-none rounded-[8px] border border-nomi-line-soft',
              'bg-nomi-paper/[0.86] p-2 font-mono text-[10.5px] leading-[1.45] text-nomi-ink-75',
              'outline-none focus:border-nomi-accent',
            )}
            value={draft}
            spellCheck={false}
            onPointerDown={stopPointer}
            onChange={(event) => {
              setDraft(event.currentTarget.value)
              if (error) setError('')
            }}
          />
          <div className="flex items-center gap-1.5">
            <button
              className={cn(
                'inline-flex min-h-[28px] items-center justify-center gap-1.5 px-2.5',
                'rounded-[8px] border border-nomi-line-soft bg-nomi-paper text-[11.5px] text-nomi-ink-70',
                'hover:bg-white hover:text-nomi-ink',
              )}
              type="button"
              onPointerDown={stopPointer}
              onClick={(event) => {
                event.stopPropagation()
                saveScene()
              }}
            >
              <IconDeviceFloppy size={14} stroke={1.8} />
              <span>保存</span>
            </button>
            <button
              className={cn(
                'inline-flex min-h-[28px] items-center justify-center gap-1.5 px-2.5',
                'rounded-[8px] border border-nomi-line-soft bg-nomi-paper text-[11.5px] text-nomi-ink-70',
                'hover:bg-white hover:text-nomi-ink',
              )}
              type="button"
              onPointerDown={stopPointer}
              onClick={(event) => {
                event.stopPropagation()
                copyScene()
              }}
            >
              <IconClipboard size={14} stroke={1.8} />
              <span>复制</span>
            </button>
            {error ? <span className="min-w-0 truncate text-[11px] text-workbench-danger">{error}</span> : null}
          </div>
        </div>
      ) : (
        <div className="mt-auto px-4 pb-4 text-[11px] leading-[1.4] text-nomi-ink-45">
          {hasSourceImage ? '可由 AI 分析源图后写入语义 JSON，再转换为 3D。' : '可粘贴 AI 输出的语义场景 JSON，或先连接图片/全景图节点。'}
        </div>
      )}
    </div>
  )
}
