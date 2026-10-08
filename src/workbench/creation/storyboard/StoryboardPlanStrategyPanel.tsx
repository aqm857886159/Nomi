import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { IconAlertTriangle, IconSparkles } from '@tabler/icons-react'
import type { StoryboardPlan } from '../../generationCanvas/agent/storyboardPlan'
import {
  applyMergeSuggestion,
  applySplitSuggestion,
  storyboardShotId,
} from '../../generationCanvas/agent/storyboardStrategy'
import type { MergeProposal, SplitProposal } from '../../../../electron/shared/videoCapabilities/planResolver'
import { aggregateIssues, describeIssue, describeMerge, describeSplit } from './strategyText'
import type { StoryboardStrategyState } from './useStoryboardStrategy'

/**
 * 执行计划审阅条（Generation Strategy Resolver，切片 3）。
 *
 * 挂在方案编辑器表上方：编辑器查一次主进程窄 IPC resolve（与 agent/MCP 同源），把合并/拆条
 * 建议与致命问题摊成可逐条采纳的小条。机器算、方案免费可改：采纳 = apply 一条建议到方案本体
 * （applyMergeSuggestion / applySplitSuggestion），不落画布、不花钱。
 *
 * 呈现语义（对齐已拍板表格版样张的「机器处置」列）：
 *  - 必需（低于下限，不并会截断）与拆条（超上限）→ 警示语义 + 「采纳」按钮；
 *  - 效率合并（建议式）→ 中性语义，不采纳也合法；
 *  - 没有可用视频模型 → **人话 + 下一步（去设置）**，不是把 `generation_core_unavailable` 摆给用户；
 *  - 能力核还没起来 → 什么都不显示（那是启动竞态，不是用户能处理的事，摆一条灰码只是噪音，R2）；
 *  - 采纳后方案变化 → 自动重查 → 建议消失（「已采纳」由消失本身表达，不做双份状态）。
 *
 * 所有句子都由 `strategyText` 用 i18n 模板渲染（引擎只产 code + 数值，R15）。
 */
export type StoryboardPlanStrategyPanelProps = {
  plan: StoryboardPlan
  state: StoryboardStrategyState
  onChange: (plan: StoryboardPlan) => void
}

export default function StoryboardPlanStrategyPanel({ plan, state, onChange }: StoryboardPlanStrategyPanelProps): JSX.Element | null {
  const { t } = useTranslation()

  if (state.status === 'idle' || state.status === 'unavailable') return null
  if (state.status === 'loading') return <StatusBar stateKey="loading">{t('storyboardEditor.strategy.resolving')}</StatusBar>
  if (state.status === 'stale') return <StatusBar stateKey="stale">{t('storyboardEditor.strategy.projectStale')}</StatusBar>
  if (state.status === 'error') return <StatusBar stateKey="error">{t('storyboardEditor.strategy.error')}</StatusBar>

  const { view } = state
  // 「一个视频模型都没有」不是一堆逐镜错误，而是一件事 + 一个下一步。
  const noVideoModel = view.blockers.length > 0 && view.blockers.every((issue) => issue.code === 'no.candidates')
  if (noVideoModel) {
    return (
      <section
        className="shrink-0 flex items-start gap-2 rounded-nomi border border-nomi-line bg-nomi-paper px-3 py-2 shadow-nomi-sm"
        data-storyboard-strategy-root="true"
        data-storyboard-strategy-state="no-video-model"
      >
        <IconAlertTriangle size={14} stroke={1.8} className="mt-[2px] shrink-0 text-nomi-warning" />
        <div className="min-w-0 flex-1">
          <div className="text-caption font-medium text-nomi-ink-80">{t('storyboardEditor.strategy.noVideoModelTitle')}</div>
          <div className="text-micro text-nomi-ink-60">{t('storyboardEditor.strategy.noVideoModelBody')}</div>
        </div>
        <button
          type="button"
          onClick={() => window.dispatchEvent(new CustomEvent('nomi-open-model-catalog'))}
          data-storyboard-strategy-settings="true"
          className="shrink-0 rounded-pill bg-nomi-accent px-2 py-0.5 text-micro font-medium text-white hover:opacity-90"
        >
          {t('storyboardEditor.strategy.goToSettings')}
        </button>
      </section>
    )
  }

  const aggregatedBlockers = aggregateIssues(view.blockers)
  const total = view.requiredMerges.length + view.mergeSuggestions.length + view.splits.length + aggregatedBlockers.length
  if (total === 0) return null

  const shotTag = (shotId: string): string => {
    const shot = plan.shots.find((candidate) => storyboardShotId(candidate) === shotId)
    if (!shot) return shotId
    return t('storyboardEditor.strategy.shotTag', { index: shot.index, seconds: shot.durationSec })
  }
  const blockerShotTag = (shotId: string): string => {
    const shot = plan.shots.find((candidate) => storyboardShotId(candidate) === shotId)
    return shot ? t('storyboardEditor.strategy.shotTagShort', { index: shot.index }) : shotId
  }
  const mergeRow = (proposal: MergeProposal, tone: 'required' | 'advisory'): JSX.Element => (
    <ProposalRow
      key={proposal.id}
      tone={tone}
      badge={tone === 'required' ? t('storyboardEditor.strategy.requiredBadge') : t('storyboardEditor.strategy.advisoryBadge')}
      summary={`${proposal.shotIds.map(shotTag).join(' + ')} → ${t('storyboardEditor.strategy.merge')}`}
      reason={describeMerge(t, proposal)}
      adoptLabel={t('storyboardEditor.strategy.adopt')}
      whyLabel={t('storyboardEditor.strategy.why')}
      onAdopt={() => onChange(applyMergeSuggestion(plan, proposal))}
    />
  )
  const splitRow = (proposal: SplitProposal): JSX.Element => (
    <ProposalRow
      key={`${proposal.shotId}-${proposal.durationSec}`}
      tone="required"
      badge={t('storyboardEditor.strategy.split')}
      summary={`${shotTag(proposal.shotId)} → ${t('storyboardEditor.strategy.split')} ${proposal.pieces.map((piece) => `${piece.durationSec}s`).join(' + ')}`}
      reason={describeSplit(t, proposal)}
      adoptLabel={t('storyboardEditor.strategy.adopt')}
      whyLabel={t('storyboardEditor.strategy.why')}
      onAdopt={() => onChange(applySplitSuggestion(plan, proposal))}
    />
  )

  // `shrink-0` 不是装饰：本条挂在编辑器 `overflow-y-auto flex flex-col` 的滚动列里，flex 子项默认
  // `flex-shrink:1`——镜头一多，这一条就被压成 2px 的细线，配上 `overflow-hidden` 等于整块消失。
  // 2026-09-07 真机走查实测到的就是这一幕：section 高 2px、两条建议画在盒外、「采纳」根本点不到，
  // 而 Playwright 的 toBeVisible（只看 bounding box 非空）照样绿。三处根元素都要带它。
  return (
    <section
      className="shrink-0 rounded-nomi border border-nomi-line bg-nomi-paper shadow-nomi-sm overflow-hidden"
      data-storyboard-strategy-root="true"
      data-storyboard-strategy-state="ready"
      data-storyboard-strategy-panel="true"
    >
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-nomi-line-soft">
        <IconSparkles size={14} stroke={1.6} className="text-nomi-accent shrink-0" />
        <span className="text-caption font-medium text-nomi-ink-80 shrink-0">{t('storyboardEditor.strategy.heading')}</span>
        <span className="text-micro text-nomi-ink-40 min-w-0 truncate">{t('storyboardEditor.strategy.hint')}</span>
      </div>
      <div className="flex flex-col px-3 py-2 gap-0.5">
        {view.requiredMerges.map((proposal) => mergeRow(proposal, 'required'))}
        {view.mergeSuggestions.map((proposal) => mergeRow(proposal, 'advisory'))}
        {view.splits.map(splitRow)}
        {view.blockers.length > 0 ? (
          <div className="py-1 text-caption font-medium text-nomi-danger" data-storyboard-strategy-blockers-heading="true">
            {t('storyboardEditor.strategy.blockersHeading')}
          </div>
        ) : null}
        {aggregatedBlockers.map(({ issue, shotIds }) => (
          <div
            key={`${issue.code}-${String(issue.params.requested ?? '')}-${String(issue.params.modelLabel ?? '')}`}
            className="flex items-start gap-1.5 py-1 text-caption text-nomi-danger"
            data-storyboard-strategy-blocker="true"
          >
            <IconAlertTriangle size={13} stroke={1.8} className="shrink-0 mt-[3px]" />
            <span className="min-w-0">
              {describeIssue(t, issue)}
              {shotIds.length ? ` · ${t('storyboardEditor.strategy.affectedShots', { count: shotIds.length, shots: shotIds.map(blockerShotTag).join('、') })}` : null}
            </span>
          </div>
        ))}
      </div>
    </section>
  )
}

function StatusBar({ children, stateKey }: { children: React.ReactNode; stateKey: 'loading' | 'stale' | 'error' | 'clear' }): JSX.Element {
  return (
    <div
      data-storyboard-strategy-root="true"
      data-storyboard-strategy-state={stateKey}
      className="shrink-0 rounded-nomi border border-nomi-line-soft bg-nomi-ink-05 px-3 py-1.5 text-caption text-nomi-ink-60"
    >
      {children}
    </div>
  )
}

type ProposalRowProps = {
  tone: 'required' | 'advisory'
  badge: string
  summary: string
  reason: string
  adoptLabel: string
  whyLabel: string
  onAdopt: () => void
}

function ProposalRow(props: ProposalRowProps): JSX.Element {
  const [whyOpen, setWhyOpen] = React.useState(false)
  const { tone, badge, summary, reason, adoptLabel, whyLabel, onAdopt } = props
  return (
    <div className="flex items-start gap-2 py-1" data-storyboard-strategy-proposal="true">
      <span
        className={`mt-[5px] shrink-0 rounded-full px-2 py-[1px] text-micro font-medium ${
          tone === 'required' ? 'bg-nomi-warning/15 text-nomi-warning' : 'bg-nomi-accent/10 text-nomi-accent'
        }`}
      >
        {badge}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-caption text-nomi-ink-80 min-w-0 truncate">{summary}</span>
          <button
            type="button"
            onClick={onAdopt}
            data-storyboard-strategy-adopt="true"
            className="shrink-0 inline-flex items-center gap-1 h-6 px-2.5 rounded-full bg-nomi-accent text-white text-micro font-medium hover:opacity-90"
          >
            {adoptLabel}
          </button>
          <button
            type="button"
            onClick={() => setWhyOpen((open) => !open)}
            data-storyboard-strategy-why="true"
            className="shrink-0 text-micro text-nomi-ink-40 hover:text-nomi-ink-80"
          >
            {whyLabel}
          </button>
        </div>
        {whyOpen ? <div className="mt-1 text-caption text-nomi-ink-60">{reason}</div> : null}
      </div>
    </div>
  )
}
