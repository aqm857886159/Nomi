/**
 * 模型设置面板内容（方案 A 折叠摘要卡）。
 *
 * 首屏从「模型墙」变「几行供应商摘要」：
 *  - grouplabel「预置供应商」+ 已知供应商折叠卡（apimart / kie，VendorOnboardCard）
 *  - grouplabel「其他模型」+ 自定义模型折叠卡（OtherModelsCard，chip 可删）
 *  - 末尾「添加模型」虚线卡（长尾逃生口，打开 Wizard）
 *
 * 头部不再有「添加模型」按钮（P1，入口只留末尾虚线卡一个）。
 * 不改后端 catalog / IPC / 模型数据。样张：docs/design/mockups/onboarding-panel-A.html
 */
import React from 'react'
import { IconStack2 } from '@tabler/icons-react'
import { OnboardingWizard } from './OnboardingWizard'
import { FoldableModelCard } from './FoldableModelCard'
import { VendorOnboardCard } from './VendorOnboardCard'
import { ModelChipGroups, type ChipModel } from './ModelChipGroups'
import { AddModelCard } from './AddModelCard'
import { KNOWN_VENDORS, isKnownVendor } from '../../config/knownVendors'
import { getDesktopBridge } from '../../desktop/bridge'
import { notifyModelOptionsRefresh } from '../../config/useModelOptions'

type VendorMeta = {
  name: string
  hasApiKey: boolean
  baseUrl: string
}

export function OnboardingDrawer(): JSX.Element {
  const [wizardOpen, setWizardOpen] = React.useState(false)
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
  }, [])

  const handleDelete = React.useCallback((row: ChipModel) => {
    const bridge = getDesktopBridge()
    if (!bridge) return
    const ok = window.confirm(`删除「${row.labelZh}」？此操作不可恢复。`)
    if (!ok) return
    try {
      bridge.modelCatalog.deleteModel(row.vendorKey, row.modelKey)
      refresh()
    } catch (e) {
      window.alert(`删除失败：${e instanceof Error ? e.message : String(e)}`)
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

  return (
    <div className="flex flex-col">
      <div className="px-4 pt-4 pb-1">
        <div className="text-title font-bold text-nomi-ink">模型设置</div>
      </div>

      <div className="px-3 pb-3 pt-1 flex flex-col gap-2">
        <div className="text-micro font-semibold text-nomi-ink-40 pt-2 px-0.5">预置供应商</div>
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
          <>
            <div className="text-micro font-semibold text-nomi-ink-40 pt-2 px-0.5">其他模型</div>
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
          </>
        ) : null}

        <AddModelCard onClick={() => setWizardOpen(true)} />
      </div>

      <OnboardingWizard
        opened={wizardOpen}
        onClose={() => setWizardOpen(false)}
        onCommitted={refresh}
      />
    </div>
  )
}
