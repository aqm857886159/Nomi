/**
 * 模型设置面板内容（简化版：A 分区列表 + 顶部能力概览，见 docs/plan/2026-06-22-model-onboarding-simplify.md）。
 *
 * 从上到下：
 *  - 顶部「你现在已经能生成」能力概览条（图/视频/文本/配音，由已连通供应商的模型 kind 派生，effect-first）
 *  - 【接入生成模型】供应商行卡（VendorOnboardCard，待接入一眼可见可解锁）+ 其他模型卡 + 一个合并入口「添加模型/中转站」
 *  - 【接入编程助手 · 可选】ConnectAssistantCard（长尾，折叠）
 *
 * 合并同源入口：原「接你的中转站·new-api」与「添加其他模型」两张卡点开同一个 Wizard → 合成一张（消歧）。
 * 不改后端 catalog / IPC / 模型数据。
 */
import React from 'react'
import { IconStack2, IconChevronRight, IconPlus, IconPhoto, IconVideo, IconMessageCircle, IconMusic } from '@tabler/icons-react'
import { cn } from '../../utils/cn'
import { OnboardingWizard } from './OnboardingWizard'
import { FoldableModelCard } from './FoldableModelCard'
import { VendorOnboardCard } from './VendorOnboardCard'
import { ModelChipGroups, type ChipModel } from './ModelChipGroups'
import { ConnectAssistantCard } from './ConnectAssistantCard'
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
  // 打开 Wizard 时预选的预设：中转卡传 'newapi'（直接进中转拉取流），「添加其他模型」传 undefined。
  const [wizardPreset, setWizardPreset] = React.useState<string | undefined>(undefined)
  const openWizard = React.useCallback((preset?: string) => { setWizardPreset(preset); setWizardOpen(true) }, [])
  const [models, setModels] = React.useState<ChipModel[]>([])
  const [vendorMeta, setVendorMeta] = React.useState<Map<string, VendorMeta>>(new Map())
  const [version, setVersion] = React.useState(0) // bump to refetch

  React.useEffect(() => {
    const bridge = getDesktopBridge()
    if (!bridge) return
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
      }))
      setVendorMeta(metaMap)
      setModels(rows)
    } catch {
      setVendorMeta(new Map())
      setModels([])
    }
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
      message: `删除「${row.labelZh}」？此操作不可恢复。`,
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

  // 已知供应商：catalog 里存在该 vendor 才渲染卡片。
  const knownCards = KNOWN_VENDORS
    .map((directory) => {
      const meta = vendorMeta.get(directory.vendorKey)
      if (!meta) return null
      const vendorModels = models.filter((m) => m.vendorKey === directory.vendorKey)
      return { directory, meta, vendorModels }
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)

  // 其他模型：非已知供应商的自定义接入。
  const otherModels = models.filter((m) => !isKnownVendor(m.vendorKey))

  // 能力覆盖：某 kind 有「已连通供应商（hasApiKey）」的模型 = 现在就能生成（诚实，未连通不算）。
  const coveredKinds = React.useMemo(() => {
    const set = new Set<string>()
    for (const m of models) {
      if (vendorMeta.get(m.vendorKey)?.hasApiKey) set.add(String(m.kind))
    }
    return set
  }, [models, vendorMeta])

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

      <div className="px-3 pb-3 pt-1 flex flex-col gap-2">
        {/* ── 区一：接入生成模型 ── */}
        <div className="text-micro font-semibold text-nomi-ink-40 pt-1 px-0.5">接入生成模型</div>
        {knownCards.map(({ directory, meta, vendorModels }) => (
          <VendorOnboardCard
            key={directory.vendorKey}
            directory={directory}
            vendorName={meta.name}
            baseUrl={meta.baseUrl}
            hasApiKey={meta.hasApiKey}
            models={vendorModels}
            onChanged={refresh}
          />
        ))}

        {otherModels.length > 0 ? (
          <FoldableModelCard
            glyph={<IconStack2 size={16} stroke={1.6} />}
            glyphTone="soft"
            name="其他模型"
            subtitle={`${otherModels.length} 个自定义模型`}
            status="ok"
            statusLabel="已配置"
            defaultExpanded={false}
          >
            <ModelChipGroups models={otherModels} connected onDelete={handleDelete} />
          </FoldableModelCard>
        ) : null}

        {/* 合并入口：原「中转站·new-api」与「添加其他模型」两张同源卡 → 一张（消歧，P1）。 */}
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

        {/* ── 区二：接入编程助手（长尾，可选，折叠）── */}
        <div className="text-micro font-semibold text-nomi-ink-40 pt-3 px-0.5">接入编程助手 · 可选</div>
        <ConnectAssistantCard />
      </div>

      <OnboardingWizard
        opened={wizardOpen}
        onClose={() => setWizardOpen(false)}
        onCommitted={refresh}
        initialPreset={wizardPreset}
      />
    </div>
  )
}
