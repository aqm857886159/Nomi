import React from 'react'
import { useTranslation } from 'react-i18next'
import {
  IconBox,
  IconCamera,
  IconChevronUp,
  IconLetterCase,
  IconLock,
  IconLockOpen,
  IconPalette,
  IconPhoto,
  IconRefresh,
  IconTrash,
  IconUser,
} from '@tabler/icons-react'
import { cn } from '../../../utils/cn'
import { NomiImage } from '../../../design/media'
import { AutoGrowTextarea } from '../../ai/composer/AutoGrowTextarea'
import type { PlanAnchor, PlanAnchorKind } from '../../generationCanvas/agent/storyboardPlan'
import { ANCHOR_KINDS } from '../../generationCanvas/agent/storyboardPlanEdits'
import type { AnchorCardRuntime } from './exec/storyboardRowStatus'
import StoryboardHoverPreview from './StoryboardHoverPreview'

/**
 * 参考卡（v5 B3 图卡）：新增就地生成后**图成为审阅对象，必须大到能审**（拍板记录 §3.9）。
 * 卡面 108×144（样张 .acard/.aimg）按锚节点投影分态：
 * - 视觉锚：空（虚线 + 生成按钮 + 「先写好描述」）/ 生成中（进度覆盖）/ 失败（红 + 重试）/
 *   已生成（图 + 悬停 重生成·锁定，「满意就锁定」）/ 已锁定（🔒 徽章 + 悬停解锁）；
 * - 文本锚（仅提示词）：文字卡显示描述预览，不生成图（astat=不生成图）。
 * astat 行：被 N 镜引用 / N 镜在等它 / 未生成 / 未锁定——与行状态同一份 derive（F2）。
 * 编辑（保 v4 纯逻辑）：点 ✎ 卡片就地变宽 → 名字/类型/载体/描述/删除一个面收齐；收起回图卡。
 */

const KIND_ICON: Record<PlanAnchorKind, typeof IconUser> = {
  character: IconUser,
  scene: IconPhoto,
  prop: IconBox,
  style: IconPalette,
}

type Props = {
  anchor: PlanAnchor
  /** 执行态投影（deriveAnchorCardRuntimes；与行/组头/footer 同一份）。 */
  runtime: AnchorCardRuntime
  onUpdate: (patch: Partial<PlanAnchor>) => void
  onChangeKind: (kind: PlanAnchorKind) => void
  onRemove: () => void
  /** 就地生成（未生成/失败重试）——与镜行同一执行通路。 */
  onGenerate: () => void
  /** 已生成悬停 ↻：写回描述编辑 + 原地重出（引用镜经「参考已变」提示补跑，绝不自动跑）。 */
  onRegenerate: () => void
  /** 🔒/🔓 定妆锁开关（anchorBibleKeys 同一把锁）。 */
  onToggleLock: () => void
  onFilterByAnchor?: () => void
  onOpenPreview?: () => void
  /** 视觉锚缺名字 → 校验高亮（名字是落画布的卡片标题）。 */
  nameInvalid?: boolean
}

/** 卡面动作钮（浮条同款 32×26 深底白字）。 */
function FaceButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="w-8 h-[26px] grid place-items-center rounded-nomi-sm bg-nomi-overlay-chip-strong text-nomi-paper text-micro hover:bg-nomi-ink"
    >
      {children}
    </button>
  )
}

export default function StoryboardAnchorCard({ anchor, runtime, onUpdate, onChangeKind, onRemove, onGenerate, onRegenerate, onToggleLock, onFilterByAnchor, onOpenPreview, nameInvalid }: Props): JSX.Element {
  const { t } = useTranslation()
  // 空描述（新加的锚）默认展开好直接写；AI 填好的默认收起成图卡。
  const [editing, setEditing] = React.useState(() => !anchor.description.trim())
  const desc = anchor.description.trim()
  const KindIcon = KIND_ICON[anchor.kind]
  const displayName = anchor.name.trim() || t('storyboardEditor.unnamed')

  // astat（样张）：锁定→被 N 镜引用；生成中→N 镜在等它；未生成→未生成；已生成未锁→未锁定。
  const statLine = (() => {
    if (!runtime.visual) return t('storyboardEditor.anchor.stat.textOnly')
    if (runtime.locked) return t('storyboardEditor.anchor.stat.referenced', { count: runtime.referencedByCount })
    if (runtime.generating || runtime.waitingShotCount > 0) {
      return runtime.waitingShotCount > 0
        ? t('storyboardEditor.anchor.stat.waitedBy', { count: runtime.waitingShotCount })
        : t('storyboardEditor.frame.generating')
    }
    if (runtime.failed) return t('storyboardEditor.frame.failed')
    if (runtime.resultUrl) return t('storyboardEditor.anchor.stat.unlockedHint')
    return t('storyboardEditor.anchor.stat.ungenerated')
  })()

  const face = runtime.visual ? (
    runtime.resultUrl && !runtime.generating && !runtime.failed ? (
      // 已生成/已锁定：图铺满 + 悬停 重生成·锁（锁定态只给解锁——锁了不重跑）。
      <div className="group/acard relative w-[108px] h-[144px] rounded-nomi overflow-hidden border border-nomi-line bg-nomi-ink-05" data-anchor-face={runtime.locked ? 'locked' : 'done'}>
        <NomiImage src={runtime.resultUrl} alt={t('storyboardEditor.anchor.resultAlt', { name: displayName })} className="absolute inset-0 w-full h-full object-cover" />
        {runtime.locked ? (
          <span className="absolute top-1.5 right-1.5 z-[2] px-1.5 py-0.5 rounded-pill bg-nomi-overlay-chip-strong text-nomi-paper text-micro inline-flex items-center gap-0.5">
            <IconLock size={10} stroke={2} />
            {t('storyboardEditor.frame.lockedBadge')}
          </span>
        ) : null}
        <div className="absolute inset-0 z-[3] hidden group-hover/acard:grid place-items-center bg-nomi-scrim">
          <div className="flex items-center gap-1">
            {runtime.locked ? (
              <FaceButton label={t('storyboardEditor.frame.unlock')} onClick={onToggleLock}><IconLockOpen size={13} stroke={1.8} /></FaceButton>
            ) : (
              <>
                <FaceButton label={t('storyboardEditor.frame.regenerate')} onClick={onRegenerate}><IconRefresh size={13} stroke={1.8} /></FaceButton>
                <FaceButton label={t('storyboardEditor.anchor.lockTitle')} onClick={onToggleLock}><IconLock size={13} stroke={1.8} /></FaceButton>
              </>
            )}
          </div>
        </div>
      </div>
    ) : runtime.generating ? (
      <div className="relative w-[108px] h-[144px] rounded-nomi overflow-hidden border border-nomi-line bg-nomi-ink-05" data-anchor-face="generating">
        {runtime.resultUrl ? <NomiImage src={runtime.resultUrl} alt="" className="absolute inset-0 w-full h-full object-cover opacity-50" /> : null}
        <div className="absolute inset-0 z-[1] flex flex-col items-center justify-center gap-1.5 bg-nomi-scrim text-nomi-paper p-2 text-center">
          <div className="w-[64px] h-1 rounded-pill bg-nomi-paper/25 overflow-hidden">
            <div className="h-full bg-nomi-paper transition-[width]" style={{ width: `${runtime.progressPercent ?? 12}%` }} />
          </div>
          <span className="text-micro leading-tight">
            {runtime.progressPercent !== null
              ? t('storyboardEditor.frame.generatingPercent', { percent: Math.round(runtime.progressPercent) })
              : t('storyboardEditor.frame.generating')}
          </span>
        </div>
      </div>
    ) : runtime.failed ? (
      <div className="relative w-[108px] h-[144px] rounded-nomi border border-workbench-danger bg-workbench-danger-soft flex flex-col items-center justify-center gap-1.5 p-2 text-center" data-anchor-face="failed">
        <span className="text-micro text-workbench-danger leading-tight line-clamp-3" title={runtime.errorMessage ?? undefined}>
          {t('storyboardEditor.frame.failed')}
        </span>
        <button
          type="button"
          onClick={onGenerate}
          className="h-6 px-2 rounded-nomi-sm border border-workbench-danger bg-nomi-paper text-micro text-workbench-danger inline-flex items-center gap-0.5"
        >
          <IconRefresh size={11} stroke={1.8} />
          {t('storyboardEditor.frame.retry')}
        </button>
      </div>
    ) : (
      // 未生成：虚线空面 + 生成按钮（描述空时提示先写描述——出的卡就是按描述画的）。
      <div className="relative w-[108px] h-[144px] rounded-nomi border border-dashed border-nomi-ink-20 bg-nomi-ink-05 flex flex-col items-center justify-center gap-1.5 p-2 text-center" data-anchor-face="empty">
        <button
          type="button"
          onClick={onGenerate}
          aria-label={t('storyboardEditor.anchor.generateAria', { name: displayName })}
          className="h-6 px-2.5 rounded-nomi-sm bg-nomi-ink text-nomi-paper text-micro font-medium hover:opacity-90 active:opacity-80"
        >
          {t('storyboardEditor.frame.generate')}
        </button>
        {!desc ? <span className="text-micro text-nomi-ink-30">{t('storyboardEditor.anchor.writeDescFirst')}</span> : null}
      </div>
    )
  ) : (
    // 文本锚（仅提示词）：文字卡——描述就是产物本体，点卡进编辑。
    <button
      type="button"
      onClick={() => setEditing(true)}
      className="relative w-[108px] h-[144px] rounded-nomi border border-nomi-line bg-nomi-ink-05 p-2 text-left flex flex-col gap-1 overflow-hidden hover:border-nomi-ink-20"
      data-anchor-face="text"
    >
      <span className="shrink-0 self-start px-1.5 py-0.5 rounded-pill bg-nomi-ink-10 text-micro text-nomi-ink-60">{t('storyboardEditor.anchor.text')}</span>
      <span className="text-micro text-nomi-ink-60 leading-normal line-clamp-6">{desc || t('storyboardEditor.anchor.addDescription')}</span>
    </button>
  )

  return (
    <div
      className={cn('flex gap-3 items-start', editing ? 'w-[288px]' : 'w-[108px]')}
      data-anchor-card={anchor.id}
    >
      <div className="shrink-0 flex flex-col gap-1 w-[108px]">
        {runtime.resultUrl && onOpenPreview ? (
          <StoryboardHoverPreview url={runtime.resultUrl} alt={t('storyboardEditor.anchor.resultAlt', { name: displayName })}>
            <div onDoubleClick={onOpenPreview}>{face}</div>
          </StoryboardHoverPreview>
        ) : face}
        <div className="flex items-center gap-1 min-w-0">
          <KindIcon size={11} stroke={1.8} className="shrink-0 text-nomi-ink-40" aria-label={t(`storyboardEditor.anchor.kind.${anchor.kind}` as 'storyboardEditor.anchor.kind.character')} />
          <span className={cn('min-w-0 truncate text-caption font-medium', nameInvalid ? 'text-workbench-danger' : 'text-nomi-ink-80')}>
            {displayName}
          </span>
          <button
            type="button"
            onClick={() => setEditing((open) => !open)}
            aria-expanded={editing}
            aria-label={t('storyboardEditor.anchor.editDescription')}
            className="ml-auto shrink-0 size-5 grid place-items-center rounded-nomi-sm text-nomi-ink-40 hover:bg-nomi-ink-10 hover:text-nomi-ink-60"
          >
            {editing ? <IconChevronUp size={12} stroke={1.8} /> : <span className="text-micro leading-none" aria-hidden>✎</span>}
          </button>
        </div>
        {runtime.referencedByCount > 0 && onFilterByAnchor ? (
          <button
            type="button"
            onClick={onFilterByAnchor}
            className={cn('text-left text-micro truncate hover:text-nomi-accent hover:underline', runtime.failed ? 'text-workbench-danger' : 'text-nomi-ink-40')}
            data-anchor-stat={anchor.id}
          >
            {statLine}
          </button>
        ) : (
          <span className={cn('text-micro truncate', runtime.failed ? 'text-workbench-danger' : 'text-nomi-ink-40')} data-anchor-stat={anchor.id}>
            {statLine}
          </span>
        )}
      </div>

      {editing ? (
        <div className="flex-1 min-w-0 flex flex-col gap-1.5 pt-0.5">
          <input
            value={anchor.name}
            onChange={(event) => onUpdate({ name: event.target.value })}
            placeholder={t('storyboardEditor.anchor.namePlaceholder')}
            aria-label={t('storyboardEditor.anchor.nameAria')}
            className={cn(
              'w-full h-7 px-2 rounded-nomi-sm border bg-nomi-paper',
              'text-body-sm font-medium text-nomi-ink outline-none focus:border-nomi-accent',
              nameInvalid ? 'border-workbench-danger' : 'border-nomi-line',
            )}
          />
          <div className="flex items-center gap-1 flex-wrap">
            {ANCHOR_KINDS.map((kind) => {
              const Icon = KIND_ICON[kind]
              const active = kind === anchor.kind
              return (
                <button
                  key={kind}
                  type="button"
                  onClick={() => onChangeKind(kind)}
                  className={cn(
                    'h-6 px-1.5 rounded-full text-micro inline-flex items-center gap-1',
                    active
                      ? 'bg-nomi-accent-soft text-nomi-accent'
                      : 'border border-nomi-line text-nomi-ink-60 hover:text-nomi-ink-80 hover:border-nomi-ink-20',
                  )}
                >
                  <Icon size={11} stroke={1.8} />
                  {t(`storyboardEditor.anchor.kind.${kind}` as 'storyboardEditor.anchor.kind.character')}
                </button>
              )
            })}
            <CarrierToggle value={anchor.carrier} onChange={(carrier) => onUpdate({ carrier })} />
          </div>
          <AutoGrowTextarea
            value={anchor.description}
            onChange={(event) => onUpdate({ description: event.target.value })}
            aria-label={t('storyboardEditor.anchor.descriptionAria')}
            autoFocus={!desc}
            placeholder={anchor.carrier === 'visual' ? t('storyboardEditor.anchor.visualPlaceholder') : t('storyboardEditor.anchor.textPlaceholder')}
            className="px-2 py-2 rounded-nomi-sm bg-nomi-paper border border-nomi-line text-body-sm text-nomi-ink-60 leading-normal focus:border-nomi-accent"
          />
          <div className="flex items-center">
            <button
              type="button"
              aria-label={t('storyboardEditor.anchor.delete')}
              onClick={onRemove}
              className="shrink-0 size-6 grid place-items-center rounded-nomi-sm text-nomi-ink-30 hover:bg-nomi-ink-10 hover:text-workbench-danger"
            >
              <IconTrash size={13} stroke={1.6} />
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="ml-auto text-micro text-nomi-ink-40 inline-flex items-center gap-1 hover:text-nomi-ink-60"
            >
              {t('storyboardEditor.anchor.collapse')}
              <IconChevronUp size={12} stroke={1.8} />
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

/** carrier 切换：图标 + 小字（视觉锚=相机·参考图 accent-soft / 文本锚=字母·文字 描边）。 */
function CarrierToggle({ value, onChange }: { value: PlanAnchor['carrier']; onChange: (v: PlanAnchor['carrier']) => void }): JSX.Element {
  const { t } = useTranslation()
  const isVisual = value === 'visual'
  return (
    <button
      type="button"
      onClick={() => onChange(isVisual ? 'text' : 'visual')}
      title={isVisual ? t('storyboardEditor.anchor.switchToText') : t('storyboardEditor.anchor.switchToVisual')}
      className={cn(
        'h-6 px-1.5 rounded-full text-micro inline-flex items-center gap-1',
        isVisual
          ? 'bg-nomi-accent-soft text-nomi-accent'
          : 'border border-nomi-line text-nomi-ink-60 hover:text-nomi-ink-80',
      )}
    >
      {isVisual ? <IconCamera size={12} stroke={1.7} /> : <IconLetterCase size={12} stroke={1.7} />}
      {isVisual ? t('storyboardEditor.anchor.visual') : t('storyboardEditor.anchor.text')}
    </button>
  )
}
