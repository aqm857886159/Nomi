import React from 'react'
import { useTranslation } from 'react-i18next'
import {
  IconBox,
  IconCamera,
  IconLetterCase,
  IconLock,
  IconLockOpen,
  IconMaximize,
  IconPalette,
  IconPhoto,
  IconRefresh,
  IconTrash,
  IconUser,
} from '../../../../vendor/tablerIcons'
import { cn } from '../../../../utils/cn'
import { NomiImage } from '../../../../design/media'
import { NomiSelect } from '../../../../design'
import type { ModelOption } from '../../../../config/models'
import { AutoGrowTextarea } from '../../../ai/composer/AutoGrowTextarea'
import type { PlanAnchorKind } from '../../../generationCanvas/agent/storyboardPlan'
import { ANCHOR_KINDS, planModelSelection, type PlanAnchorPatch } from '../../../generationCanvas/agent/storyboardPlanEdits'
import { modelVisibilityFooterAction, useDedupedModelSelect } from '../../../common/useDedupedModelSelect'
import { useVendorPreferenceOrder } from '../../../common/useVendorPreference'
import { findModelOptionByIdentifier } from '../../../../config/modelOptionResolvers'
import type { AnchorCardRuntime } from '../exec/storyboardRowStatus'
import StoryboardRowShell from '../shotRow/StoryboardRowShell'
import { referenceColumnWidthOf, useStoryboardRowNarrow } from '../shotRow/storyboardRowDensity'
import ShotReferenceZone from '../shotRow/ShotReferenceZone'
import { frameMediaBox, FRAME_COLUMN_WIDTH } from '../shotRow/shotFrameGeometry'
import { missingRequiredSlotsOf, resolveShotArchetypeMode } from '../shotRow/shotRowModel'

/**
 * 锚区的**展开态**（合同 v6 §2.2）——与镜头行**完全同一套解剖**：
 * 画面格 / 参考列 / 提示词框 + 底栏，共用 `StoryboardRowShell` 那一份网格。
 *
 * v5 里锚卡（108×144 图卡 + ✎ 编辑面板）与镜头行是两个各画各的组件，同一个几何写了两遍；
 * v6 统一成一套之后，改列宽/间距只有一个 owner。
 *
 * 文字锚（如"全片风格"）**没有画面格**——它不生成图，描述本身就是产物，只写进每一镜的提示词。
 * 这是唯一没有生成态的锚类型，画面格那一列因此只放一枚「仅文字」标签，不放空的虚线框
 * （空框会读成"这里该有张图但还没生成"，那是另一回事）。
 */

const KIND_ICON: Record<PlanAnchorKind, typeof IconUser> = {
  character: IconUser,
  scene: IconPhoto,
  prop: IconBox,
  style: IconPalette,
}

type Props = {
  runtime: AnchorCardRuntime
  /** 整片默认画幅——锚的画面格与镜头行用同一套几何。 */
  aspect: string
  modelOptions?: ModelOption[]
  nameInvalid?: boolean
  onUpdate: (patch: PlanAnchorPatch) => void
  onChangeKind: (kind: PlanAnchorKind) => void
  onRemove: () => void
  onGenerate: () => void
  onRegenerate: () => void
  /** 可找回态的**免费**续查（`recoverNodeResult`）；缺省时那枚按钮不出现，绝不退回付费的「重试」。 */
  onRecover?: (() => void) | undefined
  onToggleLock: () => void
  onOpenPreview?: (() => void) | undefined
  onFilterByAnchor?: (() => void) | undefined
}

function ActButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="grid size-[26px] place-items-center rounded-nomi-sm text-nomi-ink-60 hover:bg-nomi-ink-10 hover:text-nomi-ink-80"
    >
      {children}
    </button>
  )
}

/**
 * 纯文字锚没有参考槽，但它仍要**占住参考列**——否则同一张表里两种行的提示词列起点对不齐。
 * 列宽跟着行的密度档走（窄档 65px），这一格也就跟着收；单独一层只是为了在组件里读到 context。
 */
function AnchorTextRefZone({ minHeight }: { minHeight: number }): JSX.Element {
  const { t } = useTranslation()
  const narrow = useStoryboardRowNarrow()
  const text = t('storyboardEditor.anchor.textNoRefs')
  return (
    <div className="flex shrink-0 items-start" style={{ width: referenceColumnWidthOf(narrow), minHeight }} data-storyboard-refzone="anchor-text">
      <span className={cn('text-micro leading-relaxed text-nomi-ink-30', narrow && 'line-clamp-3')} title={text}>{text}</span>
    </div>
  )
}

export default function StoryboardAnchorRow({
  runtime,
  aspect,
  modelOptions = [],
  nameInvalid,
  onUpdate,
  onChangeKind,
  onRemove,
  onGenerate,
  onRegenerate,
  onRecover,
  onToggleLock,
  onOpenPreview,
  onFilterByAnchor,
}: Props): JSX.Element {
  const { t } = useTranslation()
  const anchor = runtime.anchor
  const displayName = anchor.name.trim() || t('storyboardEditor.unnamed')
  const KindIcon = KIND_ICON[anchor.kind]
  const box = frameMediaBox(aspect)
  // 锚的模型框与镜头卡、画布节点**同一个选择 owner**（useDedupedModelSelect）：同名模型按供应商区分，
  // (modelKey, modelVendor) 成对读、成对写。这里以前是一只原生下拉，option value 是裸 modelKey——
  // 两家同名就是两个同值选项，选哪家都只写 modelKey（2026-09-21 分镜三处复现之一）。
  const onAnchorModelChange = React.useCallback(
    (value: string, vendor?: string) => onUpdate(planModelSelection(value, vendor)),
    [onUpdate],
  )
  const modelSelect = useDedupedModelSelect(modelOptions, anchor.modelKey ?? '', onAnchorModelChange, anchor.modelVendor)
  const orderedVendorKeys = useVendorPreferenceOrder()
  const modelOption = findModelOptionByIdentifier(modelOptions, anchor.modelKey, anchor.modelVendor, orderedVendorKeys)
  const resolvedArchetype = resolveShotArchetypeMode(modelOption, anchor.modeId)
  const resolvedMode = resolvedArchetype?.mode ?? null

  const face = ((): JSX.Element => {
    if (!runtime.visual) {
      return (
        <span className="inline-flex h-6 items-center rounded-pill bg-nomi-ink-10 px-2 text-micro text-nomi-ink-60">
          {t('storyboardEditor.anchor.text')}
        </span>
      )
    }
    const style = { width: box.width, height: box.height }
    if (runtime.resultUrl && !runtime.generating && !runtime.failed) {
      return (
        <div
          className="relative overflow-hidden rounded-nomi border border-nomi-line bg-nomi-ink-05"
          style={style}
          onDoubleClick={onOpenPreview}
          data-anchor-face={runtime.locked ? 'locked' : 'done'}
        >
          <NomiImage src={runtime.resultUrl} alt={t('storyboardEditor.anchor.resultAlt', { name: displayName })} className="absolute inset-0 h-full w-full object-cover" />
          {runtime.locked ? (
            <span className="absolute right-1 top-1 z-[2] inline-flex items-center gap-0.5 rounded-pill bg-nomi-overlay-chip-strong px-1 py-0.5 text-micro text-nomi-media-ink">
              <IconLock size={10} stroke={2} aria-label={t('storyboardEditor.frame.lockedBadge')} />
            </span>
          ) : null}
        </div>
      )
    }
    if (runtime.generating) {
      return (
        <div className="relative overflow-hidden rounded-nomi border border-nomi-line bg-nomi-ink-05" style={style} data-anchor-face="generating">
          {/* scrim 只负责压暗底图，**不负责托住字**：它只有 0.42 alpha，白字压在亮底图上实测 1.8:1
              （2026-09-11 用户说「生成中」看不清）。字与进度条搬进 overlay-chip-strong 那枚胶囊——
              那个 token 存在的理由就是「在任意亮度的媒体上托住白字」，最坏情况（纯白底图）4.5:1。 */}
          <div className="absolute inset-0 flex items-center justify-center bg-nomi-scrim p-2">
            <span
              className="inline-flex flex-col items-center gap-1.5 rounded-nomi-sm bg-nomi-overlay-chip-strong px-2 py-1 text-center text-nomi-media-ink"
              data-anchor-generating-chip="true"
            >
              <span className="block h-1 w-[64px] overflow-hidden rounded-pill bg-nomi-media-ink/25">
                <span className="block h-full bg-nomi-media-ink transition-[width]" style={{ width: `${runtime.progressPercent ?? 12}%` }} />
              </span>
              <span className="text-micro leading-tight">
                {runtime.progressPercent !== null
                  ? t('storyboardEditor.frame.generatingPercent', { percent: Math.round(runtime.progressPercent) })
                  : t('storyboardEditor.frame.generating')}
              </span>
            </span>
          </div>
        </div>
      )
    }
    if (runtime.failed) {
      return (
        <div
          className="relative flex flex-col items-center justify-center gap-1.5 rounded-nomi border border-workbench-danger bg-workbench-danger-soft p-2 text-center"
          style={style}
          data-anchor-face="failed"
        >
          <span className="line-clamp-3 text-micro leading-tight text-workbench-danger" title={runtime.errorMessage ?? undefined}>
            {t('storyboardEditor.frame.failed')}
          </span>
          <button
            type="button"
            onClick={onGenerate}
            title={t('storyboardEditor.frame.retryHint')}
            aria-label={t('storyboardEditor.frame.retryHint')}
            className="inline-flex h-6 items-center gap-0.5 rounded-nomi-sm border border-workbench-danger bg-nomi-paper px-2 text-micro text-workbench-danger"
          >
            <IconRefresh size={11} stroke={1.8} />
            {t('storyboardEditor.frame.retry')}
          </button>
        </div>
      )
    }
    // 可找回：中性纸底 + **免费**续查。这张卡已经付过钱了，落回下面那枚「生成」就是重复付费。
    if (runtime.recoverable) {
      return (
        <div
          className="relative flex flex-col items-center justify-center gap-1.5 rounded-nomi border border-nomi-line bg-nomi-paper p-2 text-center"
          style={style}
          title={t('storyboardEditor.frame.recoverableHint')}
          data-anchor-face="recoverable"
        >
          <span className="line-clamp-2 text-micro leading-tight text-nomi-ink-60" title={runtime.errorMessage ?? undefined}>
            {t('storyboardEditor.frame.recoverable')}
          </span>
          {onRecover ? (
            <button
              type="button"
              onClick={onRecover}
              title={t('storyboardEditor.frame.recoverableHint')}
              className="inline-flex h-6 items-center gap-0.5 rounded-nomi-sm border border-nomi-line bg-nomi-paper px-2 text-micro text-nomi-ink-80 hover:border-nomi-accent hover:text-nomi-accent"
            >
              <IconRefresh size={11} stroke={1.8} />
              {t('storyboardEditor.frame.recoverableRefetch')}
            </button>
          ) : null}
        </div>
      )
    }
    return (
      <div
        className="relative flex flex-col items-center justify-center gap-1.5 rounded-nomi border border-dashed border-nomi-ink-20 bg-nomi-ink-05 p-2 text-center"
        style={style}
        data-anchor-face="empty"
      >
        <button
          type="button"
          onClick={onGenerate}
          aria-label={t('storyboardEditor.anchor.generateAria', { name: displayName })}
          className="h-6 rounded-nomi-sm bg-nomi-ink px-2.5 text-micro font-medium text-nomi-paper hover:opacity-90 active:opacity-80"
        >
          {t('storyboardEditor.frame.generate')}
        </button>
        {!anchor.description.trim() ? <span className="text-micro text-nomi-ink-30">{t('storyboardEditor.anchor.writeDescFirst')}</span> : null}
      </div>
    )
  })()

  return (
    <StoryboardRowShell
      dataAttributes={{ 'data-storyboard-anchor-row': anchor.id, 'data-anchor-card': anchor.id }}
      className="border-t border-nomi-line-soft first:border-t-0"
      grip={<KindIcon size={14} stroke={1.7} className="text-nomi-ink-40" aria-label={t(`storyboardEditor.anchor.kind.${anchor.kind}` as 'storyboardEditor.anchor.kind.character')} />}
      frame={
        <div style={{ width: FRAME_COLUMN_WIDTH }} data-storyboard-frame={runtime.visual ? 'anchor' : 'anchor-text'}>
          {face}
          {runtime.visual && runtime.resultUrl ? (
            <div className="mt-1 flex items-center gap-0.5" data-storyboard-actbar="anchor">
              {runtime.locked ? (
                <ActButton label={t('storyboardEditor.frame.unlock')} onClick={onToggleLock}><IconLockOpen size={14} stroke={1.8} /></ActButton>
              ) : (
                <>
                  <ActButton label={t('storyboardEditor.frame.regenerate')} onClick={onRegenerate}><IconRefresh size={14} stroke={1.8} /></ActButton>
                  <ActButton label={t('storyboardEditor.anchor.lockTitle')} onClick={onToggleLock}><IconLock size={14} stroke={1.8} /></ActButton>
                </>
              )}
              {onOpenPreview ? <ActButton label={t('storyboardEditor.frame.zoom')} onClick={onOpenPreview}><IconMaximize size={14} stroke={1.8} /></ActButton> : null}
            </div>
          ) : null}
        </div>
      }
      references={
        runtime.visual ? (
          <ShotReferenceZone
            mode={resolvedMode}
            archetype={resolvedArchetype?.archetype ?? null}
            bindings={anchor.referenceBindings}
            onChangeBindings={(next) => onUpdate({ referenceBindings: next })}
            // 锚行没有计划首帧、也不引用别的锚：缺不缺只看它自己的绑定——同一个 owner，零额外来源。
            missingSlots={missingRequiredSlotsOf(resolvedMode, anchor.referenceBindings, { plannedFirstFrame: null, visualAnchorCount: 0 })}
            anchors={[]}
            mentionEnabled={false}
          />
        ) : (
          <AnchorTextRefZone minHeight={box.height} />
        )
      }
      prompt={
        <div className="flex min-w-0 flex-col gap-1.5" data-storyboard-prompt-block="anchor">
          <div className="flex flex-wrap items-center gap-1.5">
            <input
              value={anchor.name}
              onChange={(event) => onUpdate({ name: event.target.value })}
              placeholder={t('storyboardEditor.anchor.namePlaceholder')}
              aria-label={t('storyboardEditor.anchor.nameAria')}
              className={cn(
                'h-7 min-w-0 flex-1 rounded-nomi-sm border bg-nomi-paper px-2 text-body-sm font-medium text-nomi-ink outline-none focus:border-nomi-accent',
                nameInvalid ? 'border-workbench-danger' : 'border-nomi-line',
              )}
            />
            {runtime.referencedByCount > 0 && onFilterByAnchor ? (
              <button
                type="button"
                onClick={onFilterByAnchor}
                data-anchor-stat={anchor.id}
                className="shrink-0 text-micro text-nomi-ink-40 hover:text-nomi-accent hover:underline"
              >
                {t('storyboardEditor.anchor.stat.referenced', { count: runtime.referencedByCount })}
              </button>
            ) : null}
            <button
              type="button"
              aria-label={t('storyboardEditor.anchor.delete')}
              onClick={onRemove}
              className="grid size-6 shrink-0 place-items-center rounded-nomi-sm text-nomi-ink-30 hover:bg-nomi-ink-10 hover:text-workbench-danger"
            >
              <IconTrash size={13} stroke={1.6} />
            </button>
          </div>

          {runtime.visual && runtime.referencedByCount > runtime.consumedByShotCount ? (
            <p className="text-micro text-nomi-warning" data-anchor-consumption-warning={anchor.id}>
              {t('storyboardEditor.anchorPolicy.countWarning', { total: runtime.referencedByCount, ignored: runtime.referencedByCount - runtime.consumedByShotCount })}
            </p>
          ) : null}

          <AutoGrowTextarea
            value={anchor.description}
            onChange={(event) => onUpdate({ description: event.target.value })}
            aria-label={t('storyboardEditor.anchor.descriptionAria')}
            placeholder={anchor.carrier === 'visual' ? t('storyboardEditor.anchor.visualPlaceholder') : t('storyboardEditor.anchor.textPlaceholder')}
            className="rounded-nomi-sm border border-nomi-line bg-nomi-paper px-2 py-2 text-body-sm leading-normal text-nomi-ink-60 focus:border-nomi-accent"
          />

          {/* 底栏：与镜头行同一位置、同一手感——锚的「模型 / 类型 / 载体」都住这里。 */}
          <div className="flex flex-wrap items-center gap-1.5 border-t border-nomi-line-soft pt-1.5" data-storyboard-composer-bar="anchor">
            {ANCHOR_KINDS.map((kind) => {
              const Icon = KIND_ICON[kind]
              const active = kind === anchor.kind
              return (
                <button
                  key={kind}
                  type="button"
                  onClick={() => onChangeKind(kind)}
                  className={cn(
                    'inline-flex h-6 items-center gap-1 rounded-pill px-1.5 text-micro',
                    active ? 'bg-nomi-accent-soft text-nomi-accent' : 'border border-nomi-line text-nomi-ink-60 hover:border-nomi-ink-20 hover:text-nomi-ink-80',
                  )}
                >
                  <Icon size={11} stroke={1.8} />
                  {t(`storyboardEditor.anchor.kind.${kind}` as 'storyboardEditor.anchor.kind.character')}
                </button>
              )
            })}
            <button
              type="button"
              onClick={() => onUpdate({ carrier: anchor.carrier === 'visual' ? 'text' : 'visual' })}
              title={anchor.carrier === 'visual' ? t('storyboardEditor.anchor.switchToText') : t('storyboardEditor.anchor.switchToVisual')}
              className={cn(
                'inline-flex h-6 items-center gap-1 rounded-pill px-1.5 text-micro',
                anchor.carrier === 'visual' ? 'bg-nomi-accent-soft text-nomi-accent' : 'border border-nomi-line text-nomi-ink-60 hover:text-nomi-ink-80',
              )}
            >
              {anchor.carrier === 'visual' ? <IconCamera size={12} stroke={1.7} /> : <IconLetterCase size={12} stroke={1.7} />}
              {anchor.carrier === 'visual' ? t('storyboardEditor.anchor.visual') : t('storyboardEditor.anchor.text')}
            </button>
            {anchor.carrier === 'visual' ? (
              modelOptions.length > 0 ? (
                <>
                  <NomiSelect
                    ariaLabel={t('storyboardEditor.anchor.modelAria')}
                    leadingLabel={t('storyboardEditor.anchor.modelLabel')}
                    size="xs"
                    triggerMaxWidth={150}
                    value={anchor.modelKey ? modelSelect.modelValue : ''}
                    options={[{ value: '', label: t('storyboardEditor.defaultModel') }, ...modelSelect.modelOptions]}
                    onChange={(id) => (id ? modelSelect.onModelPick(id) : onAnchorModelChange(''))}
                    onChipChange={modelSelect.onModelProviderPick}
                    footerAction={modelVisibilityFooterAction()}
                    hiddenNote={modelSelect.hiddenNote}
                  />
                  {modelSelect.providerOptions.length > 1 ? (
                    <NomiSelect
                      ariaLabel={t('storyboardEditor.provider')}
                      size="xs"
                      triggerMaxWidth={110}
                      value={modelSelect.providerValue}
                      options={modelSelect.providerOptions}
                      onChange={modelSelect.onProviderPick}
                    />
                  ) : null}
                </>
              ) : (
                <span className="text-micro text-nomi-warning" data-anchor-model-empty="true">
                  {t('storyboardEditor.anchor.noImageModel')}
                </span>
              )
            ) : null}
          </div>
        </div>
      }
    />
  )
}
