import React from 'react'
import type { Editor } from '@tiptap/react'
import { NomiLoadingMark } from '../../../design'
import { cn } from '../../../utils/cn'
import PromptEditor from '../../assets/PromptEditor'
import { readArchetypeArray } from './controls/archetypeMeta'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { canRunGenerationNode, confirmAndRunNode } from '../runner/generationRunController'
import { collectUngeneratedReferenceAncestors } from '../runner/referenceAncestors'
import { buildDependencyWaves } from '../runner/dependencyWaves'
import { useBatchPlanPreviewStore } from '../components/batchPlanPreview'
import NodeParameterControls from './NodeParameterControls'
import { GENERATE_BUTTON_CLASS } from './nodeComposerStyles'
import { NodeLockBadge } from './NodeLockBadge'
import { NodePromptOptimizer } from './NodePromptOptimizer'
import { useNodeAssetDrop } from './useNodeAssetDrop'
import { persistActiveWorkbenchProjectNow } from '../../project/workbenchProjectSession'
import {
  getGenerationNodeExecutionKind,
  getGenerationNodePromptPlaceholder,
  isAudioLikeGenerationNodeKind,
  isImageLikeGenerationNodeKind,
  isVideoLikeGenerationNodeKind,
} from '../model/generationNodeKinds'
import { resolveArchetypeForModel } from '../../../config/modelArchetypes'
import { currentArchetypeMode } from './controls/archetypeMeta'
import { getTextGenMode, type TextGenMode } from '../runner/textActions'

// C5 P2：文本节点的三种生成模式。
const TEXT_GEN_MODES: { value: TextGenMode; label: string }[] = [
  { value: 'append', label: '续写' },
  { value: 'rewrite', label: '改写' },
  { value: 'replace', label: '重写' },
]
const TEXT_MODE_PLACEHOLDER: Record<TextGenMode, string> = {
  append: '续写要求…（留空＝直接接着往下写）',
  rewrite: '改写要求…（先在正文里选中要改的文字）',
  replace: '重写要求…（替换整篇）',
}

// 翻转滞回带（屏幕 px）：已翻上后要等下方明显够放才切回朝下，杜绝边界反复横跳（用户反馈①）。
const FLIP_HYSTERESIS = 48

// 生成节点的浮动 composer：references + 提示词 + 参数 + 生成/重新生成按钮。
// 从 BaseGenerationNode 抽出（A1.5 接缝）：只有「生成类」节点挂它，素材节点不挂。
// 所有生成相关依赖（runner / NodeParameterControls / 布局计算）都收在这里，壳保持 kind 无关。

type Props = {
  node: GenerationCanvasNode
  visualSize: { width: number; height: number }
}

type FloatingComposerLayout = {
  maxHeight: number
  gap: number
}

function floatingComposerLayout(width: number, _height: number, kind: GenerationCanvasNode['kind']): FloatingComposerLayout {
  // 宽度不再在这里算——它**内容驱动**（CSS `w-fit` + `min-w/max-w` 边界，见卡 className），
  // 跟着该模型实际的参数横排自然撑开，参数少则窄、多则宽、触上限在卡内换行（绝不绑节点比例、不钉死常数）。
  //
  // 高度同理**内容驱动**，不再绑节点高（旧 `height*0.72` 是 bug 根因：小节点 → 矮卡，
  // 「参考区 + 3 行提示词 + 底栏」放不下，overflow-hidden 把底栏的生成钮裁到卡外，修③④）。
  // 卡片在 flex-col 里自然按内容长高；只有一个可伸缩区（提示词 flex-1 overflow-auto），
  // 底栏 shrink-0 永远贴底可见。这里给一个宽松上限：内容超过它时只有提示词内部滚动，底栏不动。
  const maxHeight = kind === 'video' ? 460 : 400
  const gap = width >= 420 ? 14 : 10
  return { maxHeight, gap }
}

export default function NodeGenerationComposer({ node, visualSize }: Props): JSX.Element {
  const updateNode = useGenerationCanvasStore((state) => state.updateNode)
  const status = node.status || 'idle'
  const isGenerating = status === 'queued' || status === 'running'
  const hasResult = Boolean(node.result?.url)
  const nodeExecutionKind = getGenerationNodeExecutionKind(node.kind)
  // v0.7.2 perf: 用 boolean primitive 订阅 canGenerate
  const canGenerate = useGenerationCanvasStore((state) =>
    canRunGenerationNode(node, { nodes: state.nodes, edges: state.edges }),
  ) && !isGenerating
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
      meta,
    })
    return archetype ? currentArchetypeMode(archetype, meta) : null
  }, [isAudioKind, node.meta])
  const audioIsTranscribe = audioMode?.transportTaskKind === 'transcribe'
  const textGenMode = getTextGenMode(node)
  // 持有 prompt 编辑器实例,供「点参考 tile → 在光标处插入 chip」(@ 内联引用主路径)。
  const [promptEditor, setPromptEditor] = React.useState<Editor | null>(null)
  const insertMention = React.useCallback((url: string) => {
    if (promptEditor && !promptEditor.isDestroyed) promptEditor.commands.insertAssetMention(url)
  }, [promptEditor])
  // 拖文件到卡 → 加为参考（捷径 A）。仅当当前模式有数组参考槽时接管拖拽。
  const { acceptsDrop, isDragOver, isUploading, dropHandlers } = useNodeAssetDrop(node)

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
    // 付费守卫：单节点生成/重新生成 → 轻确认 + 铸令牌 + 跑（confirmAndRunNode 内部收口）。
    await confirmAndRunNode(node.id, hasResult ? { rerun: true } : {})
  }

  // 遮挡防线（audit 2026-06-12 bug C）：composer 默认朝下展开时，靠近画布底部的节点
  // 会把参数行/生成钮伸进时间轴的屏幕区域，被盖住点不到（elementFromPoint 实证）。
  // 屏幕坐标下实测节点上下可用空间，决定是否翻转朝上。
  // 订阅 zoom/offset/node.position：平移、缩放、拖节点都会重算。
  // 用户反馈①：默认稳定朝下，仅「下方真放不下且上方更宽裕」才翻上；已翻上后要等下方
  // 明显够放（+滞回带 FLIP_HYSTERESIS）才切回 → 杜绝节点贴边界时反复横跳。
  // 面板已反向缩放成恒定屏幕尺寸（见 anchor transform），故所需高度≈ offsetHeight（不再 ×zoom）。
  const canvasZoom = useGenerationCanvasStore((state) => state.canvasZoom)
  const canvasOffset = useGenerationCanvasStore((state) => state.canvasOffset)
  const anchorRef = React.useRef<HTMLDivElement>(null)
  const [flipUp, setFlipUp] = React.useState(false)
  // 翻上时要避让的「节点上方图片编辑工具条」高度（节点坐标系 px）。否则参数框会压住那条
  // 浮动工具条（用户反馈：浮动条看不见/遮挡）。无工具条（如未生成、视频节点）则为 0。
  const [aboveClearance, setAboveClearance] = React.useState(0)
  // 横向视口夹取（屏幕 px）：内容驱动的卡变宽后，靠画布左右边的节点会让卡溢出视口被裁（用户反馈
  // 2026-06-16「参数遮挡/很丑」）。算出卡左右沿对 stage 视口的越界量，整体平移把它拉回视口内
  // （卡比视口还宽时左对齐——参数从左起，优先露出左侧）。与竖向 flip 同源：都按屏幕几何避让。
  const [shiftX, setShiftX] = React.useState(0)
  React.useLayoutEffect(() => {
    const anchor = anchorRef.current
    const stage = anchor?.closest('.generation-canvas-v2__stage')
    const nodeEl = anchor?.parentElement
    if (!anchor || !stage || !nodeEl) return
    const recompute = () => {
      const stageRect = stage.getBoundingClientRect()
      const nodeRect = nodeEl.getBoundingClientRect()
      const neededScreenHeight = (anchor.offsetHeight || 280) + composerLayout.gap * canvasZoom
      const spaceBelow = stageRect.bottom - nodeRect.bottom
      const spaceAbove = nodeRect.top - stageRect.top
      setFlipUp((prev) =>
        prev
          ? !(spaceBelow > neededScreenHeight + FLIP_HYSTERESIS)
          : spaceBelow < neededScreenHeight && spaceAbove > spaceBelow,
      )
      // 工具条也恒定屏幕尺寸（counter-scaled）→ 实测其屏幕高换回节点坐标（/zoom）+ 它距节点的 18px。
      const toolbarEl = nodeEl.querySelector('.generation-canvas-v2-node__panorama-toolbar')
      const toolbarScreenH = toolbarEl ? toolbarEl.getBoundingClientRect().height : 0
      setAboveClearance(toolbarScreenH > 0 ? toolbarScreenH / (canvasZoom || 1) + 18 : 0)
      // 横向夹取：卡净 scale=1（画布 scale(zoom)×卡 counter-scale(1/zoom)）→ 屏幕宽 = offsetWidth。
      // 默认锚在节点中心（left-1/2 + translateX(-50%)）。算越界，整体平移回视口内。
      const MARGIN = 12
      const cardScreenW = anchor.offsetWidth
      const centerX = nodeRect.left + nodeRect.width / 2
      const wouldLeft = centerX - cardScreenW / 2
      const wouldRight = centerX + cardScreenW / 2
      const minLeft = stageRect.left + MARGIN
      const maxRight = stageRect.right - MARGIN
      let next = 0
      if (wouldRight > maxRight) next = maxRight - wouldRight // 右溢出 → 左移（负）
      if (wouldLeft + next < minLeft) next = minLeft - wouldLeft // 左溢出（或比视口宽）→ 左对齐
      setShiftX(Math.round(next))
    }
    recompute()
    // 卡宽随模型/参数变（model 切换不在下方 deps 里）→ ResizeObserver 兜住宽度变化重算横向夹取。
    const ro = new ResizeObserver(recompute)
    ro.observe(anchor)
    return () => ro.disconnect()
  }, [canvasZoom, canvasOffset, node.position?.x, node.position?.y, visualSize.width, visualSize.height, composerLayout.gap, node.result?.url])

  // 卡宽 = **内容驱动**（用户拍板 2026-06-16，推翻 06-13 的「按最宽模型恒定宽」）：
  // 卡片 **w-max**（max-content）跟着当前模型的「底栏一行」(锁+参数横排+生成钮)自然撑开——参数少则窄、
  // 多则宽，永远一行不换（InlineParameterBar flex-nowrap），生成钮 ml-auto 贴右。
  // **为什么不能用 w-fit**：composer 是 absolute + left-1/2 锚在节点上，fit-content 的可用宽被节点框
  // (~300px) 卡死 → 塌回 min-content(min-w-360)、参数多就被挤截断（实测 2026-06-16 真机：card 卡 360）。
  // max-content 不吃可用宽约束，按内容真实宽长开。提示词/参考区用 w-0 min-w-full **只填不撑**(贡献 0 到
  // max-content，长 prompt 在卡宽内换行，不把卡撑爆)。max-w 兜底防极端。（离屏测量器已删，纯 CSS。）

  return (
    // 外层只做定位锚（不裁剪），宽度跟随内层卡（w-max 包住按内容长开的卡，便于 -translate-x-1/2 居中）。
    <div
      ref={anchorRef}
      className={cn('generation-canvas-v2-node__composer', 'absolute left-1/2 z-[8] w-max')}
      data-flipped={flipUp ? 'true' : 'false'}
      style={{
        // 用户反馈③：反向缩放抵消画布 scale(zoom) → 面板恒定屏幕尺寸（缩小画布只缩上面的卡片框，
        // 不缩这个参数框）。横向居中的 -translate-x-1/2 改写进 transform（否则被 scale 覆盖）。
        // transform-origin 贴住与节点相连的那条边（默认朝下=顶边、翻上=底边），缩放时锚点不漂移。
        // 最左的 translateX(shiftX px) 在屏幕空间生效（不被 scale 缩）→ 横向夹取把溢出视口的宽卡拉回。
        transform: `translateX(${shiftX}px) translateX(-50%) scale(${1 / (canvasZoom || 1)})`,
        transformOrigin: flipUp ? 'bottom center' : 'top center',
        ...(flipUp
          ? { bottom: `calc(100% + ${composerLayout.gap + aboveClearance}px)` }
          : { top: `calc(100% + ${composerLayout.gap}px)` }),
      }}
      onPointerDown={(event) => event.stopPropagation()}
      {...(acceptsDrop ? dropHandlers : {})}
    >
      <div
        className={cn(
          'generation-canvas-v2-node__composer-card',
          'flex flex-col gap-2.5 p-3 min-h-[150px] min-w-[360px] max-w-[880px] w-max',
          // 宽度内容驱动（w-max）：按底栏一行(锁+参数+生成钮)的真实宽长开，参数少则窄、多则宽，不塌不爆、不换行。
          // max-w-[880px] 兜底：现有最宽是 apimart Seedance 7 控件(model+变体+比例+清晰度+时长+seed+生成音频)
          // ≈810px，880 留头不触发截断；纯防极端（防 omni 模式参考槽行等异常撑爆）。实测 2026-06-16 校准。
          'border border-nomi-line rounded-nomi bg-nomi-paper overflow-hidden shadow-nomi-md',
          'transition-[outline-color] duration-150',
          isDragOver && 'outline-2 outline-dashed outline-nomi-accent outline-offset-[-2px]',
        )}
        style={{ maxHeight: composerLayout.maxHeight }}
      >
      {/* 参考区：图像/视频的参考槽，以及声音的「配音生成/转写」模式切换 + 转写的音频参考槽。 */}
      {isImageLikeGenerationNodeKind(node.kind) || isVideoLikeGenerationNodeKind(node.kind) || isAudioKind ? (
        <>
          <NodeParameterControls node={node} section="references" onInsertMention={insertMention} />
          {/* 样张 v4 .divider：参考区与描述之间一条极淡分隔线 */}
          <div className={cn('h-px bg-nomi-line-soft')} />
        </>
      ) : null}
      {isTextKind ? (
        <div className={cn('flex items-center gap-1')} role="group" aria-label="生成模式">
          {TEXT_GEN_MODES.map((option) => (
            <button
              key={option.value}
              type="button"
              data-active={textGenMode === option.value ? 'true' : 'false'}
              onClick={(event) => {
                event.stopPropagation()
                updateNode(node.id, { meta: { ...(node.meta || {}), textGenMode: option.value } })
              }}
              className={cn(
                'h-[22px] rounded-full px-2.5 text-micro font-medium',
                'text-nomi-ink-60 hover:bg-nomi-ink-05',
                'data-[active=true]:bg-nomi-accent-soft data-[active=true]:text-nomi-accent',
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
      {/* 长 prompt 在编辑器内部滚动/换行；底栏永远贴底（卡宽确定，提示词在卡宽内自然换行，不撑爆）。 */}
      {/* 提示词至少 3 行高（min-h-[72px]）——参考区/底栏再多也不把它挤成 1 行（修③）；超长时本区滚动。 */}
      {/* 转写模式无台词输入（音频参考即输入）——隐藏 prompt，避免误导。 */}
      {audioIsTranscribe ? null : (
        // w-0 min-w-full：填满卡宽但**贡献 0** 到 max-content（长 prompt 在卡宽内换行，不把卡撑爆 → 卡宽由底栏定）。
        <div className={cn('flex-1 min-h-[72px] overflow-auto w-0 min-w-full')}>
          <PromptEditor
            className={cn('min-h-[72px]')}
            value={node.prompt || ''}
            placeholder={isTextKind ? TEXT_MODE_PLACEHOLDER[textGenMode] : getGenerationNodePromptPlaceholder(node.kind)}
            editable={!node.locked}
            onChange={(next) => updateNode(node.id, { prompt: next })}
            onBlur={() => { void persistActiveWorkbenchProjectNow().catch(() => {}) }}
            onReady={setPromptEditor}
            mentionCandidates={readArchetypeArray(node.meta || {}, 'referenceImageUrls')}
          />
        </div>
      )}
      {/* 底栏铺满卡宽（w-full）：卡宽由「最宽模型」恒定，生成钮 ml-auto 永远贴右；
          换到参数少的模型时底栏内容靠左、右侧留白，生成钮仍锁死右下角（不再随参数横排漂移）。 */}
      <div className={cn('flex items-center gap-2 mt-auto pt-1 shrink-0 w-full')}>
        {/* 锁从节点卡片移到这里（编辑面板底栏）：卡片预览保持干净，锁定/解锁在选中编辑时就近可达。
            selected 恒为真（composer 只在选中时挂载）→ 始终可见：未锁=描边开锁、已锁=实心锁。 */}
        <NodeLockBadge nodeId={node.id} locked={node.locked} selected />
        <NodeParameterControls node={node} section="parameters" />
        {(nodeExecutionKind === 'image' || nodeExecutionKind === 'video') && !node.locked ? (
          <NodePromptOptimizer node={node} isVideo={nodeExecutionKind === 'video'} />
        ) : null}
        {(() => {
          const disabledReason = !canGenerateNow && !isGenerating
            ? nodeExecutionKind === 'video'
              ? acceptsDrop
                ? '需要先添加参考素材（拖入 / 连线 / 点 +）'
                : '需要先连接一个图片节点作为首帧'
              : nodeExecutionKind === 'image'
                ? undefined
                : `「${node.kind}」类型暂不支持直接生成`
            : undefined
          const title = disabledReason
            ?? (isGenerating ? '生成中…' : hasPendingRefs ? '先生成参考，再生成本镜' : hasResult ? '重新生成' : '生成')
          return (
            <span title={title} style={{ display: 'contents' }}>
              {/* 原生 button：避开 WorkbenchButton(Mantine)对 radius/bg 的覆盖,确保样张 v4 的深色圆形主行动钮。
                  ml-auto：把生成钮推到底栏最右 = 卡片右下角（卡宽恒定 → 屏幕位置锁死）。 */}
              <button
                type="button"
                className={cn(GENERATE_BUTTON_CLASS, 'ml-auto')}
                aria-label={hasResult ? '重新生成' : '生成素材'}
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
            {isUploading ? <NomiLoadingMark size={14} label="上传中" /> : null}
            {isUploading ? '上传中…' : '松手添加为参考'}
          </span>
        </div>
      ) : null}
    </div>
  )
}
