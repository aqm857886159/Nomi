/**
 * 接入 AI 编程助手卡（见 docs/plan/2026-06-22-multi-client-mcp-connect.md）。
 *
 * 一键把 Nomi 接进 Claude Code / Codex / Cursor 的 MCP——用户不读配置、不找路径、不学命令。
 * 不冗余：单卡 + 一行分段切目标（DesignSegmentedControl，§3.4），同一个「一键接入/状态/撤销」随之变；
 * 其余助手（Cline/Windsurf…）走「复制配置」。主操作 = 写各客户端配置的 nomi 条目（合并 + 备份，mcpConfig）。
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import {
  IconTerminal2, IconPlugConnected, IconCopy, IconCheck, IconCircleCheck, IconExternalLink,
  IconAlertTriangle, IconRefresh, IconLock,
} from '@tabler/icons-react'
import { cn } from '../../utils/cn'
import { getDesktopBridge } from '../../desktop/bridge'
import { toast, useToastStore } from '../toast'
import { FoldableModelCard } from './FoldableModelCard'
import { DesignSegmentedControl } from '../../design'
import type { McpInfo, McpVerifyReason } from '../../desktop/mcpBridgeTypes'
import { resolveAssistantActivationState, type AssistantClientKey } from './assistantActivationState'

const GUIDE_URL = 'https://github.com/aqm857886159/Nomi/blob/main/docs/guide/capability-core-cli-mcp.md'
const CURSOR_CONNECTED_TOAST_ID = 'mcp:cursor-connected'
type ClientKey = AssistantClientKey
const CLIENT_LABEL: Record<ClientKey, string> = { claude: 'Claude Code', codex: 'Codex', cursor: 'Cursor' }
const CLIENT_ORDER: ClientKey[] = ['claude', 'codex', 'cursor']

// 本卡只管一个方向：**让 AI 助手来用 Nomi**（MCP）。
// 反方向的「Nomi 去用 Codex 出图」已拆成独立的 CodexLocalImageCard，各开各的——此前接入 MCP 会
// 顺带开生图模型、撤销顺带关，且抽屉刷新还会把用户手动改的开关掰回来（冲用户数据）。别再接回来。
/**
 * 实连验证状态。**「配置里有 nomi 这行字」≠「还连得上」**——老版本写的 `node …/scripts/nomi-mcp.mjs`
 * 早已随仓库删除、从 dev 构建点的接入会把路径钉在随时会消失的 worktree 上，两者在旧口径下都显示
 * 「已接入」，用户却在助手里发消息石沉大海。故打开面板即真起一次配置里那条命令握手（见 mcpVerify）。
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
  'spawn-failed': 'spawnFailed',
  timeout: 'timeout',
  'handshake-failed': 'handshakeFailed',
  'client-auth-missing': 'clientAuthMissing',
}

// 桥类型单一真相源在 desktop/mcpBridgeTypes（此前这里手抄过一份，两处会各自漂移）。
export type { McpInfo }

type ConnectAssistantCardProps = {
  /** MCP 接入状态由父组件统一 fetch 后下传（单一来源，见 plan §4.1）；null = 不显（加载中/老 preload）。 */
  info: McpInfo | null
  /** 接入/撤销后冒泡，父组件重查 + 重新分桶。 */
  onChanged: () => void
}

export function ConnectAssistantCard({ info, onChanged }: ConnectAssistantCardProps): JSX.Element | null {
  const { t } = useTranslation()
  const [target, setTarget] = React.useState<ClientKey>('claude')
  const pickedDefault = React.useRef(false)
  const [busy, setBusy] = React.useState(false)
  const [copied, setCopied] = React.useState(false)
  const [error, setError] = React.useState('')
  const [verify, setVerify] = React.useState<VerifyState | null>(null)
  const [checkNonce, setCheckNonce] = React.useState(0)

  const capability = getDesktopBridge()?.capability

  React.useEffect(() => {
    window.addEventListener('nomi-automation-policy-changed', onChanged)
    return () => window.removeEventListener('nomi-automation-policy-changed', onChanged)
  }, [onChanged])

  // 首次拿到 info 时默认选已接入的客户端（没有则保持 Claude Code）。只挑一次，不抢用户后续切换。
  React.useEffect(() => {
    if (!info || pickedDefault.current) return
    pickedDefault.current = true
    const installed = CLIENT_ORDER.find((key) => info.clients[key]?.installed)
    if (installed) setTarget(installed)
  }, [info])

  // 打开面板即实连一次（只对「配置里有这条」的客户端跑，没接入的不 spawn）。
  // checkNonce：接入/重连后配置没变成「未接入」，靠布尔值触发不了重验，故显式打点。
  const verifyBridge = capability?.verifyMcp
  const targetInstalled = info?.clients[target]?.installed === true
  React.useEffect(() => {
    if (!verifyBridge || !targetInstalled) {
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
  }, [verifyBridge, target, targetInstalled, checkNonce])

  // 加载中 / 老 preload（无 capability.mcpInfo）：整卡不显，避免坏入口。
  if (!capability?.mcpInfo || !info) return null

  const label = CLIENT_LABEL[target]
  const client = info.clients[target]

  const handleInstall = () => {
    if (!capability.installMcp) return
    setBusy(true)
    setError('')
    try {
      capability.installMcp(target)
      onChanged()
      setCheckNonce((n) => n + 1) // 重连后立刻复验，别让刚修好的还挂着「已失效」。
      const message = t(target === 'cursor'
          ? info.trustedHosts?.includes('cursor')
            ? 'onboardingProviders.assistant.cursorConnectedTrustedToast'
            : 'onboardingProviders.assistant.cursorConnectedToast'
          : 'onboardingProviders.assistant.connectedToast', { client: label })
      if (target === 'cursor') {
        useToastStore.getState().push({ id: CURSOR_CONNECTED_TOAST_ID, message, type: 'success' })
      } else {
        toast(message, 'success')
      }
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
      capability.uninstallMcp(target)
      onChanged()
      toast(t('onboardingProviders.assistant.disconnectedToast'), 'success')
    } catch (e) {
      setError(t('onboardingProviders.assistant.disconnectFailed', { message: e instanceof Error ? e.message : String(e) }))
    } finally {
      setBusy(false)
    }
  }

  const handleCopy = () => {
    void navigator.clipboard.writeText(client.snippet).then(() => {
      setCopied(true)
      toast(t('onboardingProviders.assistant.copiedToast'), 'success')
      window.setTimeout(() => setCopied(false), 1600)
    })
  }

  const openAutomationPermissions = () => {
    useToastStore.getState().remove(CURSOR_CONNECTED_TOAST_ID)
    window.dispatchEvent(new CustomEvent('nomi-open-settings', { detail: { tab: 'automation', section: 'cursor-host' } }))
  }

  // 状态以**实连结果**为准；没验证能力（老 preload）才退回「配置里有这行字」的老口径。
  const activation = resolveAssistantActivationState({
    target,
    installed: client.installed,
    verifyPhase: verify?.phase ?? null,
    trustedHosts: info.trustedHosts ?? [],
  })
  const { broken, cursorConfiguration: cursorActivationNotice, cursorTrusted } = activation
  // Cursor 还有宿主自己的批准门。Nomi 直接握手只能证明配置命令可用，不能替 Cursor 批准自己。
  const cursorConnectionValue = verify?.phase === 'ok' && typeof verify.toolCount === 'number'
    ? t('onboardingProviders.assistant.cursorConnectionVerified', { count: verify.toolCount })
    : verify?.phase === 'checking'
      ? t('onboardingProviders.assistant.cursorConnectionChecking')
      : t('onboardingProviders.assistant.cursorConnectionUnknown')
  const statusLabel = !client.installed
    ? info.tokenReady
      ? t('onboardingProviders.assistant.status.ready')
      : t('onboardingProviders.assistant.status.notReady')
    : verify?.phase === 'checking'
      ? t('onboardingProviders.assistant.status.checking')
      : broken
        ? t('onboardingProviders.assistant.status.broken')
        : verify?.phase === 'ok' && target !== 'cursor'
          ? t('onboardingProviders.assistant.status.connected')
          : t('onboardingProviders.assistant.status.configured')

  return (
    <FoldableModelCard
      glyph={<IconTerminal2 size={16} stroke={1.6} />}
      glyphTone="ink"
      name={t('onboardingProviders.assistant.name')}
      subtitle={t('onboardingProviders.assistant.subtitle')}
      // 徽章绿只认「真接入且握手没断」：此前 anyInstalled || tokenReady 就 ok——
      // 配置残留/broken 也亮绿「已接入」，用户「什么都没整却显示已接入」（2026-08-08 反馈）。
      status={activation.headerStatus}
      statusLabel={statusLabel}
      defaultExpanded={false}
    >
      {!info.tokenReady ? (
        <div className="text-caption text-nomi-ink-60 leading-relaxed">
          {t('onboardingProviders.assistant.credentialPending')}
        </div>
      ) : (
        <>
          <DesignSegmentedControl
            size="xs"
            fullWidth
            value={target}
            onChange={(value) => setTarget(value as ClientKey)}
            data={CLIENT_ORDER.map((key) => ({ label: CLIENT_LABEL[key], value: key }))}
          />

          {client.installed && broken ? (
            <>
              {/* 实连失败：不再显示绿色「已写入配置」，如实说坏在哪 + 给唯一出路（重写成当前启动方式）。 */}
              <div className="flex items-start gap-2 rounded-nomi-sm bg-[var(--workbench-danger-soft)] px-3 py-2.5">
                <IconAlertTriangle size={17} className="shrink-0 mt-0.5 text-workbench-danger" />
                <div className="min-w-0">
                  <div className="text-body-sm font-semibold text-nomi-ink">{t('onboardingProviders.assistant.brokenTitle')}</div>
                  <div className="text-caption text-nomi-ink-60 mt-0.5 leading-relaxed">
                    {t(`onboardingProviders.assistant.reason.${REASON_I18N[verify!.reason] || 'handshakeFailed'}`, { client: label })}
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
                <IconRefresh size={15} stroke={1.8} />{t('onboardingProviders.assistant.reconnect', { client: label })}
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
                {cursorActivationNotice ? (
                  <IconLock size={17} className="shrink-0 mt-0.5 text-nomi-ink-60" />
                ) : verify?.phase === 'ok' ? (
                  <IconCircleCheck size={17} className="shrink-0 mt-0.5 text-workbench-success-ink" />
                ) : (
                  <IconPlugConnected size={17} className="shrink-0 mt-0.5 text-nomi-ink-60" />
                )}
                <div className="min-w-0">
                  <div className="text-body-sm font-semibold text-nomi-ink">
                    {cursorActivationNotice
                      ? t('onboardingProviders.assistant.cursorConfigured')
                      : verify?.phase === 'ok'
                        ? t('onboardingProviders.assistant.verified', { client: label })
                      : t('onboardingProviders.assistant.configWritten', { client: label })}
                  </div>
                  {cursorActivationNotice ? (
                    <div className="mt-2 grid gap-1 text-caption">
                      <div className="flex items-start justify-between gap-3">
                        <span className="text-nomi-ink-40">{t('onboardingProviders.assistant.cursorConnection')}</span>
                        <span className="text-right text-nomi-ink-80">{cursorConnectionValue}</span>
                      </div>
                      <div className="flex items-start justify-between gap-3">
                        <span className="text-nomi-ink-40">{t('onboardingProviders.assistant.cursorNomiPermission')}</span>
                        <span className={cursorTrusted ? 'text-workbench-success-ink' : 'text-nomi-warning'}>
                          {t(cursorTrusted
                            ? 'onboardingProviders.assistant.cursorNomiAllowed'
                            : 'onboardingProviders.assistant.cursorNomiRequired')}
                        </span>
                      </div>
                      <div className="flex items-start justify-between gap-3">
                        <span className="text-nomi-ink-40">{t('onboardingProviders.assistant.cursorHostPermission')}</span>
                        <span className="text-right text-nomi-ink-60">
                          {t('onboardingProviders.assistant.cursorHostPermissionUnknown')}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-0.5 text-caption text-nomi-ink-60">
                      {verify?.phase === 'ok' && typeof verify.toolCount === 'number'
                        ? t('onboardingProviders.assistant.verifiedBody', { count: verify.toolCount })
                        : t('onboardingProviders.assistant.restartClient', { client: label })}
                    </div>
                  )}
                </div>
              </div>
              {activation.showCursorPermissionAction ? (
                <button
                  type="button"
                  onClick={openAutomationPermissions}
                  className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-nomi-sm border border-nomi-line px-2.5 text-caption text-nomi-ink-60 hover:bg-nomi-ink-05 hover:text-nomi-ink"
                >
                  <IconLock size={14} stroke={1.7} />
                  {t('onboardingProviders.assistant.openCursorPermissions')}
                </button>
              ) : null}
              <div className="text-caption text-nomi-ink-40">
                {t(cursorActivationNotice
                  ? 'onboardingProviders.assistant.sayAfterApproval'
                  : 'onboardingProviders.assistant.sayNow')}
              </div>
              <div className="text-body-sm text-nomi-ink-80 leading-relaxed rounded-nomi-sm border border-nomi-line bg-nomi-paper px-3 py-2.5">
                “{t('onboardingProviders.assistant.example')}”
              </div>
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
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleCopy}
                  className={cn(
                    'flex-1 h-8 rounded-nomi-sm border border-nomi-line text-nomi-ink-60',
                    'text-caption inline-flex items-center justify-center gap-1.5 hover:border-nomi-ink-20',
                  )}
                >
                  {copied ? <IconCheck size={14} stroke={1.8} /> : <IconCopy size={14} stroke={1.6} />}
                  {copied ? t('onboardingProviders.assistant.copied') : t('onboardingProviders.assistant.copyConfig')}
                </button>
                <button
                  type="button"
                  onClick={() => window.open(GUIDE_URL, '_blank', 'noopener')}
                  className="h-8 px-1 text-caption text-nomi-ink-60 inline-flex items-center gap-1 hover:text-nomi-accent"
                >
                  {t('onboardingProviders.assistant.guide')}<IconExternalLink size={13} stroke={1.6} />
                </button>
              </div>
              <div className="text-micro text-nomi-ink-30">{t('onboardingProviders.assistant.otherClients')}</div>
            </>
          )}
        </>
      )}

      {error ? <div className="text-caption text-workbench-danger">{error}</div> : null}
    </FoldableModelCard>
  )
}
