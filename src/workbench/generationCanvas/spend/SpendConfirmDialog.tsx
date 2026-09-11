import React from 'react'
import { FocusTrap } from '@mantine/core'
import { useTranslation } from 'react-i18next'
import { cn } from '../../../utils/cn'
import { IconCloud, IconCoin, IconFileText, IconRobot, IconMovie, IconPhoto, IconUser } from '@tabler/icons-react'
import { BodyPortal, NOMI_OVERLAY_Z_INDEX, useOverlayEscape, WorkbenchButton } from '../../../design'
import { useSpendConfirmStore, type SpendConfirmState } from './spendConfirm'
import { ProductionContractSummary } from './ProductionContractSummary'
import { MultiShotContractSummary } from './MultiShotContractSummary'
import { AnchorCheckpointCard } from './AnchorCheckpointCard'
import type { MultiShotContractProjection } from './productionContractView'

// 付费生成确认对话框（单一收口，挂一次于工作区根）。极简：标题 + 一句人话 + 取消/确认。
// 三种来源共用这一个对话框（不另造并行卡，P1）：
// - 用户直发（light）：多一个「本会话不再提示」。
// - agent 受理（不 light）：每次必确认。
// - 外部 AI 助手（MCP，source='agent'）：换机器人图标 + 明细行。
// 审批卡**永不因空闲超时**（2026-09-11 用户拍板）：没有倒计时、没有到点自动决定。钱的闸只有真人能决，
// 等多久都行——外部调用方那头的超时是它自己的事，不该由我们替用户按下「未确认」。
export function SpendConfirmDialog() {
  const { t } = useTranslation()
  const pending = useSpendConfirmStore((state) => state.pending)
  const resolvePending = useSpendConfirmStore((state) => state.resolvePending)
  const [rememberHosting, setRememberHosting] = React.useState(false)
  // B1：方向门单选（默认选第一个候选）。换 pending 时重置到第一个。
  const directionCandidates = pending?.directionCandidates ?? []
  const [choiceKey, setChoiceKey] = React.useState<string | null>(null)
  // B3 无障碍保障（花钱确认比破坏性删除更重，此前 Esc/焦点/语义三样全缺）：
  // 手写壳保留（三种宽度 / 滚动内容区 + 固定 footer 是 Mantine Modal 结构给不了的），
  // 只补齐模态该有的四件事：Esc 可关、焦点陷阱、返回焦点、role/aria-modal/aria-labelledby。
  const cardRef = React.useRef<HTMLDivElement | null>(null)
  const titleId = React.useId()
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

  // Esc 关闭 = 取消/忽略。让位规则（本卡之上还叠着更高层对话框时不接管）住在共用原语里。
  useOverlayEscape(cardRef, open, () => resolvePending(false))

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
  // P4 §3.2 形象确认卡：与多镜卡同款「滚动内容区 + 固定 footer」布局（~560px），自渲染 footer（先不拍/开拍/重拍）。
  const isAnchorCheckpoint = pending?.kind === 'anchorCheckpoint' && Boolean(pending.anchorCheckpoint)
  const flexShell = isMultiShot || isAnchorCheckpoint

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

  return (
    // BodyPortal + 中央 z 层级（overlayLayers 契约：全局浮层都 portal 到 body 消费统一层级）——
    // 之前裸 z-[3500] 挂在 app 树里，被 body 级任务中心 Portal（floatingPanel:4000）盖住裁掉半张卡
    // （门确认卡多半从任务中心 run 卡点开，680px 合同卡 / 560px 形象卡尤其明显，2026-08-25 走查抓出）。
    // 用 dialog(9100)：高过任务中心，低过破坏性 confirmation(9300) 好让它能叠在本卡之上。
    <BodyPortal>
    {/* 焦点陷阱挂在遮罩上：Mantine 的 useFocusTrap 会在其中找 [data-autofocus]（= 下面的卡本体），
        并把 Tab 圈在遮罩内 —— 遮罩内除了卡没有别的可聚焦物，所以 Tab 出不去这张卡。 */}
    <FocusTrap>
    <div
      // 全屏固定模态：付费/确认是全局阻断性动作，要盖住整窗（含顶栏/侧栏/任务中心），任意视图（库/studio）都能弹。
      className={cn('fixed inset-0 flex items-center justify-center bg-nomi-ink/20 pointer-events-auto')}
      style={{ zIndex: NOMI_OVERLAY_Z_INDEX.dialog }}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) resolvePending(false)
      }}
    >
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        // 走查/工具的稳定锚点（此前只能靠 `div.fixed.inset-0` + 文案过滤这种易碎选择器认这张卡）。
        data-spend-confirm-dialog={pending.kind ?? 'generation'}
        aria-labelledby={titleId}
        // tabIndex + data-autofocus：打开时焦点落在对话框本体（读屏会念标题），
        // **刻意不落在「确认花钱」上** —— 那是不可逆动作，不该被一个回车顺手按掉。
        tabIndex={-1}
        data-autofocus
        className={cn(
          'outline-none',
          pending.kind === 'contract' ? 'w-[680px]' : isAnchorCheckpoint ? 'w-[560px]' : 'w-[380px]',
          'max-h-[88vh] max-w-[88%] rounded-nomi-lg border border-nomi-line bg-nomi-paper p-4 shadow-nomi-md',
          // 多镜卡 / 形象卡：flex 列 + footer shrink-0，内容区滚动、footer 恒在（清单/网格另有内滚）。
          flexShell ? 'flex flex-col overflow-hidden' : 'overflow-y-auto',
        )}
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
            <p id={titleId} className={cn('text-title font-medium text-nomi-ink truncate')}>{pending.title}</p>
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
                resolvePending(true, rememberHosting)
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
    </FocusTrap>
    </BodyPortal>
  )
}

/** 人话金额（整数不带小数，非整保留两位）。多镜卡的费用块专用（不引 Intl 货币前缀，避免和「¥」重复）。 */
function formatAmount(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2)
}

/**
 * P4 S3a 多镜确认卡的 body + 固定 footer。抽成独立组件（SpendConfirmDialog 已近上限，且这块自成一体）。
 * 内容区（一句正文 + 规格/主角/清单）滚动、footer（费用块 / 冻结项 / 按钮）恒在不滚出。
 */
function MultiShotCardBody(props: {
  view: import('./productionContractView').ProductionContractView
  list: MultiShotContractProjection
  message: string
  confirmLabel?: string
  onBackToEdit: () => void
  onTrialFirst: () => void
  onIgnore: () => void
  onConfirm: () => void
  t: (key: string, opts?: Record<string, unknown>) => string
}): JSX.Element {
  const { view, list, message, confirmLabel, t } = props
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

      {/* 固定 footer：不随清单滚。费用块 → 冻结项 → 按钮区。 */}
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
