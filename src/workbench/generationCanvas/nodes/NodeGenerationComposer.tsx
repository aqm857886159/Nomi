import { notify } from '../../../ui/notificationPolicy'
import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import type { Editor } from '@tiptap/react'
import { ICON_TIERS, NomiLoadingMark, WorkbenchIconButton } from '../../../design'
import { cn } from '../../../utils/cn'
import type { LibraryPrompt } from '../../api/promptLibraryApi'
import { useNodeEffectChips } from './NodeEffectChips'
import { showUndoToast } from '../../../utils/showUndoToast'
import PromptEditor from '../../assets/PromptEditor'
import { promptToContent } from '../../assets/promptEditorContent'
import { useNodeMentionSource } from './useNodeMentionSource'
import { NODE_SCROLL_REGION_CLASS_NAME } from './nodeScrollRegionClassName'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { NodeWriteAccessProvider, useNodeWriteAccess } from './nodeWriteAccess'
import { canRunGenerationNode, unmetReferenceDependencyForNode } from '../runner/generationRunController'
import { startGenerationFromComposer } from './composerRun'
import { directorPreviewSpendBlock, directorPreviewSpendBlockMessageKey } from './director/model/directorPreviewState'
import { requestDirectorPreviewRender } from './director/agent/directorPreviewCapture'
import type { UnmetReferenceDependency } from './controls/referenceDependency'
import { collectUngeneratedReferenceAncestors } from '../runner/referenceAncestors'
import NodeParameterControls from './NodeParameterControls'
import { GENERATE_BUTTON_CLASS } from './nodeComposerStyles'
import { NodePromptToolCluster } from './NodePromptToolCluster'
import { NodePromptOptimizer } from './NodePromptOptimizer'
import { NodePromptTranslator } from './NodePromptTranslator'
import { useNodeAssetDrop } from './useNodeAssetDrop'
import { persistActiveWorkbenchProjectNow } from '../../project/workbenchProjectSession'
import {
  getGenerationNodeExecutionKind,
  getGenerationNodePromptPlaceholder,
  isAudioLikeGenerationNodeKind,
  isImageLikeGenerationNodeKind,
  isModel3dLikeGenerationNodeKind,
  isVideoLikeGenerationNodeKind,
} from '../model/generationNodeKinds'
import { resolveArchetypeForModel } from '../../../../electron/shared/modelArchetypes'
import { effectiveArchetypeMode } from './controls/archetypeMeta'
import { applyPromptReferenceImages } from './promptReferenceImages'
import { useComposerPromptExpand } from './useComposerPromptExpand'
import { COMPOSER_MIN_USABLE_HEIGHT, NODE_COMPOSER_WIDTH } from './nodeSizing'
import { ComposerAnchor } from './composerAnchor'
import { ConnectedTextChips } from './ConnectedTextChips'
import TextNodeComposer from './TextNodeComposer'
import { IconArrowUp, IconArrowsDiagonal, IconArrowsDiagonalMinimize2, IconRefresh } from '@tabler/icons-react'
import { ReferenceNamesContext, resolveReferenceInfos } from '../../assets/referenceNames'
import { mentionUrlsInOrder } from '../../assets/promptMentions'
import { peekAllProjectAssets } from '../../assets/useAllProjectAssets'
import {
  findModelOptionByIdentifier,
  requiredModeForGenerationNode,
  useGenerationModelOptionsState,
} from '../adapters/modelOptionsAdapter'
import { useVendorMappingsReader } from './controls/useChannelCreateBody'
import { nodeSelectedModelAddress } from './controls/parameterControlModel'
import { comfyWorkflowTakesPrompt } from '../runner/promptRequirement'
import { useProductionRunStore } from '../../production/productionRunStore'
import { useProductionCanvasLandingStore } from '../../production/productionCanvasLandingStore'
import { useComposerGraph } from './composerGraphSnapshot'
import { productionMetaOf } from '../model/productionMeta'
import { decideShotClaim } from '../../../../electron/shared/decideShotClaim'
import { shotClaimCopy } from '../../observability/shotClaimCopy'
import { useNodePromptFocusRequest } from './nodePromptFocus'
import { CANVAS_LAYER } from '../reactFlow/canvasLayerOrder'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'

// 生成节点的浮动 composer：references + 提示词 + 参数 + 生成/重新生成按钮。
// 从 BaseGenerationNode 抽出（A1.5 接缝）：只有「生成类」节点挂它，素材节点不挂。
// 所有生成相关依赖（runner / NodeParameterControls / 布局计算）都收在这里，壳保持 kind 无关。

/**
 * 这张 composer 挂在哪里。
 *
 * `canvas`（默认）= 画布上那张浮在节点下沿的卡：绝对定位、自带边框阴影、右下角一颗圆形 `↑`。
 *
 * `inline` = **画布这张卡原样，只是放在普通内容流里**（生成页「列表」点开一镜后的大详情用它，用户 10-10：「排版完全复用我们画布里面的排版」）：
 * 生成方式页签、提示词区、模型、参数、工具图标、右下角 `↑` 都和 `canvas` 一模一样（同一个组件、同一套排版），
 * 唯一的差别是不钉在画布节点下沿（没有 React Flow、没有缩放）——宿主只给它一块地方。
 *
 * 刻意用一个 host 字段而不是一堆 `hideX` 开关：宿主各自成套，散开成开关之后，下一个调用者一定会挑出一套没人验证过的组合。
 *
 * Agent 面板的付费卡**不挂**这张卡（D2，用户 2026-10-23 拍板）：卡上只有指向元素和一行只读摘要，想改就点指向元素去节点里改。
 * 2026-09-10 到 D2 之间那张卡挂过整件生成框（`panel` 宿主、逐参数 chip），连同它的写口一起删了；
 * 聊天卡片模块引不到这里，由依赖规则 `chat-card-no-import-node-editor` 拦着（设计系统 §1.0）。
 */
export type NodeComposerHost = 'canvas' | 'inline'

type Props = {
  onFeedback: (message: string) => void
  node: GenerationCanvasNode
  visualSize: { width: number; height: number }
  host?: NodeComposerHost
  readOnly?: boolean
}

/**
 * 画布浮框的高度上限（屏幕像素）。宽度与间距不在这里：宽度是定值 `NODE_COMPOSER_WIDTH`，间距是 `NODE_COMPOSER_GAP`。
 *
 * 高度**内容驱动**，不绑节点高（旧 `height*0.72` 是 bug 根因：小节点 → 矮卡，
 * 「参考区 + 3 行提示词 + 底栏」放不下，overflow-hidden 把底栏的生成钮裁到卡外，修③④）。
 * 卡片在 flex-col 里自然按内容长高；提示词 flex-1 overflow-auto，推荐项只占剩余空间，
 * 底栏不收缩；提示词保留三行。上限只看 kind，不看屏幕还剩多少——同一个节点每次打开都一样高。
 * 展开提示词时（右上角那颗钮）这个上限整个让开，卡片按全文长高。
 */
function composerMaxHeight(kind: GenerationCanvasNode['kind']): number {
  return kind === 'video' ? 460 : 400
}

/**
 * 文本节点在画布上的浮框是「加工框」（预设 + 一句话 + 跟随 Agent 的模型），不是图片 / 视频那张带参考与参数的卡——
 * 两件东西没有共同的身体，所以按种类分开：文本走 TextNodeComposer，其余走下面这张。
 */
export default function NodeGenerationComposer(props: Props): JSX.Element {
  return props.node.kind === 'text'
    ? <TextNodeComposer onFeedback={props.onFeedback} node={props.node} visualSize={props.visualSize} readOnly={props.readOnly ?? false} inFlow={props.host === 'inline'} />
    : <GenericNodeGenerationComposer {...props} />
}

function GenericNodeGenerationComposer({ onFeedback, node, visualSize, host = 'canvas', readOnly = false }: Props): JSX.Element {
  const feedbackOwnerRef = React.useRef<string | null>(node.id)
  feedbackOwnerRef.current = node.id
  React.useEffect(() => { feedbackOwnerRef.current = node.id; return () => { feedbackOwnerRef.current = null } }, [node.id])
  const [feedback, setFeedback] = React.useState<string | null>(null)
  const reportFeedback = React.useCallback((message: string) => {
    if (feedbackOwnerRef.current !== node.id) { onFeedback(message); return }
    notify({ identity: `NodeGenerationComposer:${node.id}`, reason: 'interaction', message, level: 'inline', present: setFeedback })
  }, [node.id, onFeedback])
  const { t } = useTranslation()
  // 不钉在画布节点下沿（列表详情）：外层是普通内容流里的一个 div，不绝对定位、不随画布拖动隐身。
  const inFlow = host !== 'canvas'
  // 写口（见 nodeWriteAccess）：默认写画布 store；这张卡往下把它包一层只读闸再交给参考区 / @ 引用 / 拖放。
  const { updateNode: writeNode, latestNode, connectNodes } = useNodeWriteAccess()
  const readOnlyRef = React.useRef(readOnly)
  readOnlyRef.current = readOnly
  const updateNode = React.useCallback((...args: Parameters<typeof writeNode>) => {
    if (!readOnlyRef.current) writeNode(...args)
  }, [writeNode])
  const writeAccess = React.useMemo(() => ({ updateNode, latestNode, canWrite: () => !readOnlyRef.current, ...(connectNodes ? { connectNodes: ((...args: Parameters<typeof connectNodes>) => { if (!readOnlyRef.current) return connectNodes(...args) }) as typeof connectNodes } : {}) }), [updateNode, latestNode, connectNodes])
  const status = node.status || 'idle'
  const isGenerating = status === 'queued' || status === 'running'
  const hasResult = Boolean(node.result?.url)
  const nodeExecutionKind = getGenerationNodeExecutionKind(node.kind)
  // 这张卡读得到的那一小片图（composerGraphSnapshot）：依赖面没变就是同一份，别的卡的生成进度、拖动不让生成框重渲。
  // 下面每个读图的派生值都从这一份算，算法照旧是 runner 那几个现役函数——不再各订各的整表、不再 JSON.stringify 防抖。
  const graph = useComposerGraph(node.id)
  const requiredMode = React.useMemo(() => requiredModeForGenerationNode(node, graph), [node, graph])
  // 模型清单（可疑点 f）：整张生成框只算这一份，往下交给三份参数控件，不再各算一遍。
  const modelOptionsState = useGenerationModelOptionsState(node.kind, requiredMode)
  const modelOptions = modelOptionsState.options
  // 渠道 mapping 同理：内存里那一份（composerResidentData 启动后载入），三份控件共用一个读取器。
  const readMappings = useVendorMappingsReader()
  const selectedModelAddress = nodeSelectedModelAddress(node.meta || {})
  const selectedModelOption = findModelOptionByIdentifier(
    modelOptions,
    selectedModelAddress.modelKey,
    selectedModelAddress.vendorKey,
  )
  // 导入工作流是否接收提示词由保存下来的 binding 决定。明确不接收时，整组移除无效输入和动作；
  // null 表示非 ComfyUI 或目录尚未就绪，维持普通模型原有体验。
  const acceptsPrompt = comfyWorkflowTakesPrompt(selectedModelOption?.meta) !== false
  // 「这一镜归制作流程生成」也是 canRunGenerationNode 的一个判据：它读的是制作落地 store，所以单独订它的 runs。
  const productionLandingRuns = useProductionCanvasLandingStore((state) => state.runs)
  const canGenerate = React.useMemo(
    () => { void productionLandingRuns; return canRunGenerationNode(node, graph) },
    [node, graph, productionLandingRuns],
  )
  // 跨槽依赖未满足（档案 slot.requiresAnyOf；如 Seedance 2.0 只放了参考音频、缺图/视频）。
  // 与 canGenerate 同一个判定（unmetReferenceDependencyForNode），composer 不再按 node.kind 重猜原因。
  // 文案仍留到渲染时用 t() 格式化，保证切语言能实时重渲。
  // 3D-BOX 预演挡着这一镜的生成（渲染中 / 失败 / 过期）：与 canRunGenerationNode 同一个判据，这里只取原因与可重渲的导演节点（都从这张卡的图快照算，导演卡已在依赖面里）。
  const directorBlock = React.useMemo(() => directorPreviewSpendBlock(node.id, graph.nodes), [node.id, graph])
  const directorPreviewBlock = directorBlock ? directorPreviewSpendBlockMessageKey(directorBlock) : null
  // 过期 / 可重试的失败：给一键重渲（与「出成片」、导演节点卡「重试」同一个写口）；超长的失败要改短，不给
  const rerenderDirectorNodeId = directorBlock && (directorBlock.reason === 'stale' || (directorBlock.reason === 'failed' && directorBlock.failure !== 'too_long')) ? directorBlock.directorNodeId : null
  const unmetDependency = React.useMemo<UnmetReferenceDependency | null>(() => unmetReferenceDependencyForNode(node, graph), [node, graph])
  // 自动备齐参考（对话 2026-06-14）：本节点经参考边、尚未出图的上游 id。
  // 有则「生成」不裸跑，转而排依赖波次（参考先生成→本节点后生成）走批量确认条。
  const pendingRefKey = React.useMemo(() => collectUngeneratedReferenceAncestors(node.id, graph).join(','), [node.id, graph])
  const hasPendingRefs = pendingRefKey.length > 0
  // 视频缺参考本会禁用「生成」；但若缺的是「连了线、只是还没生成」的上游 → 仍可点（去备齐），不禁用。
  const canGenerateNow = canGenerate || hasPendingRefs
  const productionBinding = productionMetaOf(node)
  const productionRun = useProductionRunStore((state) => state.run?.runId === productionBinding?.runId ? state.run : null)
  const productionClaim = productionRun && productionBinding
    ? decideShotClaim(productionRun, productionBinding.shotId ?? productionRun.generationPlan?.candidate?.candidateId, 'canvas')
    : null
  const productionClaimBlocked = productionClaim?.holder === 'production'
  const productionClaimCopy = shotClaimCopy(productionClaim?.reason)
  // 声音节点：解析当前档案模式（配音 speech / 转写 transcribe），驱动「台词框 vs 音频参考槽」分流。
  const isAudioKind = isAudioLikeGenerationNodeKind(node.kind)
  const audioMode = React.useMemo(() => {
    if (!isAudioKind) return null
    const meta = node.meta || {}
    const archetype = resolveArchetypeForModel({
      modelKey: typeof meta.modelKey === 'string' ? meta.modelKey : undefined,
      modelAlias: typeof meta.modelAlias === 'string' ? meta.modelAlias : undefined,
      vendorKey: typeof meta.modelVendor === 'string' ? meta.modelVendor : typeof meta.vendor === 'string' ? meta.vendor : null,
      meta,
    })
    // 声音档案的方式是人选的任务、不按输入改：只问节点自己就够。
    return archetype ? effectiveArchetypeMode(archetype, node, { nodes: [node], edges: [] }).mode : null
  }, [isAudioKind, node])
  const audioIsTranscribe = audioMode?.transportTaskKind === 'transcribe'
  const hasPromptPickerButton = Boolean(nodeExecutionKind) && acceptsPrompt && !audioIsTranscribe
  const hasReferenceControls =
    isImageLikeGenerationNodeKind(node.kind) ||
    isVideoLikeGenerationNodeKind(node.kind) ||
    isAudioKind ||
    // 3D 的图生3D模式带 first_frame 参考槽——漏了它参考区整个不渲染，图生3D没法放参考（同族 kind 边界漏 3D）。
    isModel3dLikeGenerationNodeKind(node.kind)
  // 持有 prompt 编辑器实例,供「点参考 tile → 在光标处插入 chip」(@ 内联引用主路径)。
  const [promptEditor, setPromptEditor] = React.useState<Editor | null>(null)
  // 空节点「试试」配方跑完要把光标放进这张卡的提示词（nodes/nodePromptFocus：配方先跑、生成框后挂，请求等它来取）。
  const focusPrompt = React.useMemo(() => (promptEditor ? () => {
    if (promptEditor.isDestroyed) return false
    promptEditor.commands.focus('end')
    return true
  } : null), [promptEditor])
  useNodePromptFocusRequest(node.id, focusPrompt)
  // 拖文件到卡 → 加为参考（捷径 A）。仅当当前模式有数组参考槽时接管拖拽。
  const { acceptsDrop, isDragOver, isUploading, dropHandlers } = useNodeAssetDrop(node, reportFeedback, writeAccess)
  // @ 候选 = 当前模式 image_ref 槽的有序填充（连线在前+上传，option 2 单源），与面板编号①②③、
  // 发送的 reference_image 数组同一口径——连线进来的参考图也在候选里、能被 @（此前只读 meta 漏掉边）。
  // 候选已扩到三组：当前参考 / 画布已出图节点 / 素材库。后两组选中会**先真的建立引用**再插 chip
  // （建边或落上传槽，都过能力校验闸），见 useNodeMentionSource。素材库那组打了 @ 才去取，挂载不扫。
  const { orderedReferenceUrls: mentionCandidates, orderedMediaReferences, mentionSearch, onMentionSelect } =
    useNodeMentionSource(node, reportFeedback, writeAccess, graph)
  // 提示词里的引用块写「小图 + 名字」（不写图1、图2）：名字是当前这批参考的投影，重名加「·2」。
  const computedReferenceNames = React.useMemo(() => {
    const infos = resolveReferenceInfos({
      nodeId: node.id,
      // 当前方式里的参考 + 提示词里写着的引用（换到首尾帧后，参考数组里的图不在当前槽里，句中的小块仍要有名字）。
      references: [
        ...orderedMediaReferences.map((reference) => ({ url: reference.url, kind: reference.kind })),
        ...mentionUrlsInOrder(node.prompt || '').filter((url) => !orderedMediaReferences.some((reference) => reference.url === url)).map((url) => ({ url, kind: 'image' as const })),
      ],
      nodes: graph.nodes, edges: graph.edges, library: peekAllProjectAssets(),
      fallbackName: (kind) => t(kind === 'video' ? 'assetLibrary.referenceVideo' : kind === 'audio' ? 'assetLibrary.referenceAudio' : 'assetLibrary.referenceImage'),
    })
    return Object.fromEntries([...infos.values()].map((info) => [info.url, info.chipName]))
  }, [graph, node.id, node.prompt, orderedMediaReferences, t])
  // 名字表内容没变就沿用同一个对象：换方式时参考集合换了新数组，名字表内容却一样——对象一换，提示词里每枚引用块都会白白重渲一遍
  // （30 张参考切方式时，这一项是提示词编辑器 ~16ms 的来源）。
  const referenceNamesKey = JSON.stringify(computedReferenceNames)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const referenceNames = React.useMemo(() => computedReferenceNames, [referenceNamesKey])
  // 连入的文字是一条连线接进来的：小签尾巴的 × = 断开这条线（和参考小图的 × 同一个动作）。
  const disconnectTextInput = React.useCallback((sourceId: string) => {
    const edge = graph.edges.find((candidate) => candidate.source === sourceId && candidate.target === node.id)
    if (edge) useGenerationCanvasStore.getState().disconnectEdge(edge.id)
  }, [graph, node.id])
  const insertMention = React.useCallback((url: string) => {
    if (!promptEditor || promptEditor.isDestroyed) return
    const reference = orderedMediaReferences.find((candidate) => candidate.url === url)
    promptEditor.commands.insertAssetMention(url, reference?.index, reference?.kind)
  }, [orderedMediaReferences, promptEditor])

  /**
   * 描述框 placeholder：**这张卡已经有参考图时**才在尾巴上挂一句「打 @ 可引用参考图」。
   *
   * 为什么挂条件而不是写死进每条 placeholder 文案：@ 只是键盘加速器（可发现的主路径是点参考 tile
   * 直接插 chip），没有参考图时打 @ 只会弹一个「没有可引用的图」的空面板——那句提示就成了误导。
   * 挂在 placeholder 上而不是新增一行常驻说明，是因为这个面已经拍板过「最少文字」（omni 样张 v4
   * 特意砍掉了三组标签/caption）：placeholder 一开始打字就消失，不占常驻预算。
   */
  const appendMentionHint = (base: string): string =>
    mentionCandidates.length > 0 ? `${base} · ${t('assetLibrary.mentionPlaceholderHint')}` : base

  const applyPromptPickerItem = React.useCallback(
    (item: LibraryPrompt): void => {
      if (node.locked || readOnlyRef.current) return
      const before = node.prompt || ''
      const next = [before, item.prompt].filter(Boolean).join('\n')
      if (promptEditor && !promptEditor.isDestroyed) {
        promptEditor.commands.setContent(promptToContent(next, mentionCandidates))
        promptEditor.commands.focus('end')
      }
      updateNode(node.id, { prompt: next })
      showUndoToast({ message: t('libraries.gallery.appended'), onUndo: () => {
        updateNode(node.id, { prompt: before })
        if (promptEditor && !promptEditor.isDestroyed) promptEditor.commands.setContent(promptToContent(before, mentionCandidates))
      } })
      const referenceUrls = (item.referenceImages ?? []).map((reference) => reference.url).filter(Boolean)
      if (referenceUrls.length) {
        if (applyPromptReferenceImages(node.id, referenceUrls, writeAccess) === 'unsupported') {
          reportFeedback(t('generationCommon.composer.promptReferenceUnsupported'))
        }
      }
      void persistActiveWorkbenchProjectNow().catch(() => {})
    },
    [mentionCandidates, node.id, node.locked, node.prompt, promptEditor, reportFeedback, t, updateNode, writeAccess],
  )

  const handleGenerate = async (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    try { await startGenerationFromComposer(node, hasResult) }
    catch (error) { reportFeedback(error instanceof Error ? error.message : t('generationCommon.batchPlan.authorizationFailed')) }
  }

  // 吃提示词的节点才有「最小可用高度」——不吃的（如某些 ComfyUI 工作流）本来就该按内容自然矮。
  const minUsableHeight = acceptsPrompt ? COMPOSER_MIN_USABLE_HEIGHT : 0
  // 位置只由两样东西决定：节点的画布尺寸、画布缩放（owner：composerCanvasPlacement）。**不量任何矩形、
  // 不躲任何东西、不翻到上方**——出了屏幕就被挡住（2026-09-25 用户拍板「遮挡就遮挡了，保持位置」）。
  // 这正是 React Flow 官方节点浮层 `NodeToolbar` 的定位法（只有锚点 + 反缩放，无视口避让）；没直接用它，
  // 是因为它挂在 portal 里、隐藏即卸载，会丢掉拖动期间靠 visibility 保住的 TipTap 实例（见下面 invisible 那条注释）。
  // 画布缩放由画布宿主的定位锚（CanvasComposerAnchor）自己读 React Flow 的 transform——见文件尾。
  const anchorRef = React.useRef<HTMLDivElement>(null)
  const maxHeight = composerMaxHeight(node.kind)
  const promptExpand = useComposerPromptExpand()

  const effects = useNodeEffectChips({ enabled: hasPromptPickerButton, empty: !node.prompt?.trim(), kind: nodeExecutionKind ?? node.kind, disabled: node.locked, onSelect: applyPromptPickerItem })

  // B 簇（帮我写提示词）：效果 → 翻译 → 优化（翻译与优化同一出现条件，2026-09-21 拍板）。运镜控件已从视频/图片节点移除：用户直接在 prompt
  // 里写运镜，避免节点控件和提示词重复表达。
  // 一件都没有（锁住的节点、不吃提示词的工作流）就整段不渲染——空的分组连同两根分隔线
  // 留在那里只会在底栏里留一段没人看得懂的空白。
  const showPromptPicker = hasPromptPickerButton
  const showOptimizer = acceptsPrompt && (nodeExecutionKind === 'image' || nodeExecutionKind === 'video') && !node.locked
  const hasPromptTools = showPromptPicker || showOptimizer

  // 卡宽恒定（NODE_COMPOSER_WIDTH）；推荐项让位，输入内滚、底栏固定。

  return (
    // 外层只做屏幕空间定位锚，反向缩放保持参数卡可读。
    <NodeWriteAccessProvider value={writeAccess}><ComposerAnchor
      inFlow={inFlow}
      anchorRef={anchorRef}
      visualSize={visualSize}
      className={cn(
        'generation-canvas-v2-node__composer nokey',
        // 列表详情里这只是一段普通内容流；画布上才是浮在节点下沿的绝对定位层。
        inFlow ? 'w-full' : 'absolute',
        // 画布拖动期间隐身（拖节点、拖选区/组框、拖画布平移都算；状态源=stage 的 data-dragging，见 canvasDraggingFlag）。
        // 刻意用 visibility 而非条件卸载：里面是 TipTap 编辑器实例，卸载 = 丢未提交的输入 +
        // 每次拖动重建编辑器（拖动是最高频动作）。
        !inFlow && 'group-data-[dragging=true]/canvas:invisible',
      )}
      data-composer-host={host}
      style={{ cursor: 'default', userSelect: 'auto', touchAction: 'auto', ...(inFlow ? null : { zIndex: CANVAS_LAYER.nodeComposer }) }}
      {...(acceptsDrop ? dropHandlers : {})}
    >
      {feedback ? <p role="status" className="m-0 px-2 py-1 text-caption text-nomi-ink-60">{feedback}</p> : null}
      <div
        className={cn(
          'generation-canvas-v2-node__composer-card',
          NODE_SCROLL_REGION_CLASS_NAME,
          'relative flex flex-col gap-1.5 min-w-0',
          'p-3 border border-nomi-line rounded-nomi bg-nomi-paper overflow-hidden shadow-nomi-md',
          // 内容流里（列表详情）：卡宽恒定、在所在列里水平居中，和上面的预览同一条竖直中线（画布上由定位锚负责，不走这里）。
          inFlow && 'mx-auto',
          'transition-[outline-color] duration-150',
          isDragOver && 'outline-2 outline-dashed outline-nomi-ink-40 outline-offset-[-2px]',
        )}
        style={{
          width: NODE_COMPOSER_WIDTH,
          ...(inFlow ? { maxWidth: '100%' } : {}),
          ...(promptExpand.expanded ? {} : { maxHeight }),
          minHeight: Math.min(minUsableHeight, maxHeight),
          cursor: 'default',
          userSelect: 'auto',
          touchAction: 'auto',
        }}
      >
      {readOnly ? <div role="status" className="text-caption text-nomi-ink-60">{t('generationCommon.workflowPlugin.readOnly')}</div> : null}
      {/* 声音 / 3D 的「生成方式」仍在参考区滚动口之外、紧贴在它上面：属于卡片的固定内容，
          压到最小高度也整行可见可点（2026-09-21，见 NodeParameterControls 的 section="mode"）。
          视频的生成方式在底栏「方式」一格（modeMenuModel），图片没有这一组（放了图就是按图改）。 */}
      {hasReferenceControls && !readOnly && (isAudioKind || isModel3dLikeGenerationNodeKind(node.kind)) ? (
        <div data-node-composer-mode-bar className={cn('shrink-0')}>
          <NodeParameterControls node={node} section="mode" graph={graph} modelOptionsState={modelOptionsState} readMappings={readMappings} />
        </div>
      ) : null}
      {hasReferenceControls && !readOnly ? (
        // 参考区的滚动口在参考行里面（只包图那一行），行尾那句话在滚动口外面、图再多也钉在可视区里（边界样张 K1）。
        <div data-node-composer-references className="min-h-0 shrink-0">
          <NodeParameterControls node={node} section="references" onInsertMention={insertMention} graph={graph} modelOptionsState={modelOptionsState} readMappings={readMappings} />
        </div>
      ) : null}
      {/* 长 prompt 在编辑器内部滚动/换行；卡宽确定，提示词不撑爆卡片。 */}
      {/* 输入区始终保留三行，推荐项在剩余高度内展示。 */}
      {/* 转写模式无台词输入（音频参考即输入）。 */}
      {audioIsTranscribe || !acceptsPrompt ? null : (
        // 外层不滚、只负责占位和挂「展开」钮；里层是滚动口。钮挂在滚动口外面，滚到底也还在右上角。
        // 展开（2026-09-25 用户拍板，参考 LibTV）：卡片高度上限让开、滚动口长到全文（再长到 360 才内滚）。
        <div className={cn('relative flex min-h-[72px] flex-col', promptExpand.expanded ? 'flex-none' : 'flex-1')}>
        <div
          ref={promptExpand.scrollRef}
          data-node-composer-prompt
          data-prompt-expanded={promptExpand.expanded ? 'true' : 'false'}
          className={cn(
            NODE_SCROLL_REGION_CLASS_NAME,
            'relative w-full min-h-[72px] overflow-y-auto overscroll-contain',
            promptExpand.expanded ? 'max-h-[360px]' : 'flex-1',
            promptExpand.canToggle && 'pr-7',
          )}
          style={{ cursor: node.locked ? 'default' : 'text', userSelect: node.locked ? 'auto' : 'text' }}
        >
          <ReferenceNamesContext.Provider value={referenceNames}>
          <PromptEditor
            className={cn('min-h-[72px]')}
            value={node.prompt || ''}
            placeholder={appendMentionHint(getGenerationNodePromptPlaceholder(node.kind))}
            editable={!node.locked && !readOnly}
            onChange={(next) => { if (!readOnly) updateNode(node.id, { prompt: next }) }}
            onBlur={() => { if (!readOnlyRef.current) void persistActiveWorkbenchProjectNow().catch(() => {}) }}
            onReady={setPromptEditor}
            mentionCandidates={mentionCandidates}
            mentionReferences={orderedMediaReferences}
            mentionSearch={mentionSearch}
            onMentionSelect={(...args) => readOnlyRef.current ? null : onMentionSelect(...args)}
          />
          </ReferenceNamesContext.Provider>
        </div>
        {promptExpand.canToggle ? (
          <WorkbenchIconButton
            size="sm"
            data-prompt-expand-toggle
            className="absolute right-0 top-0"
            label={promptExpand.expanded ? t('generationCommon.composer.collapsePrompt') : t('generationCommon.composer.expandPrompt')}
            aria-expanded={promptExpand.expanded}
            onClick={promptExpand.toggle}
            icon={promptExpand.expanded ? <IconArrowsDiagonalMinimize2 /> : <IconArrowsDiagonal />}
          />
        ) : null}
        </div>
      )}
      {/* 连进来的文字：拼进提示词的那几段，摆出来（和生成时拼提示词读同一个投影）。 */}
      <ConnectedTextChips node={node} graph={graph} onDisconnect={readOnly ? undefined : disconnectTextInput} />
      {showPromptPicker && effects.recommendations}
      {/* 底栏（B3，2026-10-18/19 用户拍板）：铺满卡宽（w-full），左边「出什么」、右边「怎么写 → 出几张 → 走」，不换行：
          `[模型 ▾] [变体 ▾] [16:9 · 5s ▾] ……… [预设][翻译][N] │ [1 个 ▾] [↑]`
          左边模型一颗、变体一颗、参数摘要一颗（现有组件原样）；右边三个提示词钮 + 分隔线 + 数量（模型声明了才有）+ ↑ 圆钮。
          三类归位见 docs/design/2026-09-10-node-composer-bar-v1.md：
            A 决定出什么/花多少 → 第一段与第三段；B 帮我写提示词 → 中段缩小一号的纯 icon；
            锁 → 回节点浮条（它的作用对象是**这个节点**，不是这一次生成）。
          参数区是**摘要 pill**（同日 02:10 的逐参数 chip 于 04:30 被用户收回）。
          `flex-nowrap`：排不下不靠换行解决，靠别往这一排里塞第四件。
          `data-node-composer-footer` / `data-bar-segment` 是走查锚点，好断言「单行 + 段序没漂」。 */}
      {!readOnly && <div data-node-composer-footer className={cn('flex items-center gap-2 mt-auto pt-1 shrink-0 w-full flex-nowrap')}>
        {/* 第一段：模型芯片 + 变体 + 参数区（摘要 pill，见 composerHeadlineSummary）。 */}
        <div data-bar-segment="model-params" className={cn('flex min-w-0 flex-1 items-center')}>
          <NodeParameterControls
            node={node}
            section="parameters"
            graph={graph}
            modelOptionsState={modelOptionsState}
            readMappings={readMappings}
          />
        </div>
        {/* 右半边（三个提示词钮、数量、↑）靠卡片右侧：第一段 flex-1 吃掉剩余宽度，不再另放一个占 8px 间距的空垫片
            ——英文「Standard」那一档正是被这 8px 挤得模型名和摘要各被截掉几像素（验收 V-b1a 建议 1）。 */}
        {/* B 簇（三个提示词钮）。它和数量之间的分隔线由数量自己带（只有数量存在才有）。 */}
        {hasPromptTools ? (
          <NodePromptToolCluster ariaLabel={t('generationCommon.composerBarV1.promptTools')}>
            {showPromptPicker ? effects.more : null}
            {showOptimizer ? <NodePromptTranslator editor={promptEditor} prompt={node.prompt || ''} mentionReferences={orderedMediaReferences} onFeedback={reportFeedback} /> : null}
            {showOptimizer ? <NodePromptOptimizer node={node} isVideo={nodeExecutionKind === 'video'} /> : null}
          </NodePromptToolCluster>
        ) : null}
        {/* 数量：模型声明了数量才有（section="quantity" 自己判断，没有就不渲染），紧挨 ↑ 左边。 */}
        <NodeParameterControls node={node} section="quantity" graph={graph} modelOptionsState={modelOptionsState} readMappings={readMappings} />
        {(() => {
          const disabledReason = directorPreviewBlock
            ? t(directorPreviewBlock)
            : unmetDependency
            ? t('generationCommon.composer.referenceCompanionRequired', {
                slot: unmetDependency.slotLabel,
                companions: unmetDependency.companionLabels.join(t('generationCommon.composer.companionOr')),
              })
            : productionClaimBlocked
            ? t(productionClaimCopy
              ? `generationCommon.observability.error.shotClaimed.${productionClaimCopy.key}.reason`
              : 'generationCommon.observability.error.shotClaimed.generic.reason')
            : !canGenerateNow && !isGenerating
            ? nodeExecutionKind === 'video'
              ? acceptsDrop
                ? t('generationCommon.composer.videoReferenceRequired')
                : t('generationCommon.composer.videoFirstFrameRequired')
              : nodeExecutionKind === 'image'
                ? acceptsDrop
                  ? t('generationCommon.composer.imageReferenceRequired')
                  : t('generationCommon.composer.imageConnectionRequired')
                : nodeExecutionKind === 'model3d'
                  // 图生3D缺参考时的诚实原因——此前落到 unsupportedKind「暂不支持」，明明支持只是缺图（同族 kind 边界漏 3D）。
                  ? t('generationCommon.composer.model3dReferenceRequired')
                  : t('generationCommon.composer.unsupportedKind', { kind: node.kind })
            : undefined
          const title = disabledReason
            ?? (isGenerating
              ? t('generationCommon.composer.generating')
              : hasPendingRefs
                ? t('generationCommon.composer.generateReferencesFirst')
                : hasResult
                  ? t('generationCommon.composer.regenerate')
                  : t('generationCommon.composerB3.generateTip'))
          return (
            <>
            {rerenderDirectorNodeId ? (
              <WorkbenchIconButton
                size="sm"
                icon={<IconRefresh />}
                label={t('director.agent.previewRerender')}
                data-testid="node-composer-preview-rerender"
                onClick={() => requestDirectorPreviewRender(rerenderDirectorNodeId)}
              />
            ) : null}
            <span title={title} style={{ display: 'contents' }}>
              {/* 原生 button：避开 WorkbenchButton(Mantine)对 radius/bg 的覆盖,确保样张 v4 的深色圆形主行动钮。
                  右半边由上面那根 flex-1 撑开：生成钮永远在底栏最右 = 卡片右下角（卡宽恒定 → 屏幕位置锁死）。 */}
              <button
                type="button"
                data-bar-segment="generate"
                className={GENERATE_BUTTON_CLASS}
                aria-label={hasResult ? t('generationCommon.composer.regenerate') : t('generationCommon.composer.generateAsset')}
                disabled={!canGenerateNow || productionClaimBlocked || directorPreviewBlock !== null}
                onClick={handleGenerate}
              >
                {isGenerating ? '···' : <IconArrowUp size={ICON_TIERS.tool.size} stroke={ICON_TIERS.tool.stroke} aria-hidden />}
              </button>
            </span>
            </>
          )
        })()}
      </div>}
      </div>
      {isDragOver ? (
        <div
          className={cn(
            'generation-canvas-v2-node__composer-dropzone',
            'absolute inset-0 z-[10] flex items-center justify-center rounded-nomi',
            'bg-nomi-paper/[0.7] pointer-events-none',
          )}
          aria-hidden="true"
        >
          {/* pending 规范 #1:上传中统一品牌转圈,不再纯文字 */}
          <span className={cn('inline-flex items-center gap-1.5 text-caption text-nomi-ink-60')}>
            {isUploading ? <NomiLoadingMark size={14} label={t('generationCommon.composer.uploading')} /> : null}
            {isUploading ? t('generationCommon.composer.uploadingEllipsis') : t('generationCommon.composer.dropToAddReference')}
          </span>
        </div>
      ) : null}
    </ComposerAnchor></NodeWriteAccessProvider>
  )
}
