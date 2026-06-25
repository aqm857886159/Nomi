/**
 * 接入 AI 编程助手卡（见 docs/plan/2026-06-22-multi-client-mcp-connect.md）。
 *
 * 一键把 Nomi 接进 Claude Code / Codex / Cursor 的 MCP——用户不读配置、不找路径、不学命令。
 * 不冗余：单卡 + 一行分段切目标（DesignSegmentedControl，§3.4），同一个「一键接入/状态/撤销」随之变；
 * 其余助手（Cline/Windsurf…）走「复制配置」。主操作 = 写各客户端配置的 nomi 条目（合并 + 备份，mcpConfig）。
 */
import React from 'react'
import { IconTerminal2, IconPlugConnected, IconCopy, IconCheck, IconCircleCheck, IconExternalLink } from '@tabler/icons-react'
import { cn } from '../../utils/cn'
import { getDesktopBridge } from '../../desktop/bridge'
import { toast } from '../toast'
import { FoldableModelCard } from './FoldableModelCard'
import { DesignSegmentedControl } from '../../design'

const GUIDE_URL = 'https://github.com/aqm857886159/Nomi/blob/main/docs/guide/capability-core-cli-mcp.md'
const SAY_EXAMPLE = '在 Nomi 新建项目「咖啡广告」，拆 3 个镜头加到画布，用我的图模型把第一个生成出来。'

type ClientKey = 'claude' | 'codex' | 'cursor'
const CLIENT_LABEL: Record<ClientKey, string> = { claude: 'Claude Code', codex: 'Codex', cursor: 'Cursor' }
const CLIENT_ORDER: ClientKey[] = ['claude', 'codex', 'cursor']

type McpClientInfo = { installed: boolean; configPath: string; snippet: string }
export type McpInfo = {
  tokenReady: boolean
  rpcRunning: boolean
  server: { command: string; args: string[]; env?: Record<string, string> }
  clients: Record<ClientKey, McpClientInfo>
}

type ConnectAssistantCardProps = {
  /** MCP 接入状态由父组件统一 fetch 后下传（单一来源，见 plan §4.1）；null = 不显（加载中/老 preload）。 */
  info: McpInfo | null
  /** 接入/撤销后冒泡，父组件重查 + 重新分桶。 */
  onChanged: () => void
}

export function ConnectAssistantCard({ info, onChanged }: ConnectAssistantCardProps): JSX.Element | null {
  const [target, setTarget] = React.useState<ClientKey>('claude')
  const pickedDefault = React.useRef(false)
  const [busy, setBusy] = React.useState(false)
  const [copied, setCopied] = React.useState(false)
  const [error, setError] = React.useState('')

  const capability = getDesktopBridge()?.capability

  // 首次拿到 info 时默认选已接入的客户端（没有则保持 Claude Code）。只挑一次，不抢用户后续切换。
  React.useEffect(() => {
    if (!info || pickedDefault.current) return
    pickedDefault.current = true
    const installed = CLIENT_ORDER.find((key) => info.clients[key]?.installed)
    if (installed) setTarget(installed)
  }, [info])

  // 加载中 / 老 preload（无 capability.mcpInfo）：整卡不显，避免坏入口。
  if (!capability?.mcpInfo || !info) return null

  const label = CLIENT_LABEL[target]
  const client = info.clients[target]
  const anyInstalled = CLIENT_ORDER.some((key) => info.clients[key]?.installed)

  const handleInstall = () => {
    if (!capability.installMcp) return
    setBusy(true)
    setError('')
    try {
      capability.installMcp(target)
      onChanged()
      toast(`已接入 ${label}，重启后生效`, 'success')
    } catch (e) {
      setError(`接入失败：${e instanceof Error ? e.message : String(e)}`)
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
      toast('已撤销接入', 'success')
    } catch (e) {
      setError(`撤销失败：${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  const handleCopy = () => {
    void navigator.clipboard.writeText(client.snippet).then(() => {
      setCopied(true)
      toast('配置已复制', 'success')
      window.setTimeout(() => setCopied(false), 1600)
    })
  }

  const statusLabel = client.installed ? '已接入' : info.tokenReady ? '就绪' : '未就绪'

  return (
    <FoldableModelCard
      glyph={<IconTerminal2 size={16} stroke={1.6} />}
      glyphTone="ink"
      name="接入 AI 编程助手"
      subtitle="让 Claude Code / Codex / Cursor 帮你建项目、出图"
      status={anyInstalled || info.tokenReady ? 'ok' : 'todo'}
      statusLabel={statusLabel}
      defaultExpanded={false}
    >
      {!info.tokenReady ? (
        <div className="text-caption text-nomi-ink-60 leading-relaxed">
          凭证还没生成——重启 Nomi 一次即可（启动时自动生成）。
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

          {client.installed ? (
            <>
              <div className="flex items-start gap-2 rounded-nomi-sm bg-[var(--workbench-success-soft)] px-3 py-2.5">
                <IconCircleCheck size={17} className="shrink-0 mt-0.5 text-workbench-success" />
                <div className="min-w-0">
                  <div className="text-body-sm font-semibold text-nomi-ink">已写入 {label} 配置</div>
                  <div className="text-caption text-nomi-ink-60 mt-0.5">重启 {label} 后生效。</div>
                </div>
              </div>
              <div className="text-caption text-nomi-ink-40">现在可以对它说：</div>
              <div className="text-body-sm text-nomi-ink-80 leading-relaxed rounded-nomi-sm border border-nomi-line bg-nomi-paper px-3 py-2.5">
                「{SAY_EXAMPLE}」
              </div>
              <button
                type="button"
                onClick={handleUninstall}
                disabled={busy}
                className="self-start text-caption text-nomi-ink-40 hover:text-workbench-danger disabled:opacity-50"
              >
                撤销接入
              </button>
            </>
          ) : (
            <>
              <div className="text-caption text-nomi-ink-60 leading-relaxed">
                一键把 Nomi 接进 {label}——之后你一句话，它就能在 Nomi 里建项目、拆镜头、用你配好的模型真出图。
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
                <IconPlugConnected size={15} stroke={1.8} />一键接入 {label}
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
                  {copied ? '已复制' : '复制配置'}
                </button>
                <button
                  type="button"
                  onClick={() => window.open(GUIDE_URL, '_blank', 'noopener')}
                  className="h-8 px-1 text-caption text-nomi-ink-60 inline-flex items-center gap-1 hover:text-nomi-accent"
                >
                  看用法<IconExternalLink size={13} stroke={1.6} />
                </button>
              </div>
              <div className="text-micro text-nomi-ink-30">用 Cline / Windsurf 等其它助手？点「复制配置」粘进它的 MCP 设置即可。</div>
            </>
          )}
        </>
      )}

      {error ? <div className="text-caption text-workbench-danger">{error}</div> : null}
    </FoldableModelCard>
  )
}
