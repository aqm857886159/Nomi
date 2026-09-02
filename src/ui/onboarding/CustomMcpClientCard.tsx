/**
 * 自定义 MCP 客户端卡（方案 A：让任意支持 MCP stdio 的 AI 工具接入 Nomi）。
 *
 * 与内置三客户端（Claude Code / Codex / Cursor）**同权**：同一个签名证明、同一套写配置逻辑、
 * 同一个「可信发起方」信任开关。差异只有「没有 Nomi 内置的配置路径」——由用户填。
 * 样式对齐 ConnectAssistantCard：FoldableModelCard 外壳 + DesignSwitch。
 *
 * 状态三分离（对齐 settings.automation.mcp.separationHint）：
 *   - 接入 = installMcp 写配置（「能不能连上」）
 *   - 信任 = trustedHosts（「连上后允许做什么」）——由宿主 toggle，本卡只读 + 冒泡
 *   - 验证 = verifyMcp 真握手（「配置里有字 ≠ 还连得上」）——后续可补，第一版不引入异步状态
 *
 * 诚实边界（D4）：Nomi 不能「自动跳转」到别的 app 的 UI，只能写配置文件 + 给「提示词一键配置」兜底。
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconCheck, IconCopy, IconHelp, IconPlus, IconPlugConnected, IconSettings, IconTrash } from '@tabler/icons-react'
import { cn } from '../../utils/cn'
import { getDesktopBridge } from '../../desktop/bridge'
import { FoldableModelCard } from './FoldableModelCard'
import { DesignSwitch, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../../design'
import type { McpClientProfile, McpInfo } from '../../desktop/mcpBridgeTypes'

type CustomMcpClientCardProps = {
  /** MCP 连接快照（主进程读）：本卡用 `server` 拼「提示词一键配置」的真实片段。 */
  info: McpInfo
  /** 自定义 profile 列表（主进程读）。 */
  profiles: McpClientProfile[]
  /** 可信发起方（决定「信任」开关状态）。 */
  trustedHosts: string[]
  /** 信任开关变更：由宿主改 automationPolicy 的 trustedHosts。 */
  onToggleTrust: (key: string, trusted: boolean) => void
  /** 接入/撤销/profile 变更后冒泡，由宿主重读快照。 */
  onChanged: () => void
}

function helpTip(label: string): JSX.Element {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className="inline-grid h-3.5 w-3.5 cursor-help place-items-center rounded-full border border-nomi-ink-30 text-micro font-bold leading-none text-nomi-ink-40"
            aria-label={label}
          >
            ?
          </span>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

export function CustomMcpClientCard({ info, profiles, trustedHosts, onToggleTrust, onChanged }: CustomMcpClientCardProps): JSX.Element | null {
  const { t } = useTranslation()
  const [editingKey, setEditingKey] = React.useState<string | null>(null)
  const [name, setName] = React.useState('')
  const [format, setFormat] = React.useState<'json' | 'toml'>('json')
  const [key, setKey] = React.useState('')
  const [configPath, setConfigPath] = React.useState('')
  const [copied, setCopied] = React.useState(false)
  const [error, setError] = React.useState('')
  // 编辑 detected 客户端时保留其原始自报名字（sourceName），保存后用于检测去重。
  const [editingSourceName, setEditingSourceName] = React.useState<string | undefined>(undefined)

  const capability = getDesktopBridge()?.capability
  // 逐叶子 key 显式取（check:i18n-key-refs 门岗要求 t() 指向叶子；returnObjects 子树会被判为坏引用）。
  const tc = {
    title: t('settings.automation.mcp.customClients.title'),
    subtitle: t('settings.automation.mcp.customClients.subtitle'),
    description: t('settings.automation.mcp.customClients.description'),
    add: t('settings.automation.mcp.customClients.add'),
    nameLabel: t('settings.automation.mcp.customClients.nameLabel'),
    nameHelp: t('settings.automation.mcp.customClients.nameHelp'),
    namePlaceholder: t('settings.automation.mcp.customClients.namePlaceholder'),
    formatLabel: t('settings.automation.mcp.customClients.formatLabel'),
    formatHelp: t('settings.automation.mcp.customClients.formatHelp'),
    formatJson: t('settings.automation.mcp.customClients.formatJson'),
    formatToml: t('settings.automation.mcp.customClients.formatToml'),
    keyLabel: t('settings.automation.mcp.customClients.keyLabel'),
    keyHelp: t('settings.automation.mcp.customClients.keyHelp'),
    keyPlaceholder: t('settings.automation.mcp.customClients.keyPlaceholder'),
    pathLabel: t('settings.automation.mcp.customClients.pathLabel'),
    pathHelp: t('settings.automation.mcp.customClients.pathHelp'),
    pathPlaceholder: t('settings.automation.mcp.customClients.pathPlaceholder'),
    saveError: t('settings.automation.mcp.customClients.saveError'),
    save: t('settings.automation.mcp.customClients.save'),
    cancel: t('settings.automation.mcp.customClients.cancel'),
    connect: t('settings.automation.mcp.customClients.connect'),
    reinstall: t('settings.automation.mcp.customClients.reinstall'),
    installed: t('settings.automation.mcp.customClients.installed'),
    notInstalled: t('settings.automation.mcp.customClients.notInstalled'),
    detected: t('settings.automation.mcp.customClients.detected'),
    detectedHint: t('settings.automation.mcp.customClients.detectedHint'),
    configure: t('settings.automation.mcp.customClients.configure'),
    trust: t('settings.automation.mcp.customClients.trust'),
    untrust: t('settings.automation.mcp.customClients.untrust'),
    trustDisabled: t('settings.automation.mcp.customClients.trustDisabled'),
    remove: t('settings.automation.mcp.customClients.remove'),
    copyPromptHint: t('settings.automation.mcp.customClients.copyPromptHint'),
    copyPrompt: t('settings.automation.mcp.customClients.copyPrompt'),
    copied: t('settings.automation.mcp.customClients.copied'),
  }

  if (!capability?.mcpInfo) return null

  const registerBridge = capability.registerCustomMcpProfile
  const removeBridge = capability.removeCustomMcpProfile
  const installBridge = capability.installMcp
  const uninstallBridge = capability.uninstallMcp

  const resetForm = () => {
    setName('')
    setFormat('json')
    setKey('')
    setConfigPath('')
    setError('')
    setEditingKey(null)
  }

  const startEdit = (profile: McpClientProfile) => {
    if (profile.detected) {
      // detected 客户端字段默认留空，引导用户填产品名/路径（不预填自报的 nomi / 派生 key）。
      setName('')
      setFormat('json')
      setKey('')
      setConfigPath('')
      setEditingSourceName(profile.sourceName ?? profile.label)
    } else {
      setName(profile.label)
      setFormat(profile.format)
      setKey(profile.key)
      setConfigPath(profile.configPath)
      setEditingSourceName(undefined)
    }
    setEditingKey(profile.key)
  }

  const handleSave = () => {
    if (!registerBridge || !installBridge) return
    // key 缺省自动生成：取 name 的小写字母数字横杠。
    const resolvedKey = key.trim() || name.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
    // 编辑已有 profile（尤其 detected 改名，key 会变）：先按旧 key 删掉再注册新的，否则「改名后旧卡片残留 + 新卡片又加进来」。
    if (editingKey) removeBridge?.(editingKey)
    const profile = registerBridge({ key: resolvedKey, label: name.trim(), format, configPath: configPath.trim(), sourceName: editingSourceName })
    if (!profile) {
      setError(tc.saveError)
      return
    }
    // 「保存并写入配置」（样张场景 2）：注册 + 一键写配置合一步。写配置可能因权限/路径失败，
    // 独立 catch——注册已成，失败只报写配置，不丢已注册的 profile，也不吞掉列表更新。
    try {
      installBridge(profile.key)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      return
    }
    resetForm()
    onChanged()
  }

  const handleInstall = (profile: McpClientProfile) => {
    if (!installBridge) return
    setError('')
    try {
      const result = installBridge(profile.key)
      if (result.ok) onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const handleRemove = (profile: McpClientProfile) => {
    if (!removeBridge || !uninstallBridge) return
    uninstallBridge(profile.key)
    removeBridge(profile.key)
    onChanged()
  }

  const handleCopyPrompt = (profile: McpClientProfile) => {
    // 复制该客户端的**签名**条目（含 NOMI_MCP_CLIENT + PROOF）：贴进工具后身份就是本 profile key，
    // Nomi 才能按签名识别「已接入」，信任开关才生效。兜底到未签名 base entry（老 preload 罕见路径）。
    const snippet = info.clients[profile.key]?.snippet ?? JSON.stringify({ nomi: info.server }, null, 2)
    const prompt = t('settings.automation.mcp.customClients.promptContent', { path: profile.configPath, snippet })
    void navigator.clipboard.writeText(prompt).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  const handleCopyGenericPrompt = () => {
    // 通用兜底：未签名 base entry（接入后是 external，只能读）。给「还没注册 profile / 不知道路径」
    // 的用户——复制教学提示词让 AI 工具自己完成接入；接入后 Nomi 会经自动检测登记「已连通 XXX」。
    const snippet = JSON.stringify({ nomi: info.server }, null, 2)
    const prompt = t('settings.automation.mcp.customClients.genericPromptContent', { snippet })
    void navigator.clipboard.writeText(prompt).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  const hasInstalled = profiles.some((p) => info.clients[p.key]?.installed === true)

  return (
    <FoldableModelCard
      glyph={<IconPlugConnected size={16} stroke={1.6} />}
      glyphTone="soft"
      name={tc.title}
      subtitle={tc.subtitle}
      status={hasInstalled ? 'ok' : 'todo'}
      statusLabel={hasInstalled ? tc.installed : tc.notInstalled}
      defaultExpanded={false}
    >
      <div className="flex flex-col gap-3">
        <div className="text-caption leading-relaxed text-nomi-ink-60">{tc.description}</div>

        {/* 已注册列表 */}
        {profiles.map((profile) => {
          const detected = profile.detected === true
          const trusted = trustedHosts.includes(profile.key)
          const installed = info.clients[profile.key]?.installed === true
          return (
            <div key={profile.key} className="flex items-center gap-2 rounded-nomi-sm border border-nomi-line bg-nomi-paper px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-body-sm font-medium text-nomi-ink">
                  <span className="truncate">{profile.label}</span>
                  <span className={cn(
                    'shrink-0 rounded-full px-1.5 py-0.5 text-micro',
                    detected ? 'bg-nomi-ink-05 text-nomi-warning' : installed ? 'bg-workbench-success-soft text-workbench-success' : 'bg-nomi-ink-05 text-nomi-ink-40',
                  )}>
                    {detected ? tc.detected : installed ? tc.installed : tc.notInstalled}
                  </span>
                </div>
                <div className="truncate text-micro text-nomi-ink-40">{detected ? tc.detectedHint : profile.configPath}</div>
              </div>
              {detected ? (
                <>
                  <button
                    type="button"
                    title={tc.configure}
                    onClick={() => startEdit(profile)}
                    className="grid h-7 w-7 place-items-center rounded-nomi-sm text-nomi-ink-40 hover:bg-nomi-ink-05 hover:text-nomi-ink"
                  >
                    <IconSettings size={14} stroke={1.6} />
                  </button>
                  <button
                    type="button"
                    title={tc.remove}
                    onClick={() => handleRemove(profile)}
                    className="grid h-7 w-7 place-items-center rounded-nomi-sm text-nomi-ink-40 hover:bg-nomi-ink-05 hover:text-workbench-danger"
                  >
                    <IconTrash size={14} stroke={1.6} />
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    title={installed ? tc.reinstall : tc.connect}
                    onClick={() => handleInstall(profile)}
                    className="grid h-7 w-7 place-items-center rounded-nomi-sm text-nomi-ink-40 hover:bg-nomi-ink-05 hover:text-nomi-ink"
                  >
                    <IconPlugConnected size={14} stroke={1.6} />
                  </button>
                  <button
                    type="button"
                    title={tc.copyPrompt}
                    onClick={() => handleCopyPrompt(profile)}
                    className="grid h-7 w-7 place-items-center rounded-nomi-sm text-nomi-ink-40 hover:bg-nomi-ink-05 hover:text-nomi-ink"
                  >
                    {copied ? <IconCheck size={14} stroke={1.6} /> : <IconCopy size={14} stroke={1.6} />}
                  </button>
                  <button
                    type="button"
                    title={tc.configure}
                    onClick={() => startEdit(profile)}
                    className="grid h-7 w-7 place-items-center rounded-nomi-sm text-nomi-ink-40 hover:bg-nomi-ink-05 hover:text-nomi-ink"
                  >
                    <IconSettings size={14} stroke={1.6} />
                  </button>
                  <DesignSwitch
                    checked={trusted}
                    disabled={!installed}
                    aria-label={trusted ? tc.trust : tc.untrust}
                    title={installed ? (trusted ? tc.trust : tc.untrust) : tc.trustDisabled}
                    onChange={(event) => onToggleTrust(profile.key, event.currentTarget.checked)}
                  />
                  <button
                    type="button"
                    title={tc.remove}
                    onClick={() => handleRemove(profile)}
                    className="grid h-7 w-7 place-items-center rounded-nomi-sm text-nomi-ink-40 hover:bg-nomi-ink-05 hover:text-workbench-danger"
                  >
                    <IconTrash size={14} stroke={1.6} />
                  </button>
                </>
              )}
            </div>
          )
        })}

        {/* 新增/编辑表单 */}
        {editingKey !== null ? (
          <div className="flex flex-col gap-3 rounded-nomi-sm border border-nomi-accent bg-nomi-paper p-3">
            <div className="flex flex-col gap-1">
              <label className="flex items-center gap-1 text-caption font-medium text-nomi-ink-60">
                {tc.nameLabel} <span className="text-nomi-warning">*</span>
                {helpTip(tc.nameHelp)}
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={tc.namePlaceholder}
                className="h-8 rounded-nomi-sm border border-nomi-line bg-nomi-paper px-2.5 text-body-sm text-nomi-ink outline-none focus:border-nomi-accent"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <label className="flex items-center gap-1 text-caption font-medium text-nomi-ink-60">
                  {tc.formatLabel} <span className="text-nomi-warning">*</span>
                  {helpTip(tc.formatHelp)}
                </label>
                <select
                  value={format}
                  onChange={(e) => setFormat(e.target.value as 'json' | 'toml')}
                  className="h-8 rounded-nomi-sm border border-nomi-line bg-nomi-paper px-2 text-body-sm text-nomi-ink outline-none focus:border-nomi-accent"
                >
                  <option value="json">{tc.formatJson}</option>
                  <option value="toml">{tc.formatToml}</option>
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="flex items-center gap-1 text-caption font-medium text-nomi-ink-60">
                  {tc.keyLabel}
                  {helpTip(tc.keyHelp)}
                </label>
                <input
                  type="text"
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  placeholder={tc.keyPlaceholder}
                  className="h-8 rounded-nomi-sm border border-nomi-line bg-nomi-paper px-2.5 text-body-sm text-nomi-ink outline-none focus:border-nomi-accent"
                />
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <label className="flex items-center gap-1 text-caption font-medium text-nomi-ink-60">
                {tc.pathLabel} <span className="text-nomi-warning">*</span>
                {helpTip(tc.pathHelp)}
              </label>
              <input
                type="text"
                value={configPath}
                onChange={(e) => setConfigPath(e.target.value)}
                placeholder={tc.pathPlaceholder}
                className="h-8 rounded-nomi-sm border border-nomi-line bg-nomi-paper px-2.5 font-mono text-body-sm text-nomi-ink outline-none focus:border-nomi-accent"
              />
            </div>
            {error ? <div className="text-caption text-workbench-danger">{error}</div> : null}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={resetForm}
                className="inline-flex h-8 items-center justify-center rounded-nomi-sm border border-nomi-line px-3 text-caption text-nomi-ink-60 hover:text-nomi-ink"
              >
                {tc.cancel}
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={!name.trim() || !configPath.trim()}
                className="inline-flex h-8 items-center justify-center gap-1 rounded-nomi-sm bg-nomi-ink px-3 text-caption font-semibold text-nomi-paper hover:bg-nomi-accent disabled:opacity-50"
              >
                <IconCheck size={14} stroke={1.8} />
                {tc.save}
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setEditingKey('')}
            className="inline-flex h-8 items-center justify-center gap-1.5 self-start rounded-nomi-sm border border-nomi-line px-3 text-caption text-nomi-ink-60 hover:border-nomi-ink-20 hover:text-nomi-ink"
          >
            <IconPlus size={14} stroke={1.8} />
            {tc.add}
          </button>
        )}

        {/* 通用接入提示词（找不到工具/路径时的兜底） */}
        <div className="rounded-nomi-sm border border-dashed border-nomi-accent bg-nomi-accent-soft p-3">
          <div className="flex items-center gap-1.5 text-caption font-semibold text-nomi-accent">
            <IconHelp size={14} stroke={1.8} />
            {tc.copyPromptHint}
          </div>
          <button
            type="button"
            onClick={handleCopyGenericPrompt}
            className="mt-2 inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-nomi-sm border border-nomi-line bg-nomi-paper text-caption text-nomi-ink-60 hover:text-nomi-ink"
          >
            {copied ? <IconCheck size={14} stroke={1.8} /> : <IconCopy size={14} stroke={1.6} />}
            {copied ? tc.copied : tc.copyPrompt}
          </button>
        </div>
      </div>
    </FoldableModelCard>
  )
}
