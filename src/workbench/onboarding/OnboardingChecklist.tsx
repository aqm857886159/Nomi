/**
 * 上手 4 步进度（被动指示，不带走查——引导走查归首页触发的 JourneyTour）。
 *
 * 10-08 外壳重设计：入口从顶栏右簇的「上手 N/4」下拉**收纳进设置「通用」最上面**（设计卡归位表；
 * 09-08 A1 Rail 板「上手清单 → 设置 › 上手，未完成时在设置钮上冒一个点」）。所以这里拆成两件：
 *   - `useOnboardingProgress()`：**常驻**在顶栏里跑（只为设置钮上那个点 + 把达成的步落盘），不画任何东西；
 *   - `OnboardingChecklistSection`：设置「通用」里那一块清单（步骤、下一步高亮、手册入口、不再提示）。
 * 四步随**真实行为**自动打勾：
 *   1 接入模型   = 有可用文本模型（hasTextModel）
 *   2 拆一个镜头 = 画布出现节点
 *   3 生成一张   = 任一节点 status === 'success'
 *   4 导出成片   = 一次 MP4 导出成功（TimelinePreview 处 markChecklistStep）
 * 退出三条路不变：① 4/4 全做完；② 用户点「不再提示」；③ 首次显示满 2 天仍未完成 → 自动永久关闭。
 */
import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { IconCheck, IconMap } from '@tabler/icons-react'
import { cn } from '../../utils/cn'
import { DesignProgress } from '../../design'
import type { ChecklistStep } from './onboardingState'
import { useOnboardingProgress } from './useOnboardingProgress'

/** 设置「通用」最上面那一块：上手清单。做完 / 关掉 / 过期后整块不出现。 */
export function OnboardingChecklistSection(): JSX.Element | null {
  const { t } = useTranslation()
  const progress = useOnboardingProgress()
  const steps: { key: ChecklistStep; label: string; hint: string }[] = [
    { key: 'model', label: t('onboarding.steps.model.label'), hint: t('onboarding.steps.model.hint') },
    { key: 'storyboard', label: t('onboarding.steps.storyboard.label'), hint: t('onboarding.steps.storyboard.hint') },
    { key: 'generated', label: t('onboarding.steps.generated.label'), hint: t('onboarding.steps.generated.hint') },
    { key: 'exported', label: t('onboarding.steps.exported.label'), hint: t('onboarding.steps.exported.hint') },
  ]
  if (!progress.active) return null
  return (
    <section
      data-onboarding-checklist="settings"
      aria-label={t('onboarding.panelLabel')}
      className="mb-5 overflow-hidden rounded-nomi border border-nomi-line bg-nomi-paper"
    >
      <header className="flex items-center gap-2 px-4 pb-2 pt-3">
        <span className="text-body-sm font-semibold text-nomi-ink">{t('onboarding.panelLabel')}</span>
        <span className="text-caption font-medium tabular-nums text-nomi-ink-40">{progress.doneCount} / {progress.total}</span>
      </header>
      <DesignProgress value={(progress.doneCount / progress.total) * 100} size="xs" className="mx-4 mb-2" />
      <ul className="m-0 grid list-none gap-0.5 px-1.5 pb-2 sm:grid-cols-2">
        {steps.map((step) => {
          const done = progress.effective[step.key]
          const isNext = !done && step.key === progress.nextKey
          return (
            <li
              key={step.key}
              data-step={step.key}
              data-done={done ? 'true' : 'false'}
              className={cn('flex items-start gap-2.5 rounded-nomi-sm p-2', isNext && 'bg-nomi-accent-soft')}
            >
              <span
                className={cn(
                  'mt-px grid size-5 shrink-0 place-items-center rounded-full',
                  done ? 'bg-nomi-accent text-nomi-paper' : isNext ? 'border-2 border-nomi-accent' : 'border-2 border-nomi-ink-20',
                )}
              >
                {done ? <IconCheck size={12} stroke={1.8} aria-hidden="true" /> : null}
              </span>
              <span className="min-w-0">
                <span className={cn('block text-body-sm font-medium leading-snug', done ? 'text-nomi-ink-40' : isNext ? 'text-nomi-accent' : 'text-nomi-ink')}>
                  {step.label}
                </span>
                {!done ? <span className="mt-px block text-caption leading-snug text-nomi-ink-40">{step.hint}</span> : null}
              </span>
            </li>
          )
        })}
      </ul>
      <div className="flex items-center justify-between border-t border-nomi-line-soft px-3 py-2">
        {/* 手册入口：开同一个 nomi-open-handbook 事件。 */}
        <button
          type="button"
          onClick={() => window.dispatchEvent(new CustomEvent('nomi-open-handbook'))}
          className="inline-flex cursor-pointer items-center gap-1 rounded-nomi-sm border-0 bg-transparent px-1.5 py-0.5 text-caption text-nomi-accent transition-colors hover:text-nomi-ink"
        >
          <IconMap size={13} stroke={1.8} aria-hidden="true" />
          {t('onboarding.fullHandbook')}
        </button>
        <button
          type="button"
          onClick={progress.dismiss}
          className="cursor-pointer rounded-nomi-sm border-0 bg-transparent px-1.5 py-0.5 text-caption text-nomi-ink-40 transition-colors hover:text-nomi-ink"
          data-onboarding-dismiss
        >
          {t('onboarding.dismiss')}
        </button>
      </div>
    </section>
  )
}
