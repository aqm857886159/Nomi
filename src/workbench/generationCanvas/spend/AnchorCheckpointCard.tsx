import { IconZoomIn } from '@tabler/icons-react'
import React from 'react'
import { useTranslation } from 'react-i18next'

import { NomiLoadingMark, WorkbenchButton } from '../../../design'
import { cn } from '../../../utils/cn'
import type { AnchorCheckpointCardModel } from './anchorCheckpointView'

// P4 §3.2 形象确认卡 body + 固定 footer（anchor_checkpoint 门·免费质量门）——与花钱确认卡同一条对话框轨道
// （SpendConfirmDialog 家族，P1 一功能一个家）。视觉语言 + 「内容区滚动、footer 恒在」布局沿用 MultiShotCardBody：
// 返回 fragment（flex-1 滚动内容区 = 定妆照 2 列网格 + 两句承诺；shrink-0 固定 footer = 脚注/先不拍/开拍或重拍），
// 由 SpendConfirmDialog 的 flex 列直接摊开。术语零内部词（「锚/检查点/冻结/封存/物化/合同」不上卡，措辞全走 i18n）。
//
// 语义映射到 #156 真实 API（在 useProductionStatus 接线）：
//   开拍 = decide approved → service 钩子自动续踢镜批；先不拍 = 不 decide、门保持 waiting、可从任务中心重开；
//   重拍选中 = decide rejected + 对选中 shotId 走 S6 返工链（reworkShot），新 attempt 完成后门重新武装、卡再弹。

type Props = {
  model: AnchorCheckpointCardModel
  /** 自动放行倒计时（秒）：仅当 run 配了 anchorAutoReleaseMs 才 >0；生产默认不设 → 0 → 脚注不显示。 */
  autoReleaseSeconds?: number
  /** 「开拍」= 批准。resolve(true)。 */
  onApprove: () => void
  /** 「先不拍」= 不表态。resolve(false)、门保持 waiting。 */
  onDefer: () => void
  /** 「重拍选中的」= 回传选中 shotId（view 层 decide rejected + reworkShot）。不确认。 */
  onRework: (shotIds: string[]) => void
}

function formatMoney(value: number, currency: string, language: string): string {
  try {
    return new Intl.NumberFormat(language, { style: 'currency', currency, maximumFractionDigits: 2 }).format(value)
  } catch {
    return `${currency} ${value.toFixed(2)}`
  }
}

export function AnchorCheckpointCard({ model, autoReleaseSeconds = 0, onApprove, onDefer, onRework }: Props): JSX.Element {
  const { t, i18n } = useTranslation()
  const [selected, setSelected] = React.useState<Set<string>>(() => new Set())
  const [zoomUrl, setZoomUrl] = React.useState<string | null>(null)

  const toggle = React.useCallback((shotId: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(shotId)) next.delete(shotId)
      else next.add(shotId)
      return next
    })
  }, [])

  const reworkMode = selected.size > 0
  const budgetText = model.approvedBudget === null
    ? t('generationCommon.production.checkpoint.budgetUnknown')
    : formatMoney(model.approvedBudget, model.budgetCurrency, i18n.language)

  return (
    <>
      {/* 内容区：副标题 + 定妆照 2 列网格 + 两句承诺。flex-1 可滚。
          data-anchor-checkpoint-card 标在这里（fragment 挂不了属性）——它涵盖卡的可见主体，供走查/消费方定位。 */}
      <div className={cn('flex-1 min-h-0 overflow-y-auto')} data-anchor-checkpoint-card>
        <p className={cn('m-0 mb-3 text-body-sm leading-relaxed text-nomi-ink-80')} data-anchor-checkpoint-subtitle>
          {/* 复用形象不进门、不花钱；有复用时副标题把它们单列，避免和本批新拍混淆。 */}
          {t(
            model.reusedCount > 0
              ? 'generationCommon.production.checkpoint.subtitleWithReuse'
              : 'generationCommon.production.checkpoint.subtitle',
            { count: model.anchors.length, fresh: model.freshCount, reused: model.reusedCount },
          )}
        </p>

        <div className={cn('grid grid-cols-2 gap-2.5')} data-anchor-checkpoint-grid>
          {model.anchors.map((anchor) => {
            const isSelected = selected.has(anchor.shotId)
            const displayName = anchor.name || t('generationCommon.production.checkpoint.unnamed')
            return (
              <div
                key={anchor.shotId}
                data-anchor-entry={anchor.shotId}
                data-anchor-selected={isSelected ? 'true' : 'false'}
                className={cn(
                  'flex flex-col overflow-hidden rounded-nomi border bg-nomi-bg',
                  isSelected ? 'border-nomi-accent ring-1 ring-nomi-accent' : 'border-nomi-line',
                )}
              >
                <button
                  type="button"
                  data-anchor-thumb
                  disabled={!anchor.thumbnailUrl}
                  onClick={() => anchor.thumbnailUrl && setZoomUrl(anchor.thumbnailUrl)}
                  aria-label={t('generationCommon.production.checkpoint.viewLarge', { name: displayName })}
                  className={cn('group relative block aspect-[4/3] w-full', anchor.thumbnailUrl ? 'cursor-zoom-in' : 'cursor-default')}
                >
                  {anchor.thumbnailUrl ? (
                    <>
                      <img
                        src={anchor.thumbnailUrl}
                        alt={t('generationCommon.production.checkpoint.stillAlt', { name: displayName })}
                        className={cn('h-full w-full object-cover')}
                      />
                      <span
                        className={cn(
                          'absolute right-1.5 top-1.5 grid size-6 place-items-center rounded-full opacity-0 transition-opacity',
                          'bg-nomi-overlay-chip text-nomi-paper group-hover:opacity-100',
                        )}
                        aria-hidden
                      >
                        <IconZoomIn size={13} stroke={1.8} />
                      </span>
                    </>
                  ) : (
                    // 缩略图还没落地（罕见：确认卡弹出时锚 artifact 应已 ready）→ 占位斜条纹 + 转标，不伪造图。
                    <span
                      className={cn('grid h-full w-full place-items-center bg-[repeating-linear-gradient(45deg,var(--nomi-ink-05)_0_10px,var(--nomi-ink-10)_10px_20px)]')}
                      aria-hidden
                    >
                      <NomiLoadingMark size={16} />
                    </span>
                  )}
                </button>

                <div className={cn('flex flex-wrap items-center gap-1.5 px-2.5 py-2')}>
                  <span className={cn('min-w-0 truncate text-body-sm font-semibold text-nomi-ink')} data-anchor-name>
                    {anchor.roleLabel ? <span className={cn('font-medium text-nomi-ink-60')}>{anchor.roleLabel} · </span> : null}
                    {displayName}
                  </span>
                  <span
                    data-anchor-badge={anchor.reused ? 'reuse' : 'new'}
                    className={cn(
                      'shrink-0 rounded-full px-2 py-0.5 text-micro',
                      anchor.reused ? 'bg-nomi-ink-05 text-nomi-ink-60' : 'bg-nomi-accent-soft text-nomi-accent',
                    )}
                  >
                    {t(anchor.reused ? 'generationCommon.production.checkpoint.badgeReuse' : 'generationCommon.production.checkpoint.badgeNew')}
                  </span>
                  {anchor.canRework ? (
                    <button
                      type="button"
                      data-anchor-rework={anchor.shotId}
                      onClick={() => toggle(anchor.shotId)}
                      className={cn(
                        'ml-auto shrink-0 rounded-full border px-2.5 py-1 text-micro transition-colors',
                        isSelected
                          ? 'border-nomi-accent text-nomi-accent'
                          : 'border-dashed border-nomi-line text-nomi-ink-60 hover:border-nomi-accent hover:text-nomi-accent',
                      )}
                    >
                      {t('generationCommon.production.checkpoint.reworkThis')}
                    </button>
                  ) : null}
                </div>
              </div>
            )
          })}
        </div>

        {/* 说明行：两句承诺（不新增花费 + 只花重拍那张的钱）。零内部词。 */}
        <p className={cn('m-0 mt-4 text-caption leading-relaxed text-nomi-ink-60')} data-anchor-checkpoint-note>
          {t('generationCommon.production.checkpoint.note', { budget: budgetText, count: model.shotCount })}
        </p>
      </div>

      {/* 固定 footer（不随网格滚）：左=自动放行脚注（默认空）；右=先不拍 + 开拍/重拍。 */}
      <div className={cn('shrink-0 mt-3 flex items-center gap-2.5 border-t border-nomi-line pt-3')} data-anchor-checkpoint-footer>
        <span className={cn('text-micro leading-relaxed text-nomi-ink-40')} data-anchor-checkpoint-footnote>
          {autoReleaseSeconds > 0
            ? t('generationCommon.production.checkpoint.autoRelease', { minutes: Math.max(1, Math.round(autoReleaseSeconds / 60)) })
            : ''}
        </span>
        <span className={cn('flex-1')} />
        <WorkbenchButton className={cn('h-8 px-4 cursor-pointer')} onClick={onDefer} data-anchor-checkpoint-defer>
          {t('generationCommon.production.checkpoint.defer')}
        </WorkbenchButton>
        <WorkbenchButton
          data-anchor-checkpoint-primary
          data-anchor-checkpoint-mode={reworkMode ? 'rework' : 'approve'}
          className={cn('h-8 px-4 cursor-pointer bg-nomi-ink text-nomi-paper border-nomi-ink hover:bg-nomi-accent hover:text-nomi-paper')}
          onClick={() => (reworkMode ? onRework([...selected]) : onApprove())}
        >
          {reworkMode
            ? t('generationCommon.production.checkpoint.reworkSelected')
            : t('generationCommon.production.checkpoint.approve', { count: model.shotCount })}
        </WorkbenchButton>
      </div>

      {/* 看大图浮层（点缩略图放大；点任意处收起）。复用 scrim token。 */}
      {zoomUrl ? (
        <div
          data-anchor-checkpoint-zoom
          // 看大图浮层：从卡内点开，z 必须高过对话框本身（z-[4300]）才盖得住。
          className={cn('fixed inset-0 z-[4400] grid place-items-center bg-nomi-scrim p-8')}
          onPointerDown={() => setZoomUrl(null)}
        >
          <img
            src={zoomUrl}
            alt={t('generationCommon.production.checkpoint.stillLargeAlt')}
            className={cn('max-h-full max-w-full rounded-nomi-lg object-contain shadow-nomi-lg')}
          />
        </div>
      ) : null}
    </>
  )
}
