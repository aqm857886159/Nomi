import { NodeGenerationStatus } from '../../../generationCanvas/nodes/NodeGenerationStatus'
import { StoryboardOverrideBadge } from '../../../generationCanvas/nodes/StoryboardOverrideBadge'
import { resolveStoryboardOverride } from '../exec/storyboardOverrideActions'
import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import {
  IconAlertTriangle,
  IconArrowRight,
  IconCopy,
  IconDots,
  IconGripVertical,
  IconLock,
  IconPlus,
  IconRobot,
  IconTrash,
} from '../../../../vendor/tablerIcons'
import { cn } from '../../../../utils/cn'
import type { MentionSuggestionItem, MentionUploadControls } from '../../../assets/AssetMentionSuggestionList'
import type { PlanAnchor, PlanShot } from '../../../generationCanvas/agent/storyboardPlan'
import { NO_SCENE_VALUE, type PlanShotPatch } from '../../../generationCanvas/agent/storyboardPlanEdits'
import { findModelOptionByIdentifier } from '../../../../config/modelOptionResolvers'
import { useVendorPreferenceOrder } from '../../../common/useVendorPreference'
import type { PromptSegmentRange, StoryboardProfile } from '../../../generationCanvas/agent/storyboardPlan'
import type { ModelOption } from '../../../../config/models'
import { resolveShotArchetypeMode } from './shotRowModel'
import { isPortraitBox, visualColumnWidth, type FrameMediaBox } from './shotFrameGeometry'
import type { ShotRowExec } from '../exec/storyboardRowStatus'
import type { Editor } from '@tiptap/react'
import StoryboardRowShell from './StoryboardRowShell'
import StoryboardShotFrame from './StoryboardShotFrame'
import StoryboardFrameActions from './StoryboardFrameActions'
import StoryboardVariantsDrawer from './StoryboardVariantsDrawer'
import ShotReferenceStrip from './ShotReferenceStrip'
import { modeDisplayLabel, referenceCapableSibling } from './shotReferenceCells'
import { dropBindingsForUrls, removeReferenceWithMention } from './shotReferenceSlots'
import { droppedMentionUrls } from '../../../assets/promptMentions'
import ShotComposerBar from './ShotComposerBar'
import PromptSkeletonSegments from './PromptSkeletonSegments'
import type { ShotVariant } from './shotVariants'

/**
 * 分镜表的一行：`[行首 | 视觉列 | 内容列]`（2026-10-06 第二轮，版面由协调会话定；行网格在 `StoryboardRowShell`）。
 *
 *   · 视觉列 = 预览框（全表同一只，整片画幅定）+ 结果动作（有结果才占位）+ 参考缩略图条（36 方块，带 ×、序号对芯片）；
 *   · 内容列 = 提示词（内联 @ 芯片，2–5 行，超出滚动）+ 底栏（画布同款模型按钮 + 参数汇总按钮，右端「生成」）。
 *
 * 用户 10-05：「复用我们目前的交互」；10-06：「优化左侧的显示……我们原来的设计是为了空间，把参考的图片放到了左边」。
 * 行首那枚复选框是「本次跳过」（§2.10，语义归 L-sbtable，这里不动）。
 */

type Props = {
  shot: PlanShot
  anchors: PlanAnchor[]
  modelOptions?: ModelOption[]
  exec?: ShotRowExec | undefined
  /** 这一行生效的画幅（storyboardShotScope.effectiveShotAspect）。 */
  aspect: string
  /** 整张表共用的媒体盒（`tableFrameMediaBox`）——行不自己按画幅算，算了混排就又不齐（§2.4 修订）。 */
  frameBox: FrameMediaBox
  /**
   * 旧底栏的「覆盖」胶囊与行菜单的画幅清单用的。画幅现在住参数面板，这两项这一行不再读；
   * 表格（`StoryboardShotTable`，L-sbtable 线的文件）仍在传，等那条线顺手删掉传参再从这里删。
   */
  aspectOverridden?: boolean
  aspectOptions?: readonly string[]
  /** 改这一行的画幅覆盖；传 null = 收回覆盖，跟随整片默认。 */
  onChangeAspect: (aspect: string | null) => void
  /** 「本次跳过」：不进这一次批量，跑完自动清（≠ 锁定）。 */
  skipped?: boolean
  onToggleSkip?: (() => void) | undefined
  /** 这一镜的历史变体（§2.9）；重生成往里追加，画面格不动。 */
  variants?: readonly ShotVariant[]
  adoptedVariantId?: string | undefined
  onAdoptVariant?: ((variant: ShotVariant) => void) | undefined
  onDeleteVariant?: ((variant: ShotVariant) => void) | undefined
  /** 「再出 3 版」——同镜连出三版追加进抽屉（不覆盖画面格）。 */
  onGenerateVariants?: (() => void) | undefined
  /** 这次产出的 `@tag`（§2.10）——下一镜靠它 @ 得出来。 */
  outputTag?: string | undefined
  mentionSearch?: (query: string) => MentionSuggestionItem[]
  onMentionSelect?: (item: MentionSuggestionItem) => number | null
  currentRefUrls?: string[]
  mentionUpload?: MentionUploadControls
  storyboardProfile?: StoryboardProfile
  onGenerate?: (() => void) | undefined
  onOpenPreview?: (() => void) | undefined
  onRegenerate?: (() => void) | undefined
  /** 可找回态的**免费**续查（`recoverNodeResult`）；与 onGenerate/onRegenerate 那两条付费路径分开。 */
  onRecover?: (() => void) | undefined
  onToggleLock?: (() => void) | undefined
  /** 「交给 Agent 改这一镜」（§2.7 入口 3/3）。 */
  onAgentHandoff?: (() => void) | undefined
  /** 设计返工 §2.7：剧本来源只展示设计，不在本轮接真实文稿读写链。 */
  sourceSegment?: { id: string; edited: boolean; onClick?: (() => void) | undefined }
  onInsertAbove?: (() => void) | undefined
  onInsertBelow?: (() => void) | undefined
  targetShots?: readonly PlanShot[]
  allShots?: readonly PlanShot[]
  sourcePosition?: number
  onSaveAsReference?: (() => void) | undefined
  onSetAsFirstFrame?: ((targetIndex: number) => void) | undefined
  selected?: boolean
  onSelect?: ((event: React.MouseEvent) => void) | undefined
  scenes?: readonly { id: string; title: string }[]
  onCopy?: (() => void) | undefined
  onMoveToScene?: ((sceneId: string) => void) | undefined
  onKeyboardMove?: ((direction: -1 | 1) => void) | undefined
  onKeyboardFocus?: ((direction: -1 | 1) => void) | undefined
  onRerunFreshRefs?: (() => void) | undefined
  onResolveOverride?: (field: string, action: 'adopt' | 'discard') => void
  onUpdate: (patch: PlanShotPatch) => void
  onRemove: () => void
  promptInvalid?: boolean
  /**
   * 执行计划的行内警示（返工 7 / D1）：这一镜按所选模型的真实档案「超上限 / 低于下限」。
   * 句子由编辑器用 `strategyText` 渲染好传进来——行不认识引擎，也不重复一份判据。
   */
  durationWarning?: { kind: 'overflow' | 'underflow'; text: string; detail: string } | undefined
  draggable?: boolean
  isDragOver?: boolean
  onDragStart?: () => void
  onDragOver?: (event: React.DragEvent) => void
  onDrop?: () => void
  onDragEnd?: () => void
}

/** ⋯ 菜单里的一条。图标 + 文字，一行一条（合同 §2.6 的清单，顺序不变）。 */
function MenuItem({
  icon,
  label,
  danger,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  danger?: boolean
  onClick: () => void
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center gap-2 whitespace-nowrap rounded-nomi-sm px-2 py-1 text-left text-micro',
        danger ? 'text-workbench-danger hover:bg-workbench-danger-soft' : 'text-nomi-ink-80 hover:bg-nomi-ink-05',
      )}
    >
      {icon}
      {label}
    </button>
  )
}

/**
 * 行级 Enter 快捷键（「回车 = 去改提示词」）**不许抢走已经聚焦的控件的那一下**。
 *
 * 2026-09-17 实测到的坑：原来的名单只列了文本录入类（`input, textarea, select, contenteditable`），
 * 于是**行内每一颗按钮**——「生成」、行尾 ⋯、画面格那排动作钮——用键盘 Tab 过去之后按 Enter，
 * 都会被这一行 `preventDefault()` 吃掉，焦点直接跳去提示词框。鼠标用户完全看不到这个问题，
 * 键盘用户则是「这颗钮按不动」。
 *
 * 判据改成「这一下 Enter 本来就属于某个控件吗」，而不是「是不是在打字」——
 * 按钮、链接、combobox 的 Enter 都是它们自己的。行自己是个 `div`，不在这张名单里，
 * 所以焦点真落在行上时快捷键照旧。
 */
const ENTER_BELONGS_TO_CONTROL =
  'input, textarea, select, button, a[href], [contenteditable="true"], [role="button"], [role="combobox"], [role="option"], [role="switch"]'

export default function StoryboardShotRow(props: Props): JSX.Element {
  const { t } = useTranslation()
  const {
    shot, modelOptions, exec, aspect, frameBox, onChangeAspect,
    skipped, onToggleSkip, variants = [], adoptedVariantId, onAdoptVariant, onDeleteVariant, onGenerateVariants, outputTag,
    onGenerate, onOpenPreview, onRegenerate, onRecover, onToggleLock, onAgentHandoff,
    onInsertAbove, onInsertBelow, targetShots, allShots, sourcePosition, onSaveAsReference, onSetAsFirstFrame,
    onRerunFreshRefs, onUpdate, onRemove, promptInvalid, durationWarning,
    mentionSearch, onMentionSelect, currentRefUrls, mentionUpload, storyboardProfile, sourceSegment,
  } = props
  const orderedVendorKeys = useVendorPreferenceOrder()
  const [actionsOpen, setActionsOpen] = React.useState(false)
  const [variantsOpen, setVariantsOpen] = React.useState(false)
  const editorRef = React.useRef<Editor | null>(null)
  // 点参考缩略图 = 在提示词光标处插一枚指向它的 @（画布节点同一手势、同一条 editor 命令）。
  const insertMention = React.useCallback((url: string) => {
    const editor = editorRef.current
    if (!editor || editor.isDestroyed) return
    const position = (currentRefUrls ?? []).indexOf(url)
    editor.chain().focus().insertAssetMention(url, position >= 0 ? position + 1 : undefined).run()
  }, [currentRefUrls])

  const closeMenus = (): void => { setActionsOpen(false) }
  // 视觉列宽：这一行在行网格之外渲染，读不到网格量出的档位，所以参考条与降级框的宽度由 ShotReferenceStrip /
  // 画面格在网格里面各自按档位缩（同一个 context）。这里给的是宽档值。
  const visualWidth = frameBox.width
  const visualHeight = frameBox.height
  // 整片竖版：参考在框右边、提示词不撑满行高（用户选 A）；横版与方图：参考在框下面。
  const portrait = isPortraitBox(frameBox)
  // 生成时会被计划首帧填上的那一槽不摆进参考里（不是用户摆的参考）。
  const hiddenSlotKeys = React.useMemo(
    () => (exec?.plannedFirstFrame ? new Set([exec.plannedFirstFrame.slotKind]) : undefined),
    [exec?.plannedFirstFrame],
  )

  const isImageShot = shot.shotKind === 'image'
  // 档案按 (modelKey, modelVendor) 取：同名两家的档案/参数可以不同，按名字取会拿到另一家的模式表。
  const resolved = resolveShotArchetypeMode(findModelOptionByIdentifier(modelOptions ?? [], shot.modelKey, shot.modelVendor, orderedVendorKeys), shot.modeId)
  const resolvedMode = resolved?.mode ?? null
  // 行上摆着、当前模式用不上的参考图：一句话点名（模式名与下拉同一个出口；换哪个模式才带得上也说出来）。
  const ignoredNames = (exec?.ignoredAnchors ?? []).map((anchor) => anchor.name).join(t('storyboardEditor.anchorPolicy.nameSeparator'))
  const ignoredSwitch = resolvedMode ? referenceCapableSibling(resolvedMode, resolved?.archetype ?? null) : undefined
  const ignoredReferenceNotice = resolvedMode && ignoredNames
    ? ignoredSwitch
      ? t('storyboardEditor.anchorPolicy.rowIgnored', { names: ignoredNames, mode: modeDisplayLabel(resolvedMode), other: ignoredSwitch.modeLabel })
      : t('storyboardEditor.anchorPolicy.rowIgnoredNoAlt', { names: ignoredNames, mode: modeDisplayLabel(resolvedMode) })
    : null


  /**
   * 已生成/已锁定的行：底栏用一枚状态标签替换「生成」按钮位置，不额外加行（§2.3）。
   * 可找回的行也走这里：它已经付过费了，底栏那枚「生成」是一条会重新扣费的路
   * ——这一行的正解是画面格下方那枚**免费**的「重新拉取结果」，所以这里只留标签、不留付费按钮。
   */
  const statusTag = exec?.status === 'locked'
    ? t('storyboardEditor.composerBar.lockedTag')
    : exec?.status === 'done'
      ? t('storyboardEditor.composerBar.doneTag')
      : exec?.status === 'recoverable'
        ? t('storyboardEditor.frame.recoverable')
        : null

  const grip = (
    <div className="flex flex-col items-center gap-1">
      {/* 拖动把手。它和下面那颗「⋯」曾经**共用同一个 aria-label**（都叫「镜头操作」），
          于是任何按名字找的点击——走查、读屏器、无障碍工具——都落在这一颗上；而它没有 onClick，
          点了什么也不会发生（2026-09-17，W-04：逐镜换画幅的入口因此整条不可达）。
          一个名字只能有一个含义。 */}
      <button
        type="button"
        draggable={props.draggable}
        onDragStart={props.onDragStart}
        onDragEnd={props.onDragEnd}
        className="relative cursor-grab active:cursor-grabbing after:absolute after:-inset-1.5 after:content-['']"
        aria-label={t('storyboardEditor.rowActions.drag')}
        data-storyboard-row-drag={shot.index}
      >
        <IconGripVertical size={15} stroke={1.6} aria-hidden />
      </button>
      {onToggleSkip ? (
        <input
          type="checkbox"
          checked={Boolean(skipped)}
          onChange={onToggleSkip}
          aria-label={t('storyboardEditor.skip.aria', { index: shot.index })}
          title={t('storyboardEditor.skip.hint')}
          {...(skipped ? { 'data-storyboard-skip': shot.index } : {})}
          className="size-3 accent-[var(--nomi-accent)]"
        />
      ) : null}
      <button
        type="button"
        onClick={() => setActionsOpen((value) => !value)}
        aria-label={t('storyboardEditor.rowActions.open')}
        data-storyboard-row-menu-trigger={shot.index}
        // 视觉尺寸受 14px 的行首栏宽约束（改栏宽是布局改动），但**命中区**不必受它约束：
        // ::after 把可点范围撑到约 28px，仍然只有这一颗，不与相邻控件抢（W-04 附带的「命中区偏小」）。
        className="relative grid size-4 place-items-center rounded-nomi-sm text-nomi-ink-40 after:absolute after:-inset-1.5 after:content-[''] hover:bg-nomi-ink-10 hover:text-nomi-ink-80"
      >
        <IconDots size={13} stroke={1.8} />
      </button>
      {actionsOpen ? (
        <div
          className="absolute left-5 top-5 z-30 flex min-w-40 flex-col gap-0.5 rounded-nomi-sm border border-nomi-line bg-nomi-paper p-1 shadow-nomi-md"
          data-storyboard-row-menu={shot.index}
          onPointerDown={(event) => event.stopPropagation()}
        >
          {onInsertAbove ? <MenuItem icon={<IconPlus size={13} stroke={1.8} />} label={t('storyboardEditor.rowMenu.insertAbove')} onClick={() => { onInsertAbove(); closeMenus() }} /> : null}
          {onInsertBelow ? <MenuItem icon={<IconPlus size={13} stroke={1.8} />} label={t('storyboardEditor.rowMenu.insertBelow')} onClick={() => { onInsertBelow(); closeMenus() }} /> : null}
          {props.onCopy ? <MenuItem icon={<IconCopy size={13} stroke={1.8} />} label={t('storyboardEditor.row.copy')} onClick={() => { props.onCopy?.(); closeMenus() }} /> : null}
          {props.scenes && props.scenes.length > 0 ? (
            <>
              <span className="px-2 pt-1 text-micro text-nomi-ink-40">{t('storyboardEditor.rowMenu.moveToScene')}</span>
              {props.scenes.map((scene) => (
                <MenuItem key={scene.id} icon={<IconArrowRight size={13} stroke={1.8} />} label={scene.title} onClick={() => { props.onMoveToScene?.(scene.id); closeMenus() }} />
              ))}
              <MenuItem icon={<IconArrowRight size={13} stroke={1.8} />} label={t('storyboardEditor.selection.allScenes')} onClick={() => { props.onMoveToScene?.(NO_SCENE_VALUE); closeMenus() }} />
            </>
          ) : null}
          <span className="my-0.5 h-px bg-nomi-line-soft" aria-hidden />
          {/* 画幅不再住这里：参数面板里「比例」那一组就是它的家（选回整片默认 = 收回覆盖）。 */}
          {onToggleLock ? <MenuItem icon={<IconLock size={13} stroke={1.8} />} label={t('storyboardEditor.frame.lock')} onClick={() => { onToggleLock(); closeMenus() }} /> : null}
          {onAgentHandoff ? (
            <MenuItem
              icon={<IconRobot size={13} stroke={1.8} />}
              label={t('storyboardEditor.agentHandoff.row')}
              onClick={() => { onAgentHandoff(); closeMenus() }}
            />
          ) : null}
          <span className="my-0.5 h-px bg-nomi-line-soft" aria-hidden />
          <MenuItem icon={<IconTrash size={13} stroke={1.8} />} label={t('storyboardEditor.rowMenu.deleteUndoable')} danger onClick={() => { onRemove(); closeMenus() }} />
        </div>
      ) : null}
    </div>
  )

  // 视觉列：预览框 → 结果动作（有结果才占位）→ 参考缩略图条。列宽 = 框宽（窄档由行网格和画面格按同一档位缩）。
  const visual = (
    <div className={portrait ? 'flex items-start gap-2' : 'flex flex-col'} data-storyboard-visual={shot.index}>
      <div className="flex flex-col">
      {exec ? (
        <>
          <StoryboardShotFrame
            shot={shot}
            exec={exec}
            aspect={aspect}
            box={frameBox}
            onOpenPreview={onOpenPreview}
            selected={props.selected}
            onSelect={props.onSelect}
          />
          <NodeGenerationStatus node={exec.node} keyframeNode={exec.keyframeNode} />
          <StoryboardFrameActions
            shot={shot}
            exec={exec}
            variants={variants}
            outputTag={outputTag}
            onRegenerate={onRegenerate}
            onRecover={onRecover}
            onOpenPreview={onOpenPreview}
            onToggleLock={onToggleLock}
            onOpenVariants={() => setVariantsOpen((open) => !open)}
            onGenerate={onGenerate}
            targetShots={targetShots}
            allShots={allShots}
            sourcePosition={sourcePosition}
            onSaveAsReference={onSaveAsReference}
            onSetAsFirstFrame={onSetAsFirstFrame}
          />
        </>
      ) : (
        /* exec 缺省（测试/降级）：纯占位框，仍按表级框出，不让行错位。 */
        <div
          className="relative rounded-nomi border border-dashed border-nomi-ink-20 bg-nomi-ink-05"
          style={{ width: visualWidth, height: visualHeight }}
          data-storyboard-frame-media={aspect || 'default'}
          data-storyboard-visual-box="true"
        >
          <span className="absolute left-1 top-1 rounded-nomi-sm bg-nomi-ink-10 px-1 text-micro tabular-nums text-nomi-ink-60">
            {String(shot.index).padStart(2, '0')}
          </span>
        </div>
      )}
      </div>
      <ShotReferenceStrip
        mode={resolvedMode}
        archetype={resolved?.archetype ?? null}
        bindings={shot.referenceBindings}
        onChangeBindings={(next) => onUpdate({ referenceBindings: next })}
        onRemove={(slotKey, index) => {
          const next = removeReferenceWithMention(shot.prompt, shot.referenceBindings, slotKey, index)
          if (next) onUpdate({ referenceBindings: next.bindings, ...(next.prompt !== shot.prompt ? { prompt: next.prompt } : {}) })
        }}
        onInsertMention={mentionSearch ? insertMention : undefined}
        onSwitchMode={exec?.resultUrl || exec?.status === 'generating' ? undefined : (modeId) => onUpdate({ modeId })}
        hiddenSlotKeys={hiddenSlotKeys}
        layout={portrait
          ? { placement: 'right', columnWidth: visualColumnWidth(frameBox), frameWidth: frameBox.width, frameHeight: frameBox.height }
          : { placement: 'below', width: visualWidth }}
      />
    </div>
  )

  const prompt = (
    <div className="flex min-h-full min-w-0 flex-1 flex-col gap-1.5" data-storyboard-prompt-block="true">
      {exec?.node ? <StoryboardOverrideBadge node={exec.node} onResolve={(field, action) => props.onResolveOverride ? props.onResolveOverride(field, action) : resolveStoryboardOverride(exec.node!.id, field, action)} /> : null}
      {exec?.ignoredAnchors?.length ? (
        <span className="text-micro text-nomi-ink-40" data-storyboard-anchor-ignored={shot.index} title={exec.ignoredAnchors.map(anchor => `${anchor.name}: ${anchor.reason}`).join('\n')}>
          {ignoredReferenceNotice}
        </span>
      ) : null}
      {skipped ? (
        <span className="self-start rounded-pill bg-nomi-ink-10 px-2 py-0.5 text-micro text-nomi-ink-60">
          {t('storyboardEditor.skip.tag')}
        </span>
      ) : null}

      {/* 时长警示（返工 7）：这一镜原样生成会被截断 / 生成不出来——摩擦发生在行上，提示就在行上，
          不必点开上方的执行计划面板才知道是哪一镜。完整机器理由挂 title（和面板「为什么」同一句）。 */}
      {durationWarning ? (
        <span
          className="self-start inline-flex items-center gap-1 rounded-pill bg-nomi-warning/15 px-2 py-0.5 text-micro font-medium text-nomi-warning"
          title={durationWarning.detail}
          data-storyboard-row-duration-warning={durationWarning.kind}
          aria-label={t('storyboardEditor.strategy.rowWarningAria', { index: shot.index, reason: durationWarning.detail })}
        >
          <IconAlertTriangle size={11} stroke={2} aria-hidden />
          {durationWarning.text}
        </span>
      ) : null}

      {/* 图片+视频镜：首帧图提示词在视频提示词之前（v5 已有，v6 不动这块的语义）。 */}
      {shot.shotKind !== 'image' && shot.keyframe?.enabled ? (
        <>
          <div className="text-micro text-nomi-ink-40">{t('storyboardEditor.keyframePrompt')}</div>
          <textarea
            value={shot.keyframe?.prompt || ''}
            onChange={(event) => onUpdate({ keyframe: { ...(shot.keyframe || {}), enabled: true, prompt: event.target.value } })}
            aria-label={t('storyboardEditor.keyframePromptAria', { index: shot.index })}
            placeholder={t('storyboardEditor.keyframePromptPlaceholder')}
            rows={2}
            className="resize-none rounded-nomi-sm border border-nomi-line bg-nomi-paper px-2 py-2 text-body-sm leading-normal text-nomi-ink-80 focus:border-nomi-accent focus:outline-none"
          />
          <div className="text-micro text-nomi-ink-40">{t('storyboardEditor.videoPrompt')}</div>
        </>
      ) : null}

      {/* composer：提示词 + 底栏，一个框，撑满内容列剩余高度——底栏和「生成」因此永远在右下角、每行同一位置。 */}
      <div className={cn('flex min-h-0 flex-1 flex-col rounded-nomi-sm border bg-nomi-paper', promptInvalid ? 'border-workbench-danger' : 'border-nomi-line')}>
        {sourceSegment ? (
          <div className="flex items-center gap-1.5 border-b border-nomi-line-soft px-2.5 py-1.5" data-storyboard-source-segment={sourceSegment.id} data-storyboard-prompt-origin={sourceSegment.edited ? 'script-edited' : 'script-derived'}>
            {sourceSegment.onClick ? (
              <button type="button" onClick={sourceSegment.onClick} className="rounded-pill bg-nomi-accent-soft px-1.5 py-0.5 text-micro text-nomi-accent hover:underline">
                {sourceSegment.id}
              </button>
            ) : (
              <span className="rounded-pill bg-nomi-accent-soft px-1.5 py-0.5 text-micro text-nomi-accent">{sourceSegment.id}</span>
            )}
            <span className="text-micro text-nomi-ink-40">
              {sourceSegment.edited ? t('storyboardEditor.scriptProvenance.edited') : t('storyboardEditor.scriptProvenance.original')}
            </span>
          </div>
        ) : null}
        <PromptSkeletonSegments
          prompt={shot.prompt}
          profile={storyboardProfile}
          ranges={shot.promptSegments}
          onChange={({ prompt: nextPrompt, ranges }) => {
            // 删掉一枚 @ = 这张图不要了：参考框里它的绑定一起删（反馈 #7 的另一半）。
            const bindings = dropBindingsForUrls(shot.referenceBindings, droppedMentionUrls(shot.prompt, nextPrompt))
            onUpdate({ prompt: nextPrompt, promptSegments: ranges as PromptSegmentRange[], ...(bindings !== shot.referenceBindings ? { referenceBindings: bindings } : {}) })
          }}
          editorProps={{
            ariaLabel: t('storyboardEditor.promptAria', { index: shot.index }),
            placeholder: isImageShot ? t('storyboardEditor.imagePromptPlaceholder') : t('storyboardEditor.videoPromptPlaceholder'),
            // 至少两行、最多约五行，超出在框里滚动——行高由视觉列定，提示词不把行撑高。
            className: 'flex-1 px-2.5 py-2 text-body-sm leading-normal [&_.ProseMirror]:min-h-[42px] [&_.ProseMirror]:max-h-[105px] [&_.ProseMirror]:overflow-y-auto',
            mentionCandidates: currentRefUrls,
            mentionSearch,
            onMentionSelect,
            mentionUpload,
            onReady: (editor) => { editorRef.current = editor },
          }}
        />
        <ShotComposerBar
          shot={shot}
          modelOptions={modelOptions}
          aspect={aspect}
          onChangeAspect={onChangeAspect}
          onUpdate={onUpdate}
          onGenerate={statusTag ? undefined : onGenerate}
          generating={exec?.status === 'generating'}
          statusTag={statusTag}
        />
      </div>

      {/* 参考已变警示行：只报事实 + 给一键补跑，绝不自动跑。 */}
      {exec && exec.changedRefs.length > 0 ? (
        <div className="flex min-w-0 items-center gap-2" data-storyboard-ref-warnline={shot.index}>
          <span className="min-w-0 truncate text-micro text-workbench-danger">
            {exec.changedRefs.length > 1
              ? t('storyboardEditor.row.refChangedLineMore', { name: exec.changedRefs[0].name.trim() || t('storyboardEditor.unnamed'), count: exec.changedRefs.length })
              : t('storyboardEditor.row.refChangedLine', { name: exec.changedRefs[0].name.trim() || t('storyboardEditor.unnamed') })}
          </span>
          {onRerunFreshRefs ? (
            <button
              type="button"
              onClick={onRerunFreshRefs}
              className="h-6 shrink-0 rounded-nomi-sm border border-nomi-line bg-nomi-paper px-2 text-micro text-nomi-ink-80 hover:border-nomi-accent hover:text-nomi-accent"
            >
              {t('storyboardEditor.row.rerunFreshRefs')}
            </button>
          ) : null}
        </div>
      ) : null}

    </div>
  )

  const footer = (
    variantsOpen && variants.length > 0 ? (
        <StoryboardVariantsDrawer
          shotIndex={shot.index}
          variants={variants}
          adoptedVariantId={adoptedVariantId}
          onAdopt={(variant) => onAdoptVariant?.(variant)}
          onDelete={onDeleteVariant ? (variant) => onDeleteVariant(variant) : undefined}
          onOpenPreview={onOpenPreview ? () => onOpenPreview() : undefined}
          onGenerateMore={onGenerateVariants}
          onClose={() => setVariantsOpen(false)}
        />
      ) : null
  )

  return (
    <StoryboardRowShell
      tabIndex={-1}
      onDragOver={props.onDragOver}
      onDrop={props.onDrop}
      onClick={(event) => {
        if (event.target instanceof Element && event.target.closest('button, input, textarea, select')) return
        props.onSelect?.(event)
      }}
      onKeyDown={(event) => {
        if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
          event.preventDefault()
          props.onKeyboardMove?.(event.key === 'ArrowUp' ? -1 : 1)
        } else if (event.metaKey && event.key === 'Enter') {
          event.preventDefault()
          onGenerate?.()
        } else if (event.key === 'Enter' && !(event.target instanceof HTMLElement && event.target.closest(ENTER_BELONGS_TO_CONTROL))) {
          event.preventDefault()
          const box = event.currentTarget.querySelector<HTMLElement>('[data-prompt-box="true"] [contenteditable="true"]')
          box?.focus()
        } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
          props.onKeyboardFocus?.(event.key === 'ArrowUp' ? -1 : 1)
        }
      }}
      // 「本次跳过」的视觉：整行降到 60% 不透明度（§2.10）——一眼看得出这一批不跑它，
      // 但内容、参考、参数原样留着，和"删掉"或"锁定"是三件不同的事。
      className={cn(skipped && 'opacity-60')}
      dataAttributes={{
        'data-storyboard-row': shot.index,
        ...(props.selected ? { 'data-selected': 'true' } : {}),
      }}
      dropIndicator={props.isDragOver}
      grip={grip}
      visual={visual}
      visualWidth={visualColumnWidth(frameBox)}
      contentStretch={!portrait}
      prompt={prompt}
      footer={variantsOpen ? footer : undefined}
    />
  )
}
