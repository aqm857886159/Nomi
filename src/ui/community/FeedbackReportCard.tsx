import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { IconCheck, IconClock } from '@tabler/icons-react'
import { DesignButton, DesignCheckbox, DesignTextInput } from '../../design'
import { getDesktopBridge } from '../../desktop/bridge'
import { snapshotPerfSummary } from '../../workbench/observability/perfCollector'
import { buildFeedbackDiagnostics } from './feedbackDiagnostics'
import { feedbackSummaryLine, feedbackSurfaceOf } from './feedbackSummary'
import type { FeedbackOpenRequest } from './feedbackTypes'
import type { DiagnosticsBundleManifest } from '../../../electron/shared/contracts/diagnostics'
import { FEEDBACK_MANIFEST_ITEMS, type FeedbackReportRequest } from '../../../electron/shared/contracts/feedback'

// 一键反馈的那张面（样张 B，用户 09-15 已拍板）。**四个失败面共用这一份**：
// Agent 报错卡 / 生成失败节点 / 导入被拒 / 模型验证失败。
//
// 最要紧的一条形状约束是用户原话：「一键反馈里的东西大部分不能让用户填」。
// 所以这张卡上只有**一个**可填位（一行留言，可空）和**一个**决定（带不带内容）。
// 摘要、日志、模型目录、工具轨迹全由机器自己凑；那句人话由调用处所在域的错误码 owner
// 派生好了传进来（见 `feedbackSummary.ts` 的说明，这里不做第六张码表）。
//
// P1 加新必删旧：它替掉了 2026-09-01 那张手填表（手选功能阶段 + 手写摘要/详情 +
// 「私密 Tally / 公开 GitHub」二选一 + 外跳浏览器自己提交）。旧那条路和这条是同一件事
// 的两个实现，而且和「用户零输入 + 数据只去我们的端点」直接冲突。

type Phase = 'idle' | 'sending' | 'sent' | 'queued' | 'unconfigured' | 'failed'

/**
 * 主进程最迟多久该回答（组包等轨迹 5 秒 + 等网络 8 秒，再留点余量）。
 * 超过说明主进程卡住了：这张卡不能跟着卡住，用户的留言还在上面。
 */
const SEND_WATCHDOG_MS = 20_000
/** 发完后卡留多久再收：一个编号扫一眼就够，一句要读完的话多留一会儿。 */
const RECEIPT_LINGER_MS = 2_200
const NOTICE_LINGER_MS = 5_000

const MANIFEST_ITEM_KEYS = new Map(Object.entries(FEEDBACK_MANIFEST_ITEMS).map(([key, name]) => [name as string, key]))
/** 「没带」那一行写短名：长说明讲的是带了什么，放在没带的那一行读着像带了。 */
const EXCLUDED_ITEM_LABELS = new Map<string, string>([
  [FEEDBACK_MANIFEST_ITEMS.logTail, 'feedbackReport.attachItem.logs'],
  [FEEDBACK_MANIFEST_ITEMS.modelCatalog, 'feedbackReport.attachItem.catalog'],
  [FEEDBACK_MANIFEST_ITEMS.trajectory, 'feedbackReport.attachItem.trace'],
  [FEEDBACK_MANIFEST_ITEMS.perf, 'feedbackReport.attachItem.perf'],
])

export function FeedbackReportCard({
  request = null,
  onDone,
  showHeading = true,
}: {
  request?: FeedbackOpenRequest | null
  /** 发完（拿到编号或排队）后调用，带上这行回执该留多久。浮层态用它关窗，内嵌态用它退回首页。 */
  onDone?: (lingerMs: number) => void
  /**
   * 宿主已经把「反馈这个问题」印在自己的标题栏上时传 false。
   * 为什么要这一格：从失败面进来时它装在一个 modal 里，modal 自己有标题栏——
   * 两个标题会在卡上方留出一条空白带，而「面板尺寸由内容派生、空白=冗余」是拍板过的规则。
   */
  showHeading?: boolean
}): JSX.Element {
  const { t } = useTranslation()
  const bridge = getDesktopBridge()
  const api = bridge?.feedback
  const [appInfo, setAppInfo] = React.useState<{ version?: string; platform?: string; arch?: string } | null>(null)
  const [includeContent, setIncludeContent] = React.useState(false)
  const [note, setNote] = React.useState('')
  const [phase, setPhase] = React.useState<Phase>('idle')
  const [receipt, setReceipt] = React.useState<string | null>(null)
  const [trimmed, setTrimmed] = React.useState(false)
  const [manifest, setManifest] = React.useState<DiagnosticsBundleManifest | 'loading' | null>(null)
  const [viewing, setViewing] = React.useState(false)
  // 卡换了请求或关掉之后，上一次发送晚到的回答不许再动这张卡（也不许把新卡关掉）。
  const sendAttempt = React.useRef(0)
  // 摘要行里的时间是**这张卡打开的时刻**，不是渲染时刻——否则它会随每次重绘往前跳。
  const openedAt = React.useMemo(() => new Date(), [request])

  React.useEffect(() => {
    setIncludeContent(false)
    setNote('')
    setPhase('idle')
    setReceipt(null)
    setTrimmed(false)
    setManifest(null)
    setViewing(false)
    let active = true
    void bridge?.update?.appInfo().then((info) => { if (active) setAppInfo(info) }).catch(() => undefined)
    return () => {
      active = false
      sendAttempt.current += 1
    }
  }, [bridge, request])

  // 供应商身份走**既有**的脱敏（策展供应商原样、ComfyUI 塌成字面量、用户自建塌成 custom）。
  // 那一层 2026-09-01 就为反馈面解决过「自建中转的 key 编码了用户的 base-url」这个问题。
  const diagnostics = React.useMemo(
    () => buildFeedbackDiagnostics(request ?? {}, { intent: 'problem', stage: request?.stage ?? 'other' }, appInfo),
    [appInfo, request],
  )

  const summary = request?.summary?.trim() || t('feedbackReport.summaryFallback')
  const summaryLine = feedbackSummaryLine({
    summary,
    appVersion: diagnostics.app.version === 'unknown' ? null : diagnostics.app.version,
    model: diagnostics.context.model ?? null,
    now: openedAt,
  })

  // 卡顿数字：卡片打开这一刻的本机分档快照。点「发送」= 同意带上（卡上写明了），不看遥测开关。
  const [perf, setPerf] = React.useState(() => snapshotPerfSummary())
  React.useEffect(() => { setPerf(snapshotPerfSummary()) }, [request])
  // 留言不在这里：它不影响清单，打字时不该重算一遍清单。
  const reportRequest: FeedbackReportRequest = React.useMemo(() => ({
    surface: feedbackSurfaceOf(request),
    summary,
    ...(request?.errorKind ? { errorCode: request.errorKind } : {}),
    includeContent,
    ...(diagnostics.context.provider ? { provider: diagnostics.context.provider } : {}),
    ...(diagnostics.context.model ? { model: diagnostics.context.model } : {}),
    ...(request?.laneName ? { laneName: request.laneName } : {}),
    // 项目由发起的那个失败面给（见 feedbackTypes.projectId）；这里只转发，不自己去查。
    ...(request?.projectId ? { projectId: request.projectId } : {}),
    ...(perf ? { perf } : {}),
  }), [diagnostics.context.model, diagnostics.context.provider, includeContent, perf, request, summary])

  // 「查看」只算清单，不发任何东西。勾选变了清单跟着变：用户点发送前看到的要是实情。
  React.useEffect(() => {
    if (!viewing) return undefined
    let active = true
    setManifest('loading')
    void Promise.resolve(api?.preview(reportRequest) ?? null).catch(() => null).then((preview) => {
      if (active) setManifest(preview?.manifest ?? null)
    })
    return () => { active = false }
  }, [api, reportRequest, viewing])

  const send = React.useCallback(async (): Promise<void> => {
    if (!api) return
    sendAttempt.current += 1
    const attempt = sendAttempt.current
    setPhase('sending')
    let watchdog: number | undefined
    const result = await Promise.race([
      // 主进程先把报告落盘再发，最多等几秒就回答，发不出去的那边接着重试（四条硬性之一）。
      api.send(note.trim() ? { ...reportRequest, note: note.trim() } : reportRequest).catch(() => null),
      new Promise<null>((resolve) => { watchdog = window.setTimeout(() => resolve(null), SEND_WATCHDOG_MS) }),
    ])
    window.clearTimeout(watchdog)
    if (attempt !== sendAttempt.current) return
    if (!result || result.ok !== true) {
      setPhase(result?.reason === 'endpoint-unconfigured' ? 'unconfigured' : 'failed')
      return
    }
    setReceipt(result.id)
    setTrimmed(result.trimmed)
    setPhase(result.queued ? 'queued' : 'sent')
    onDone?.(result.queued || result.trimmed ? NOTICE_LINGER_MS : RECEIPT_LINGER_MS)
  }, [api, note, onDone, reportRequest])

  // 发完就收成一行。用户拿到编号之后这张卡没有任何别的用途（⑥：只给编号，不做回复闭环）。
  if (phase === 'sent' || phase === 'queued') {
    return (
      <div data-feedback-card data-feedback-phase={phase} className="flex items-start gap-2 rounded-nomi-sm border border-nomi-line-soft bg-nomi-ink-05 px-3 py-2 text-caption text-nomi-ink-60">
        {phase === 'sent'
          ? <IconCheck size={15} stroke={1.8} className="mt-px shrink-0 text-nomi-accent" aria-hidden="true" />
          : <IconClock size={15} stroke={1.8} className="mt-px shrink-0 text-nomi-ink-40" aria-hidden="true" />}
        {/* 文字折行也留在图标右边：图标不独占一行。 */}
        <div className="flex min-w-0 flex-wrap gap-x-2">
          <span data-feedback-receipt>
            {phase === 'sent' && receipt
              ? t('feedbackReport.sentWithId', { id: receipt })
              : phase === 'sent' ? t('feedbackReport.sent') : t('feedbackReport.queued')}
          </span>
          {trimmed ? <span data-feedback-trimmed>{t('feedbackReport.trimmedNote')}</span> : null}
        </div>
      </div>
    )
  }

  // 这一行写的是这次真会带什么：工具轨迹只有对话里的问题才有，卡顿数字要攒够了才有。
  const attachItems = ['logs', 'catalog', ...(request?.laneName ? ['trace'] : []), ...(perf ? ['perf'] : [])]
  const contentAttached = manifest !== null && manifest !== 'loading'
    && !manifest.excluded.some((item) => item.what === FEEDBACK_MANIFEST_ITEMS.content)

  return (
    <div data-feedback-card data-feedback-phase={phase} className="space-y-3 rounded-nomi border border-nomi-line bg-nomi-paper p-3.5">
      {showHeading ? <h2 className="text-body-sm font-medium text-nomi-ink">{t('feedbackReport.title')}</h2> : null}

      {/* 一行自动摘要：机器已经知道的东西机器自己填。 */}
      <p data-feedback-summary className="break-words text-body-sm leading-relaxed text-nomi-ink-80">{summaryLine}</p>

      {/* 「附带」那一行 + 「查看」。附属信息紧跟内容流、不推到右缘（设计系统「行布局」那一节）。 */}
      <div className="flex flex-wrap items-center gap-1.5 text-caption text-nomi-ink-40">
        <span data-feedback-attaches>
          {t('feedbackReport.attachesLead')} {attachItems.map((item) => t(`feedbackReport.attachItem.${item}`)).join(' · ')}
        </span>
        <button
          type="button"
          data-feedback-view
          onClick={() => setViewing(true)}
          className="border-0 bg-transparent px-0 text-caption text-nomi-accent underline-offset-2 hover:underline"
        >
          {t('feedbackReport.view')}
        </button>
      </div>

      {viewing ? (
        <div data-feedback-manifest className="space-y-1 rounded-nomi-sm border border-nomi-line-soft bg-nomi-ink-05 px-3 py-2">
          {manifest === 'loading' ? (
            <p className="text-micro text-nomi-ink-40">{t('feedbackReport.manifestLoading')}</p>
          ) : manifest === null ? (
            <p className="text-micro text-nomi-ink-40">{t('feedbackReport.manifestUnavailable')}</p>
          ) : (
            <>
              {manifest.entries.map((entry) => (
                <p key={entry.path} data-feedback-entry={entry.path} className="flex flex-wrap items-baseline gap-1.5 text-micro text-nomi-ink-60">
                  <span className="font-nomi-mono">{entry.path}</span>
                  <span className="text-nomi-ink-40">
                    {entry.path === FEEDBACK_MANIFEST_ITEMS.trajectory && contentAttached
                      ? t('feedbackReport.manifestTrajectoryWithContent')
                      : t(`feedbackReport.manifestItem.${MANIFEST_ITEM_KEYS.get(entry.path)}`)}
                  </span>
                </p>
              ))}
              {/* 没带什么，比带了什么更容易引起误解（D4 诚实交付）。 */}
              {manifest.excluded.map((item) => (
                <p key={`${item.what}-${item.why}`} data-feedback-excluded={item.what} data-feedback-why={item.why} className="flex items-baseline gap-1.5 text-micro text-nomi-ink-40">
                  <span aria-hidden="true" className="shrink-0">✗</span>
                  {/* 短名在「附带」那一行是句中小写，这里在行首。 */}
                  <span className="first-letter:uppercase">
                    {t(EXCLUDED_ITEM_LABELS.get(item.what) ?? `feedbackReport.manifestItem.${MANIFEST_ITEM_KEYS.get(item.what)}`)}
                    {' · '}
                    {t(`feedbackReport.manifestWhy.${item.why}`)}
                  </span>
                </p>
              ))}
              <p className="pt-1 text-micro text-nomi-ink-40">{t('feedbackReport.rawHint')}</p>
            </>
          )}
        </div>
      ) : null}

      {/* 内容只住在对话轨迹里。这个问题不在对话里就没有东西可带，给一个勾只会让人以为带了。 */}
      {request?.laneName ? (
        <DesignCheckbox
          data-feedback-include-content
          label={t('feedbackReport.includeContent')}
          checked={includeContent}
          onChange={(event) => setIncludeContent(event.currentTarget.checked)}
        />
      ) : null}

      <DesignTextInput
        data-feedback-note
        placeholder={t('feedbackReport.notePlaceholder')}
        value={note}
        onChange={(event) => setNote(event.currentTarget.value)}
        maxLength={1000}
      />

      {phase === 'unconfigured' ? (
        <p data-feedback-error className="text-caption text-nomi-ink-60">{t('feedbackReport.unconfigured')}</p>
      ) : null}
      {phase === 'failed' ? (
        <p data-feedback-error className="text-caption text-nomi-ink-60">{t('feedbackReport.failed')}</p>
      ) : null}

      <div className="flex items-center gap-2">
        <DesignButton
          data-feedback-send
          variant="filled"
          /* R13/C1：拿不到桥就禁用并说清为什么，不做一颗点了没反应的钮。 */
          disabled={!api || phase === 'sending'}
          title={api ? undefined : t('feedbackReport.bridgeMissing')}
          onClick={() => { void send() }}
        >
          {phase === 'sending' ? t('feedbackReport.sending') : t('feedbackReport.send')}
        </DesignButton>
      </div>
    </div>
  )
}
