import React, { type JSX } from 'react'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'

import type { QaStageReport } from '../../../electron/shared/productionQaVerdict'
import { SHOT_VERIFY_DIMENSIONS, formatQaUnverifiedReason, type ShotVerifyDimensionKey } from '../generationCanvas/agent/shotVerify'
import { cn } from '../../utils/cn'
import { productionPlaybookLabelKey, productionStageLabelKey } from './productionRunLabels'
import type { ProductionRunView } from './productionRunView'

type Props = {
  details: ProductionRunView['details']
}

const DIMENSION_NAME_KEYS: Record<string, ShotVerifyDimensionKey> = Object.fromEntries(
  SHOT_VERIFY_DIMENSIONS.map((d) => [d.name, d.key]),
) as Record<string, ShotVerifyDimensionKey>

type QaReportParts = {
  summary: string
  reasonDetail?: string
}

function formatQaReportParts(report: QaStageReport, t: TFunction): QaReportParts {
  const sep = t('generationCommon.production.qa.listSeparator')
  if (report.skipped || report.total === 0) {
    return {
      summary: t('generationCommon.production.qa.skipped'),
      reasonDetail: report.skipReason?.trim() || undefined,
    }
  }
  const reasons = report.unverifiedReasons?.length
    ? report.unverifiedReasons.map((r) => formatQaUnverifiedReason(r, t)).join(sep)
    : t('generationCommon.production.qa.fallbackReason')
  const dims = report.flaggedDimensions?.length
    ? report.flaggedDimensions
        .map((dim) => {
          const key = DIMENSION_NAME_KEYS[dim]
          return key ? t(`generationCommon.reconcile.fields.${key}` as 'generationCommon.reconcile.fields.identity') : dim
        })
        .join(sep)
    : t('generationCommon.production.qa.fallbackDimension')

  if (report.flaggedCount === 0 && report.unverifiedCount === 0) {
    return { summary: t('generationCommon.production.qa.allPassed', { count: report.total }) }
  }
  if (report.unverifiedCount === report.total) {
    return {
      summary: t('generationCommon.production.qa.allUnverified', { count: report.total }),
      reasonDetail: reasons,
    }
  }
  if (report.flaggedCount === 0) {
    return {
      summary: t('generationCommon.production.qa.partialUnverified', {
        count: report.unverifiedCount,
        total: report.total,
      }),
      reasonDetail: reasons,
    }
  }
  if (report.unverifiedCount === 0) {
    return {
      summary: t('generationCommon.production.qa.flaggedOnly', {
        passed: report.passedCount,
        total: report.total,
        flagged: report.flaggedCount,
        dims,
      }),
    }
  }
  return {
    summary: t('generationCommon.production.qa.flaggedAndUnverified', {
      total: report.total,
      flagged: report.flaggedCount,
      dims,
      unverified: report.unverifiedCount,
    }),
    reasonDetail: reasons,
  }
}

function formatStageStatusLabel(
  stage: ProductionRunView['details']['stages'][number],
  t: TFunction,
): string {
  if (stage.stageId === 'qa' && stage.qaReport) {
    if (
      stage.qaReport.skipped
      || stage.qaReport.total === 0
      || stage.qaReport.unverifiedCount === stage.qaReport.total
    ) {
      return t('generationCommon.reconcile.unverifiedLabel')
    }
    if (stage.qaReport.unverifiedCount > 0) {
      return t('generationCommon.production.qa.partialStatus')
    }
  }
  return t(`generationCommon.production.runDetails.stageStatus.${stage.status}`)
}

// 界面不谈钱：这里原有四个金额格（已授权 / 已预留 / 已结算 / 待结算），值是把账本合计现算成货币。
// 账本合计只加已知价，算不出价的镜头不在里面，实付也从不回写——四格印出来的零金额没有依据（2026-10-27 删，
// 方向检查 docs/engineering/direction-checks/2026-10-27-ui-money-amounts.md）。视图里也不再带预算，
// 界面上新写金额格式化由 ESLint 的 ui-money 规则拦（scripts/ui-money-format.mjs）。
export function ProductionDetails({ details }: Props): JSX.Element {
  const { t, i18n } = useTranslation()
  const [qaReasonsOpen, setQaReasonsOpen] = React.useState(false)
  const updatedAt = new Intl.DateTimeFormat(i18n.language, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(details.updatedAt))

  return (
    <div className={cn('grid gap-3 pt-3')}>
      <div className={cn('flex items-center justify-between gap-3 text-caption')}>
        <span className={cn('text-nomi-ink-60')}>{t('generationCommon.production.runDetails.stages')}</span>
        <span className={cn('font-medium tabular-nums text-nomi-ink')}>
          {t('generationCommon.production.runDetails.stageCount', {
            completed: details.completedStages,
            total: details.totalStages,
          })}
        </span>
      </div>
      <div className={cn('grid gap-1.5')}>
        {details.stages.map((stage) => {
          const qaParts = stage.qaReport
            ? formatQaReportParts(stage.qaReport, t)
            : stage.qaSummary
              ? { summary: stage.qaSummary }
              : null
          return (
            <div key={stage.stageId} className={cn('grid gap-0.5')}>
              <div className={cn('flex items-center justify-between gap-3 text-caption')}>
                <span className={cn('truncate text-nomi-ink-80')}>{t(productionStageLabelKey(stage.stageId))}</span>
                <span className={cn('shrink-0 text-micro text-nomi-ink-60')}>
                  {formatStageStatusLabel(stage, t)}
                </span>
              </div>
              {qaParts ? (
                <div className={cn('grid gap-0.5')}>
                  <div className={cn('flex flex-wrap items-baseline gap-x-2 gap-y-0.5')}>
                    <p data-production-qa-summary className={cn('m-0 text-micro leading-relaxed text-nomi-ink-60')}>
                      {qaParts.summary}
                    </p>
                    {qaParts.reasonDetail ? (
                      <button
                        type="button"
                        data-production-qa-why-toggle="true"
                        aria-expanded={qaReasonsOpen}
                        onClick={() => setQaReasonsOpen((open) => !open)}
                        className={cn(
                          'shrink-0 cursor-pointer border-0 bg-transparent p-0 text-micro text-nomi-ink-60 underline decoration-nomi-ink-30 underline-offset-2 hover:text-nomi-ink',
                        )}
                      >
                        {qaReasonsOpen
                          ? t('generationCommon.reconcile.hideReasons')
                          : t('generationCommon.reconcile.showReasons')}
                      </button>
                    ) : null}
                  </div>
                  {qaParts.reasonDetail && qaReasonsOpen ? (
                    <p data-production-qa-reasons className={cn('m-0 text-micro leading-relaxed text-nomi-ink-40')}>
                      {qaParts.reasonDetail}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
          )
        })}
      </div>
      <div className={cn('grid gap-1 text-caption')}>
        <span className={cn('text-nomi-ink-60')}>{t('generationCommon.production.runDetails.skills')}</span>
        <span className={cn('text-nomi-ink-80')}>
          {/* 技能证据记的是流程身份（name@version），上屏只给人话名。 */}
          {details.skills.length > 0
            ? [...new Set(details.skills.map((skill) => t(productionPlaybookLabelKey(skill.name))))].join(' · ')
            : t('generationCommon.production.runDetails.noSkills')}
        </span>
      </div>
      <div className={cn('flex items-center justify-between gap-3 text-caption')}>
        <span className={cn('text-nomi-ink-60')}>{t('generationCommon.production.runDetails.updatedAt')}</span>
        <time dateTime={details.updatedAt} className={cn('text-right tabular-nums text-nomi-ink-80')}>{updatedAt}</time>
      </div>
    </div>
  )
}
