import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { IconCheck, IconClock } from '@tabler/icons-react'
import { DesignButton, DesignCheckbox, DesignTextInput } from '../../design'
import { getDesktopBridge } from '../../desktop/bridge'
import { buildFeedbackDiagnostics } from './feedbackDiagnostics'
import { feedbackSummaryLine, feedbackSurfaceOf } from './feedbackSummary'
import type { FeedbackOpenRequest } from './feedbackTypes'
import type { DiagnosticsBundleManifest } from '../../../electron/shared/contracts/diagnostics'
import type { FeedbackReportRequest } from '../../../electron/shared/contracts/feedback'

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

export function FeedbackReportCard({
  request = null,
  onDone,
  showHeading = true,
}: {
  request?: FeedbackOpenRequest | null
  /** 发完（拿到编号或排队）后调用。浮层态用它关窗，内嵌态用它退回首页。 */
  onDone?: () => void
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
  const [manifest, setManifest] = React.useState<DiagnosticsBundleManifest | null>(null)
  const [viewing, setViewing] = React.useState(false)
  // 摘要行里的时间是**这张卡打开的时刻**，不是渲染时刻——否则它会随每次重绘往前跳。
  const openedAt = React.useMemo(() => new Date(), [request])

  React.useEffect(() => {
    setIncludeContent(false)
    setNote('')
    setPhase('idle')
    setReceipt(null)
    setManifest(null)
    setViewing(false)
    let active = true
    void bridge?.update?.appInfo().then((info) => { if (active) setAppInfo(info) }).catch(() => undefined)
    return () => { active = false }
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

  const payload: FeedbackReportRequest = React.useMemo(() => ({
    surface: feedbackSurfaceOf(request),
    summary,
    ...(request?.errorKind ? { errorCode: request.errorKind } : {}),
    ...(note.trim() ? { note: note.trim() } : {}),
    includeContent,
    ...(diagnostics.context.provider ? { provider: diagnostics.context.provider } : {}),
    ...(diagnostics.context.model ? { model: diagnostics.context.model } : {}),
    ...(request?.laneName ? { laneName: request.laneName } : {}),
    // 项目由发起的那个失败面给（见 feedbackTypes.projectId）；这里只转发，不自己去查。
    ...(request?.projectId ? { projectId: request.projectId } : {}),
  }), [diagnostics.context.model, diagnostics.context.provider, includeContent, note, request, summary])

  const view = React.useCallback(async (): Promise<void> => {
    setViewing(true)
    // 「查看」只算清单，不发任何东西。
    const preview = await api?.preview(payload).catch(() => null)
    setManifest(preview?.manifest ?? null)
  }, [api, payload])

  const send = React.useCallback(async (): Promise<void> => {
    if (!api) return
    setPhase('sending')
    // 发送**不阻塞**：主进程立刻返回，失败已在那边入队重试（四条硬性之一）。
    const result = await api.send(payload).catch(() => null)
    if (!result || result.ok !== true) {
      setPhase(result?.reason === 'endpoint-unconfigured' ? 'unconfigured' : 'failed')
      return
    }
    setReceipt(result.id)
    setPhase(result.queued ? 'queued' : 'sent')
    onDone?.()
  }, [api, onDone, payload])

  // 发完就收成一行。用户拿到编号之后这张卡没有任何别的用途（⑥：只给编号，不做回复闭环）。
  if (phase === 'sent' || phase === 'queued') {
    return (
      <div data-feedback-card data-feedback-phase={phase} className="flex items-center gap-2 rounded-nomi-sm border border-nomi-line-soft bg-nomi-ink-05 px-3 py-2 text-caption text-nomi-ink-60">
        {phase === 'sent'
          ? <IconCheck size={15} stroke={1.8} className="shrink-0 text-nomi-accent" aria-hidden="true" />
          : <IconClock size={15} stroke={1.8} className="shrink-0 text-nomi-ink-40" aria-hidden="true" />}
        <span data-feedback-receipt>
          {phase === 'sent' && receipt
            ? t('feedbackReport.sentWithId', { id: receipt })
            : phase === 'sent' ? t('feedbackReport.sent') : t('feedbackReport.queued')}
        </span>
      </div>
    )
  }

  return (
    <div data-feedback-card data-feedback-phase={phase} className="space-y-3 rounded-nomi border border-nomi-accent bg-nomi-paper p-3.5">
      {showHeading ? <h2 className="text-body-sm font-medium text-nomi-ink">{t('feedbackReport.title')}</h2> : null}

      {/* 一行自动摘要：机器已经知道的东西机器自己填。 */}
      <p data-feedback-summary className="break-words text-body-sm leading-relaxed text-nomi-ink-80">{summaryLine}</p>

      {/* 「附带」那一行 + 「查看」。附属信息紧跟内容流、不推到右缘（设计系统「行布局」那一节）。 */}
      <div className="flex flex-wrap items-center gap-1.5 text-caption text-nomi-ink-40">
        <span>{t('feedbackReport.attaches')}</span>
        <button
          type="button"
          data-feedback-view
          onClick={() => { void view() }}
          className="border-0 bg-transparent px-0 text-caption text-nomi-accent underline-offset-2 hover:underline"
        >
          {t('feedbackReport.view')}
        </button>
      </div>

      {viewing ? (
        <div data-feedback-manifest className="space-y-1 rounded-nomi-sm border border-nomi-line-soft bg-nomi-ink-05 px-3 py-2">
          {manifest === null ? (
            <p className="text-micro text-nomi-ink-40">{t('feedbackReport.manifestUnavailable')}</p>
          ) : (
            <>
              {manifest.entries.map((entry) => (
                <p key={entry.path} className="flex flex-wrap items-baseline gap-1.5 text-micro text-nomi-ink-60">
                  <span className="font-nomi-mono">{entry.path}</span>
                  <span className="text-nomi-ink-40">{entry.what}</span>
                </p>
              ))}
              {/* 没带什么，比带了什么更容易引起误解（D4 诚实交付）。 */}
              {manifest.excluded.map((item) => (
                <p key={`${item.what}-${item.why}`} className="flex flex-wrap items-baseline gap-1.5 text-micro text-nomi-ink-40">
                  <span aria-hidden="true">✗</span>
                  <span>{item.what}</span>
                  <span className="font-nomi-mono">{item.why}</span>
                </p>
              ))}
              <p className="pt-1 text-micro text-nomi-ink-40">{t('feedbackReport.rawHint')}</p>
            </>
          )}
        </div>
      ) : null}

      <DesignCheckbox
        data-feedback-include-content
        label={t('feedbackReport.includeContent')}
        checked={includeContent}
        onChange={(event) => setIncludeContent(event.currentTarget.checked)}
      />

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
