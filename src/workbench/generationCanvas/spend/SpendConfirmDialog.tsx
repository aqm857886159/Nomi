import React from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '../../../utils/cn'
import { IconCloud, IconCoin, IconFileText, IconRobot, IconMovie, IconPhoto, IconUser } from '@tabler/icons-react'
import { BodyPortal, NOMI_OVERLAY_Z_INDEX, WorkbenchButton } from '../../../design'
import { useSpendConfirmStore } from './spendConfirm'
import { ProductionContractSummary } from './ProductionContractSummary'
import { MultiShotContractSummary } from './MultiShotContractSummary'
import { AnchorCheckpointCard } from './AnchorCheckpointCard'
import type { MultiShotContractProjection } from './productionContractView'

// 付费生成确认对话框（单一收口，挂一次于工作区根）。极简：标题 + 一句人话 + 取消/确认。
// 三种来源共用这一个对话框（不另造并行卡，P1）：
// - 用户直发（light）：多一个「本会话不再提示」。
// - agent 受理（不 light）：每次必确认。
// - 外部 AI 助手（MCP，source='agent'）：换机器人图标 + 明细行 + 倒计时（到点自动按未确认返回，不死等）。
export function SpendConfirmDialog() {
  const { t } = useTranslation()
  const pending = useSpendConfirmStore((state) => state.pending)
  const resolvePending = useSpendConfirmStore((state) => state.resolvePending)
  const [suppress, setSuppress] = React.useState(false)
  const [rememberHosting, setRememberHosting] = React.useState(false)
  const [remainingMs, setRemainingMs] = React.useState(0)
  // P4 S3a：多镜确认卡「交互即暂停」——用户一旦在卡上动一下（点/移入/聚焦），倒计时停在原地，
  // 文案切「已暂停 · 你正在查看」。换 pending 时重置。只对多镜卡生效（外部单发确认仍到点自动返回）。
  const [interacted, setInteracted] = React.useState(false)
  // B1：方向门单选（默认选第一个候选）。换 pending 时重置到第一个。
  const directionCandidates = pending?.directionCandidates ?? []
  const [choiceKey, setChoiceKey] = React.useState<string | null>(null)

  const isMultiShot = pending?.kind === 'contract' && Boolean(pending.contract?.shotList)
  // P4 §3.2 形象确认卡：与多镜卡同款「滚动内容区 + 固定 footer」布局（~560px），自渲染 footer（先不拍/开拍/重拍）。
  const isAnchorCheckpoint = pending?.kind === 'anchorCheckpoint' && Boolean(pending.anchorCheckpoint)
  const flexShell = isMultiShot || isAnchorCheckpoint
  const countdownPaused = isMultiShot && interacted

  React.useEffect(() => {
    if (!pending) setSuppress(false)
    setChoiceKey(pending?.directionCandidates?.[0]?.key ?? null)
    setInteracted(false)
    setRememberHosting(false)
  }, [pending])

  // 倒计时：设了 countdownMs 才跑。每 200ms 收敛，到点自动按「未确认」返回（不死等——外部调用方那头在等）。
  // 多镜卡交互后暂停：freeze remainingMs、停 tick（交互即暂停是 S3a 拍板，倒计时是「无人看时」的兜底）。
  React.useEffect(() => {
    if (!pending?.countdownMs) {
      setRemainingMs(0)
      return
    }
    if (countdownPaused) return
    const total = pending.countdownMs
    // 暂停后再无交互（不会发生，但安全起见）从当前剩余续跑，而不是从头。
    const base = remainingMs > 0 && remainingMs <= total ? remainingMs : total
    const startedAt = Date.now()
    setRemainingMs(base)
    const tick = window.setInterval(() => {
      const left = base - (Date.now() - startedAt)
      if (left <= 0) {
        window.clearInterval(tick)
        resolvePending(false)
      } else {
        setRemainingMs(left)
      }
    }, 200)
    return () => window.clearInterval(tick)
    // remainingMs 故意不进依赖：它每 tick 变，进依赖会重启 interval。base 只在挂载/pending/暂停切换时取一次。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, resolvePending, countdownPaused])

  if (!pending) return null

  const isAgent = pending.source === 'agent'
  const incompletePolicy = pending.kind === 'contract' && pending.contract && !pending.contract.policy.ready
  // 图标按门类派生（Phase B）：方案门=分镜、参考图门=相机、生成门=机器人(agent)/金币(用户直发)。
  const Icon = pending.kind === 'contract'
    ? IconFileText
    : pending.kind === 'plan'
      ? IconMovie
      : pending.kind === 'reference'
        ? IconPhoto
        : pending.kind === 'anchorCheckpoint'
          ? IconUser
          : isAgent ? IconRobot : IconCoin
  const countdownTotal = pending.countdownMs || 0
  const remainingSec = countdownTotal ? Math.ceil(remainingMs / 1000) : 0
  const remainingPct = countdownTotal ? Math.max(0, Math.min(100, (remainingMs / countdownTotal) * 100)) : 0

  return (
    // BodyPortal + 中央 z 层级（overlayLayers 契约：全局浮层都 portal 到 body 消费统一层级）——
    // 之前裸 z-[3500] 挂在 app 树里，被 body 级任务中心 Portal（floatingPanel:4000）盖住裁掉半张卡
    // （门确认卡多半从任务中心 run 卡点开，680px 合同卡 / 560px 形象卡尤其明显，2026-08-25 走查抓出）。
    // 用 dialog(9100)：高过任务中心，低过破坏性 confirmation(9300) 好让它能叠在本卡之上。
    <BodyPortal>
    <div
      // 全屏固定模态：付费/确认是全局阻断性动作，要盖住整窗（含顶栏/侧栏/任务中心），任意视图（库/studio）都能弹。
      className={cn('fixed inset-0 flex items-center justify-center bg-nomi-ink/20 pointer-events-auto')}
      style={{ zIndex: NOMI_OVERLAY_Z_INDEX.dialog }}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) resolvePending(false)
      }}
    >
      <div
        className={cn(
          pending.kind === 'contract' ? 'w-[680px]' : isAnchorCheckpoint ? 'w-[560px]' : 'w-[380px]',
          'max-h-[88vh] max-w-[88%] rounded-nomi-lg border border-nomi-line bg-nomi-paper p-4 shadow-nomi-md',
          // 多镜卡 / 形象卡：flex 列 + footer shrink-0，内容区滚动、footer 恒在（清单/网格另有内滚）。
          flexShell ? 'flex flex-col overflow-hidden' : 'overflow-y-auto',
        )}
        // 多镜卡「交互即暂停」：任意鼠标/键盘触达即冻结倒计时。
        {...(isMultiShot
          ? {
              onPointerDownCapture: () => setInteracted(true),
              onKeyDownCapture: () => setInteracted(true),
              onMouseEnter: () => setInteracted(true),
            }
          : {})}
      >
        <div className={cn('flex items-center gap-2.5 mb-2', flexShell ? 'shrink-0' : '')}>
          <span
            className={cn(
              'shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-nomi',
              isAgent ? 'bg-nomi-ink text-nomi-paper' : 'bg-nomi-accent-soft text-nomi-accent',
            )}
          >
            <Icon size={18} aria-hidden />
          </span>
          <div className={cn('min-w-0')}>
            <p className={cn('text-title font-medium text-nomi-ink truncate')}>{pending.title}</p>
            {isAgent ? (
              <p className={cn('text-micro text-nomi-ink-60')}>
                {/* 方案门免费 → 副标不提「花费」（否则与「不花额度」正文自相矛盾，2026-08-02 走查抓出）。 */}
                {t(pending.kind === 'plan' ? 'generationCommon.spend.agentNoticePlan' : 'generationCommon.spend.agentNotice')}
              </p>
            ) : null}
          </div>
        </div>

        {isAnchorCheckpoint && pending.anchorCheckpoint ? (
          // 形象确认卡：自渲染 flex-1 滚动内容区（网格 + 承诺）+ shrink-0 固定 footer（先不拍/开拍/重拍），
          // 与 MultiShotCardBody 同款 fragment，由这个 flex 列直接摊开（不再外包滚动容器）。
          <AnchorCheckpointCard
            model={pending.anchorCheckpoint}
            onApprove={() => resolvePending(true, false)}
            onDefer={() => resolvePending(false)}
            onRework={(shotIds) => {
              const cb = pending.onRework
              resolvePending(false)
              cb?.(shotIds)
            }}
          />
        ) : isMultiShot && pending.contract?.shotList ? (
          <MultiShotCardBody
            view={pending.contract}
            list={pending.contract.shotList}
            message={pending.message}
            countdownTotal={countdownTotal}
            remainingSec={remainingSec}
            remainingPct={remainingPct}
            countdownPaused={countdownPaused}
            confirmLabel={pending.confirmLabel}
            onBackToEdit={() => {
              const cb = pending.onBackToEdit
              resolvePending(false)
              cb?.()
            }}
            onTrialFirst={() => {
              const cb = pending.onTrialFirst
              resolvePending(false)
              cb?.()
            }}
            onIgnore={() => resolvePending(false)}
            onConfirm={() => resolvePending(true, false)}
            t={t}
          />
        ) : (
        <>
        <p className={cn('text-body-sm text-nomi-ink-80 leading-relaxed mb-3')}>{pending.message}</p>

        {pending.hostingDisclosure ? (
          // 「记住我的选择」住在披露块**内部**，不和下面「本次会话不再提示」并排。
          // 起因（2026-08-26 用户拍板）：两个勾选框曾贴在一起、长得一模一样，但管的是两件事、
          // 两种作用域——一个管这张花钱卡（本会话），一个把 anonymousAssetHosting 永久设成 allow。
          // 并排时得逐字读标签才分得清，误勾的代价是「以后本机素材静默上传公共托管」。
          // 按 §1.5.3「先分组」：把勾选框搬进它作用的那个对象里，作用域一眼可见（也是「一功能一个家」的视觉版）。
          <div
            data-hosting-disclosure="true"
            className={cn('mb-3 flex gap-2 rounded-nomi-sm bg-nomi-ink-05 px-3 py-2.5 text-caption leading-relaxed text-nomi-ink-80')}
          >
            <IconCloud size={17} stroke={1.7} className={cn('mt-0.5 shrink-0 text-nomi-ink-60')} aria-hidden="true" />
            <div className={cn('min-w-0 grid gap-2')}>
              <div className={cn('min-w-0')}>{pending.hostingDisclosure.message}</div>
              {/* 细分隔线：让「说明」与「这条说明对应的选择」分段，但仍同属一张托管卡（§1.5.3 分段要有边界）。 */}
              <label
                data-hosting-remember="true"
                className={cn('flex items-center gap-2 border-t border-nomi-line-soft pt-2 cursor-pointer select-none text-nomi-ink-60')}
              >
                <input
                  type="checkbox"
                  checked={rememberHosting}
                  onChange={(event) => setRememberHosting(event.currentTarget.checked)}
                />
                {pending.hostingDisclosure.rememberLabel}
              </label>
            </div>
          </div>
        ) : null}

        {directionCandidates.length ? (
          <div className={cn('mb-3 grid gap-1.5')} role="radiogroup" data-direction-candidates>
            {directionCandidates.map((candidate) => {
              const selected = candidate.key === choiceKey
              return (
                <button
                  key={candidate.key}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  data-direction-candidate={candidate.key}
                  data-direction-selected={selected ? 'true' : 'false'}
                  onClick={() => setChoiceKey(candidate.key)}
                  className={cn(
                    'grid gap-0.5 rounded-nomi-sm border px-2.5 py-2 text-left transition-colors cursor-pointer',
                    selected ? 'border-nomi-accent bg-nomi-accent-soft' : 'border-nomi-line hover:border-nomi-accent',
                  )}
                >
                  <span className={cn('text-caption font-medium text-nomi-ink')}>{candidate.title}</span>
                  <span className={cn('text-micro text-nomi-ink-60')}>{candidate.oneLiner}</span>
                </button>
              )
            })}
          </div>
        ) : null}

        {pending.kind === 'contract' && pending.contract ? (
          <ProductionContractSummary view={pending.contract} />
        ) : null}

        {incompletePolicy ? (
          <div
            data-production-policy-readiness="incomplete"
            className={cn('mt-3 rounded-nomi-sm border border-nomi-warning/40 bg-nomi-warning/10 px-3 py-2 text-caption leading-relaxed text-nomi-ink-80')}
          >
            <div className={cn('font-semibold text-nomi-ink')}>
              {t('generationCommon.production.gate.missingPolicyTitle', { count: pending.contract!.policy.issueCount })}
            </div>
            <div className={cn('mt-1 grid gap-0.5')}>
              {pending.contract!.policy.missingHardBudget ? (
                <div data-production-policy-issue="budget">{t('generationCommon.production.gate.missingPolicyBudget')}</div>
              ) : null}
              {pending.contract!.policy.missingProviders.length ? (
                <div data-production-policy-issue="providers">
                  {t('generationCommon.production.gate.missingPolicyProviders', { providers: pending.contract!.policy.missingProviders.join(', ') })}
                </div>
              ) : null}
              {pending.contract!.policy.missingModels.length ? (
                <div data-production-policy-issue="models">
                  {t('generationCommon.production.gate.missingPolicyModels', { models: pending.contract!.policy.missingModels.join(', ') })}
                </div>
              ) : null}
            </div>
            <div className={cn('mt-1 text-nomi-ink-60')}>
              {t('generationCommon.production.gate.missingPolicyMessage')}
            </div>
          </div>
        ) : null}

        {pending.kind !== 'contract' && pending.details?.length ? (
          <div className={cn('mb-3 rounded-nomi-sm border border-nomi-line-soft divide-y divide-nomi-line-soft')}>
            {pending.details.map((row) => (
              <div key={row.label} className={cn('flex items-center justify-between gap-3 px-2.5 py-1.5')}>
                <span className={cn('text-caption text-nomi-ink-60 shrink-0')}>{row.label}</span>
                <span className={cn('text-caption text-nomi-ink-80 font-medium text-right truncate')}>{row.value}</span>
              </div>
            ))}
          </div>
        ) : null}

        {countdownTotal ? (
          <div className={cn('flex items-center gap-2 mb-3')}>
            <div className={cn('flex-1 h-1 rounded-full bg-nomi-ink-05 overflow-hidden')}>
              <div
                className={cn('h-full rounded-full', remainingSec <= 10 ? 'bg-nomi-accent' : 'bg-nomi-ink-30')}
                style={{ width: `${remainingPct}%` }}
              />
            </div>
            <span className={cn('text-micro text-nomi-ink-60 tabular-nums shrink-0 w-[88px] text-right')}>
              {t('generationCommon.spend.autoIgnore', { seconds: remainingSec })}
            </span>
          </div>
        ) : null}

        {pending.light ? (
          <label
            className={cn('flex items-center gap-2 mb-4 cursor-pointer select-none text-caption text-nomi-ink-60')}
          >
            <input type="checkbox" checked={suppress} onChange={(event) => setSuppress(event.target.checked)} />
            {t('generationCommon.spend.suppressSession')}
          </label>
        ) : null}

        <div className={cn('flex items-center justify-end gap-2')}>
          <WorkbenchButton className={cn('h-8 px-4 cursor-pointer')} onClick={() => resolvePending(false)}>
            {pending.cancelLabel || (isAgent ? t('generationCommon.spend.ignore') : t('generationCommon.spend.cancel'))}
          </WorkbenchButton>
          {incompletePolicy ? (
            <WorkbenchButton
              className={cn('h-8 px-4 cursor-pointer bg-nomi-ink text-nomi-paper border-nomi-ink hover:bg-nomi-accent hover:text-nomi-paper')}
              onClick={() => {
                const openPolicySettings = pending.onOpenPolicySettings
                resolvePending(false)
                openPolicySettings?.()
              }}
            >
              {t('generationCommon.production.gate.openProductionPolicy')}
            </WorkbenchButton>
          ) : (
            <WorkbenchButton
              className={cn(
                'h-8 px-4 cursor-pointer bg-nomi-ink text-nomi-paper border-nomi-ink hover:bg-nomi-accent hover:text-nomi-paper',
              )}
              onClick={() => {
                // B1：方向门确认时先回传选中候选（沿用 onOpenPolicySettings 的回调模式），再 resolve。
                if (directionCandidates.length) pending.onDirectionDecision?.(choiceKey)
                resolvePending(true, suppress, rememberHosting)
              }}
            >
              {pending.confirmLabel || t('generationCommon.spend.confirm')}
            </WorkbenchButton>
          )}
        </div>
        </>
        )}
      </div>
    </div>
    </BodyPortal>
  )
}

/** 人话金额（整数不带小数，非整保留两位）。多镜卡的费用块专用（不引 Intl 货币前缀，避免和「¥」重复）。 */
function formatAmount(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2)
}

/**
 * P4 S3a 多镜确认卡的 body + 固定 footer。抽成独立组件（SpendConfirmDialog 已近上限，且这块自成一体）。
 * 内容区（一句正文 + 规格/主角/清单）滚动、footer（费用块 / 冻结项 / 倒计时 / 按钮）恒在不滚出。
 */
function MultiShotCardBody(props: {
  view: import('./productionContractView').ProductionContractView
  list: MultiShotContractProjection
  message: string
  countdownTotal: number
  remainingSec: number
  remainingPct: number
  countdownPaused: boolean
  confirmLabel?: string
  onBackToEdit: () => void
  onTrialFirst: () => void
  onIgnore: () => void
  onConfirm: () => void
  t: (key: string, opts?: Record<string, unknown>) => string
}): JSX.Element {
  const { view, list, message, countdownTotal, remainingSec, remainingPct, countdownPaused, confirmLabel, t } = props
  const firstShotPrice = list.shots[0]?.price
  const trialLabel = firstShotPrice?.known
    ? t('generationCommon.production.batch.trialFirst', { amount: formatAmount(firstShotPrice.amount) })
    : t('generationCommon.production.batch.trialFirstUnknown')
  return (
    <>
      {/* 内容区：一句正文 + 规格条/主角 chips/汇总/逐镜清单。flex-1 可滚（清单本身另有 ~40vh 内滚）。 */}
      <div className={cn('flex-1 min-h-0 overflow-y-auto')}>
        <p className={cn('text-body-sm text-nomi-ink-80 leading-relaxed mb-3')}>{message}</p>
        <MultiShotContractSummary view={view} />
      </div>

      {/* 固定 footer：不随清单滚。费用块 → 冻结项 → 倒计时 → 按钮区。 */}
      <div className={cn('shrink-0 mt-3 grid gap-2.5 border-t border-nomi-line pt-3')} data-production-footer>
        {/* 费用块：左「预估合计 + 单镜返工承诺句」 | 右「最多花费 ≤¥X」。 */}
        <div className={cn('flex items-start justify-between gap-4')}>
          <div className={cn('min-w-0 grid gap-0.5')}>
            <span className={cn('text-body-sm font-semibold text-nomi-ink')} data-production-estimate-total>
              {list.unknownShotCount > 0
                ? t('generationCommon.production.batch.estimateTotalWithUnknown', {
                    amount: formatAmount(list.knownSubtotal),
                    count: list.unknownShotCount,
                  })
                : t('generationCommon.production.batch.estimateTotal', { amount: formatAmount(list.knownSubtotal) })}
            </span>
            <span className={cn('text-caption text-nomi-ink-60')}>
              {t('generationCommon.production.batch.retryPromise')}
            </span>
          </div>
          <span
            data-production-hard-limit={list.hardLimit === null ? 'unset' : 'set'}
            className={cn(
              'shrink-0 text-body-sm font-semibold tabular-nums text-right',
              list.hardLimit === null ? 'text-nomi-warning' : 'text-nomi-ink',
            )}
          >
            {list.hardLimit === null
              ? t('generationCommon.production.batch.maxSpendUnset')
              : t('generationCommon.production.batch.maxSpend', { amount: formatAmount(list.hardLimit) })}
          </span>
        </div>

        {/* 冻结项一行：确认后不可再改（镜头清单/模型/参考/价格）。 */}
        {list.frozenItems.length ? (
          <div className={cn('text-micro text-nomi-ink-60')} data-production-frozen-items>
            {t('generationCommon.production.batch.frozenLead')}
            {list.frozenItems
              .map((item) => t(`generationCommon.production.batch.frozen.${item}`))
              .join(' · ')}
          </div>
        ) : null}

        {/* 倒计时条：交互即暂停（文案切「已暂停 · 你正在查看」）；时长随镜数伸缩由调用方给的 countdownMs 决定。 */}
        {countdownTotal ? (
          <div className={cn('flex items-center gap-2')} data-production-countdown={countdownPaused ? 'paused' : 'running'}>
            <div className={cn('flex-1 h-1 rounded-full bg-nomi-ink-05 overflow-hidden')}>
              <div
                className={cn('h-full rounded-full', countdownPaused ? 'bg-nomi-ink-20' : remainingSec <= 10 ? 'bg-nomi-accent' : 'bg-nomi-ink-30')}
                style={{ width: `${countdownPaused ? 100 : remainingPct}%` }}
              />
            </div>
            <span className={cn('text-micro text-nomi-ink-60 tabular-nums shrink-0 text-right')}>
              {countdownPaused
                ? t('generationCommon.production.batch.countdownPaused')
                : t('generationCommon.production.batch.countdownAuto', { seconds: remainingSec })}
            </span>
          </div>
        ) : null}

        {/* 按钮区：左「返回修改」「先试拍第 1 镜」文字链 | 右「忽略」次按钮 +「确认生成 N 镜」主按钮。 */}
        <div className={cn('flex items-center justify-between gap-2')}>
          <div className={cn('flex items-center gap-3 min-w-0')}>
            <button
              type="button"
              data-production-action="back-to-edit"
              onClick={props.onBackToEdit}
              className={cn('text-caption text-nomi-ink-60 hover:text-nomi-accent underline underline-offset-2 cursor-pointer')}
            >
              {t('generationCommon.production.batch.backToEdit')}
            </button>
            <button
              type="button"
              data-production-action="trial-first"
              onClick={props.onTrialFirst}
              className={cn('text-caption text-nomi-accent hover:text-nomi-ink underline underline-offset-2 cursor-pointer truncate')}
            >
              {trialLabel}
            </button>
          </div>
          <div className={cn('flex items-center gap-2 shrink-0')}>
            <WorkbenchButton
              className={cn('h-8 px-4 cursor-pointer')}
              data-production-action="ignore"
              onClick={props.onIgnore}
            >
              {t('generationCommon.production.batch.ignore')}
            </WorkbenchButton>
            <WorkbenchButton
              className={cn('h-8 px-4 cursor-pointer bg-nomi-ink text-nomi-paper border-nomi-ink hover:bg-nomi-accent hover:text-nomi-paper')}
              data-production-action="confirm"
              onClick={props.onConfirm}
            >
              {confirmLabel || t('generationCommon.production.batch.confirm', { count: list.shots.length })}
            </WorkbenchButton>
          </div>
        </div>
      </div>
    </>
  )
}
