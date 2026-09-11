import { IconAlertTriangle } from '@tabler/icons-react'
import React from 'react'
import { useTranslation } from 'react-i18next'

import { cn } from '../../../utils/cn'
import type { ShotDegradation, ShotPrice } from '../../../../electron/productionRun/shotPricing'
import type { MultiShotContractProjection, ProductionContractView } from './productionContractView'

// P4 S3a — 多镜确认卡的「可滚动内容区」：规格条 4 格 + 主角形象 chips + 汇总行 + 逐镜清单（内部有界滚动 ~40vh）。
// 固定 footer（费用块 / 冻结项 / 按钮）不在这里——由 SpendConfirmDialog 的 contract 分支渲染，
// 好让它不随清单滚动（NodeErrorReport 2026-07-31 同款「动作固定、内容滚动」教训）。
// 逐镜行**只读**：改内容走「返回修改」（一功能一个家，卡内不加编辑控件）。
// 术语零内部词（「锚/封存/物化/合同」不上卡）；降级从 S2 结构化 code 经 t() 翻人话。

function formatShotPrice(price: ShotPrice, t: (key: string, opts?: Record<string, unknown>) => string): string {
  return price.known
    ? t('generationCommon.production.batch.shotPrice', { amount: price.amount })
    : t('generationCommon.production.batch.shotPriceUnknown')
}

function degradationText(
  degradations: ShotDegradation[],
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  // code → 人话徽标；未知 code 兜底透出 code 本身（不静默吞，方便发现漏翻）。
  return degradations
    .map((degradation) => {
      const key = `generationCommon.production.degradation.${degradation.code}`
      const translated = t(key, degradation.params)
      return translated === key ? degradation.code : translated
    })
    .join(' · ')
}

/** 规格条 4 格：总时长 / 画幅 / 镜头数 / 预计等待。缺项显「未知」（不伪造）。 */
function SpecStrip({ view, list }: { view: ProductionContractView; list: MultiShotContractProjection }): JSX.Element {
  const { t } = useTranslation()
  const unknown = t('generationCommon.production.batch.unknown')
  const cells: Array<{ key: string; label: string; value: string }> = [
    {
      key: 'duration',
      label: t('generationCommon.production.batch.specDuration'),
      value: view.specs.durationSeconds === null
        ? unknown
        : t('generationCommon.production.batch.durationValue', { count: view.specs.durationSeconds }),
    },
    {
      key: 'aspect',
      label: t('generationCommon.production.batch.specAspect'),
      value: view.specs.aspectRatio ?? unknown,
    },
    {
      key: 'shots',
      label: t('generationCommon.production.batch.specShots'),
      value: String(view.specs.shotCount ?? list.shots.length),
    },
    {
      key: 'wait',
      label: t('generationCommon.production.batch.specWait'),
      value: list.waitSeconds === null
        ? unknown
        : t('generationCommon.production.batch.waitValue', { count: Math.max(1, Math.round(list.waitSeconds / 60)) }),
    },
  ]
  return (
    <div className={cn('grid grid-cols-4 border-y border-nomi-line-soft')} data-production-spec-strip>
      {cells.map((cell) => (
        <div
          key={cell.key}
          data-production-spec={cell.key}
          className={cn('min-w-0 border-r border-nomi-line-soft px-3 py-2.5 last:border-r-0')}
        >
          <div className={cn('text-micro text-nomi-ink-40')}>{cell.label}</div>
          <div className={cn('mt-1 truncate text-body-sm font-semibold text-nomi-ink')}>{cell.value}</div>
        </div>
      ))}
    </div>
  )
}

export function MultiShotContractSummary({ view }: { view: ProductionContractView }): JSX.Element {
  const { t } = useTranslation()
  const list = view.shotList
  if (!list) return <></>

  return (
    <div className={cn('grid gap-4')} data-production-multishot-summary>
      <SpecStrip view={view} list={list} />

      {/* 主角形象 chips 行（含「定妆照先行」+ 锚参考费用）。空则整行不渲染。 */}
      {list.anchorChips.length ? (
        <div className={cn('grid gap-1.5')} data-production-anchor-chips>
          <div className={cn('flex items-center gap-2')}>
            <span className={cn('text-caption font-semibold text-nomi-ink')}>
              {t('generationCommon.production.batch.anchorsTitle')}
            </span>
            <span className={cn('text-micro text-nomi-accent')}>
              {t('generationCommon.production.batch.anchorLeadIn')}
            </span>
          </div>
          <div className={cn('flex flex-wrap gap-1.5')}>
            {list.anchorChips.map((chip, index) => (
              <span
                key={`${chip.label}-${index}`}
                data-production-anchor-chip
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full border border-nomi-line bg-nomi-ink-05 px-2.5 py-1',
                  'text-caption text-nomi-ink-80',
                )}
              >
                <span className={cn('truncate')}>{chip.label}</span>
                <span className={cn('text-micro text-nomi-ink-60 tabular-nums')}>{formatShotPrice(chip.price, t)}</span>
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {/* 汇总行（共 N 镜 · M 镜有提醒）——清单上方。 */}
      <span className={cn('text-caption font-semibold text-nomi-ink')} data-production-shots-summary>
        {list.reminderShotCount > 0
          ? t('generationCommon.production.batch.shotsSummaryReminder', {
              total: list.shots.length,
              reminder: list.reminderShotCount,
            })
          : t('generationCommon.production.batch.shotsSummary', { total: list.shots.length })}
      </span>

      {/* 逐镜清单：内部有界滚动 ~40vh。只读行（镜号/画面一句/模型·模式/时长/单价）。 */}
      <div
        data-production-shot-list
        className={cn('max-h-[40vh] overflow-y-auto rounded-nomi-sm border border-nomi-line-soft divide-y divide-nomi-line-soft')}
      >
        {list.shots.map((shot) => {
          const degraded = shot.degradations.length > 0
          return (
            <div
              key={shot.shotId}
              data-production-shot-row={shot.shotId}
              data-production-shot-degraded={degraded ? 'true' : 'false'}
              className={cn(
                'grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1 px-3 py-2.5',
                // 降级镜：整行浅警示底（根层 warning 语义 token，#128 收口后 :root 全局可解析）。
                degraded ? 'bg-nomi-warning/10' : null,
              )}
            >
              <span className={cn('text-micro font-semibold text-nomi-ink-40 tabular-nums pt-0.5')}>
                {t('generationCommon.production.batch.shotNo', { index: shot.index })}
              </span>
              <div className={cn('min-w-0 grid gap-0.5')}>
                <span className={cn('text-body-sm text-nomi-ink-80 leading-snug')}>{shot.sceneOneLiner}</span>
                <span className={cn('text-micro text-nomi-ink-60 truncate')}>{shot.providerModelText}</span>
                {degraded ? (
                  <span
                    data-production-shot-degrade-badge
                    className={cn('mt-0.5 inline-flex items-center gap-1 text-micro text-nomi-warning')}
                  >
                    <IconAlertTriangle size={12} stroke={1.8} aria-hidden />
                    {degradationText(shot.degradations, t)}
                  </span>
                ) : null}
              </div>
              <div className={cn('shrink-0 grid justify-items-end gap-0.5 text-right')}>
                <span className={cn('text-micro text-nomi-ink-40 tabular-nums')}>
                  {shot.durationSeconds === null
                    ? t('generationCommon.production.batch.unknown')
                    : t('generationCommon.production.batch.durationValue', { count: shot.durationSeconds })}
                </span>
                <span
                  data-production-shot-price={shot.price.known ? 'known' : 'unknown'}
                  className={cn(
                    'text-caption font-semibold tabular-nums',
                    shot.price.known ? 'text-nomi-ink' : 'text-nomi-warning',
                  )}
                >
                  {formatShotPrice(shot.price, t)}
                </span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
