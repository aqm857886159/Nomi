import React from 'react'
import { MODEL_ACCESS_ENTRY } from '../../../../electron/shared/modelAccessCapabilities'
import { useTranslation } from 'react-i18next'
import { IconAlertTriangle, IconChevronDown, IconChevronRight, IconRefresh, IconReplace, IconSettings, IconWand } from '@tabler/icons-react'
import { cn } from '../../../utils/cn'
import { WorkbenchButton } from '../../../design'
import { isKnownVendor } from '../../../config/knownVendors'
import { notifyModelOptionsRefresh } from '../../../config/modelCatalogCache'
import { getDesktopBridge } from '../../../desktop/bridge'
import { setPendingCustomCallIntent } from '../../../ui/onboarding/customCallIntent'
import { isComfyuiVendorKey } from '../runner/comfyuiTaskControl'
import { nodeSelectedModelAddress } from './controls/parameterControlModel'
import { classifyGenerationError } from '../runner/generationRunController'
import { narrateErrorActionLabel, narrateModelKind, type GenerationErrorAction } from '../../observability/narrate'

const ACTION_ICON: Record<GenerationErrorAction, typeof IconRefresh> = {
  retry: IconRefresh,
  'switch-model': IconReplace,
  'open-model-access': IconSettings,
  'fix-model-kind': IconWand,
}

/**
 * 生成失败态 —— 节点正文内联错误卡（方案 B，2026-06-03 6 角色评审后重构）。
 *
 * 旧版是「顶部徽标 + 底部橙条 + 点击 portal 弹层」三件套：未分类时「生成失败」重复三遍、
 * 真正报错被折叠两层、弹层向下弹盖住 composer。新版直接铺满节点正文（图片本来就没生成出来），
 * 一屏给出 **原因 + 人话建议 + 重试**；「复制详情 / 技术详情」降为次要；composer 不再被遮挡。
 * 删掉 portal + 手搓定位 + wheel-dismiss + z-index 魔数（连带清掉那部分工程债）。
 *
 * 分类仍走 runner 的 `classifyGenerationError`（唯一真相源），UI 不自己解析错误。
 */
/** 报文对不上那几类：hint 行末尾给「自定义调用」小入口（主按钮结构不动，2026-07-30 拍板守住）。 */
const CUSTOM_CALL_HINT_KINDS = new Set(['model-config', 'image-route-disabled', 'model-unavailable-upstream'])

export function NodeErrorReport({
  message,
  onRetry,
  meta,
}: {
  message: string
  onRetry?: () => void
  /** 节点 meta（内部经 nodeSelectedModelAddress 取双键寻址，防同名 modelKey 误路由）。 */
  meta?: Record<string, unknown>
}): JSX.Element {
  const { t } = useTranslation()
  const report = React.useMemo(() => classifyGenerationError(message), [message])
  // 自定义调用入口目标：节点当前模型属于「自定义/中转家」才给（内置家各有专属通道，不添噪音）。
  const customCallTarget = React.useMemo(() => {
    const { modelKey, vendorKey } = nodeSelectedModelAddress(meta)
    if (!modelKey || !vendorKey || !CUSTOM_CALL_HINT_KINDS.has(report.kind)) return null
    if (isKnownVendor(vendorKey)) return null
    if (vendorKey === 'dreamina' || vendorKey === 'codex-local' || isComfyuiVendorKey(vendorKey)) return null
    return { vendorKey, modelKey, label: modelKey }
  }, [meta, report.kind])

  const handleOpenCustomCall = React.useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation()
      if (!customCallTarget) return
      setPendingCustomCallIntent({ vendorKey: customCallTarget.vendorKey, modelKey: customCallTarget.modelKey })
      window.dispatchEvent(new CustomEvent('nomi-open-model-catalog'))
    },
    [customCallTarget],
  )
  const [showRaw, setShowRaw] = React.useState(false)
  const [copied, setCopied] = React.useState(false)
  const rootRef = React.useRef<HTMLDivElement>(null)

  const handleRetry = React.useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation()
      onRetry?.()
    },
    [onRetry],
  )

  /**
   * 「换个模型」= 打开**本节点已经在屏幕上**的那个模型下拉（错误卡下方 composer 里的模型芯片）。
   * 故意不在卡里内联第二个 picker：换模型要跟着重置参数/解析档案（NodeParameterControls 的
   * handleModelChange），复制一份就是并行版（P1）。这里只做一次 UI nudge，写入仍走那个唯一入口。
   */
  const handleSwitchModel = React.useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation()
      const nodeRoot = rootRef.current?.closest('[data-node-id]')
      const trigger = nodeRoot?.querySelector<HTMLElement>(`[aria-label="${t('generationCommon.parameters.model')}"]`)
      trigger?.scrollIntoView({ block: 'nearest' })
      trigger?.click()
    },
    [t],
  )

  /** 「去模型接入」复用已有全局事件（AssistantErrorCard 同一条，不造第二套入口）。 */
  const handleOpenModelAccess = React.useCallback((event: React.MouseEvent) => {
    event.stopPropagation()
    window.dispatchEvent(new CustomEvent('nomi-open-model-catalog'))
  }, [])

  /**
   * 一键改对类型：改 kind 的同时按新 kind 重建调用通道（electron 侧 retypeModel 单事务），改完直接重跑。
   * 只有在**三个事实都齐**时才给这个按钮：模型地址（节点 meta 的双键）+ 错误里带出的目标类型。
   * 缺任一项就返回 undefined，让下面既有的降级逻辑把主按钮换成「去模型接入」——宁可少一个按钮，
   * 也不给一个点了不知道会对谁生效的按钮（§1.6 C1：可点即有效）。
   */
  const kindFixTarget = React.useMemo(() => {
    if (report.kind !== 'model-kind-mismatch' || !report.modelKindFix) return null
    const { vendorKey } = nodeSelectedModelAddress(meta)
    if (!vendorKey) return null
    return { vendorKey, ...report.modelKindFix }
  }, [meta, report])

  const handleFixModelKind = React.useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation()
      if (!kindFixTarget) return
      const retype = getDesktopBridge()?.modelCatalog.retypeModel
      if (!retype) {
        window.dispatchEvent(new CustomEvent('nomi-open-model-catalog'))
        return
      }
      try {
        retype({
          vendorKey: kindFixTarget.vendorKey,
          modelKey: kindFixTarget.modelKey,
          kind: kindFixTarget.requested,
        })
      } catch {
        // 改不动（内置/agent 路的模型不许套通用模板重建通道）→ 把用户送去那一页自己处理，
        // 别静默吞掉让按钮看起来没反应。
        window.dispatchEvent(new CustomEvent('nomi-open-model-catalog'))
        return
      }
      // 目录变了，下拉/运行前解析都得重取，否则刚改完这次重试仍按旧目录解析、白撞一次。
      // 复用既有唯一刷新入口（清缓存 + 广播），不另造一套失效机制。
      notifyModelOptionsRefresh()
      onRetry?.()
    },
    [kindFixTarget, onRetry],
  )

  const actionHandlers: Record<GenerationErrorAction, ((event: React.MouseEvent) => void) | undefined> = {
    retry: onRetry ? handleRetry : undefined,
    'switch-model': handleSwitchModel,
    'open-model-access': handleOpenModelAccess,
    'fix-model-kind': kindFixTarget ? handleFixModelKind : undefined,
  }
  const primaryAction = actionHandlers[report.primary] ? report.primary : 'open-model-access'
  const secondaryAction = report.secondary !== primaryAction && actionHandlers[report.secondary] ? report.secondary : null
  // 「改成图片」要点出改成**哪个**类型，否则按钮只是「改类型」——用户还得自己再想一步。
  const actionLabelParams = kindFixTarget ? { kind: narrateModelKind(kindFixTarget.requested) } : undefined

  const handleCopy = React.useCallback(
    async (event: React.MouseEvent) => {
      event.stopPropagation()
      try {
        await navigator.clipboard.writeText(report.raw)
        setCopied(true)
        window.setTimeout(() => setCopied(false), 1200)
      } catch {
        /* read-only env */
      }
    },
    [report.raw],
  )

  return (
    <div
      ref={rootRef}
      data-model-access-entry={MODEL_ACCESS_ENTRY.failureRecovery}
      role="alert"
      aria-label={t('generationCommon.error.failedAria', { reason: report.reason })}
      className={cn(
        'absolute inset-0 z-[5] flex flex-col rounded-nomi p-4',
        // 不透明浅红底：盖住下面的棋盘格占位，缩放时也一眼看出是失败态。
        'bg-[color-mix(in_oklch,var(--workbench-danger)_5%,var(--nomi-paper))]',
        'border border-[color-mix(in_oklch,var(--workbench-danger)_24%,transparent)]',
      )}
      // 不拦 pointerdown：错误卡 inset-0 盖住整个节点正文，若 stopPropagation 会让节点**拖不动也选不中**
      // （用户真机反馈）。放行 → 节点可拖可选、参数框正常弹；复制错误详情走卡里的「复制详情」按钮（不靠划选）。
    >
      <div className="flex items-start gap-2">
        <IconAlertTriangle size={16} stroke={1.6} className="mt-[1px] shrink-0 text-workbench-danger" />
        <span className="select-text cursor-text text-body font-bold leading-snug text-nomi-ink">{report.reason}</span>
      </div>
      {/* 正文区独立滚动 —— 这一层是结构保证，不是样式偏好：错误卡铺满节点正文，而节点可以很小，
          hint + 上游原话却可以很长。不给正文独立滚动，长文案会把整排动作按钮顶出卡外，用户连
          「换个模型」都点不到（2026-07-31 走查几何断言抓到：436×245 的节点上按钮底边越界）。
          内容短时它照旧撑满剩余高度，按钮仍贴底，视觉与旧版一致。
          onWheel 停冒泡：画布用 bubble 阶段的 wheel 缩放，不停的话在卡里滚 = 缩放画布。 */}
      <div className="mt-2 min-h-0 flex-1 overflow-y-auto" onWheel={(event) => event.stopPropagation()}>
        {report.hint || customCallTarget ? (
          <p className="select-text cursor-text text-caption leading-relaxed text-nomi-ink-60">
            {report.hint}
            {customCallTarget ? (
              <button
                type="button"
                onClick={handleOpenCustomCall}
                aria-label={t('onboardingProviders.customCall.errorCardHintAria', { name: customCallTarget.label })}
                className="ml-1 cursor-pointer text-nomi-accent hover:underline"
              >
                {t('onboardingProviders.customCall.errorCardHint')}
              </button>
            ) : null}
          </p>
        ) : null}
        {/* 服务商真实原话——提到可见区，别再让用户去折叠的「技术详情」里挖（一脸懵逼的根源）。
            break-words 不能省：上游原话常是一整串没有空格的 JSON/URL（如方舟的
            `{"code":"InputImageSensitiveContentDetected.PrivacyInformation",…}`），窄节点上会横向
            溢出被切掉右半截（同一次走查截图抓到）。 */}
        {report.providerMessage ? (
          <p className="mt-2 select-text cursor-text break-words rounded-nomi-sm bg-nomi-ink-05 p-2 text-caption leading-relaxed text-nomi-ink-60">
            <span className="text-nomi-ink-40">{t('generationCommon.error.providerMessage')}</span>
            {report.providerMessage}
          </p>
        ) : null}
      </div>

      {showRaw ? (
        <pre
          className="mb-2 max-h-[88px] select-text overflow-auto whitespace-pre-wrap break-all rounded-nomi-sm bg-nomi-ink-05 p-2 font-nomi-mono text-micro text-nomi-ink-60"
          onPointerDown={(event) => event.stopPropagation()}
        >
          {report.raw}
        </pre>
      ) : null}

      {/* 主动作按类型走（narrate 的 ACTION_BY_KIND）：确定性失败给「换个模型/去模型接入」，
          偶发失败才给「重试」。以前一律红「重试」，和「重试还会是同样结果」的文案自相矛盾。

          flex-wrap + 每颗 shrink-0 whitespace-nowrap：不加的话 flex 会压缩次要按钮，把文案**从词中间
          断开**成「换个模/型」「复制详/情」（2026-08-11 走查截图实拍）。几何断言抓不到它——没有溢出、
          没有越界，只是难看得像坏了。窄处该做的是整颗换行，不是把字劈两半（AssistantErrorCard 同款处理）。 */}
      <div className="flex flex-wrap items-center gap-2">
        {(() => {
          const PrimaryIcon = ACTION_ICON[primaryAction]
          const label = narrateErrorActionLabel(primaryAction, 'primary', actionLabelParams)
          return (
            <WorkbenchButton
              size="sm"
              onClick={actionHandlers[primaryAction]}
              aria-label={label}
              className="shrink-0 whitespace-nowrap bg-workbench-danger text-nomi-paper border-0 hover:bg-workbench-danger-soft"
            >
              <PrimaryIcon size={13} stroke={1.6} />
              {label}
            </WorkbenchButton>
          )
        })()}
        {secondaryAction ? (
          <button
            type="button"
            onClick={actionHandlers[secondaryAction]}
            className="shrink-0 whitespace-nowrap text-caption text-nomi-ink-40 hover:text-nomi-ink"
          >
            {narrateErrorActionLabel(secondaryAction, 'secondary', actionLabelParams)}
          </button>
        ) : null}
        <button type="button" onClick={handleCopy} className="shrink-0 whitespace-nowrap text-caption text-nomi-ink-40 hover:text-nomi-ink">
          {copied ? t('generationCommon.error.copied') : t('generationCommon.error.copyDetails')}
        </button>
        <div className="min-w-0 flex-1" />
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            setShowRaw((value) => !value)
          }}
          aria-expanded={showRaw}
          className="inline-flex shrink-0 items-center gap-0.5 whitespace-nowrap text-micro text-nomi-ink-40 hover:text-nomi-ink-60"
        >
          {t('generationCommon.error.technicalDetails')}
          {showRaw ? <IconChevronDown size={13} stroke={1.6} /> : <IconChevronRight size={13} stroke={1.6} />}
        </button>
      </div>
    </div>
  )
}
