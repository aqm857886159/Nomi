import React from 'react'
import { useTranslation } from 'react-i18next'
import {
  IconArrowRight,
  IconAspectRatio,
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
import type { PromptSegmentRange, StoryboardProfile } from '../../../generationCanvas/agent/storyboardPlan'
import type { ModelOption } from '../../../../config/models'
import { resolveShotArchetypeMode } from './shotRowModel'
import { FRAME_COLUMN_WIDTH, type FrameMediaBox } from './shotFrameGeometry'
import type { ShotRowExec } from '../exec/storyboardRowStatus'
import type { Editor } from '@tiptap/react'
import StoryboardRowShell from './StoryboardRowShell'
import StoryboardShotFrame from './StoryboardShotFrame'
import StoryboardFrameActions from './StoryboardFrameActions'
import StoryboardVariantsDrawer from './StoryboardVariantsDrawer'
import ShotReferenceZone from './ShotReferenceZone'
import ShotComposerBar from './ShotComposerBar'
import PromptSkeletonSegments from './PromptSkeletonSegments'
import type { ShotVariant } from './shotVariants'

/**
 * 分镜表 v6 的一行：`[grip 14 | 画面格 136 | 参考列 200 | 提示词块 1fr]`（设计合同
 * `docs/design/2026-09-05-storyboard-table-v6-design-contract.md`，用户逐条拍板）。
 *
 * 与 v5 的四处结构性差异（其余语义原样保留）：
 *   ① 画面格列宽固定 136，媒体框按画幅缩放 → 横版镜头第一次有真实身材，混排仍左对齐（§2.4）；
 *   ② 参考列固定 200、一个槽一个格、永不换行（§4.1）；
 *   ③ 模型/模式/参数从**行上沿**搬进提示词框的**底栏**（§2.3）——批量观察与精细调参不再抢带宽；
 *   ④ 动作条从"压在图上的悬停浮层"移到**图下方常驻**，并新增「变体 ×N」抽屉入口（§2.9）。
 *
 * 行首那枚复选框是「本次跳过」（§2.10）：这一批不跑，跑完自动清；它与「锁定」是两回事
 * （锁定是持久的、要显式解锁），两者的挂点、视觉、清除时机都不许混。
 */

type Props = {
  shot: PlanShot
  anchors: PlanAnchor[]
  modelOptions?: ModelOption[]
  /** 这镜引用了、但锚已不存在的 id（展开态红标 + 阻断确认）。 */
  danglingIds: string[]
  exec?: ShotRowExec | undefined
  /** 这一行生效的画幅（storyboardAspectScope.effectiveShotAspect）。 */
  aspect: string
  /** 整张表共用的媒体盒（`tableFrameMediaBox`）——行不自己按画幅算，算了混排就又不齐（§2.4 修订）。 */
  frameBox: FrameMediaBox
  /** 这一行是否覆盖了整片默认画幅——底栏那枚画幅胶囊只在 true 时出现（§2.4.1 规则 3）。 */
  aspectOverridden: boolean
  aspectOptions: readonly string[]
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
  onJumpToAnchor?: ((anchorId: string) => void) | undefined
  onOpenPreview?: (() => void) | undefined
  onRegenerate?: (() => void) | undefined
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
  onUpdate: (patch: Partial<PlanShot>) => void
  onToggleAnchor: (anchorId: string) => void
  onRemove: () => void
  promptInvalid?: boolean
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

export default function StoryboardShotRow(props: Props): JSX.Element {
  const { t } = useTranslation()
  const {
    shot, anchors, modelOptions, exec, aspect, frameBox, aspectOverridden, aspectOptions, onChangeAspect,
    skipped, onToggleSkip, variants = [], adoptedVariantId, onAdoptVariant, onDeleteVariant, onGenerateVariants, outputTag,
    onGenerate, onJumpToAnchor, onOpenPreview, onRegenerate, onToggleLock, onAgentHandoff,
    onInsertAbove, onInsertBelow, targetShots, allShots, sourcePosition, onSaveAsReference, onSetAsFirstFrame,
    onRerunFreshRefs, onUpdate, onRemove, promptInvalid,
    mentionSearch, onMentionSelect, currentRefUrls, mentionUpload, storyboardProfile, sourceSegment,
  } = props
  const [actionsOpen, setActionsOpen] = React.useState(false)
  const [aspectMenuOpen, setAspectMenuOpen] = React.useState(false)
  const [variantsOpen, setVariantsOpen] = React.useState(false)
  const editorRef = React.useRef<Editor | null>(null)
  const triggerAtMention = React.useCallback(() => {
    const editor = editorRef.current
    if (!editor || editor.isDestroyed) return
    editor.chain().focus().insertContent('@').run()
  }, [])

  const closeMenus = (): void => { setActionsOpen(false); setAspectMenuOpen(false) }

  const isImageShot = shot.shotKind === 'image'
  const resolved = resolveShotArchetypeMode(modelOptions?.find((option) => option.value === shot.modelKey) ?? null, shot.modeId)
  const resolvedMode = resolved?.mode ?? null


  /** 已生成/已锁定的行：底栏用一枚状态标签替换「生成」按钮位置，不额外加行（§2.3）。 */
  const statusTag = exec?.status === 'locked'
    ? t('storyboardEditor.composerBar.lockedTag')
    : exec?.status === 'done'
      ? t('storyboardEditor.composerBar.doneTag')
      : null

  const grip = (
    <div className="flex flex-col items-center gap-1">
      <button
        type="button"
        draggable={props.draggable}
        onDragStart={props.onDragStart}
        onDragEnd={props.onDragEnd}
        className="cursor-grab active:cursor-grabbing"
        aria-label={t('storyboardEditor.rowActions.open')}
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
        className="grid size-4 place-items-center rounded-nomi-sm text-nomi-ink-40 hover:bg-nomi-ink-10 hover:text-nomi-ink-80"
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
              <MenuItem icon={<IconArrowRight size={13} stroke={1.8} />} label={t('storyboardEditor.selection.allScenes')} onClick={() => { props.onMoveToScene?.('__none__'); closeMenus() }} />
            </>
          ) : null}
          <span className="my-0.5 h-px bg-nomi-line-soft" aria-hidden />
          {/* 画幅覆盖的入口。底栏那枚胶囊只在**已覆盖**时出现（§2.4.1 规则 3），
              所以"把这一镜改成别的画幅"这个动作必须另有一个常驻的家——就是这里。 */}
          <MenuItem
            icon={<IconAspectRatio size={13} stroke={1.8} />}
            label={t('storyboardEditor.aspectScope.rowMenu')}
            onClick={() => setAspectMenuOpen((value) => !value)}
          />
          {aspectMenuOpen ? (
            <div className="flex flex-col gap-0.5 rounded-nomi-sm bg-nomi-ink-05 p-1" data-storyboard-aspect-menu={shot.index}>
              <MenuItem icon={<span className="size-3" aria-hidden />} label={t('storyboardEditor.aspectScope.followDefault')} onClick={() => { onChangeAspect(null); closeMenus() }} />
              {aspectOptions.map((option) => (
                <MenuItem key={option} icon={<span className="size-3" aria-hidden />} label={option} onClick={() => { onChangeAspect(option); closeMenus() }} />
              ))}
            </div>
          ) : null}
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

  const frame = exec ? (
    <>
      <StoryboardShotFrame
        shot={shot}
        exec={exec}
        aspect={aspect}
        box={frameBox}
        onGenerate={onGenerate}
        onJumpToAnchor={onJumpToAnchor}
        onOpenPreview={onOpenPreview}
        selected={props.selected}
        onSelect={props.onSelect}
      />
      <StoryboardFrameActions
        shot={shot}
        exec={exec}
        variants={variants}
        outputTag={outputTag}
        onRegenerate={onRegenerate}
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
    /* exec 缺省（测试/降级）：纯占位格，仍按固定列宽出，不让行错位。 */
    <div style={{ width: FRAME_COLUMN_WIDTH }} data-storyboard-frame="ready">
      <div
        className="relative rounded-nomi border border-dashed border-nomi-ink-20 bg-nomi-ink-05"
        style={{ width: frameBox.width, height: frameBox.height }}
        data-storyboard-frame-media={aspect || 'default'}
      >
        <span className="absolute left-1 top-1 rounded-nomi-sm bg-nomi-ink-10 px-1 text-micro tabular-nums text-nomi-ink-60">
          {String(shot.index).padStart(2, '0')}
        </span>
      </div>
    </div>
  )

  const prompt = (
    <div className="flex min-w-0 flex-col gap-1.5" data-storyboard-prompt-block="true">
      {skipped ? (
        <span className="self-start rounded-pill bg-nomi-ink-10 px-2 py-0.5 text-micro text-nomi-ink-60">
          {t('storyboardEditor.skip.tag')}
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

      {/* composer：提示词正文 + 底栏，一个框（"就像图片节点那样"）。 */}
      <div className={cn('rounded-nomi-sm border bg-nomi-paper', promptInvalid ? 'border-workbench-danger' : 'border-nomi-line')}>
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
          onChange={({ prompt: nextPrompt, ranges }) => onUpdate({ prompt: nextPrompt, promptSegments: ranges as PromptSegmentRange[] })}
          editorProps={{
            ariaLabel: t('storyboardEditor.promptAria', { index: shot.index }),
            placeholder: isImageShot ? t('storyboardEditor.imagePromptPlaceholder') : t('storyboardEditor.videoPromptPlaceholder'),
            className: 'px-2.5 py-2 text-body-sm leading-normal [&_.ProseMirror]:min-h-[52px]',
            mentionCandidates: currentRefUrls,
            mentionSearch,
            onMentionSelect,
            mentionUpload,
            onReady: (editor) => { editorRef.current = editor },
          }}
        />
        <ShotComposerBar
          shot={shot}
          archetype={resolved?.archetype ?? null}
          mode={resolvedMode}
          modelOptions={modelOptions}
          aspect={aspect}
          aspectOverridden={aspectOverridden}
          aspectOptions={aspectOptions}
          onChangeAspect={onChangeAspect}
          onUpdate={onUpdate}
          onGenerate={statusTag ? undefined : onGenerate}
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
        } else if (event.key === 'Enter' && !(event.target instanceof HTMLElement && event.target.closest('input, textarea, select, [contenteditable="true"]'))) {
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
      frame={frame}
      references={
        <ShotReferenceZone
          mode={resolvedMode}
          bindings={shot.referenceBindings}
          onChangeBindings={(next) => onUpdate({ referenceBindings: next })}
          anchors={anchors}
          onTriggerMention={triggerAtMention}
          mentionEnabled={Boolean(mentionSearch)}
        />
      }
      prompt={prompt}
      footer={variantsOpen ? footer : undefined}
    />
  )
}
