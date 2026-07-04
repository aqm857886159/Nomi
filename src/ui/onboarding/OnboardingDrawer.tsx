/**
 * 模型设置面板内容（已接入 / 可接入 分层 + 方案2 分组折叠 + 自适应默认，见
 * docs/plan/2026-06-25-model-onboarding-connected-available-split.md）。
 *
 * 从上到下：
 *  - 顶部「你现在已经能生成」能力概览条（图/视频/文本/配音，由已连通供应商的模型 kind 派生，effect-first）
 *  - 【已接入】跨类扁平排你接好的家（连通 vendor / 其他自定义模型 / 即梦已登录 / 编程助手已接）；无已接入项则整段不显
 *  - 【可接入】保留原分组（接入生成模型 / 有即梦会员？/ 接入编程助手），每组是带数量的折叠组（AvailableGroup）；
 *    自适应默认：有已接入 → 各组收起；零已接入的新用户 → 首组「接入生成模型」自动展开
 *
 * 连接状态单一来源（plan §4.1）：vendor.hasApiKey 本就在父组件；即梦/编程助手的连接状态由父组件统一 fetch
 * 后下传给受控卡（DreaminaMemberCard / ConnectAssistantCard），变更经 onChanged 冒泡回来重查 + 重新分桶。
 * 不改后端 catalog / IPC / 三套 vendor 名单（不合并、不去重）。
 */
import React from 'react'
import { IconStack2, IconChevronRight, IconPlus, IconPhoto, IconVideo, IconMessageCircle, IconMusic } from '@tabler/icons-react'
import { cn } from '../../utils/cn'
import { OnboardingWizard } from './OnboardingWizard'
import { FoldableModelCard } from './FoldableModelCard'
import { VendorOnboardCard } from './VendorOnboardCard'
import { AvailableGroup } from './AvailableGroup'
import { type ChipModel } from './ModelChipGroups'
import { ModelEnableEditor } from './ModelEnableEditor'
import { ConnectAssistantCard, type McpInfo } from './ConnectAssistantCard'
import { DreaminaMemberCard, type DreaminaStatus } from './DreaminaMemberCard'
import { KNOWN_VENDORS, isKnownVendor } from '../../config/knownVendors'
import { getDesktopBridge } from '../../desktop/bridge'
import { notifyModelOptionsRefresh } from '../../config/useModelOptions'
import { alertDialog, confirmDialog } from '../../design'

type VendorMeta = {
  name: string
  hasApiKey: boolean
  baseUrl: string
}

// 能力概览：四类产物 → 图标/文案。covered 由已连通供应商的模型 kind 派生（derive 不 hardcode）。
const KIND_CAPS = [
  { kind: 'image', label: '图片', Icon: IconPhoto },
  { kind: 'video', label: '视频', Icon: IconVideo },
  { kind: 'text', label: '文本', Icon: IconMessageCircle },
  { kind: 'audio', label: '配音', Icon: IconMusic },
] as const

export function OnboardingDrawer(): JSX.Element {
  const [wizardOpen, setWizardOpen] = React.useState(false)
  const [wizardPreset, setWizardPreset] = React.useState<string | undefined>(undefined)
  const openWizard = React.useCallback((preset?: string) => { setWizardPreset(preset); setWizardOpen(true) }, [])
  const [models, setModels] = React.useState<ChipModel[]>([])
  const [vendorMeta, setVendorMeta] = React.useState<Map<string, VendorMeta>>(new Map())
  // 即梦 / 编程助手的连接状态上提到父组件（单一来源，plan §4.1）。null = 不可用/加载中（卡不显）。
  const [dreaminaStatus, setDreaminaStatus] = React.useState<DreaminaStatus | null>(null)
  const [mcpInfo, setMcpInfo] = React.useState<McpInfo | null>(null)
  // 同步数据就绪标志：分组折叠的「自适应默认」依赖 hasConnected，必须等目录/MCP 同步加载完再挂
  // AvailableGroup，否则它在首帧空态（hasConnected=false）就把默认展开态固定下来（plan §4.3 mount-before-load）。
  const [loaded, setLoaded] = React.useState(false)
  const [version, setVersion] = React.useState(0) // bump to refetch

  React.useEffect(() => {
    const bridge = getDesktopBridge()
    if (!bridge) return
    // 生成模型目录（同步）。
    try {
      const ms = bridge.modelCatalog.listModels() as Array<Record<string, unknown>>
      const vs = bridge.modelCatalog.listVendors() as Array<Record<string, unknown>>
      const metaMap = new Map<string, VendorMeta>()
      for (const v of vs) {
        metaMap.set(String(v.key), {
          name: String(v.name || v.key),
          hasApiKey: Boolean(v.hasApiKey),
          baseUrl: String(v.baseUrlHint || ''),
        })
      }
      const rows: ChipModel[] = ms.map((m) => ({
        modelKey: String(m.modelKey),
        vendorKey: String(m.vendorKey),
        labelZh: String(m.labelZh || m.modelKey),
        kind: m.kind as ChipModel['kind'],
        // enabled 缺省视为 true（老快照/DTO 未带时不误停用）。
        enabled: m.enabled !== false,
      }))
      setVendorMeta(metaMap)
      setModels(rows)
    } catch {
      setVendorMeta(new Map())
      setModels([])
    }
    // 编程助手 MCP 状态（同步）。
    try {
      setMcpInfo((bridge.capability?.mcpInfo?.() as McpInfo | undefined) ?? null)
    } catch {
      setMcpInfo(null)
    }
    setLoaded(true) // 同步数据已就位 → 可挂分组（自适应默认按真实 hasConnected 算）。
    // 即梦状态（异步）。
    let alive = true
    const dreamina = bridge.dreamina
    if (dreamina) {
      dreamina.status()
        .then((s) => { if (alive) setDreaminaStatus(s as DreaminaStatus) })
        .catch(() => { if (alive) setDreaminaStatus(null) })
    } else {
      setDreaminaStatus(null)
    }
    return () => { alive = false }
  }, [version])

  const refresh = React.useCallback(() => {
    notifyModelOptionsRefresh('all')
    setVersion((v) => v + 1)
    // 广播目录变更：库页缺模型状态条/弱入口靠它即时重查（单一信号源）。
    window.dispatchEvent(new CustomEvent('nomi-model-catalog-changed'))
  }, [])

  const handleDelete = React.useCallback(async (row: ChipModel) => {
    const bridge = getDesktopBridge()
    if (!bridge) return
    const ok = await confirmDialog({
      title: '删除模型',
      message: `删除「${row.labelZh}」？此操作不可恢复，之后要用需重新拉取。`,
      confirmLabel: '删除',
      danger: true,
    })
    if (!ok) return
    try {
      bridge.modelCatalog.deleteModel(row.vendorKey, row.modelKey)
      refresh()
    } catch (e) {
      void alertDialog({ title: '删除失败', message: e instanceof Error ? e.message : String(e) })
    }
  }, [refresh])

  // 启用/停用模型（可逆，保留清单）：逐行只翻 enabled（upsert 保留其余字段），末尾一次 refresh。
  // enabled:false 的模型天然从生成下拉/runtime 消失（selectExecutableModel 只选 enabled）。
  // 单个 = 传 1 行；批量（全选/全不选）= 传多行，避免 N 次 refresh。
  const handleSetEnabled = React.useCallback((rows: ChipModel[], enabled: boolean) => {
    const bridge = getDesktopBridge()
    if (!bridge || rows.length === 0) return
    try {
      for (const row of rows) {
        bridge.modelCatalog.upsertModel({ vendorKey: row.vendorKey, modelKey: row.modelKey, enabled })
      }
      refresh()
    } catch (e) {
      void alertDialog({ title: '操作失败', message: e instanceof Error ? e.message : String(e) })
    }
  }, [refresh])

  // 已知供应商：catalog 里存在该 vendor 才渲染卡片。
  const knownCards = KNOWN_VENDORS
    .map((directory) => {
      const meta = vendorMeta.get(directory.vendorKey)
      if (!meta) return null
      const vendorModels = models.filter((m) => m.vendorKey === directory.vendorKey)
      return { directory, meta, vendorModels }
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)

  // 分桶（derive，plan §4.4）：已连通 vendor 上「已接入」，未连通归「可接入」生成模型组。
  const connectedKnown = knownCards.filter((c) => c.meta.hasApiKey)
  const availableKnown = knownCards.filter((c) => !c.meta.hasApiKey)
  // 其他模型：用户自定义接入（有 key 才存在）→ 视为已接入。排除有专属卡的内置家：
  // 5 个 KNOWN_VENDORS + 即梦 dreamina（走 DreaminaMemberCard，其 seeded 模型不是"自定义"，
  // 否则与即梦会员卡重复且被误标"已配置"——真机走查抓到，dreamina 种了 4 个模型）。
  const otherModels = models.filter((m) => !isKnownVendor(m.vendorKey) && m.vendorKey !== 'dreamina')

  // 即梦 / 编程助手连接判定 + 可用性（卡是否该出现）。
  const dreaminaAvailable = dreaminaStatus !== null
  const dreaminaConnected = !!(dreaminaStatus?.installed && dreaminaStatus?.loggedIn)
  const assistantAvailable = mcpInfo !== null
  // 「已接入」= 真写了某客户端配置；仅 tokenReady（就绪未接）归「可接入」。
  const assistantConnected = !!(mcpInfo && Object.values(mcpInfo.clients).some((c) => c.installed))

  const hasConnected =
    connectedKnown.length > 0 ||
    otherModels.length > 0 ||
    dreaminaConnected ||
    assistantConnected

  // 能力覆盖：某 kind 有「已连通供应商（hasApiKey）」的模型 = 现在就能生成（诚实，未连通不算）。
  const coveredKinds = React.useMemo(() => {
    const set = new Set<string>()
    for (const m of models) {
      if (vendorMeta.get(m.vendorKey)?.hasApiKey) set.add(String(m.kind))
    }
    return set
  }, [models, vendorMeta])

  // 其他（自定义中转）按 vendor 拆成每家一张卡，卡名用用户在接入时填的「来源名称」（vendorMeta.name）。
  // 根因修复：此前全塞进单张「其他模型」卡、只按 kind 分组，多家糊一起分不清哪个 key 对哪家。
  // name 字段本就存在（接入向导「来源名称」→ Vendor.name），这里只是把它显示出来、按家拆开。
  const otherVendorGroups: Array<{ vendorKey: string; name: string; models: ChipModel[] }> = []
  {
    const indexByVendor = new Map<string, number>()
    for (const m of otherModels) {
      let idx = indexByVendor.get(m.vendorKey)
      if (idx === undefined) {
        idx = otherVendorGroups.length
        indexByVendor.set(m.vendorKey, idx)
        otherVendorGroups.push({ vendorKey: m.vendorKey, name: vendorMeta.get(m.vendorKey)?.name || m.vendorKey, models: [] })
      }
      otherVendorGroups[idx].models.push(m)
    }
  }

  const renderVendorCard = (card: typeof knownCards[number]) => (
    <VendorOnboardCard
      key={card.directory.vendorKey}
      directory={card.directory}
      vendorName={card.meta.name}
      baseUrl={card.meta.baseUrl}
      hasApiKey={card.meta.hasApiKey}
      models={card.vendorModels}
      onChanged={refresh}
    />
  )

  return (
    <div className="flex flex-col">
      <div className="px-4 pt-4 pb-1">
        <div className="text-title font-bold text-nomi-ink">模型设置</div>
      </div>

      {/* 顶部能力概览：先告诉用户「你现在能生成什么」（effect-first），再谈配置。 */}
      <div className="px-4 pt-1 pb-2">
        <div className="text-micro text-nomi-ink-40 mb-1.5">你现在已经能生成</div>
        <div className="flex flex-wrap gap-1.5">
          {KIND_CAPS.map(({ kind, label, Icon }) => {
            const on = coveredKinds.has(kind)
            return (
              <span
                key={kind}
                className={cn(
                  'inline-flex items-center gap-1 text-caption rounded-nomi-sm px-2 py-1',
                  on ? 'bg-workbench-success-soft text-workbench-success' : 'bg-nomi-ink-05 text-nomi-ink-40',
                )}
              >
                <Icon size={13} stroke={1.7} />
                {label}
                {on ? null : <span className="text-nomi-ink-30">未接</span>}
              </span>
            )
          })}
        </div>
      </div>

      {!loaded ? (
        <div className="px-4 py-6 text-caption text-nomi-ink-40">加载中…</div>
      ) : (
      <div className="px-3 pb-3 pt-1 flex flex-col gap-2">
        {/* ── 已接入：你接好的家浮顶，一眼可见（无已接入项则整段不显）── */}
        {hasConnected ? (
          <>
            <div className="text-micro font-semibold text-nomi-ink-40 pt-1 px-0.5">已接入</div>
            {connectedKnown.map(renderVendorCard)}
            {otherVendorGroups.map((group) => {
              const enabledN = group.models.filter((m) => m.enabled).length
              return (
                <FoldableModelCard
                  key={group.vendorKey}
                  glyph={<IconStack2 size={16} stroke={1.6} />}
                  glyphTone="soft"
                  name={group.name}
                  subtitle={`${enabledN} / ${group.models.length} 个模型已启用`}
                  status="ok"
                  statusLabel="已配置"
                  defaultExpanded={false}
                >
                  <ModelEnableEditor models={group.models} onToggle={handleSetEnabled} onDelete={handleDelete} />
                </FoldableModelCard>
              )
            })}
            {dreaminaAvailable && dreaminaConnected ? (
              <DreaminaMemberCard status={dreaminaStatus} onChanged={refresh} />
            ) : null}
            {assistantAvailable && assistantConnected ? (
              <ConnectAssistantCard info={mcpInfo} onChanged={refresh} />
            ) : null}
          </>
        ) : null}

        {/* ── 可接入：保留原分组，每组折叠 + 数量；首组自适应默认展开（无已接入时）── */}
        <div className="text-micro font-semibold text-nomi-ink-40 pt-2 px-0.5">可接入</div>

        <AvailableGroup title="接入生成模型" count={availableKnown.length} defaultExpanded={!hasConnected}>
          {availableKnown.map(renderVendorCard)}
          <button
            type="button"
            onClick={() => openWizard(undefined)}
            className={cn(
              'group flex items-center gap-2.5 px-3 h-11 w-full text-left mt-0.5',
              'bg-nomi-ink text-nomi-paper rounded-nomi text-body-sm font-semibold',
              'hover:bg-nomi-accent transition-colors duration-[var(--nomi-transition-fast)]',
            )}
          >
            <IconPlus size={16} stroke={1.9} />
            <span className="flex-1 min-w-0">添加模型 / 中转站</span>
            <IconChevronRight size={15} className="shrink-0 opacity-60" />
          </button>
          <div className="text-micro text-nomi-ink-40 px-1 -mt-0.5">new-api 一次拉全图·视频·文本 · 也可接官方厂商 / 自定义接口</div>
        </AvailableGroup>

        {dreaminaAvailable && !dreaminaConnected ? (
          <AvailableGroup title="有即梦会员？" count={1} defaultExpanded={false}>
            <DreaminaMemberCard status={dreaminaStatus} onChanged={refresh} />
          </AvailableGroup>
        ) : null}

        {assistantAvailable && !assistantConnected ? (
          <AvailableGroup title="接入编程助手 · 可选" count={1} defaultExpanded={false}>
            <ConnectAssistantCard info={mcpInfo} onChanged={refresh} />
          </AvailableGroup>
        ) : null}
      </div>
      )}

      <OnboardingWizard
        opened={wizardOpen}
        onClose={() => setWizardOpen(false)}
        onCommitted={refresh}
        initialPreset={wizardPreset}
      />
    </div>
  )
}
