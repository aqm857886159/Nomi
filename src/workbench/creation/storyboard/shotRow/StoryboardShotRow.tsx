import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconChevronDown, IconChevronUp, IconGripVertical, IconTrash } from '@tabler/icons-react'
import { cn } from '../../../../utils/cn'
import { NomiSelect } from '../../../../design'
import type { MentionSuggestionItem, MentionUploadControls } from '../../../assets/AssetMentionSuggestionList'
import type { PlanAnchor, PlanShot } from '../../../generationCanvas/agent/storyboardPlan'
import type { PromptSegmentRange, StoryboardProfile } from '../../../generationCanvas/agent/storyboardPlan'
import { effectiveShotDurationSec } from '../../../generationCanvas/agent/storyboardPlan'
import {
  DURATION_OPTIONS_SEC,
  shotKindPatch,
  shotTypeOf,
  type ShotTypeValue,
} from '../../../generationCanvas/agent/storyboardPlanEdits'
import type { ModelOption } from '../../../../config/models'
import { useDedupedModelSelect } from '../../../common/useDedupedModelSelect'
import { translateModelDisplayText } from '../../../../i18n/modelDisplayText'
import { aspectControlOf, referenceZoneView, resolveShotArchetypeMode } from './shotRowModel'
import type { ShotRowExec } from '../exec/storyboardRowStatus'
import type { Editor } from '@tiptap/react'
import StoryboardShotFrame from './StoryboardShotFrame'
import StoryboardShotRowExpand from './StoryboardShotRowExpand'
import PromptSkeletonSegments from './PromptSkeletonSegments'
import { modeGeneratesDialogue } from '../../../generationCanvas/agent/storyboardDialogue'

/**
 * 分镜表 v5 的一行：`[grip | 画面格 76×132 | 参考区 136 | 提示词块 1fr]`（样张
 * 2026-09-01-storyboard-table-image-first.html 拍板，「图是主角」）。B 起是执行面：
 * - 画面格 = 行状态机的脸（StoryboardShotFrame：空格生成按钮/等参考卡/缺必填红/进度/结果图）；
 * - 参考区三形态**纯展示**（具名槽空 tile / 「@」入口占位 / 不吃参考）——绑定编辑住展开态锚 chips；
 * - 提示词块：上沿类型/时长/模型/画幅胶囊（作用域=这一镜；整片改走顶部批量条，§1.5 C3），
 *   主体 PromptEditor（TipTap，C1：复用 @ mention 机制，见 useShotMentionSource），
 *   下沿有台词才显只读小字 + ▾ 展开（台词/转场/参考绑定/参数）。
 * @ 胶囊/插入线/多选浮条属 C/D 阶段；C1 只实现 @ mention 内核。
 */

type Props = {
  shot: PlanShot
  anchors: PlanAnchor[]
  /** 可选模型清单（父组件按镜头种类传图片/视频清单）；空 → 不显模型选择器，落画布按种类用默认模型兜底。 */
  modelOptions?: ModelOption[]
  /** 这镜引用了、但锚已不存在的 id（展开态红标 + 阻断确认）。 */
  danglingIds: string[]
  /** 行执行态（编辑器统一 derive；缺省 = 无执行面渲染，仅测试/降级）。 */
  exec?: ShotRowExec | undefined
  /**
   * C1 @ mention 内核：
   * - mentionSearch     按 query 返回候选（useShotMentionSource 提供）
   * - onMentionSelect   选中候选后的动作（返回 chip index；null = 拒绝插入）
   * - currentRefUrls    已绑定的参考 url 有序列表（供 chip 编号）
   * 缺省 = 不开 @ 面板（不吃参考的模型行；§1.6 C4 禁用不做沟通死路）
   */
  mentionSearch?: (query: string) => MentionSuggestionItem[]
  onMentionSelect?: (item: MentionSuggestionItem) => number | null
  currentRefUrls?: string[]
  mentionUpload?: MentionUploadControls
  storyboardProfile?: StoryboardProfile
  /** 行内「生成 / 重试」。 */
  onGenerate?: (() => void) | undefined
  /** ⏳ 态点参考卡名 → 定位那张参考卡。 */
  onJumpToAnchor?: ((anchorId: string) => void) | undefined
  /** 结果态双击 / 浮条 ⛶ → 放大预览（AssetPreviewDialog，编辑器统一挂）。 */
  onOpenPreview?: (() => void) | undefined
  /** 浮条 ↻ 原地重生成。 */
  onRegenerate?: (() => void) | undefined
  /** 浮条 ×3 变体。 */
  onVariants?: (() => void) | undefined
  /** 浮条 🔒/🔓 镜级锁定开关。 */
  onToggleLock?: (() => void) | undefined
  /** 参考已变警示行「用新图重跑」（B3）。 */
  onRerunFreshRefs?: (() => void) | undefined
  onUpdate: (patch: Partial<PlanShot>) => void
  onToggleAnchor: (anchorId: string) => void
  onRemove: () => void
  /** 把这镜的模型参数+模式套用到全部镜头（编辑器实现）。 */
  onApplyParamsToAll?: () => void
  promptInvalid?: boolean
  // grip 拖拽重排（state 在表层，行只透传）。跨场界落点 = moveShot 场感知改挂 sceneId。
  draggable?: boolean
  isDragOver?: boolean
  onDragStart?: () => void
  onDragOver?: (event: React.DragEvent) => void
  onDrop?: () => void
  onDragEnd?: () => void
}

export default function StoryboardShotRow(props: Props): JSX.Element {
  const { t } = useTranslation()
  const { shot, anchors, modelOptions, danglingIds, exec, onGenerate, onJumpToAnchor, onOpenPreview, onRegenerate, onVariants, onToggleLock, onRerunFreshRefs, onUpdate, onToggleAnchor, onRemove, promptInvalid, onApplyParamsToAll, mentionSearch, onMentionSelect, currentRefUrls, mentionUpload, storyboardProfile } = props
  const [expanded, setExpanded] = React.useState(false)
  // C1：PromptEditor ref——参考区「@」入口点击时触发 mention（一个实现两个入口）。
  const editorRef = React.useRef<Editor | null>(null)
  const triggerAtMention = React.useCallback(() => {
    const editor = editorRef.current
    if (!editor || editor.isDestroyed) return
    // 在光标位置插入 '@' 字符，Tiptap mention suggestion 自动触发。
    editor.chain().focus().insertContent('@').run()
  }, [])

  const shotTypeValue = shotTypeOf(shot)
  const isImageShot = shotTypeValue === 'image'
  const onKindChange = (value: string): void => {
    if (value === shotTypeValue) return
    onUpdate(shotKindPatch(shot, value as ShotTypeValue))
  }

  // 时长：视频镜=生成时长；图片镜=停留时长（v5，默认 3 经 effectiveShotDurationSec 单源换算），
  // 图片镜旁跟「停留」pill 点破语义差。
  const effectiveDuration = effectiveShotDurationSec(shot)
  const durationOptions = [...new Set([...DURATION_OPTIONS_SEC, ...(isImageShot ? [3] : []), effectiveDuration])]
    .filter((sec) => Number.isFinite(sec) && sec > 0)
    .sort((a, b) => a - b)
    .map((sec) => ({ value: String(sec), label: t('storyboardEditor.second', { count: sec }) }))

  // 模型选择：与画布节点共用同一去重 view-model（P1）。选具体模型 → 写 modelKey、清 modeId/params
  // （由 buildPlannedNodeMeta 按所选模型取默认模式，避免把别的模型的 modeId/参数套错）。
  const onShotModelChange = React.useCallback(
    (value: string) => onUpdate({ modelKey: value || undefined, modeId: undefined, params: undefined }),
    [onUpdate],
  )
  const modelSelect = useDedupedModelSelect(modelOptions ?? [], shot.modelKey ?? '', onShotModelChange)
  const modelSelectOptions = modelOptions && modelOptions.length > 0
    ? [{ value: '', label: t('storyboardEditor.defaultModel') }, ...modelSelect.modelOptions]
    : null
  const onModelSelect = (id: string): void => (id ? modelSelect.onModelPick(id) : onShotModelChange(''))
  const selectedModelOption = modelOptions?.find((o) => o.value === shot.modelKey) ?? null

  // 档案投影：参考区形态 / 画幅胶囊从「该行模型的当前 mode」derive（shotRowModel 单源；
  // 画面格红态由 exec.missingSlots 携带，同一 missingRequiredSlots 判定，在编辑器统一算）。
  const resolvedMode = resolveShotArchetypeMode(selectedModelOption, shot.modeId)?.mode ?? null
  const zone = referenceZoneView(resolvedMode, shot, anchors)
  const aspectControl = aspectControlOf(resolvedMode)
  const aspectValue = (() => {
    const raw = shot.params?.aspect_ratio
    if (raw !== undefined && raw !== null && raw !== '') return String(raw)
    return aspectControl?.defaultValue !== undefined ? String(aspectControl.defaultValue) : ''
  })()

  const dialogueText = shot.dialogue?.trim() || shot.subtitle?.trim() || ''
  const dialogueWillGenerate = Boolean(dialogueText && modeGeneratesDialogue(resolvedMode, shot.params))

  return (
    <div
      draggable={props.draggable}
      onDragStart={props.onDragStart}
      onDragOver={props.onDragOver}
      onDrop={props.onDrop}
      onDragEnd={props.onDragEnd}
      className="relative grid grid-cols-[14px_84px_136px_minmax(0,1fr)] gap-3 py-3 pl-1.5 pr-3 items-start bg-nomi-paper"
      data-storyboard-row={shot.index}
    >
      {props.isDragOver ? (
        <div className="absolute inset-x-1.5 top-0 h-0.5 rounded-full bg-nomi-accent" aria-hidden />
      ) : null}

      <span className="self-center justify-self-center cursor-grab text-nomi-ink-20 active:cursor-grabbing" aria-hidden>
        <IconGripVertical size={15} stroke={1.6} />
      </span>

      {/* ── 画面格（图是主角：行内最大元素）——行状态机的脸，状态与组头/footer 计数同一份 derive ── */}
      {exec ? (
        <StoryboardShotFrame
          shot={shot}
          exec={exec}
          onGenerate={onGenerate}
          onJumpToAnchor={onJumpToAnchor}
          onOpenPreview={onOpenPreview}
          onRegenerate={onRegenerate}
          onVariants={onVariants}
          onToggleLock={onToggleLock}
        />
      ) : (
        /* exec 缺省（测试/降级）：纯占位格 */
        <div className="relative w-[76px] h-[132px] rounded-nomi border border-dashed border-nomi-ink-20 bg-nomi-ink-05">
          <span className="absolute top-1 left-1 px-1 rounded-nomi-sm bg-nomi-ink-10 text-micro text-nomi-ink-60 tabular-nums">
            {String(shot.index).padStart(2, '0')}
          </span>
        </div>
      )}

      {/* ── 参考区（纯展示）：具名槽空 tile / 已引用锚 + 「@」入口占位 / 不吃参考 ── */}
      <div className="min-h-[132px] flex flex-col justify-center gap-2">
        {zone.kind === 'none-accepted' ? (
          <span className="text-micro text-nomi-ink-30 leading-relaxed">{t('storyboardEditor.row.noRefAccepted')}</span>
        ) : (
          <div className="flex flex-wrap gap-2">
            {zone.namedSlots.map((slot) => {
              const missing = slot.min >= 1
              return (
                <span key={slot.kind} className="flex flex-col items-center gap-0.5">
                  <span
                    className={cn(
                      'grid place-items-center w-14 h-14 rounded-nomi-sm border border-dashed',
                      missing ? 'border-workbench-danger bg-workbench-danger-soft text-workbench-danger' : 'border-nomi-ink-20 bg-nomi-ink-05 text-nomi-ink-30',
                    )}
                  >
                    <span className="text-micro leading-tight text-center">
                      {missing ? t('storyboardEditor.row.slotRequired') : null}
                    </span>
                  </span>
                  <span className={cn('text-micro', missing ? 'text-workbench-danger' : 'text-nomi-ink-40')}>
                    {translateModelDisplayText(slot.label)}
                  </span>
                </span>
              )
            })}
            {zone.referencedAnchors.map((anchor) => (
              <span key={anchor.id} className="flex flex-col items-center gap-0.5">
                <span className="grid place-items-center w-14 h-14 rounded-nomi-sm border border-nomi-line bg-nomi-ink-10 text-title text-nomi-ink-60">
                  {(anchor.name || t('storyboardEditor.unnamed')).slice(0, 1)}
                </span>
                <span className="text-micro text-nomi-ink-40 max-w-14 truncate">{anchor.name || t('storyboardEditor.unnamed')}</span>
              </span>
            ))}
            {zone.hasArrayIntake ? (
              // C1：参考区「@」入口 = 触发提示词框 @ mention（一个实现两个入口）。
              // 不吃参考的模型（zone.kind==='none-accepted'）走上面的 noRefAccepted 分支，此处不渲染。
              // mentionSearch 缺省时说明该行禁用 @（§1.6 C4：禁用不做沟通死路，上面已有文案）。
              <span className="flex flex-col items-center gap-0.5">
                {mentionSearch ? (
                  <button
                    type="button"
                    onClick={triggerAtMention}
                    aria-label={t('storyboardEditor.row.atRefAria')}
                    title={t('storyboardEditor.row.atRefTitle')}
                    className="grid place-items-center w-14 h-14 rounded-nomi-sm border border-dashed border-nomi-ink-20 text-title text-nomi-ink-40 hover:border-nomi-accent hover:text-nomi-accent transition-colors duration-[var(--nomi-transition-fast)]"
                  >
                    @
                  </button>
                ) : (
                  <span
                    className="grid place-items-center w-14 h-14 rounded-nomi-sm border border-dashed border-nomi-ink-20 text-title text-nomi-ink-20 cursor-not-allowed"
                    title={t('storyboardEditor.row.atRefDisabledTitle')}
                    aria-hidden
                  >
                    @
                  </span>
                )}
                <span className={cn('text-micro', mentionSearch ? 'text-nomi-ink-40' : 'text-nomi-ink-20')}>
                  {t('storyboardEditor.row.refIntakeCap')}
                </span>
              </span>
            ) : null}
          </div>
        )}
      </div>

      {/* ── 提示词块：上沿胶囊（这一镜作用域）→ 提示词 → 下沿台词小字 + ▾ ── */}
      <div className="min-w-0 min-h-[132px] flex flex-col gap-1.5">
        <div className="flex items-center gap-1.5 flex-wrap">
          <NomiSelect
            ariaLabel={t('storyboardEditor.shotType')}
            leadingLabel={t('storyboardEditor.type')}
            size="xs"
            value={shotTypeValue}
            options={[
              { value: 'image', label: t('storyboardEditor.image') },
              { value: 'video', label: t('storyboardEditor.video') },
              { value: 'image-video', label: t('storyboardEditor.imageVideo') },
            ]}
            onChange={onKindChange}
          />
          {modelSelectOptions ? (
            <NomiSelect
              ariaLabel={isImageShot ? t('storyboardEditor.imageModel') : t('storyboardEditor.videoModel')}
              leadingLabel={t('storyboardEditor.model')}
              size="xs"
              triggerMaxWidth={150}
              value={shot.modelKey ? modelSelect.modelValue : ''}
              options={modelSelectOptions}
              onChange={onModelSelect}
            />
          ) : null}
          {modelSelect.providerOptions.length > 1 ? (
            <NomiSelect
              ariaLabel={t('storyboardEditor.provider')}
              leadingLabel={t('storyboardEditor.provider')}
              size="xs"
              triggerMaxWidth={110}
              value={modelSelect.providerValue}
              options={modelSelect.providerOptions}
              onChange={modelSelect.onProviderPick}
            />
          ) : null}
          {aspectControl ? (
            <NomiSelect
              ariaLabel={t('storyboardEditor.row.aspectAria')}
              leadingLabel={t('storyboardEditor.aspect')}
              size="xs"
              value={aspectValue}
              options={aspectControl.options.map((o) => ({ value: String(o.value), label: translateModelDisplayText(o.label) }))}
              onChange={(value) => onUpdate({ params: { ...(shot.params || {}), aspect_ratio: value } })}
            />
          ) : null}
          <NomiSelect
            ariaLabel={t('storyboardEditor.duration')}
            leadingLabel={t('storyboardEditor.duration')}
            size="xs"
            value={String(effectiveDuration)}
            options={durationOptions}
            onChange={(value) => onUpdate({ durationSec: Number(value) })}
          />
          {isImageShot ? (
            <span
              className="shrink-0 text-micro text-nomi-accent bg-nomi-accent-soft px-2 py-0.5 rounded-pill"
              title={t('storyboardEditor.row.stayHint')}
            >
              {t('storyboardEditor.row.stayPill')}
            </span>
          ) : null}
          <button
            type="button"
            aria-label={t('storyboardEditor.deleteShot')}
            onClick={onRemove}
            className="ml-auto shrink-0 size-7 grid place-items-center rounded-nomi-sm text-nomi-ink-30 hover:bg-nomi-ink-10 hover:text-nomi-ink-60"
          >
            <IconTrash size={14} stroke={1.6} />
          </button>
        </div>

        {shotTypeValue === 'image-video' ? (
          <>
            <div className="text-micro text-nomi-ink-40">{t('storyboardEditor.keyframePrompt')}</div>
            {/* 首帧图提示词：首帧无 @ 引用语义（不绑参考槽），保留 AutoGrowTextarea 省复杂度。 */}
            <textarea
              value={shot.keyframe?.prompt || ''}
              onChange={(event) => onUpdate({ keyframe: { ...(shot.keyframe || {}), enabled: true, prompt: event.target.value } })}
              aria-label={t('storyboardEditor.keyframePromptAria', { index: shot.index })}
              placeholder={t('storyboardEditor.keyframePromptPlaceholder')}
              rows={2}
              className="resize-none px-2 py-2 rounded-nomi-sm border border-nomi-line bg-nomi-paper text-body-sm text-nomi-ink-80 leading-normal focus:border-nomi-accent focus:outline-none"
            />
            <div className="text-micro text-nomi-ink-40">{t('storyboardEditor.videoPrompt')}</div>
          </>
        ) : null}
        {/* C1：PromptEditor（TipTap）替换 AutoGrowTextarea。
            复用 owner：PromptEditor（@[asset:url] 持久化）+ AssetMentionSuggestion（@ 下拉）。
            mentionSearch/onMentionSelect 由 StoryboardShotTable 通过 useShotMentionSource 提供；
            缺省（不吃参考的模型）= 不开 @ 面板（§1.6 C4 禁用有说明）。
            currentRefUrls 维持 chip 编号一致性（与 NodeGenerationComposer 同语义）。 */}
        <PromptSkeletonSegments
          prompt={shot.prompt}
          profile={storyboardProfile}
          ranges={shot.promptSegments}
          onChange={({ prompt, ranges }) => onUpdate({ prompt, promptSegments: ranges as PromptSegmentRange[] })}
          editorProps={{
            'aria-label': t('storyboardEditor.promptAria', { index: shot.index }),
            placeholder: isImageShot ? t('storyboardEditor.imagePromptPlaceholder') : t('storyboardEditor.videoPromptPlaceholder'),
            className: cn(
              'flex-1 px-2.5 py-2 rounded-nomi-sm border bg-nomi-paper',
              'text-body-sm leading-normal',
              '[&_.ProseMirror]:min-h-[60px]',
              promptInvalid ? 'border-workbench-danger' : 'border-nomi-line',
            ),
            mentionCandidates: currentRefUrls,
            mentionSearch,
            onMentionSelect,
            mentionUpload,
            onReady: (editor) => { editorRef.current = editor },
          }}
        />
        {dialogueWillGenerate ? (
          <div className="text-micro text-nomi-ink-40" data-storyboard-dialogue-hint="true">
            {t('storyboardEditor.row.dialogueAudioHint')}
          </div>
        ) : null}

        {/* 参考已变警示行（v5 §v3-3）：只报事实 + 给一键补跑，绝不自动跑。 */}
        {exec && exec.changedRefs.length > 0 ? (
          <div className="flex items-center gap-2 min-w-0" data-storyboard-ref-warnline={shot.index}>
            <span className="min-w-0 truncate text-micro text-workbench-danger">
              {exec.changedRefs.length > 1
                ? t('storyboardEditor.row.refChangedLineMore', { name: exec.changedRefs[0].name.trim() || t('storyboardEditor.unnamed'), count: exec.changedRefs.length })
                : t('storyboardEditor.row.refChangedLine', { name: exec.changedRefs[0].name.trim() || t('storyboardEditor.unnamed') })}
            </span>
            {onRerunFreshRefs ? (
              <button
                type="button"
                onClick={onRerunFreshRefs}
                className="shrink-0 h-6 px-2 rounded-nomi-sm border border-nomi-line bg-nomi-paper text-micro text-nomi-ink-80 hover:border-nomi-accent hover:text-nomi-accent"
              >
                {t('storyboardEditor.row.rerunFreshRefs')}
              </button>
            ) : null}
          </div>
        ) : null}

        <div
          className="flex items-center gap-2 min-w-0 cursor-pointer"
          data-storyboard-subline="true"
          onClick={() => setExpanded(true)}
        >
          {dialogueText ? (
            <span className="min-w-0 truncate text-micro text-nomi-ink-40">
              {t('storyboardEditor.row.dialogueQuiet', { text: dialogueText })}
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => setExpanded((open) => !open)}
            onClickCapture={(event) => event.stopPropagation()}
            aria-expanded={expanded}
            aria-label={expanded ? t('storyboardEditor.row.collapse') : t('storyboardEditor.row.expand')}
            className="ml-auto shrink-0 size-6 grid place-items-center rounded-nomi-sm text-nomi-ink-40 hover:bg-nomi-ink-10 hover:text-nomi-ink-60"
          >
            {expanded ? <IconChevronUp size={14} stroke={1.8} /> : <IconChevronDown size={14} stroke={1.8} />}
          </button>
        </div>
      </div>

      {expanded ? (
        <div className="col-start-2 col-span-3">
          <StoryboardShotRowExpand
            shot={shot}
            anchors={anchors}
            danglingIds={danglingIds}
            selectedModelOption={selectedModelOption}
            onUpdate={onUpdate}
            onToggleAnchor={onToggleAnchor}
            {...(onApplyParamsToAll ? { onApplyParamsToAll } : {})}
          />
        </div>
      ) : null}
    </div>
  )
}
