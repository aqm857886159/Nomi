/**
 * 接入 AI 编程助手卡（见 docs/plan/2026-06-22-multi-client-mcp-connect.md
 * + docs/plan/2026-09-14-mcp-connection-truthfulness.md）。
 *
 * 一键把 Nomi 接进本机**检测到**的助手（Claude Code / Claude Desktop / Codex / Cursor / WorkBuddy）的 MCP——
 * 用户不读配置、不找路径、不学命令。名单与检测由 electron/shared/mcpClientRegistry.ts 唯一 owner 派生，
 * 没装的不出现（此前五家永远全渲染，没装 pi 也能「一键接入」——假项）。
 * 单卡 + 一行分段切目标，同一个「一键接入 / 状态 / 可信发起方开关 / 撤销」随之变；
 * 其余助手（Cline / Windsurf / pi-mcp-adapter…）走卡尾「其他客户端 · 复制通用配置」——**不带客户端身份**的
 * 条目（此前复制的是当前选中客户端的已签名片段，粘进 Cline 等于让 Cline 冒充默认可信的 Claude Code）。
 *
 * 「连上后允许做什么」（可信发起方）不再是设置页里的独立一栏：它就是每个客户端卡里的第二个开关。
 * 主操作 = 写各客户端配置的 nomi 条目（合并 + 备份，mcpConfig）；读状态零写盘。
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import {
  IconTerminal2, IconPlugConnected, IconCopy, IconCheck, IconCircleCheck, IconExternalLink,
  IconAlertTriangle, IconRefresh, IconLock,
} from '@tabler/icons-react'
import { cn } from '../../utils/cn'
import { getDesktopBridge } from '../../desktop/bridge'
import { FoldableModelCard } from './FoldableModelCard'
import { DesignSegmentedControl, DesignSwitch } from '../../design'
import type { McpConfigState, McpInfo, McpVerifyReason, McpWriteRefusal } from '../../desktop/mcpBridgeTypes'
import {
  ASSISTANT_CLIENT_LABEL,
  ASSISTANT_CLIENT_ORDER,
  resolveAssistantActivationState,
  type AssistantClientKey,
} from './assistantActivationState'
import { genericMcpSnippet } from './mcpGenericSnippet'

const GUIDE_URL = 'https://github.com/aqm857886159/Nomi/blob/main/docs/guide/capability-core-cli-mcp.md'
type ClientKey = AssistantClientKey
// 名字与顺序的 owner 在 assistantActivationState（模型页那张「用 AI 帮我接入」卡念的是同一份）。
const CLIENT_LABEL = ASSISTANT_CLIENT_LABEL
const CLIENT_ORDER = ASSISTANT_CLIENT_ORDER

// 本卡只管一个方向：**让 AI 助手来用 Nomi**（MCP）。
// 反方向的「Nomi 去用 Codex 出图」已拆成独立的 CodexLocalImageCard，各开各的——此前接入 MCP 会
// 顺带开生图模型、撤销顺带关，且抽屉刷新还会把用户手动改的开关掰回来（冲用户数据）。别再接回来。
/**
 * 实连验证状态。**「配置里有 nomi 这行字」≠「还连得上」**——老版本写的 `node …/scripts/nomi-mcp.mjs`
 * 早已随仓库删除、从 dev 构建点的接入会把路径钉在随时会消失的 worktree 上、指向已删除 profile 的
 * NOMI_SETTINGS_DIR 起的是空白 Nomi——三者在旧口径下都显示「已接入」。故打开面板即真起一次配置里那条
 * 命令握手，并把读回来的 profile 与本实例比对（见 mcpVerify）。
 */
// 卡头徽章只放「已接入 / 配置已失效 / 检测中」。曾试过在徽章里带握手耗时当证据，真机走查发现
// 卡头本来就窄，多这一截会把标题挤成「接入 AI 编程...」，且实测常是 0.0s（读起来像没算出来）。
// 「服务真的能握手」的证据改由展开后的工具数承担——那句更具体，也不跟标题抢位置。
type VerifyState = {
  phase: 'checking' | 'ok' | 'broken'
  toolCount: number | null
  reason: McpVerifyReason
}

const REASON_I18N: Partial<Record<McpVerifyReason, string>> = {
  'command-missing': 'commandMissing',
  'argument-missing': 'argumentMissing',
  'spawn-failed': 'spawnFailed',
  timeout: 'timeout',
  'handshake-failed': 'handshakeFailed',
  'client-auth-missing': 'clientAuthMissing',
}

/**
 * Nomi 自己写过、如今已过时的四种配置形状：读回配置就能判死，不必 spawn 去问；直接按形状说人话 + 给「升级接入」。
 * launcher-stale 含「命令签名都对、但 NOMI_SETTINGS_DIR 指向别的/已删除 profile」——2026-09-13 本机 5 个
 * 客户端全是这种「握手能过、连上的却是空白 Nomi」的假绿。
 */
const STALE_CONFIG_I18N: Partial<Record<McpConfigState, string>> = {
  'legacy-launcher': 'legacyLauncher',
  'stale-development': 'staleDevelopment',
  'auth-stale': 'authStale',
  'launcher-stale': 'launcherStale',
}

const REFUSAL_I18N: Record<McpWriteRefusal, string> = {
  'unknown-client': 'unknownClient',
  'client-not-installed': 'clientNotInstalled',
  'isolated-instance': 'isolatedInstance',
  'config-unreadable': 'configUnreadable',
}

// 桥类型单一真相源在 desktop/mcpBridgeTypes（此前这里手抄过一份，两处会各自漂移）。
export type { McpInfo }

type ConnectAssistantCardProps = {
  /** MCP 接入状态由设置宿主统一读取后下传；null = 不显（加载中/老 preload）。 */
  info: McpInfo | null
  /** 接入/撤销后冒泡，由设置宿主重读连接快照。 */
  onChanged: () => void
  /** 可信发起方开关：连上后是否允许这个客户端自动发起制作。写的是 automationPolicy.trustedHosts。 */
  onTrustChange: (client: string, trusted: boolean) => void
  onOpenDetails?: () => void
  detailMode?: boolean
}

export function ConnectAssistantCard({
  info,
  onChanged,
  onTrustChange,
  onOpenDetails,
  detailMode = false,
}: ConnectAssistantCardProps): JSX.Element | null {
  const { t } = useTranslation()
  const [target, setTarget] = React.useState<ClientKey>('claude')
  const pickedDefault = React.useRef(false)
  const [busy, setBusy] = React.useState(false)
  const [copied, setCopied] = React.useState<'client' | 'generic' | null>(null)
  const [error, setError] = React.useState('')
  const [verify, setVerify] = React.useState<VerifyState | null>(null)
  const [checkNonce, setCheckNonce] = React.useState(0)

  const capability = getDesktopBridge()?.capability

  React.useEffect(() => {
    window.addEventListener('nomi-automation-policy-changed', onChanged)
    return () => window.removeEventListener('nomi-automation-policy-changed', onChanged)
  }, [onChanged])

  // 只列本机检测到的助手（注册表 installMarkers）；没装的不给「一键接入」这个假动作。
  const detected = React.useMemo(
    () => CLIENT_ORDER.filter((key) => info?.clients[key]?.appInstalled === true),
    [info],
  )

  // 首次拿到 info 时默认选已接入的客户端，没有则选第一个检测到的。只挑一次，不抢用户后续切换。
  React.useEffect(() => {
    if (!info || pickedDefault.current || detected.length === 0) return
    pickedDefault.current = true
    setTarget(detected.find((key) => info.clients[key]?.installed) ?? detected[0])
  }, [info, detected])

  // 打开面板即实连一次（只对「配置里有这条、且形状不是已知过时」的客户端跑：没接入的不 spawn，
  // 已知过时的形状读配置就能判死，spawn 只会起一个错的 Nomi）。
  // checkNonce：接入/重连后配置没变成「未接入」，靠布尔值触发不了重验，故显式打点。
  const verifyBridge = capability?.verifyMcp
  const targetInstalled = info?.clients[target]?.installed === true
  const targetStaleShape = info?.clients[target] ? STALE_CONFIG_I18N[info.clients[target].configState] ?? null : null
  React.useEffect(() => {
    if (!verifyBridge || !targetInstalled || targetStaleShape) {
      setVerify(null)
      return
    }
    let alive = true
    setVerify({ phase: 'checking', toolCount: null, reason: 'ok' })
    void verifyBridge(target)
      .then((res) => {
        if (!alive) return
        setVerify({ phase: res.ok ? 'ok' : 'broken', toolCount: res.toolCount, reason: res.reason })
      })
      .catch(() => {
        // 老 preload / 桥异常：退回「只读配置」的老口径，不误报失效。
        if (alive) setVerify(null)
      })
    return () => {
      alive = false
    }
  }, [verifyBridge, target, targetInstalled, targetStaleShape, checkNonce])

  // 加载中 / 老 preload（无 capability.mcpInfo）：整卡不显，避免坏入口。
  if (!capability?.mcpInfo || !info) return null

  const label = CLIENT_LABEL[target]
  const client = info.clients[target]
  const hasTarget = Boolean(client) && detected.includes(target)
  const staleShape = client ? STALE_CONFIG_I18N[client.configState] ?? null : null
  const developmentConnection = client?.configState === 'development'

  const flash = (what: 'client' | 'generic') => {
    setCopied(what)
    window.setTimeout(() => setCopied((current) => (current === what ? null : current)), 1600)
  }

  const handleInstall = () => {
    if (!capability.installMcp) return
    setBusy(true)
    setError('')
    try {
      const result = capability.installMcp(target)
      if (!result.ok) {
        setError(t(`onboardingProviders.assistant.refused.${REFUSAL_I18N[result.reason]}`, { client: label }))
        return
      }
      onChanged()
      setCheckNonce((n) => n + 1) // 重连后立刻复验，别让刚修好的还挂着「已失效」。
    } catch (e) {
      setError(t('onboardingProviders.assistant.connectFailed', { message: e instanceof Error ? e.message : String(e) }))
    } finally {
      setBusy(false)
    }
  }

  const handleUninstall = () => {
    if (!capability.uninstallMcp) return
    setBusy(true)
    setError('')
    try {
      const result = capability.uninstallMcp(target)
      if (!result.ok) {
        setError(t(`onboardingProviders.assistant.refused.${REFUSAL_I18N[result.reason]}`, { client: label }))
        return
      }
      onChanged()
    } catch (e) {
      setError(t('onboardingProviders.assistant.disconnectFailed', { message: e instanceof Error ? e.message : String(e) }))
    } finally {
      setBusy(false)
    }
  }

  const handleCopyClient = () => {
    void navigator.clipboard.writeText(client.snippet).then(() => flash('client'))
  }

  const handleCopyGeneric = () => {
    void navigator.clipboard.writeText(genericMcpSnippet(info.server)).then(() => flash('generic'))
  }

  // 状态以**实连结果**为准（已知过时的配置形状不必实连，读回来就是 broken）；
  // 没验证能力（老 preload）才退回「配置里有这行字」的老口径。
  const activation = resolveAssistantActivationState({
    target,
    installed: client?.installed === true,
    verifyPhase: staleShape ? 'broken' : verify?.phase ?? null,
    trustedHosts: info.trustedHosts ?? [],
  })
  const { broken, hostApprovalPending, trusted } = activation
  const statusLabel = !hasTarget
    ? t('onboardingProviders.assistant.status.notDetected')
    : !client.installed
      ? info.tokenReady
        ? t('onboardingProviders.assistant.status.ready')
        : t('onboardingProviders.assistant.status.notReady')
      : verify?.phase === 'checking'
        ? t('onboardingProviders.assistant.status.checking')
        : broken
          ? t('onboardingProviders.assistant.status.broken')
          : verify?.phase === 'ok' && !hostApprovalPending
            ? t('onboardingProviders.assistant.status.connected')
            : t('onboardingProviders.assistant.status.configured')

  const genericSection = (
    <div data-assistant-generic-clients className="border-t border-nomi-line-soft pt-3">
      <div className="text-body-sm font-semibold text-nomi-ink">{t('onboardingProviders.assistant.generic.title')}</div>
      <div className="mt-0.5 text-caption leading-relaxed text-nomi-ink-60">{t('onboardingProviders.assistant.generic.body')}</div>
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          data-assistant-generic-copy
          onClick={handleCopyGeneric}
          className={cn(
            'flex-1 h-8 rounded-nomi-sm border border-nomi-line text-nomi-ink-60',
            'text-caption inline-flex items-center justify-center gap-1.5 hover:border-nomi-ink-20',
          )}
        >
          {copied === 'generic' ? <IconCheck size={14} stroke={1.8} /> : <IconCopy size={14} stroke={1.6} />}
          {copied === 'generic' ? t('onboardingProviders.assistant.copied') : t('onboardingProviders.assistant.generic.copy')}
        </button>
        <button
          type="button"
          onClick={() => window.open(GUIDE_URL, '_blank', 'noopener')}
          className="h-8 px-1 text-caption text-nomi-ink-60 inline-flex items-center gap-1 hover:text-nomi-accent"
        >
          {t('onboardingProviders.assistant.guide')}<IconExternalLink size={13} stroke={1.6} />
        </button>
      </div>
    </div>
  )

  return (
    <FoldableModelCard
      glyph={<IconTerminal2 size={16} stroke={1.6} />}
      glyphTone="ink"
      name={t('onboardingProviders.assistant.name')}
      subtitle={t('onboardingProviders.assistant.subtitle')}
      // 徽章绿只认「真接入且握手没断且宿主不另要审批」：此前 anyInstalled || tokenReady 就 ok——
      // 配置残留/broken 也亮绿「已接入」，用户「什么都没整却显示已接入」（2026-08-08 反馈）。
      status={activation.headerStatus}
      statusLabel={statusLabel}
      defaultExpanded={false}
      onOpenDetails={onOpenDetails}
      detailMode={detailMode}
    >
      {!info.tokenReady ? (
        <div className="text-caption text-nomi-ink-60 leading-relaxed">
          {t('onboardingProviders.assistant.credentialPending')}
        </div>
      ) : detected.length === 0 ? (
        <>
          <div data-assistant-none-detected className="flex items-start gap-2 rounded-nomi-sm bg-nomi-ink-05 px-3 py-2.5 text-caption leading-relaxed text-nomi-ink-60">
            <IconAlertTriangle size={15} className="mt-0.5 shrink-0 text-nomi-ink-40" aria-hidden="true" />
            <span>{t('onboardingProviders.assistant.noneDetected', { clients: CLIENT_ORDER.map((key) => CLIENT_LABEL[key]).join(' / ') })}</span>
          </div>
          {genericSection}
        </>
      ) : (
        <>
          <DesignSegmentedControl
            size="xs"
            fullWidth
            value={target}
            onChange={(value) => setTarget(value as ClientKey)}
            data={detected.map((key) => ({ label: CLIENT_LABEL[key], value: key }))}
          />

          {client.installed && broken ? (
            <>
              {/* 过时形状 / 实连失败：不再显示绿色「已写入配置」，如实说坏在哪 + 给唯一出路（重写成当前启动方式）。 */}
              <div
                data-assistant-broken={staleShape ? client.configState : verify?.reason ?? 'broken'}
                className={cn(
                  'flex items-start gap-2 rounded-nomi-sm px-3 py-2.5',
                  staleShape ? 'bg-nomi-ink-05' : 'bg-[var(--workbench-danger-soft)]',
                )}
              >
                <IconAlertTriangle size={17} className={cn('shrink-0 mt-0.5', staleShape ? 'text-nomi-warning' : 'text-workbench-danger')} />
                <div className="min-w-0">
                  <div className="text-body-sm font-semibold text-nomi-ink">{t('onboardingProviders.assistant.brokenTitle')}</div>
                  <div className="text-caption text-nomi-ink-60 mt-0.5 leading-relaxed">
                    {staleShape
                      ? t(`onboardingProviders.assistant.staleConfig.${staleShape}`, { client: label })
                      : t(`onboardingProviders.assistant.reason.${REASON_I18N[verify?.reason ?? 'ok'] || 'handshakeFailed'}`, { client: label })}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={handleInstall}
                disabled={busy}
                className={cn(
                  'w-full h-9 rounded-nomi-sm bg-nomi-ink text-nomi-paper',
                  'text-body-sm font-semibold inline-flex items-center justify-center gap-1.5',
                  'hover:bg-nomi-accent disabled:opacity-50 disabled:cursor-not-allowed',
                )}
              >
                <IconRefresh size={15} stroke={1.8} />
                {t(staleShape ? 'onboardingProviders.assistant.upgrade' : 'onboardingProviders.assistant.repair', { client: label })}
              </button>
              <button
                type="button"
                onClick={handleUninstall}
                disabled={busy}
                className="self-start text-caption text-nomi-ink-40 hover:text-workbench-danger disabled:opacity-50"
              >
                {t('onboardingProviders.assistant.disconnect')}
              </button>
            </>
          ) : client.installed ? (
            <>
              <div className="flex items-start gap-2 rounded-nomi-sm bg-nomi-ink-05 px-3 py-2.5">
                {verify?.phase === 'ok' && !hostApprovalPending ? (
                  <IconCircleCheck size={17} className="shrink-0 mt-0.5 text-workbench-success-ink" />
                ) : (
                  <IconPlugConnected size={17} className="shrink-0 mt-0.5 text-nomi-ink-60" />
                )}
                <div className="min-w-0">
                  <div className="text-body-sm font-semibold text-nomi-ink">
                    {verify?.phase === 'ok' && !hostApprovalPending
                      ? t('onboardingProviders.assistant.verified', { client: label })
                      : t('onboardingProviders.assistant.configWritten', { client: label })}
                  </div>
                  <div className="mt-0.5 text-caption text-nomi-ink-60">
                    {verify?.phase === 'ok' && typeof verify.toolCount === 'number'
                      ? t('onboardingProviders.assistant.verifiedBody', { count: verify.toolCount })
                      : t('onboardingProviders.assistant.restartClient', { client: label })}
                  </div>
                  {/* 宿主自己那道审批门（如 Cursor）：Nomi 握手成功只证明命令可用，不能替宿主批准自己。 */}
                  {hostApprovalPending ? (
                    <div className="mt-1 text-caption text-nomi-ink-40">
                      {t('onboardingProviders.assistant.hostApprovalHint', { client: label })}
                    </div>
                  ) : null}
                </div>
              </div>
              {/* 第二个开关：「连上」管能不能到 Nomi，「可信发起方」管连上后能不能自动发起制作。同一张卡说清两件事。 */}
              <div
                data-assistant-trust-row={target}
                className="flex items-center justify-between gap-3 rounded-nomi-sm border border-nomi-line px-3 py-2"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 text-body-sm text-nomi-ink">
                    <IconLock size={14} stroke={1.7} className="shrink-0 text-nomi-ink-60" aria-hidden="true" />
                    {t('onboardingProviders.assistant.trust.title', { client: label })}
                  </div>
                  <div className="mt-0.5 text-caption leading-relaxed text-nomi-ink-40">
                    {t('onboardingProviders.assistant.trust.hint')}
                  </div>
                </div>
                <DesignSwitch
                  checked={trusted}
                  onChange={(event) => onTrustChange(target, event.currentTarget.checked)}
                  aria-label={t('onboardingProviders.assistant.trust.title', { client: label })}
                />
              </div>
              {developmentConnection ? (
                <div className="flex items-start gap-2 rounded-nomi-sm bg-nomi-ink-05 px-3 py-2.5 text-caption text-nomi-ink-60">
                  <IconAlertTriangle size={15} className="mt-0.5 shrink-0 text-nomi-warning" aria-hidden="true" />
                  <span>{t('onboardingProviders.assistant.developmentConnection')}</span>
                </div>
              ) : null}
              <div className="text-caption text-nomi-ink-40">{t('onboardingProviders.assistant.sayNow')}</div>
              <div className="text-body-sm text-nomi-ink-80 leading-relaxed rounded-nomi-sm border border-nomi-line bg-nomi-paper px-3 py-2.5">
                “{t('onboardingProviders.assistant.example')}”
              </div>
              {/* 「让助手替你接模型」这件事的家在设置 →「模型」页顶部那张卡（它管的是「跟助手说什么」，
                  本卡管的是「把 Nomi 接进助手」）。这里只放一条指路，不在两处各留一份指引（P1）。 */}
              <button
                type="button"
                data-assistant-add-model-pointer
                onClick={() => window.dispatchEvent(new CustomEvent('nomi-open-settings', { detail: { tab: 'models' } }))}
                className="self-start text-caption text-nomi-ink-40 hover:text-nomi-accent"
              >
                {t('onboardingProviders.assistant.addModelPointer')}
              </button>
              <button
                type="button"
                onClick={handleUninstall}
                disabled={busy}
                className="self-start text-caption text-nomi-ink-40 hover:text-workbench-danger disabled:opacity-50"
              >
                {t('onboardingProviders.assistant.disconnect')}
              </button>
            </>
          ) : (
            <>
              <div className="text-caption text-nomi-ink-60 leading-relaxed">
                {t('onboardingProviders.assistant.description', { client: label })}
              </div>
              <button
                type="button"
                onClick={handleInstall}
                disabled={busy}
                className={cn(
                  'w-full h-9 rounded-nomi-sm bg-nomi-ink text-nomi-paper',
                  'text-body-sm font-semibold inline-flex items-center justify-center gap-1.5',
                  'hover:bg-nomi-accent disabled:opacity-50 disabled:cursor-not-allowed',
                )}
              >
                <IconPlugConnected size={15} stroke={1.8} />{t('onboardingProviders.assistant.connect', { client: label })}
              </button>
              {/* 手动贴的人拿的是**这个客户端**的签名片段（身份 = 它自己），不是别家的。 */}
              <button
                type="button"
                data-assistant-client-copy={target}
                onClick={handleCopyClient}
                className={cn(
                  'h-8 rounded-nomi-sm border border-nomi-line text-nomi-ink-60',
                  'text-caption inline-flex items-center justify-center gap-1.5 hover:border-nomi-ink-20',
                )}
              >
                {copied === 'client' ? <IconCheck size={14} stroke={1.8} /> : <IconCopy size={14} stroke={1.6} />}
                {copied === 'client' ? t('onboardingProviders.assistant.copied') : t('onboardingProviders.assistant.copyConfig', { client: label })}
              </button>
            </>
          )}
          {genericSection}
        </>
      )}

      {error ? <div className="text-caption text-workbench-danger">{error}</div> : null}
    </FoldableModelCard>
  )
}
