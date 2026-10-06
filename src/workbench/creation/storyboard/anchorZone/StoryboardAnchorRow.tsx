import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import {
  IconBox,
  IconDots,
  IconLock,
  IconLockOpen,
  IconMaximize,
  IconPalette,
  IconPhoto,
  IconRefresh,
  IconUser,
} from '../../../../vendor/tablerIcons'
import { cn } from '../../../../utils/cn'
import { NomiImage } from '../../../../design/media'
import { WorkbenchMenu, type WorkbenchMenuNode } from '../../../../design/menu'
import type { ModelOption } from '../../../../config/models'
import { AutoGrowTextarea } from '../../../ai/composer/AutoGrowTextarea'
import type { PlanAnchorKind } from '../../../generationCanvas/agent/storyboardPlan'
import { ANCHOR_KINDS, planModelSelection, type PlanAnchorPatch } from '../../../generationCanvas/agent/storyboardPlanEdits'
import { useVendorPreferenceOrder } from '../../../common/useVendorPreference'
import { findModelOptionByIdentifier } from '../../../../config/modelOptionResolvers'
import { recoverableHintKey } from '../../../generationCanvas/model/recoverableCopy'
import type { AnchorCardRuntime } from '../exec/storyboardRowStatus'
import { storyboardFailureCopy } from '../exec/storyboardFailureCopy'
import StoryboardRowShell from '../shotRow/StoryboardRowShell'
import ShotReferenceStrip from '../shotRow/ShotReferenceStrip'
import StoryboardComposerParams from '../shotRow/StoryboardComposerParams'
import { ComposerBarRow, ComposerGenerateButton } from '../shotRow/ShotComposerBar'
import { removeBinding } from '../shotRow/shotReferenceSlots'
import { containedBox, densityBox, frameMediaBox, isPortraitBox, sameAspectAsBox, visualColumnWidth } from '../shotRow/shotFrameGeometry'
import { useStoryboardRowNarrow } from '../shotRow/storyboardRowDensity'
import { resolveShotArchetypeMode } from '../shotRow/shotRowModel'

/**
 * 参考卡（锚）的**展开态**——与镜头行同一套解剖（`StoryboardRowShell`：画面格 / 提示词框）。
 *
 * 2026-10-06（用户 10-05：「复用目前的交互」「有些按钮明显空间浪费很大」）：
 *   · 参数 = 画布节点同一个底栏（模型按钮 + 参数汇总按钮 + 平铺面板）——参考卡第一次按模型拿到完整参数
 *     （比例 / 清晰度 / 张数…，反馈 #3 #11），不再只有一个「生成模型」下拉；
 *   · 「生成」只在底栏右端一处，画面格里不再放一颗重复的；
 *   · 类型（角色 / 场景 / 道具 / 风格）、出图方式（生成参考图 / 仅提示词）、删除收进行首 ⋯
 *     （与镜头行的 ⋯ 同一个位置）——原来那一整排五枚按钮常驻在每张卡上；
 *   · 参考图和镜头行同一条参考条（`ShotReferenceStrip`，画布同款 `AssetTile`），排在视觉列里；不摆说明文字。
 *
 * 文字锚（如「全片风格」）没有画面格、没有参数——它不生成图，描述本身就是产物。
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
  const filmBox = frameMediaBox(aspect)
  const portrait = isPortraitBox(filmBox)
  const orderedVendorKeys = useVendorPreferenceOrder()
  const modelOption = findModelOptionByIdentifier(modelOptions, anchor.modelKey, anchor.modelVendor, orderedVendorKeys)
  const resolved = resolveShotArchetypeMode(modelOption, anchor.modeId)
  const [menuOpen, setMenuOpen] = React.useState(false)
  const [menuAnchor, setMenuAnchor] = React.useState({ left: 0, top: 0, width: 0, height: 0 })
  const menuTriggerRef = React.useRef<HTMLButtonElement>(null)

  const menuItems: WorkbenchMenuNode[] = [
    {
      kind: 'radio',
      id: 'kind',
      value: anchor.kind,
      onValueChange: (value) => onChangeKind(value as PlanAnchorKind),
      options: ANCHOR_KINDS.map((kind) => ({
        id: `kind-${kind}`,
        value: kind,
        icon: KIND_ICON[kind],
        label: t(`storyboardEditor.anchor.kind.${kind}` as 'storyboardEditor.anchor.kind.character'),
      })),
    },
    { kind: 'separator', id: 'sep-carrier' },
    {
      kind: 'radio',
      id: 'carrier',
      value: anchor.carrier,
      onValueChange: (value) => onUpdate({ carrier: value === 'text' ? 'text' : 'visual' }),
      options: [
        { id: 'carrier-visual', value: 'visual', label: t('storyboardEditor.anchor.carrierVisual') },
        { id: 'carrier-text', value: 'text', label: t('storyboardEditor.anchor.carrierText') },
      ],
    },
    { kind: 'separator', id: 'sep-delete' },
    { kind: 'action', id: 'delete', label: t('storyboardEditor.anchor.delete'), danger: true, onSelect: onRemove },
  ]

  const grip = (
    <div className="flex flex-col items-center gap-1">
      <KindIcon size={14} stroke={1.7} className="text-nomi-ink-40" aria-label={t(`storyboardEditor.anchor.kind.${anchor.kind}` as 'storyboardEditor.anchor.kind.character')} />
      <button
        ref={menuTriggerRef}
        type="button"
        onClick={() => {
          const rect = menuTriggerRef.current?.getBoundingClientRect()
          // 交给菜单的是按钮这块矩形，不是按钮下沿那个点：下面放不下翻到上面时，点会让菜单压回按钮（2026-10-06 同一类）。
          if (rect) setMenuAnchor({ left: rect.left, top: rect.top, width: rect.width, height: rect.height })
          setMenuOpen((open) => !open)
        }}
        aria-label={t('storyboardEditor.anchor.actions')}
        aria-expanded={menuOpen}
        data-storyboard-anchor-menu-trigger={anchor.id}
        className="relative grid size-4 place-items-center rounded-nomi-sm text-nomi-ink-40 after:absolute after:-inset-1.5 after:content-[''] hover:bg-nomi-ink-10 hover:text-nomi-ink-80"
      >
        <IconDots size={13} stroke={1.8} />
      </button>
      <WorkbenchMenu
        open={menuOpen}
        onOpenChange={(next) => { if (!next) setMenuOpen(false) }}
        anchorRect={menuAnchor}
        gap={4}
        items={menuItems}
        ariaLabel={t('storyboardEditor.anchor.actions')}
      />
    </div>
  )


  // 底栏右端那一颗「生成」：只有「出图、还没出过、不在跑、没失败、不可找回」时出现（其余状态的动作在画面格上）。
  const canGenerate = runtime.visual && !runtime.resultUrl && !runtime.generating && !runtime.failed && !runtime.recoverable

  return (
    <StoryboardRowShell
      dataAttributes={{ 'data-storyboard-anchor-row': anchor.id, 'data-anchor-card': anchor.id }}
      className="border-t border-nomi-line-soft first:border-t-0"
      grip={grip}
      visualWidth={visualColumnWidth(filmBox)}
      contentStretch={!portrait}
      visual={
        <div className={portrait ? 'flex items-start gap-2' : 'flex flex-col'} data-storyboard-frame={runtime.visual ? 'anchor' : 'anchor-text'}>
          <div className="flex flex-col">
          <AnchorFace
            runtime={runtime}
            filmAspect={aspect}
            displayName={displayName}
            onGenerate={onGenerate}
            onRecover={onRecover}
            onOpenPreview={onOpenPreview}
          />
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
          {runtime.visual ? (
            <ShotReferenceStrip
              mode={resolved?.mode ?? null}
              archetype={resolved?.archetype ?? null}
              bindings={anchor.referenceBindings}
              onChangeBindings={(next) => onUpdate({ referenceBindings: next })}
              onRemove={(slotKey, index) => { const next = removeBinding(anchor.referenceBindings, slotKey, index); if (next) onUpdate({ referenceBindings: next }) }}
              onSwitchMode={runtime.resultUrl || runtime.generating ? undefined : (modeId) => onUpdate({ modeId })}
              layout={portrait
                ? { placement: 'right', columnWidth: visualColumnWidth(filmBox), frameWidth: filmBox.width, frameHeight: filmBox.height }
                : { placement: 'below', width: filmBox.width }}
            />
          ) : null}
        </div>
      }
      prompt={
        <div className="flex min-w-0 flex-1 flex-col gap-1.5" data-storyboard-prompt-block="anchor">
          <div className="flex items-center gap-1.5">
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
          </div>

          {/* 提示词框：参考图 + 描述 + 底栏，与镜头行、画布节点浮框同一副长相。 */}
          <div className="flex flex-1 flex-col rounded-nomi-sm border border-nomi-line bg-nomi-paper">
            <AutoGrowTextarea
              value={anchor.description}
              onChange={(event) => onUpdate({ description: event.target.value })}
              aria-label={t('storyboardEditor.anchor.descriptionAria')}
              placeholder={anchor.carrier === 'visual' ? t('storyboardEditor.anchor.visualPlaceholder') : t('storyboardEditor.anchor.textPlaceholder')}
              className="w-full border-0 bg-transparent px-2.5 py-2 text-body-sm leading-normal text-nomi-ink-80 outline-none"
            />
            {runtime.visual ? (
              <ComposerBarRow
                barId="anchor"
                params={(
                  <StoryboardComposerParams
                    target={anchor}
                    kind="image"
                    modelOptions={modelOptions}
                    onModelChange={(value, vendor) => onUpdate(planModelSelection(value, vendor))}
                    onModeChange={(modeId) => onUpdate({ modeId })}
                    onChange={(change) => {
                      // 锚没有整片默认那一段：比例就写进它自己的参数（语义槽 aspect_ratio，落地时按模式翻成真实键）。
                      const key = change.kind === 'param' ? change.key : 'aspect_ratio'
                      onUpdate({ params: { ...(anchor.params ?? {}), [key]: change.value } })
                    }}
                  />
                )}
                action={canGenerate ? (
                  <ComposerGenerateButton onGenerate={onGenerate} ariaLabel={t('storyboardEditor.anchor.generateAria', { name: displayName })} />
                ) : null}
              />
            ) : null}
          </div>
        </div>
      }
    />
  )
}

/**
 * 参考卡的预览框：与镜头行同一只表级框（整片画幅定、窄档按 176/240 缩），参考卡按它**自己的**画幅
 * （角色 3:4、场景 16:9…）完整放进框里，浅底补空，左下角标它的画幅。要在网格里面渲染才读得到档位。
 */
function AnchorFace({
  runtime, filmAspect, displayName, onGenerate, onRecover, onOpenPreview,
}: {
  runtime: AnchorCardRuntime
  filmAspect: string
  displayName: string
  onGenerate: () => void
  onRecover?: (() => void) | undefined
  onOpenPreview?: (() => void) | undefined
}): JSX.Element {
  const { t } = useTranslation()
  const narrow = useStoryboardRowNarrow()
  const box = densityBox(frameMediaBox(filmAspect), narrow)
  const raw = runtime.anchor.params?.aspect_ratio
  const anchorAspect = typeof raw === 'string' ? raw : null
  const ownAspect = Boolean(anchorAspect) && !sameAspectAsBox(box, anchorAspect)
  const aspectTag = ownAspect ? (
    <span className="absolute bottom-1 left-1 z-[3] rounded-nomi-sm bg-nomi-overlay-chip px-1 text-micro tabular-nums text-nomi-media-ink" data-storyboard-aspect-tag={anchorAspect ?? ''}>
      {anchorAspect}
    </span>
  ) : null
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
          data-storyboard-visual-box="true"
        >
          <NomiImage src={runtime.resultUrl} alt={t('storyboardEditor.anchor.resultAlt', { name: displayName })} className="absolute inset-0 h-full w-full object-contain" />
          {aspectTag}
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
          {/* scrim 只压暗底图；字与进度条在 overlay-chip-strong 胶囊里托住（2026-09-11「生成中」看不清）。 */}
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
      const failure = storyboardFailureCopy(runtime.errorMessage)
      return (
        <div
          className="relative flex flex-col items-center justify-center gap-1.5 rounded-nomi border border-workbench-danger bg-workbench-danger-soft p-2 text-center"
          style={style}
          data-anchor-face="failed"
        >
          <span className="line-clamp-3 text-micro leading-tight text-workbench-danger" title={failure.hint} data-anchor-failure-reason="true">
            {failure.reason}
          </span>
          {failure.canRetry ? <button
            type="button"
            onClick={onGenerate}
            title={t('storyboardEditor.frame.retryHint')}
            aria-label={t('storyboardEditor.frame.retryHint')}
            className="inline-flex h-6 items-center gap-0.5 rounded-nomi-sm border border-workbench-danger bg-nomi-paper px-2 text-micro text-workbench-danger"
          >
            <IconRefresh size={11} stroke={1.8} />
            {t('storyboardEditor.frame.retry')}
          </button> : null}
        </div>
      )
    }
    // 可找回：中性纸底 + **免费**续查。这张卡已经付过钱了，落回底栏那枚「生成」就是重复付费。
    if (runtime.recoverable) {
      return (
        <div
          className="relative flex flex-col items-center justify-center gap-1.5 rounded-nomi border border-nomi-line bg-nomi-paper p-2 text-center"
          style={style}
          title={t(recoverableHintKey(runtime.node))}
          data-anchor-face="recoverable"
        >
          <span className="line-clamp-2 text-micro leading-tight text-nomi-ink-60" title={runtime.errorMessage ?? undefined}>
            {t('storyboardEditor.frame.recoverable')}
          </span>
          {onRecover ? (
            <button
              type="button"
              onClick={onRecover}
              title={t(recoverableHintKey(runtime.node))}
              className="inline-flex h-6 items-center gap-0.5 rounded-nomi-sm border border-nomi-line bg-nomi-paper px-2 text-micro text-nomi-ink-80 hover:border-nomi-accent hover:text-nomi-accent"
            >
              <IconRefresh size={11} stroke={1.8} />
              {t('generationCommon.production.runAction.retry-retrieval')}
            </button>
          ) : null}
        </div>
      )
    }
    return (
      <div
        className={cn('relative grid place-items-center rounded-nomi bg-nomi-ink-05', !ownAspect && 'border border-dashed border-nomi-ink-20')}
        style={style}
        data-anchor-face="empty"
        data-storyboard-visual-box="true"
      >
        {ownAspect ? <span className="rounded-nomi-sm border border-dashed border-nomi-ink-20" style={containedBox(box, anchorAspect)} aria-hidden /> : null}
        {aspectTag}
      </div>
    )
}
