import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconAlertTriangle, IconCheck, IconSparkles } from '@tabler/icons-react'
import type { StoryboardPlan } from '../../generationCanvas/agent/storyboardPlan'
import {
  applyMergeSuggestion,
  applySplitSuggestion,
  classifyResolveStrategy,
  storyboardPlanToPlanShotInputs,
  type ResolveStrategyView,
} from '../../generationCanvas/agent/storyboardStrategy'
import { fetchStoryboardResolve, type StoryboardResolveClient } from './strategyGate'

/**
 * 执行计划审阅条（Generation Strategy Resolver，切片 3）。
 *
 * 挂在方案编辑器表上方：方案变化 → 走主进程窄 IPC resolve（与 agent/MCP 同源）→ 把合并/拆条
 * 建议与致命问题摊成可逐条采纳的小条。机器算、方案免费可改：采纳 = apply 一条建议到方案本体
 * （applyMergeSuggestion / applySplitSuggestion），不落画布、不花钱。
 *
 * 呈现语义（对齐已拍板表格版样张的「机器处置」列）：
 *  - 必需（低于下限，不并会截断）与拆条（超上限）→ 警示语义 + 「采纳」按钮；
 *  - 效率合并（建议式）→ 中性语义，不采纳也合法；
 *  - 无候选/模型不存在/孤立碎镜等没有采纳钮，只提示。
 *  - 采纳后方案变化 → 自动重查 → 建议消失（「已采纳」由消失本身表达，不做双份状态）。
 */
export type StoryboardPlanStrategyPanelProps = {
  projectId?: string | null
  plan: StoryboardPlan
  onChange: (plan: StoryboardPlan) => void
  /** 真机省略（自动走 getDesktopBridge）；测试注入假面。 */
  client?: StoryboardResolveClient | null
}

type PanelState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'unavailable' }
  | { status: 'error' }
  | { status: 'ready'; view: ResolveStrategyView }

export default function StoryboardPlanStrategyPanel(props: StoryboardPlanStrategyPanelProps): JSX.Element | null {
  const { t } = useTranslation()
  const { plan, projectId, onChange } = props
  const [state, setState] = React.useState<PanelState>({ status: 'idle' })

  // 只在「引擎投影输入」变化时重查：投影不含 prompt/绑定等文本字段，打字改 prompt 不会触发无谓 IPC。
  const projectionKey = React.useMemo(
    () => (projectId ? JSON.stringify(storyboardPlanToPlanShotInputs(plan)) : ''),
    [plan, projectId],
  )

  React.useEffect(() => {
    if (!projectId || !projectionKey || projectionKey === '[]') {
      setState({ status: 'idle' })
      return
    }
    let cancelled = false
    setState({ status: 'loading' })
    void fetchStoryboardResolve(plan, projectId, props.client).then((envelope) => {
      if (cancelled) return
      if (!envelope) {
        setState({ status: 'unavailable' })
        return
      }
      if (!envelope.ok) {
        setState({ status: envelope.error.code === 'generation_core_unavailable' ? 'unavailable' : 'error' })
        return
      }
      setState({ status: 'ready', view: classifyResolveStrategy(envelope.value) })
    })
    return () => {
      cancelled = true
    }
    // 投影 key 已编码 plan 的裁决字段；直接依赖 plan 会让每次编辑（含 prompt 打字）都重查一次 IPC。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectionKey, projectId, props.client])

  if (state.status === 'idle') return null
  if (state.status === 'loading') return <StatusBar stateKey="loading">{t('storyboardEditor.strategy.resolving')}</StatusBar>
  if (state.status === 'unavailable') return <StatusBar stateKey="unavailable">{t('storyboardEditor.strategy.unavailable', { code: 'generation_core_unavailable' })}</StatusBar>
  if (state.status === 'error') return <StatusBar stateKey="error">{t('storyboardEditor.strategy.error')}</StatusBar>

  const { view } = state
  const total = view.requiredMerges.length + view.mergeSuggestions.length + view.splits.length + view.blockers.length
  if (total === 0) {
    return (
      <StatusBar stateKey="clear">
        <span className="inline-flex items-center gap-1">
          <IconCheck size={12} stroke={2} />
          {t('storyboardEditor.strategy.noIssues')}
        </span>
      </StatusBar>
    )
  }

  return (
    <section
      className="rounded-nomi border border-nomi-line bg-nomi-paper shadow-nomi-sm overflow-hidden"
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
        {view.requiredMerges.map((proposal) => (
          <ProposalRow
            key={proposal.id}
            tone="required"
            badge={t('storyboardEditor.strategy.requiredBadge')}
            summary={`${proposal.shotIds.map((id) => shotTagText(plan, id, t)).join(' + ')} → ${t('storyboardEditor.strategy.merge')}`}
            reason={proposal.reason}
            adoptLabel={t('storyboardEditor.strategy.adopt')}
            whyLabel={t('storyboardEditor.strategy.why')}
            onAdopt={() => onChange(applyMergeSuggestion(plan, proposal))}
          />
        ))}
        {view.mergeSuggestions.map((proposal) => (
          <ProposalRow
            key={proposal.id}
            tone="advisory"
            badge={t('storyboardEditor.strategy.advisoryBadge')}
            summary={`${proposal.shotIds.map((id) => shotTagText(plan, id, t)).join(' + ')} → ${t('storyboardEditor.strategy.merge')}`}
            reason={proposal.reason}
            adoptLabel={t('storyboardEditor.strategy.adopt')}
            whyLabel={t('storyboardEditor.strategy.why')}
            onAdopt={() => onChange(applyMergeSuggestion(plan, proposal))}
          />
        ))}
        {view.splits.map((proposal) => (
          <ProposalRow
            key={`${proposal.shotId}-${proposal.durationSec}`}
            tone="required"
            badge={t('storyboardEditor.strategy.split')}
            summary={`${shotTagText(plan, proposal.shotId, t)} → ${t('storyboardEditor.strategy.split')} ${proposal.pieces.map((piece) => `${piece.durationSec}s`).join(' + ')}`}
            reason={proposal.reason}
            adoptLabel={t('storyboardEditor.strategy.adopt')}
            whyLabel={t('storyboardEditor.strategy.why')}
            onAdopt={() => onChange(applySplitSuggestion(plan, proposal))}
          />
        ))}
        {view.blockers.length > 0 ? (
          <div className="py-1 text-caption font-medium text-nomi-danger" data-storyboard-strategy-blockers-heading="true">
            {t('storyboardEditor.strategy.blockersHeading')}
          </div>
        ) : null}
        {view.blockers.map((issue, index) => (
          <div
            key={`${issue.shotId ?? 'plan'}-${issue.code}-${index}`}
            className="flex items-start gap-1.5 py-1 text-caption text-nomi-danger"
            data-storyboard-strategy-blocker="true"
          >
            <IconAlertTriangle size={13} stroke={1.8} className="shrink-0 mt-[3px]" />
            <span className="min-w-0">{issue.message}</span>
          </div>
        ))}
      </div>
    </section>
  )
}

function StatusBar({ children, stateKey }: { children: React.ReactNode; stateKey: 'loading' | 'unavailable' | 'error' | 'clear' }): JSX.Element {
  return (
    <div
      data-storyboard-strategy-root="true"
      data-storyboard-strategy-state={stateKey}
      className="rounded-nomi border border-nomi-line-soft bg-nomi-ink-05 px-3 py-1.5 text-caption text-nomi-ink-60"
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
            className="shrink-0 inline-flex items-center gap-1 h-5 px-2 rounded-full bg-nomi-accent text-white text-micro font-medium hover:opacity-90"
          >
            <IconCheck size={12} stroke={2} />
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

function shotTagText(plan: StoryboardPlan, shotId: string, t: (key: string, options?: Record<string, unknown>) => string): string {
  const shot = plan.shots.find((candidate) => (candidate.shotId ?? `shot-${candidate.index}`) === shotId)
  if (!shot) return shotId
  return t('storyboardEditor.strategy.shotTag', { index: shot.index, seconds: shot.durationSec })
}
