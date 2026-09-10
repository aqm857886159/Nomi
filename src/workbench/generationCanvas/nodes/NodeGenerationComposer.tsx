import { notify } from '../../../ui/notificationPolicy'
import React from 'react'
import { useTranslation } from 'react-i18next'
import type { Editor } from '@tiptap/react'
import { NomiLoadingMark, NomiSelect } from '../../../design'
import type { TranslationKey } from '../../../i18n/translationKey'
import { cn } from '../../../utils/cn'
import type { LibraryPrompt } from '../../api/promptLibraryApi'
import { useNodeEffectChips } from './NodeEffectChips'
import { showUndoToast } from '../../../utils/showUndoToast'
import PromptEditor from '../../assets/PromptEditor'
import { promptToContent } from '../../assets/promptEditorContent'
import { useAllProjectAssets } from '../../assets/useAllProjectAssets'
import { useNodeMentionSource } from './useNodeMentionSource'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { canRunGenerationNode, confirmAndRunNode, confirmAndRunNodeVariants, regenerateNodeInPlace, unmetReferenceDependencyForNode } from '../runner/generationRunController'
import type { UnmetReferenceDependency } from './controls/referenceDependency'
import { collectUngeneratedReferenceAncestors } from '../runner/referenceAncestors'
import { buildDependencyWaves } from '../runner/dependencyWaves'
import { useBatchPlanPreviewStore } from '../components/batchPlanPreview'
import NodeParameterControls from './NodeParameterControls'
import { GENERATE_BUTTON_CLASS } from './nodeComposerStyles'
import { NodeLockBadge } from './NodeLockBadge'
import NodeCameraMoveControl from './NodeCameraMoveControl'
import { NodePromptOptimizer } from './NodePromptOptimizer'
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
import { resolveArchetypeForModel } from '../../../config/modelArchetypes'
import { applyArchetypeModeSwitch, currentArchetypeMode } from './controls/archetypeMeta'
import { archetypeForNode, resolveModeForReferenceDemand } from '../agent/referenceEdgeCapability'
import { addAssetUrlToNode } from './nodeAssetWrite'
import { getTextGenMode, type TextGenMode } from '../runner/textActions'
import {
  GENERATION_VARIANT_COUNTS,
  parseGenerationVariantCount,
  type GenerationVariantCount,
} from './generationVariantCount'
import { useComposerViewportPlacement } from './useComposerViewportPlacement'
import { COMPOSER_MIN_USABLE_HEIGHT } from './nodeSizing'
import {
  findModelOptionByIdentifier,
  requiredModeForGenerationNode,
  useGenerationModelOptionsState,
} from '../adapters/modelOptionsAdapter'
import { nodeSelectedModelAddress } from './controls/parameterControlModel'
import { comfyWorkflowTakesPrompt } from '../runner/promptRequirement'

// C5 P2：文本节点的三种生成模式（label 在渲染处翻译）。
// 存**整键**而非相对片段：编译器替我们校验键存在（satisfies TranslationKey），
// 且不给死键门岗留下 `generationCommon.` 这种覆盖整命名空间的模板 head（见 i18n/translationKey.ts）。
const TEXT_GEN_MODES = [
  { value: 'append', labelKey: 'generationCommon.composer.append' },
  { value: 'rewrite', labelKey: 'generationCommon.composer.rewrite' },
  { value: 'replace', labelKey: 'generationCommon.composer.replace' },
] as const satisfies readonly { value: TextGenMode; labelKey: TranslationKey }[]
const TEXT_MODE_PLACEHOLDER_KEY = {
  append: 'generationCommon.composer.appendPlaceholder',
  rewrite: 'generationCommon.composer.rewritePlaceholder',
  replace: 'generationCommon.composer.replacePlaceholder',
} as const satisfies Record<TextGenMode, TranslationKey>

// 生成节点的浮动 composer：references + 提示词 + 参数 + 生成/重新生成按钮。
// 从 BaseGenerationNode 抽出（A1.5 接缝）：只有「生成类」节点挂它，素材节点不挂。
// 所有生成相关依赖（runner / NodeParameterControls / 布局计算）都收在这里，壳保持 kind 无关。

type Props = {
  onFeedback: (message: string) => void
  node: GenerationCanvasNode
  visualSize: { width: number; height: number }
}

type FloatingComposerLayout = {
  maxHeight: number
  gap: number
}

function floatingComposerLayout(_width: number, _height: number, kind: GenerationCanvasNode['kind']): FloatingComposerLayout {
  // 宽度不再在这里算——它**内容驱动**（CSS `w-fit` + `min-w/max-w` 边界，见卡 className），
  // 跟着该模型实际的参数横排自然撑开，参数少则窄、多则宽、触上限在卡内换行（绝不绑节点比例、不钉死常数）。
  //
  // 高度同理**内容驱动**，不再绑节点高（旧 `height*0.72` 是 bug 根因：小节点 → 矮卡，
  // 「参考区 + 3 行提示词 + 底栏」放不下，overflow-hidden 把底栏的生成钮裁到卡外，修③④）。
  // 卡片在 flex-col 里自然按内容长高；提示词 flex-1 overflow-auto，推荐项只占剩余空间，
  // 底栏不收缩；提示词保留三行，推荐项不挤占输入和主行动。
  const maxHeight = kind === 'video' ? 460 : 400
  // 连接间距是空间关系，不应随节点画幅宽度跨阈值跳变；否则 1:1 → 21:9 时即使底边
  // 锚点完全不动，composer 仍会被旧的 10px → 14px 分支推开，看起来像断开。
  const gap = 14
  return { maxHeight, gap }
}

export default function NodeGenerationComposer({ onFeedback, node, visualSize }: Props): JSX.Element {
  const feedbackOwnerRef = React.useRef<string | null>(node.id)
  feedbackOwnerRef.current = node.id
  React.useEffect(() => { feedbackOwnerRef.current = node.id; return () => { feedbackOwnerRef.current = null } }, [node.id])
  const [feedback, setFeedback] = React.useState<string | null>(null)
  const reportFeedback = React.useCallback((message: string) => {
    if (feedbackOwnerRef.current !== node.id) { onFeedback(message); return }
    notify({ identity: `NodeGenerationComposer:${node.id}`, reason: 'interaction', message, level: 'inline', present: setFeedback })
  }, [node.id, onFeedback])
  const { t } = useTranslation()
  const updateNode = useGenerationCanvasStore((state) => state.updateNode)
  const status = node.status || 'idle'
  const isGenerating = status === 'queued' || status === 'running'
  const hasResult = Boolean(node.result?.url)
  const nodeExecutionKind = getGenerationNodeExecutionKind(node.kind)
  const nodes = useGenerationCanvasStore((state) => state.nodes)
  const edges = useGenerationCanvasStore((state) => state.edges)
  const requiredMode = requiredModeForGenerationNode(node, { nodes, edges })
  const modelOptions = useGenerationModelOptionsState(node.kind, requiredMode).options
  const selectedModelAddress = nodeSelectedModelAddress(node.meta || {})
  const selectedModelOption = findModelOptionByIdentifier(
    modelOptions,
    selectedModelAddress.modelKey,
    selectedModelAddress.vendorKey,
  )
  // 导入工作流是否接收提示词由保存下来的 binding 决定。明确不接收时，整组移除无效输入和动作；
  // null 表示非 ComfyUI 或目录尚未就绪，维持普通模型原有体验。
  const acceptsPrompt = comfyWorkflowTakesPrompt(selectedModelOption?.meta) !== false
  // v0.7.2 perf: 用 boolean primitive 订阅 canGenerate
  const canGenerate = useGenerationCanvasStore((state) =>
    canRunGenerationNode(node, { nodes: state.nodes, edges: state.edges }),
  ) && !isGenerating
  // 跨槽依赖未满足（档案 slot.requiresAnyOf；如 Seedance 2.0 只放了参考音频、缺图/视频）。
  // 与 canGenerate 同一个判定（unmetReferenceDependencyForNode），composer 不再按 node.kind 重猜原因。
  // 订阅**字符串**而非对象：对象选择器每帧新引用会破坏 v0.7.2 的 primitive 订阅防抖；
  // 文案仍留到渲染时用 t() 格式化，保证切语言能实时重渲。
  const unmetDependencyKey = useGenerationCanvasStore((state) =>
    JSON.stringify(unmetReferenceDependencyForNode(node, { nodes: state.nodes, edges: state.edges })),
  )
  const unmetDependency = React.useMemo(
    () => JSON.parse(unmetDependencyKey) as UnmetReferenceDependency | null,
    [unmetDependencyKey],
  )
  // 自动备齐参考（对话 2026-06-14）：本节点经参考边、尚未出图的上游 id（稳定 key 订阅防抖）。
  // 有则「生成」不裸跑，转而排依赖波次（参考先生成→本节点后生成）走批量确认条。
  const pendingRefKey = useGenerationCanvasStore((state) =>
    collectUngeneratedReferenceAncestors(node.id, { nodes: state.nodes, edges: state.edges }).join(','),
  )
  const hasPendingRefs = pendingRefKey.length > 0
  // 视频缺参考本会禁用「生成」；但若缺的是「连了线、只是还没生成」的上游 → 仍可点（去备齐），不禁用。
  const canGenerateNow = canGenerate || (hasPendingRefs && !isGenerating)
  const composerLayout = floatingComposerLayout(visualSize.width, visualSize.height, node.kind)
  const isTextKind = node.kind === 'text'
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
    return archetype ? currentArchetypeMode(archetype, meta) : null
  }, [isAudioKind, node.meta])
  const audioIsTranscribe = audioMode?.transportTaskKind === 'transcribe'
  const textGenMode = getTextGenMode(node)
  const hasPromptPickerButton = Boolean(nodeExecutionKind) && acceptsPrompt && !audioIsTranscribe && !isTextKind
  const hasReferenceControls =
    isImageLikeGenerationNodeKind(node.kind) ||
    isVideoLikeGenerationNodeKind(node.kind) ||
    isAudioKind ||
    // 3D 的图生3D模式带 first_frame 参考槽——漏了它参考区整个不渲染，图生3D没法放参考（同族 kind 边界漏 3D）。
    isModel3dLikeGenerationNodeKind(node.kind)
  // 持有 prompt 编辑器实例,供「点参考 tile → 在光标处插入 chip」(@ 内联引用主路径)。
  const [promptEditor, setPromptEditor] = React.useState<Editor | null>(null)
  // 变体张数是会话态、不落盘；显式列出 1–4，避免循环按钮让用户猜下一档。
  const [variantCount, setVariantCount] = React.useState<GenerationVariantCount>(1)
  // 拖文件到卡 → 加为参考（捷径 A）。仅当当前模式有数组参考槽时接管拖拽。
  const { acceptsDrop, isDragOver, isUploading, dropHandlers } = useNodeAssetDrop(node, reportFeedback)
  // @ 候选 = 当前模式 image_ref 槽的有序填充（连线在前+上传，option 2 单源），与面板编号①②③、
  // 发送的 reference_image 数组同一口径——连线进来的参考图也在候选里、能被 @（此前只读 meta 漏掉边）。
  // 候选已扩到三组：当前参考 / 画布已出图节点 / 素材库。后两组选中会**先真的建立引用**再插 chip
  // （建边或落上传槽，都过能力校验闸），见 useNodeMentionSource。
  const { assets: projectAssets } = useAllProjectAssets()
  const mentionLibraryAssets = React.useMemo(
    () => projectAssets.flatMap((asset) => {
      if ((asset.kind !== 'image' && asset.kind !== 'video' && asset.kind !== 'audio') || !asset.renderUrl) return []
      return [{ id: asset.id, name: asset.name, url: asset.renderUrl, kind: asset.kind }]
    }),
    [projectAssets],
  )
  const { orderedReferenceUrls: mentionCandidates, orderedMediaReferences, mentionSearch, onMentionSelect } =
    useNodeMentionSource(node, mentionLibraryAssets, reportFeedback)
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
      if (node.locked) return
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
      // 库 prompt 自带的参考图一并落地（此前只写 prompt，item.referenceImages 被静默丢弃——
      // 2026-07-28 群反馈「参考被丢」家族）。当前生成方式收不下 image_ref 先促到能收的模式
      // （与建边 auto-promote 同一把尺子），再走 addAssetUrlToNode 单源写入（去重/上限同一处）；
      // 模型任何模式都不吃图参考 → 诚实提示只应用了文本，不写死数据。
      const referenceUrls = (item.referenceImages ?? []).map((reference) => reference.url).filter(Boolean)
      if (referenceUrls.length) {
        const state = useGenerationCanvasStore.getState()
        const target = state.nodes.find((candidate) => candidate.id === node.id)
        const archetype = target ? archetypeForNode(target) : null
        if (target && archetype) {
          const promotedModeId = resolveModeForReferenceDemand(
            archetype,
            (target.meta || {}) as Record<string, unknown>,
            [{ slots: ['image_ref'], asset: 'image' }],
          )
          if (promotedModeId) {
            state.updateNode(node.id, {
              meta: applyArchetypeModeSwitch((target.meta || {}) as Record<string, unknown>, archetype, promotedModeId),
            })
          }
        }
        const outcomes = referenceUrls.map((url) => addAssetUrlToNode(node.id, 'image', url))
        if (outcomes.every((outcome) => outcome.status === 'no-slot')) {
          reportFeedback(t('generationCommon.composer.promptReferenceUnsupported'))
        }
      }
      void persistActiveWorkbenchProjectNow().catch(() => {})
    },
    [mentionCandidates, node.id, node.locked, node.prompt, promptEditor, reportFeedback, t, updateNode],
  )

  const handleGenerate = async (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    const state = useGenerationCanvasStore.getState()
    // 自动备齐参考：本节点有「连了线但还没出图」的上游 → 不裸跑，排依赖波次（参考先、本镜后）
    // 走批量确认条（确认前零调用零扣费；用户一眼看到先生成谁、再生成谁）。根治单节点生成绕过
    // 依赖、参考没回灌进镜头的整类问题（对话 2026-06-14）。
    const pendingRefs = collectUngeneratedReferenceAncestors(node.id, { nodes: state.nodes, edges: state.edges })
    if (pendingRefs.length > 0) {
      const plan = buildDependencyWaves([...pendingRefs, node.id], { nodes: state.nodes, edges: state.edges })
      useBatchPlanPreviewStore.getState().open(plan)
      return
    }
    if (!canRunGenerationNode(node, { nodes: state.nodes, edges: state.edges })) return
    // ×N 变体连发（样张拍板 2026-07-29）：一次确认按 N 张报成本，串行连跑，出图堆进本节点历史。
    if (variantCount > 1) {
      await confirmAndRunNodeVariants(node.id, variantCount)
      return
    }
    // 已有结果的「重新生成」原地回填：新图进当前节点堆叠并设为主图，不再复制新节点。
    if (hasResult) await regenerateNodeInPlace(node.id)
    else await confirmAndRunNode(node.id)
  }

  // 吃提示词的节点才有「最小可用高度」——不吃的（如某些 ComfyUI 工作流）本来就该按内容自然矮。
  const minUsableHeight = acceptsPrompt ? COMPOSER_MIN_USABLE_HEIGHT : 0
  const { anchorRef, canvasZoom, flipUp, left, top, maxWidth, maxHeight, referenceMaxHeight } = useComposerViewportPlacement({
    node,
    visualSize,
    gap: composerLayout.gap,
    preferredMaxHeight: composerLayout.maxHeight,
    minUsableHeight,
  })

  const effects = useNodeEffectChips({ enabled: hasPromptPickerButton, empty: !node.prompt?.trim(), kind: nodeExecutionKind ?? node.kind, disabled: node.locked, onSelect: applyPromptPickerItem })

  // 卡宽由模型底栏驱动；推荐项让位，输入内滚、底栏固定。

  return (
    // 外层只做屏幕空间定位锚，反向缩放保持参数卡可读。
    <div
      ref={anchorRef}
      className={cn(
        'generation-canvas-v2-node__composer',
        'absolute z-[8] w-max',
        // 画布拖动期间隐身（拖节点、拖选区/组框、拖画布平移都算；状态源=stage 的 data-dragging，见 canvasDraggingFlag）。
        // 刻意用 visibility 而非条件卸载：里面是 TipTap 编辑器实例，卸载 = 丢未提交的输入 +
        // 每次拖动重建编辑器（拖动是最高频动作）。
        'group-data-[dragging=true]/canvas:invisible',
      )}
      data-flipped={flipUp ? 'true' : 'false'}
      style={{
        left,
        top,
        transform: `scale(${1 / (canvasZoom || 1)})`,
        transformOrigin: 'top left',
        maxWidth,
        visibility: maxHeight > 0 && maxWidth > 0 ? undefined : 'hidden',
        cursor: 'default',
        userSelect: 'auto',
        touchAction: 'auto',
      }}
      onPointerDown={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
      {...(acceptsDrop ? dropHandlers : {})}
    >
      {feedback ? <p role="status" className="m-0 px-2 py-1 text-caption text-nomi-ink-60">{feedback}</p> : null}
      <div
        className={cn(
          'generation-canvas-v2-node__composer-card',
          'relative flex flex-col gap-1.5 p-3 min-w-0 max-w-[880px] w-max',
          // 卡片不滚动，只有提示词拥有滚动；附属推荐行承担收缩。
          'border border-nomi-line rounded-nomi bg-nomi-paper overflow-hidden shadow-nomi-md',
          'transition-[outline-color] duration-150',
          isDragOver && 'outline-2 outline-dashed outline-nomi-accent outline-offset-[-2px]',
        )}
        style={{
          maxHeight,
          maxWidth,
          minWidth: Math.min(360, maxWidth),
          minHeight: Math.min(minUsableHeight, maxHeight),
          cursor: 'default',
          userSelect: 'auto',
          touchAction: 'auto',
        }}
      >
      {hasReferenceControls ? (
        <div data-node-composer-references className="min-h-0 shrink-0 overflow-y-auto overscroll-contain border-b border-nomi-line-soft" style={{ maxHeight: referenceMaxHeight }}>
          <NodeParameterControls node={node} section="references" onInsertMention={insertMention} />
        </div>
      ) : null}
      {isTextKind ? (
        <div
          className={cn('flex items-center gap-1')}
          role="group"
          aria-label={t('generationCommon.composer.generationMode')}
          onPointerDown={(event) => event.stopPropagation()}
        >
          {TEXT_GEN_MODES.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={textGenMode === option.value}
              data-active={textGenMode === option.value ? 'true' : 'false'}
              title={t(option.labelKey)}
              onClick={(event) => {
                event.stopPropagation()
                updateNode(node.id, { meta: { ...(node.meta || {}), textGenMode: option.value } })
              }}
              className={cn(
                'min-h-7 rounded-nomi-sm px-2.5 py-1 text-caption font-medium leading-none',
                'text-nomi-ink-60 hover:bg-nomi-ink-05',
                'data-[active=true]:bg-nomi-paper data-[active=true]:text-nomi-ink data-[active=true]:shadow-nomi-sm',
              )}
            >
              {t(option.labelKey)}
            </button>
          ))}
        </div>
      ) : null}
      {/* 长 prompt 在编辑器内部滚动/换行；卡宽确定，提示词不撑爆卡片。 */}
      {/* 输入区始终保留三行，推荐项在剩余高度内展示。 */}
      {/* 转写模式无台词输入（音频参考即输入）。 */}
      {audioIsTranscribe || isTextKind || !acceptsPrompt ? null : (
        // w-0 min-w-full keeps long prompts from widening the card. The bounded
        // scrollport retains its minimum even when fixed controls exhaust the card.
        <div
          data-node-composer-prompt
          className={cn('relative flex-1 min-h-[72px] w-0 min-w-full overflow-y-auto overscroll-contain')}
          style={{ cursor: node.locked ? 'default' : 'text', userSelect: node.locked ? 'auto' : 'text' }}
        >
          <PromptEditor
            className={cn('min-h-[72px]')}
            value={node.prompt || ''}
            placeholder={appendMentionHint(isTextKind ? t(TEXT_MODE_PLACEHOLDER_KEY[textGenMode]) : getGenerationNodePromptPlaceholder(node.kind))}
            editable={!node.locked}
            onChange={(next) => updateNode(node.id, { prompt: next })}
            onBlur={() => { void persistActiveWorkbenchProjectNow().catch(() => {}) }}
            onReady={setPromptEditor}
            mentionCandidates={mentionCandidates}
            mentionReferences={orderedMediaReferences}
            mentionSearch={mentionSearch}
            onMentionSelect={onMentionSelect}
          />
        </div>
      )}
      {hasPromptPickerButton && effects.recommendations}
      {/* 底栏铺满卡宽（w-full）：生成钮 ml-auto 永远贴右。底栏恒单行——参数已主次分层（最常调的内联、
          其余收进 InlineParameterBar 的「更多」弹层，方案 B），不会再横排超长/截断/换行（D2 根治）。 */}
      <div className={cn('flex items-center gap-2 mt-auto pt-1 shrink-0 w-full')}>
        {/* 锁从节点卡片移到这里（编辑面板底栏）：卡片预览保持干净，锁定/解锁在选中编辑时就近可达。
            selected 恒为真（composer 只在选中时挂载）→ 始终可见：未锁=描边开锁、已锁=实心锁。 */}
        <NodeLockBadge nodeId={node.id} locked={node.locked} selected />
        {hasPromptPickerButton && effects.more}
        <NodeParameterControls
          node={node}
          section="parameters"
          composerAttachmentSide={flipUp ? 'top' : 'bottom'}
        />
        {/* 手动运镜（B1）：视频镜头才有 video_ref 槽——运镜芯片仅对 video-like 节点显示（AI 工具 create_camera_move 的第二道门，共用同一产路）。 */}
        {isVideoLikeGenerationNodeKind(node.kind) && !node.locked ? (
          <NodeCameraMoveControl node={node} />
        ) : null}
        {acceptsPrompt && (nodeExecutionKind === 'image' || nodeExecutionKind === 'video') && !node.locked ? (
          <NodePromptOptimizer node={node} isVideo={nodeExecutionKind === 'video'} />
        ) : null}
        {(nodeExecutionKind === 'image' || nodeExecutionKind === 'video') && !node.locked ? (
          <NomiSelect
            ariaLabel={t('generationCommon.composer.variantCountAria')}
            title={t('generationCommon.composer.variantCountTitle', { count: variantCount })}
            value={String(variantCount)}
            disabled={isGenerating}
            options={GENERATION_VARIANT_COUNTS.map((count) => ({
              value: String(count),
              label: t('generationCommon.composer.variantCountOption', { count }),
            }))}
            onChange={(value) => setVariantCount(parseGenerationVariantCount(value))}
          />
        ) : null}
        {(() => {
          const disabledReason = unmetDependency
            ? t('generationCommon.composer.referenceCompanionRequired', {
                slot: unmetDependency.slotLabel,
                companions: unmetDependency.companionLabels.join(t('generationCommon.composer.companionOr')),
              })
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
                  : t('generationCommon.composer.generate'))
          return (
            <span title={title} style={{ display: 'contents' }}>
              {/* 原生 button：避开 WorkbenchButton(Mantine)对 radius/bg 的覆盖,确保样张 v4 的深色圆形主行动钮。
                  ml-auto：把生成钮推到底栏最右 = 卡片右下角（卡宽恒定 → 屏幕位置锁死）。 */}
              <button
                type="button"
                className={cn(GENERATE_BUTTON_CLASS, 'ml-auto')}
                aria-label={hasResult ? t('generationCommon.composer.regenerate') : t('generationCommon.composer.generateAsset')}
                disabled={!canGenerateNow}
                onClick={handleGenerate}
              >
                {isGenerating ? '···' : '↑'}
              </button>
            </span>
          )
        })()}
      </div>
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
    </div>
  )
}
