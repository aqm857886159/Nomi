import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '../../../utils/cn'
import { IconCloud, IconCoin, IconFileText, IconRobot, IconMovie, IconPhoto, IconUser } from '@tabler/icons-react'
import { DecisionBar, DesignModal, NOMI_OVERLAY_Z_INDEX, WorkbenchButton } from '../../../design'
import { useSpendConfirmStore, type SpendConfirmState } from './spendConfirm'
import { ProductionContractSummary } from './ProductionContractSummary'
import { MultiShotContractSummary } from './MultiShotContractSummary'
import { AnchorCheckpointCard } from './AnchorCheckpointCard'
import type { MultiShotContractProjection } from './productionContractView'
import { PlanRows } from '../../shared/PlanRows'

// 付费生成确认对话框（单一收口，挂一次于工作区根）。极简：标题 + 一句人话 + 取消/确认。
// 三种来源共用这一个对话框（不另造并行卡，P1）：
// - 用户直发：只有一下跑 ≥2 个 / 首次托管告知时才走到这里（判据 spendConfirmationRequirement；
//   用户自己点的单个生成直接开始）。「本会话不再提示」2026-09-09 已删。
// - agent 受理：每次必确认。
// - 外部 AI 助手（MCP，source='agent'）：换机器人图标 + 明细行。
// 审批卡**永不因空闲超时**（2026-09-11 用户拍板）：没有倒计时、没有到点自动决定。钱的闸只有真人能决，
// 等多久都行——外部调用方那头的超时是它自己的事，不该由我们替用户按下「未确认」。
export function SpendConfirmDialog() {
  const { t } = useTranslation()
  const pending = useSpendConfirmStore((state) => state.pending)
  const resolvePending = useSpendConfirmStore((state) => state.resolvePending)
  const togglePlanRow = useSpendConfirmStore((state) => state.togglePlanRow)
  const [rememberHosting, setRememberHosting] = React.useState(false)
  // B1：方向门单选（默认选第一个候选）。换 pending 时重置到第一个。
  const directionCandidates = pending?.directionCandidates ?? []
  const [choiceKey, setChoiceKey] = React.useState<string | null>(null)
  // B3 无障碍保障（花钱确认比破坏性删除更重）：外壳是共用的 DesignModal（2026-11-09 起，设计系统 §3.5）——
  // 三种宽度给 size、内容区滚动 + 固定决定栏给 actions 插槽，于是原来那套手写壳（遮罩、焦点陷阱、Esc、
  // 输入层登记、高度上限）整套删掉，由外壳给：Esc 可关、焦点陷阱、role/aria-modal/aria-labelledby、层级 dialog(9100)。
  // 这里只留外壳给不了的两件：返回焦点（卡是挂上 / 卸下，不是开 / 关，Mantine 的还焦点不触发）、回车 = 主动作。
  const open = Boolean(pending)

  // 返回焦点：记住打开这张卡之前的焦点元素，关闭时还回去（队列里换 pending 不重置，只在整卡开/关时动）。
  React.useEffect(() => {
    if (!open) return
    const previous = document.activeElement
    const trigger = previous instanceof HTMLElement ? previous : null
    return () => {
      if (!trigger || !trigger.isConnected) return
      // 等这一帧的卸载走完再还焦点，否则会被 React 拆 DOM 时的 blur 抹掉。
      window.setTimeout(() => {
        if (trigger.isConnected) trigger.focus({ preventScroll: true })
      }, 0)
    }
  }, [open])

  // E2E 专用桥（照 ConfirmDialogHost 既有写法）：仅当 localStorage['__nomiE2E']==='1' 时把**真实**
  // requestConfirm 挂到 window，供 R13 走查在真 app 里驱动同一条渲染管线取证键盘/无障碍保障
  // （见 tests/ux/spend-confirm-a11y.walk.mjs）。生产从不置该标志 → 永不暴露，非并行实现。
  React.useEffect(() => {
    try {
      if (typeof window !== 'undefined' && window.localStorage?.getItem('__nomiE2E') === '1') {
        ;(window as unknown as { __nomiSpendConfirmE2E?: SpendConfirmState['requestConfirm'] }).__nomiSpendConfirmE2E =
          useSpendConfirmStore.getState().requestConfirm
      }
    } catch {
      // localStorage 不可用 → 跳过
    }
  }, [])

  const isMultiShot = pending?.kind === 'contract' && Boolean(pending.contract?.shotList)
  // P4 §3.2 形象确认卡：与多镜卡同款「滚动内容区 + 固定决定栏」（~560px），决定栏是它自己的（先不拍/开拍/重拍）。
  const isAnchorCheckpoint = pending?.kind === 'anchorCheckpoint' && Boolean(pending.anchorCheckpoint)

  React.useEffect(() => {
    setChoiceKey(pending?.directionCandidates?.[0]?.key ?? null)
    setRememberHosting(false)
  }, [pending])

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
  const primaryAction = (): void => {
    if (incompletePolicy) {
      const openPolicySettings = pending.onOpenPolicySettings
      resolvePending(false)
      openPolicySettings?.()
      return
    }
    if (directionCandidates.length) pending.onDirectionDecision?.(choiceKey)
    resolvePending(true, rememberHosting)
  }

  const width = pending.kind === 'contract' ? 680 : isAnchorCheckpoint ? 560 : 380
  const close = (): void => resolvePending(false)
  const header = (
    <span className={cn('flex min-w-0 items-center gap-2.5')}>
      <span
        className={cn(
          'shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-nomi',
          isAgent ? 'bg-nomi-ink text-nomi-paper' : 'bg-nomi-accent-soft text-nomi-accent',
        )}
      >
        <Icon size={18} aria-hidden />
      </span>
      <span className={cn('min-w-0 flex-1')}>
        <span className={cn('block text-title font-medium text-nomi-ink truncate')}>{pending.title}</span>
        {isAgent ? (
          <span className={cn('block text-micro text-nomi-ink-60')}>
            {/* 方案门免费 → 副标不提「花费」（否则与「不花额度」正文自相矛盾，2026-08-02 走查抓出）。 */}
            {t(pending.kind === 'plan' ? 'generationCommon.spend.agentNoticePlan' : 'generationCommon.spend.agentNotice')}
          </span>
        ) : null}
      </span>
    </span>
  )
  // 外壳：层级用 dialog(9100)——高过任务中心(floatingPanel 4000)，低过破坏性 confirmation(9300) 好让它能叠在本卡之上。
  // 动画关掉：点下去的同一帧就出来（SpendConfirmHost 的约定），也不给卡里的看大图层（fixed）造出 transform 容器。
  const frame = (content: JSX.Element, actions: JSX.Element): JSX.Element => (
    <DesignModal
      opened
      onClose={close}
      centered
      size={width}
      padding="md"
      zIndex={NOMI_OVERLAY_Z_INDEX.dialog}
      transitionProps={{ duration: 0 }}
      title={header}
      closeButtonProps={{ 'aria-label': t('common.close') }}
      // 打开时焦点落在对话框本体（读屏会念标题），**刻意不落在「确认花钱」上**——那是不可逆动作，不该被一个回车顺手按掉。
      initialFocus="dialog"
      // 回车 = 主动作，但只在焦点停在对话框本体（或卡里非控件处）时：焦点在按钮 / 输入框上时回车归那个控件。
      // 挂在弹窗根上（Modal 把其余属性给根），卡里冒上来的键都经过这里，和迁移前挂在卡上同一个判据。
      onKeyDown={(event) => {
        if (event.key !== 'Enter') return
        const target = event.target as HTMLElement | null
        if (target?.closest('button, input, textarea, select, [contenteditable="true"]')) return
        event.preventDefault()
        primaryAction()
      }}
      // 走查/工具的稳定锚点落在对话框本体（带 role="dialog" 的那一层）上。
      contentAttributes={{ 'data-spend-confirm-dialog': pending.kind ?? 'generation' }}
      classNames={{
        content: 'rounded-nomi-lg border border-nomi-line bg-nomi-paper shadow-nomi-md outline-none',
        header: 'min-h-0 pb-2 bg-nomi-paper',
        // Mantine 的标题行距是 1；这里标题下还有一行 Agent 副标，行距跟回正文（迁移前手写标题栏的样子）。
        title: 'min-w-0 flex-1 leading-[inherit]',
      }}
      actions={actions}
    >
      {content}
    </DesignModal>
  )

  if (isAnchorCheckpoint && pending.anchorCheckpoint) {
    return (
      <AnchorCheckpointCard
        model={pending.anchorCheckpoint}
        onApprove={() => resolvePending(true, false)}
        onDefer={() => resolvePending(false)}
        onRework={(shotIds) => {
          const cb = pending.onRework
          resolvePending(false)
          cb?.(shotIds)
        }}
        layout={({ content, footer }) => frame(content, footer)}
      />
    )
  }
  if (isMultiShot && pending.contract?.shotList) {
    const parts = multiShotCardParts({
      view: pending.contract,
      list: pending.contract.shotList,
      message: pending.message,
      confirmLabel: pending.confirmLabel,
      onBackToEdit: () => {
        const cb = pending.onBackToEdit
        resolvePending(false)
        cb?.()
      },
      onTrialFirst: () => {
        const cb = pending.onTrialFirst
        resolvePending(false)
        cb?.()
      },
      onIgnore: () => resolvePending(false),
      onConfirm: () => resolvePending(true, false),
      t,
    })
    return frame(parts.content, parts.footer)
  }

  return frame(
    <>
      <p className={cn('text-body-sm text-nomi-ink-80 leading-relaxed mb-3 whitespace-pre-line')}>{pending.message}</p>

      {pending.planRows?.length ? (
        <PlanRows rows={pending.planRows} onToggle={togglePlanRow} className="mb-3" />
      ) : null}

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
                  selected ? 'border-transparent bg-nomi-accent-soft' : 'border-nomi-line hover:border-nomi-ink-30',
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
    </>,
    <DecisionBar
      cancelLabel={pending.cancelLabel || (isAgent ? t('generationCommon.spend.ignore') : t('generationCommon.spend.cancel'))}
      onCancel={() => resolvePending(false)}
      cancelProps={{ 'data-spend-confirm-action': 'cancel' }}
      primaryLabel={incompletePolicy ? t('generationCommon.production.gate.openProductionPolicy') : (pending.confirmLabel || t('generationCommon.spend.confirm'))}
      onPrimary={primaryAction}
      primaryProps={{ 'data-spend-confirm-action': incompletePolicy ? 'open-policy' : 'confirm' }}
      primaryHint="Enter"
    />,
  )
}

/** 人话金额（整数不带小数，非整保留两位）。多镜卡的费用块专用（不引 Intl 货币前缀，避免和「¥」重复）。 */
function formatAmount(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2)
}

/**
 * P4 S3a 多镜确认卡的两块：内容（一句正文 + 规格/主角/清单）进弹窗中间那块滚；
 * 决定栏（费用块 / 冻结项 / 按钮）进外壳的决定栏插槽，恒在不滚出（设计系统 §3.5）。
 */
function multiShotCardParts(props: {
  view: import('./productionContractView').ProductionContractView
  list: MultiShotContractProjection
  message: string
  confirmLabel?: string
  onBackToEdit: () => void
  onTrialFirst: () => void
  onIgnore: () => void
  onConfirm: () => void
  t: (key: string, opts?: Record<string, unknown>) => string
}): { content: JSX.Element; footer: JSX.Element } {
  const { view, list, message, confirmLabel, t } = props
  const firstShotPrice = list.shots[0]?.price
  const trialLabel = firstShotPrice?.known
    ? t('generationCommon.production.batch.trialFirst', { amount: formatAmount(firstShotPrice.amount) })
    : t('generationCommon.production.batch.trialFirstUnknown')
  // 内容：一句正文 + 规格条/主角 chips/汇总/逐镜清单。滚动归弹窗外壳中间那块。
  const content = (
    <div>
      <p className={cn('text-body-sm text-nomi-ink-80 leading-relaxed mb-3 whitespace-pre-line')}>{message}</p>
      <MultiShotContractSummary view={view} />
    </div>
  )
  // 决定栏：不随清单滚。费用块 → 冻结项 → 按钮区。
  const footer = (
    <div className={cn('grid gap-2.5 border-t border-nomi-line pt-3')} data-production-footer>
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
  )
  return { content, footer }
}

/**
 * 付费确认卡在整个 app 里唯一的挂载点：画布、列表、分镜、Agent、试用与取回等所有确认请求都经 requestConfirm
 * 进同一个队列，由这里把队首变成画面。工作台根组件静态引入它，不能「用到才加载」：按需加载时，每次打开 Nomi
 * 后第一张卡要先挂起等代码，React 19 揭开挂起内容又固定节流 300ms，用户点了生成、屏幕上 0.3 秒什么都没有。
 * 渲染仍然按需：没有待确认时不挂卡。
 */
export function SpendConfirmHost(): JSX.Element | null {
  const pending = useSpendConfirmStore((state) => Boolean(state.pending))
  return pending ? <SpendConfirmDialog /> : null
}
