// 分组头「生成整组」点开的付费确认卡。
//
// 外壳、标题、正文、明细行、按钮全部照现役 SpendConfirmDialog 的「用户直发 · 一下跑 ≥2 个」那一档：
// 同一个 BodyPortal + 遮罩、同一张 380 宽的卡、金币图标位、`batchPlan.startTitle` 标题、
// `describeGenerationCost` 正文、`batchPlan.confirmGenerate` 主按钮（取消在左、主动作在最右）。
// 只多一件事：明细行前面一个勾（2026-10-08 用户：按项控制，没生成过的默认勾上、生成过的默认不勾）。
// 落地时是给 SpendConfirmRequest.details 加一个「可勾」字段、在同一个对话框里渲染，不另起第二张卡。
// 确认之前不建、不派任何东西：样张里「生成」只关卡。
import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { IconCoin } from '@tabler/icons-react'
import { BodyPortal, DesignCheckbox, NOMI_OVERLAY_Z_INDEX, WorkbenchButton } from '../design'
import { cn } from '../utils/cn'
import { describeGenerationCost } from '../workbench/generationCanvas/spend/spendConfirm'
import { REFS, refName, statusLabel, type ListCard, type ListSection, type ListViewLocale } from './storyboardListViewData'

function costKind(cards: ListCard[]): 'image' | 'video' | 'mixed' {
  const kinds = new Set(cards.map((card) => card.media))
  return kinds.size > 1 ? 'mixed' : kinds.has('video') ? 'video' : 'image'
}

export function SectionGenerateDialog({
  section,
  locale,
  onClose,
}: {
  section: ListSection
  locale: ListViewLocale
  onClose: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const items = section.cards.filter((card) => card.kind !== 'director')
  const [checked, setChecked] = React.useState<Set<string>>(
    () => new Set(items.filter((card) => card.status !== 'ready' && card.status !== 'generating').map((card) => card.id)),
  )
  const picked = items.filter((card) => checked.has(card.id))
  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <BodyPortal>
      <div
        className="pointer-events-auto fixed inset-0 flex items-center justify-center bg-nomi-ink/20"
        style={{ zIndex: NOMI_OVERLAY_Z_INDEX.dialog }}
        onPointerDown={(event) => {
          if (event.target === event.currentTarget) onClose()
        }}
      >
        <div
          role="dialog"
          aria-modal="true"
          data-section-generate-dialog={section.id}
          className="max-h-[88vh] w-[380px] max-w-[88%] overflow-y-auto rounded-nomi-lg border border-nomi-line bg-nomi-paper p-4 shadow-nomi-md outline-none"
        >
          <div className="mb-2 flex items-center gap-2.5">
            <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-nomi bg-nomi-accent-soft text-nomi-accent">
              <IconCoin size={18} aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="truncate text-title font-medium text-nomi-ink">{t('generationCommon.batchPlan.startTitle')}</p>
              <p className="truncate text-micro text-nomi-ink-60">{locale === 'en' ? section.titleEn : section.title}</p>
            </div>
          </div>
          <p className="mb-3 text-body-sm leading-relaxed text-nomi-ink-80">
            {describeGenerationCost(Math.max(1, picked.length), costKind(picked.length ? picked : items))}
          </p>
          <div className="mb-3 divide-y divide-nomi-line-soft rounded-nomi-sm border border-nomi-line-soft">
            {items.map((card) => {
              // 正在生成的那张不能再勾：再发一次就是重复扣费（和画布「生成整组」不算在途节点同一条）。
              const busy = card.status === 'generating'
              const on = checked.has(card.id)
              const refs = card.refs.filter((id) => REFS[id].ready).map((id) => refName(id, locale)).join(' · ')
              return (
                <label
                  key={card.id}
                  data-section-generate-row={card.id}
                  className={cn('flex items-center gap-2 px-2.5 py-1.5', busy ? 'cursor-not-allowed' : 'cursor-pointer')}
                  title={busy ? statusLabel('generating', locale) : undefined}
                >
                  <DesignCheckbox
                    size="xs"
                    checked={on}
                    disabled={busy}
                    onChange={() =>
                      setChecked((current) => {
                        const next = new Set(current)
                        if (next.has(card.id)) next.delete(card.id)
                        else next.add(card.id)
                        return next
                      })
                    }
                    aria-label={locale === 'en' ? card.titleEn : card.title}
                  />
                  <span className={cn('shrink-0 text-caption', on ? 'text-nomi-ink-80' : 'text-nomi-ink-40')}>
                    {locale === 'en' ? card.titleEn : card.title}
                  </span>
                  {card.status === 'ready' || busy ? (
                    <span className="shrink-0 text-micro text-nomi-ink-40">{statusLabel(card.status, locale)}</span>
                  ) : null}
                  <span className={cn('ml-auto truncate text-right text-caption font-medium', on ? 'text-nomi-ink-80' : 'text-nomi-ink-40')}>
                    {refs || '—'}
                  </span>
                </label>
              )
            })}
          </div>
          <div className="flex items-center justify-end gap-2">
            <WorkbenchButton className="h-8 cursor-pointer px-4" onClick={onClose}>
              {t('generationCommon.spend.cancel')}
            </WorkbenchButton>
            <span title={picked.length ? undefined : locale === 'en' ? 'Tick at least one' : '至少勾一项'} style={{ display: 'contents' }}>
              <WorkbenchButton
                className="h-8 cursor-pointer border-nomi-ink bg-nomi-ink px-4 text-nomi-paper hover:bg-nomi-accent hover:text-nomi-paper"
                disabled={picked.length === 0}
                onClick={onClose}
              >
                {t('generationCommon.batchPlan.confirmGenerate')}
              </WorkbenchButton>
            </span>
          </div>
        </div>
      </div>
    </BodyPortal>
  )
}
