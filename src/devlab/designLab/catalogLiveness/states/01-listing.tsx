import React, { type JSX } from 'react'
import { APIMART_TEXT_MODELS } from '../../../../../electron/catalog/apimartTexts'
import { curatedCatalogLifecycle } from '../../../../../electron/catalog/seedModelIdentity'
import { modelListReconciliation } from '../../../../../electron/catalog/modelListReconcile'
import type { Model } from '../../../../../electron/catalog/types'
import { getLocalizedKnownVendors } from '../../../../config/knownVendors'
import { projectModelSettingsCatalog } from '../../../../ui/onboarding/modelSettingsCatalogProjection'
import { VendorOnboardCard } from '../../../../ui/onboarding/VendorOnboardCard'
import { ModelSettingsDetailDialog } from '../../../../ui/onboarding/ModelSettingsDetailDialog'
import { ConnectionWorkspacePage, ModelWorkspacePage } from '../../../../ui/onboarding/ModelSettingsWorkspacePages'
import { seedVendorHealthSnapshotForTests } from '../../../../ui/onboarding/useVendorHealth'
import type { LabState } from '../../labScreen'

function CatalogStage(): JSX.Element {
  const [selectedKey, setSelectedKey] = React.useState<string | null>(null)
  const [closed, setClosed] = React.useState(false)
  const [models, setModels] = React.useState(() => {
    seedVendorHealthSnapshotForTests('apimart|https://api.apimart.ai', { vendorKey: 'apimart', state: 'reachable', checkedAt: 0 })
    const rows: Model[] = APIMART_TEXT_MODELS.map((model) => ({ ...model, vendorKey: 'apimart', kind: 'text', enabled: true,
      meta: { ...model.meta, catalogLifecycle: curatedCatalogLifecycle(model.modelKey) }, createdAt: '2026-09-08', updatedAt: '2026-09-08' }))
    const list = rows.filter((model) => model.modelKey !== 'deepseek-v4-flash').map((model) => model.modelKey)
    const patches = modelListReconciliation(rows, 'apimart', { ok: true, models: list, statuses: [200] })
    return rows.map((model) => ({ ...model, ...patches.find((patch) => patch.modelKey === model.modelKey) }))
  })
  // 字面量在这里是准确的：KNOWN_VENDORS 是**展示目录**，它的 vendorKey 恒为内置 key，
  // 不是运行时 vendor 行（长不出兄弟连接）。已登记进门岗豁免名单并由断言验（#831）。
  const directory = getLocalizedKnownVendors().find((vendor) => vendor.vendorKey === 'apimart')!
  const chips = projectModelSettingsCatalog(models as unknown as Array<Record<string, unknown>>).models
  return <div data-design-lab-stage className="bg-nomi-bg" style={{ width: 960, height: 720 }}>
    {!closed ? <ModelSettingsDetailDialog label="APIMart" onClose={() => setClosed(true)} escapeAction="close">
      {selectedKey ? <ModelWorkspacePage model={chips.find((row) => row.modelKey === selectedKey)} modelKey={selectedKey} vendorName="APIMart"
        canUseScript={false} canAutoAdapt={false} hasActiveRun={false} hasTask={false} adaptStarting={false} mappings={[]}
        onOpenScript={() => undefined} onStartAdapt={() => undefined} onOpenTask={() => undefined} onOpenCapability={() => undefined}
        onSetEnabled={(enabled) => setModels((current) => current.map((model) => model.modelKey === selectedKey ? { ...model, enabled } : model))}
        onRetype={() => undefined} onDelete={() => { setModels((current) => current.filter((model) => model.modelKey !== selectedKey)); setSelectedKey(null) }} onBack={() => setSelectedKey(null)}
      /> : <ConnectionWorkspacePage vendorKey="apimart" title="APIMart" canAddModels={false} onAddModels={() => undefined} onBack={() => setClosed(true)} details={
        <VendorOnboardCard directory={directory} vendorName="APIMart" baseUrl="https://api.apimart.ai" hasApiKey models={chips} detailMode onChanged={() => undefined}
          onOpenModel={(row) => setSelectedKey(row.modelKey)}
          onToggleModel={(row, enabled) => setModels((current) => current.map((model) => model.modelKey === row.modelKey ? { ...model, enabled } : model))}
          onDeleteModel={(row) => setModels((current) => current.filter((model) => model.modelKey !== row.modelKey))}
        />
      } />}
    </ModelSettingsDetailDialog> : null}
  </div>
}

export const CATALOG_LIVENESS_STATES: readonly LabState[] = [
  {
    id: 'catalog-liveness-light',
    name: '未列出旁注与删除 · 明',
    source: 'docs/plan/2026-09-07-agent-rebuild-stage3-5-deep-plan.md §3.3 / §7 岔路 3',
    coverage: 'shell',
    capture: 'viewport',
    scheme: 'light',
    render: () => <CatalogStage />,
  },
  {
    id: 'catalog-liveness-dark',
    name: '未列出旁注与删除 · 暗',
    source: 'docs/plan/2026-09-07-agent-rebuild-stage3-5-deep-plan.md §3.3 / §7 岔路 3',
    coverage: 'shell',
    capture: 'viewport',
    scheme: 'dark',
    render: () => <CatalogStage />,
  },
]
