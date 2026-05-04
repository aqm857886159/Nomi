import React from 'react'
import { Collapse, Group, Stack, Text, Tooltip } from '@mantine/core'
import { IconDatabaseCog, IconDownload, IconKey, IconRefresh, IconCircleCheck, IconCircleDashed, IconAlertCircle } from '@tabler/icons-react'
import {
  deleteModelCatalogMapping,
  deleteModelCatalogModel,
  deleteModelCatalogVendor,
  exportModelCatalogPackage,
  importModelCatalogPackage,
  listModelCatalogMappings,
  listModelCatalogModels,
  listModelCatalogVendors,
  toast,
  type BillingModelKind,
  type ModelCatalogImportPackageDto,
  type ModelCatalogImportResultDto,
  type ModelCatalogMappingDto,
  type ModelCatalogModelDto,
  type ModelCatalogVendorDto,
  type ProfileKind,
} from './deps'
import { ModelCatalogImportSection } from './ModelCatalogImportSection'
import { ModelCatalogMappingsSection } from './ModelCatalogMappingsSection'
import { ModelCatalogModelsSection } from './ModelCatalogModelsSection'
import { ModelCatalogVendorsSection } from './ModelCatalogVendorsSection'
import { MappingEditModal, type MappingEditorState } from './modals/MappingEditModal'
import { ModelEditModal, type ModelEditorState } from './modals/ModelEditModal'
import { VendorApiKeyModal } from './modals/VendorApiKeyModal'
import { VendorEditModal, type VendorEditorState } from './modals/VendorEditModal'
import { IMPORT_TEMPLATE } from './modelCatalog.constants'
import { buildModelCatalogExportPackage, buildSafeFileTimestamp, downloadTextAsFile, safeParseJson } from './modelCatalog.utils'
import { notifyModelOptionsRefresh } from '../../../../config/useModelOptions'
import { DesignButton, DesignModal, IconActionButton } from '../../../../design'

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback
}

function readImportPackageVendors(value: unknown): ModelCatalogImportPackageDto['vendors'] | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const vendors = (value as { vendors?: unknown }).vendors
  return Array.isArray(vendors) ? (vendors as ModelCatalogImportPackageDto['vendors']) : null
}

function countImportPackageApiKeys(vendors: ModelCatalogImportPackageDto['vendors']): number {
  return vendors.reduce((acc, vendorBundle) => {
    const raw = vendorBundle.apiKey?.apiKey
    return typeof raw === 'string' && raw.trim().length > 0 ? acc + 1 : acc
  }, 0)
}

export default function StatsModelCatalogManagement({
  className,
  compact = false,
}: {
  className?: string
  compact?: boolean
}): JSX.Element {
  const rootClassName = ['stats-model-catalog', className].filter(Boolean).join(' ')

  const [loading, setLoading] = React.useState(false)
  const [vendors, setVendors] = React.useState<ModelCatalogVendorDto[]>([])
  const [models, setModels] = React.useState<ModelCatalogModelDto[]>([])
  const [mappings, setMappings] = React.useState<ModelCatalogMappingDto[]>([])

  const [importText, setImportText] = React.useState('')
  const [importSubmitting, setImportSubmitting] = React.useState(false)
  const [lastImportResult, setLastImportResult] = React.useState<ModelCatalogImportResultDto | null>(null)

  const [exportSubmitting, setExportSubmitting] = React.useState(false)
  const [exportMode, setExportMode] = React.useState<'safe' | 'full' | null>(null)

  const [vendorEditor, setVendorEditor] = React.useState<VendorEditorState | null>(null)
  const [vendorApiKeyVendor, setVendorApiKeyVendor] = React.useState<ModelCatalogVendorDto | null>(null)
  const [vendorsModalOpened, setVendorsModalOpened] = React.useState(false)
  const [modelEditor, setModelEditor] = React.useState<ModelEditorState | null>(null)
  const [mappingEditor, setMappingEditor] = React.useState<MappingEditorState | null>(null)
  const [catalogDetailsOpened, setCatalogDetailsOpened] = React.useState(false)

  const vendorSelectData = React.useMemo(() => {
    const base = vendors
      .map((v) => ({
        value: v.key,
        label: `${v.name}（${v.key}）`,
      }))
      .sort((a, b) => a.label.localeCompare(b.label, 'zh-CN'))
    return [{ value: 'all', label: '全部厂商' }, ...base]
  }, [vendors])

  const vendorOptions = React.useMemo(() => {
    const items = vendors
      .map((v) => ({ value: v.key, label: `${v.name}（${v.key}）` }))
      .sort((a, b) => a.label.localeCompare(b.label, 'zh-CN'))
    return items
  }, [vendors])
  const enabledVendorKeySet = React.useMemo(() => {
    return new Set(vendors.filter((vendor) => vendor.enabled).map((vendor) => vendor.key))
  }, [vendors])

  const enabledMappingTaskKindsByVendor = React.useMemo(() => {
    const map = new Map<string, Set<ProfileKind>>()
    for (const mapping of mappings) {
      if (!mapping.enabled) continue
      const vendorKey = String(mapping.vendorKey || '').trim()
      if (!vendorKey) continue
      const existing = map.get(vendorKey) || new Set<ProfileKind>()
      existing.add(mapping.taskKind)
      map.set(vendorKey, existing)
    }
    return map
  }, [mappings])

  const resolveTaskKindsForModelKind = React.useCallback((kind: BillingModelKind): ProfileKind[] => {
    if (kind === 'image') return ['text_to_image', 'image_edit']
    if (kind === 'video') return ['text_to_video', 'image_to_video']
    return ['chat', 'prompt_refine', 'image_to_prompt']
  }, [])

  const isModelCapabilityEnabled = React.useCallback((model: ModelCatalogModelDto): boolean => {
    if (!model.enabled) return false
    const vendorKey = String(model.vendorKey || '').trim()
    if (!vendorKey || !enabledVendorKeySet.has(vendorKey)) return false
    const taskKinds = resolveTaskKindsForModelKind(model.kind)
    const enabledTaskKinds = enabledMappingTaskKindsByVendor.get(vendorKey)
    if (!enabledTaskKinds || !enabledTaskKinds.size) return false
    return taskKinds.some((taskKind) => enabledTaskKinds.has(taskKind))
  }, [enabledMappingTaskKindsByVendor, enabledVendorKeySet, resolveTaskKindsForModelKind])

  const reloadAll = React.useCallback(async () => {
    setLoading(true)
    try {
      const [v, m, mp] = await Promise.allSettled([
        listModelCatalogVendors(),
        listModelCatalogModels(),
        listModelCatalogMappings(),
      ])

      if (v.status === 'fulfilled') setVendors(Array.isArray(v.value) ? v.value : [])
      else {
        setVendors([])
        toast(getErrorMessage(v.reason, '加载厂商列表失败'), 'error')
      }

      if (m.status === 'fulfilled') setModels(Array.isArray(m.value) ? m.value : [])
      else {
        setModels([])
        toast(getErrorMessage(m.reason, '加载模型列表失败'), 'error')
      }

      if (mp.status === 'fulfilled') setMappings(Array.isArray(mp.value) ? mp.value : [])
      else {
        setMappings([])
        toast(getErrorMessage(mp.reason, '加载映射列表失败'), 'error')
      }

      notifyModelOptionsRefresh('all')
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    void reloadAll()
  }, [reloadAll])

  const handleDeleteVendor = React.useCallback(
    async (vendor: ModelCatalogVendorDto) => {
      if (!window.confirm(`确定删除厂商「${vendor.name}（${vendor.key}）」？\n\n注意：若该厂商仍被模型/映射引用，数据库可能会拒绝删除。`)) return
      try {
        await deleteModelCatalogVendor(vendor.key)
        toast('已删除厂商', 'success')
        await reloadAll()
      } catch (err: unknown) {
        console.error('delete vendor failed', err)
        toast(getErrorMessage(err, '删除厂商失败'), 'error')
      }
    },
    [reloadAll],
  )

  const handleDeleteModel = React.useCallback(
    async (model: ModelCatalogModelDto) => {
      if (!window.confirm(`确定删除模型「${model.labelZh}（${model.modelKey}）」？`)) return
      try {
        await deleteModelCatalogModel(model.vendorKey, model.modelKey)
        toast('已删除模型', 'success')
        await reloadAll()
      } catch (err: unknown) {
        console.error('delete model failed', err)
        toast(getErrorMessage(err, '删除模型失败'), 'error')
      }
    },
    [reloadAll],
  )

  const handleDeleteMapping = React.useCallback(
    async (mapping: ModelCatalogMappingDto) => {
      if (!window.confirm(`确定删除映射「${mapping.vendorKey} / ${mapping.taskKind} / ${mapping.name}」？`)) return
      try {
        await deleteModelCatalogMapping(mapping.id)
        toast('已删除映射', 'success')
        await reloadAll()
      } catch (err: unknown) {
        console.error('delete mapping failed', err)
        toast(getErrorMessage(err, '删除映射失败'), 'error')
      }
    },
    [reloadAll],
  )

  const runImport = React.useCallback(
    async (pkg: ModelCatalogImportPackageDto) => {
      if (importSubmitting) return
      setImportSubmitting(true)
      try {
        const result = await importModelCatalogPackage(pkg)
        setLastImportResult(result)
        toast(`导入完成：vendors=${result.imported.vendors} models=${result.imported.models} mappings=${result.imported.mappings}`, 'success')
        notifyModelOptionsRefresh('all')
        await reloadAll()
      } catch (err: unknown) {
        const message = getErrorMessage(err, '导入失败')
        console.error('import model catalog failed', err)
        toast(message, 'error')
        throw new Error(message)
      } finally {
        setImportSubmitting(false)
      }
    },
    [importSubmitting, reloadAll],
  )

  const handleExport = React.useCallback(async () => {
    if (exportSubmitting) return
    setExportMode('safe')
    setExportSubmitting(true)
    try {
      const [v, m, mp] = await Promise.all([
        listModelCatalogVendors(),
        listModelCatalogModels(),
        listModelCatalogMappings(),
      ])
      if (!Array.isArray(v) || v.length === 0) {
        toast('暂无厂商配置可导出', 'error')
        return
      }

      const now = new Date()
      const pkg = buildModelCatalogExportPackage({
        vendors: Array.isArray(v) ? v : [],
        models: Array.isArray(m) ? m : [],
        mappings: Array.isArray(mp) ? mp : [],
        now,
      })

      const jsonStr = JSON.stringify(pkg, null, 2)
      const fileName = `tapcanvas-model-catalog-${buildSafeFileTimestamp(now)}.json`
      downloadTextAsFile(jsonStr, fileName, 'application/json')
      toast(`已导出配置（vendors=${pkg.vendors.length}，不含任何 API Key）`, 'success')
    } catch (err: unknown) {
      console.error('export model catalog failed', err)
      toast(getErrorMessage(err, '导出失败'), 'error')
    } finally {
      setExportSubmitting(false)
      setExportMode(null)
    }
  }, [exportSubmitting])

  const handleExportFull = React.useCallback(async () => {
    if (exportSubmitting) return
    const ok = window.confirm('即将导出“迁移包”（包含所有厂商配置 + API Key 明文）。\n\n注意：\n- 文件包含敏感信息，请勿上传到公开渠道\n- 建议仅用于本地 -> PRD 迁移后立即删除\n\n确定继续导出？')
    if (!ok) return

    setExportMode('full')
    setExportSubmitting(true)
    try {
      const pkg = await exportModelCatalogPackage({ includeApiKeys: true })
      const vendorCount = Array.isArray(pkg?.vendors) ? pkg.vendors.length : 0
      if (!vendorCount) {
        toast('暂无厂商配置可导出', 'error')
        return
      }
      const apiKeyCount = countImportPackageApiKeys(pkg.vendors || [])

      const now = new Date()
      const jsonStr = JSON.stringify(pkg, null, 2)
      const fileName = `tapcanvas-model-catalog-full-${buildSafeFileTimestamp(now)}.json`
      downloadTextAsFile(jsonStr, fileName, 'application/json')
      toast(`已导出迁移包（vendors=${vendorCount}，apiKeys=${apiKeyCount}）`, 'success')
    } catch (err: unknown) {
      console.error('export model catalog full failed', err)
      toast(getErrorMessage(err, '导出失败'), 'error')
    } finally {
      setExportSubmitting(false)
      setExportMode(null)
    }
  }, [exportSubmitting])

  const fillTemplate = React.useCallback(() => {
    setImportText(JSON.stringify(IMPORT_TEMPLATE, null, 2))
    toast('已填充导入模板（请按需修改）', 'success')
  }, [])

  const readyModelCount = React.useMemo(
    () => models.filter((model) => isModelCapabilityEnabled(model)).length,
    [isModelCapabilityEnabled, models],
  )
  const apiKeyReadyCount = React.useMemo(
    () => vendors.filter((vendor) => vendor.enabled && vendor.hasApiKey).length,
    [vendors],
  )
  const hasAnyConfig = vendors.length > 0 || models.length > 0 || mappings.length > 0

  const submitImport = React.useCallback(async () => {
    const parsed = safeParseJson(importText)
    if (!parsed.ok) {
      toast(`导入 JSON 无效：${parsed.error}`, 'error')
      return
    }
    if (!parsed.value || typeof parsed.value !== 'object') {
      toast('导入内容必须是 JSON 对象', 'error')
      return
    }

    const vendorsArr = readImportPackageVendors(parsed.value)
    if (!vendorsArr || vendorsArr.length === 0) {
      toast('导入 JSON 缺少 vendors 或为空', 'error')
      return
    }

    const apiKeyCount = countImportPackageApiKeys(vendorsArr)
    const ok = window.confirm(
      `确定导入 vendors=${vendorsArr.length} 的配置？\n\n注意：\n- 会覆盖同 Key 的厂商/模型/映射配置\n- ${apiKeyCount > 0 ? `会覆盖同 Key 的厂商 API Key（明文导入，apiKeys=${apiKeyCount}）` : '不包含 API Key（不会改动现有 API Key）'}`,
    )
    if (!ok) return

    await runImport(parsed.value as ModelCatalogImportPackageDto)
  }, [importText, runImport])

  if (compact) {
    return (
      <Stack className={rootClassName} gap={0}>
        <ModelCatalogImportSection
          importText={importText}
          setImportText={setImportText}
          importSubmitting={importSubmitting}
          lastImportResult={lastImportResult}
          onFillTemplate={fillTemplate}
          onSubmitImport={() => void submitImport()}
          onImportPackage={runImport}
          compact
        />
      </Stack>
    )
  }

  return (
    <Stack className={rootClassName} gap="md">
      <Group className="stats-model-catalog-toolbar" justify="space-between" align="flex-start" gap="md" wrap="wrap">
        <div className="stats-model-catalog-toolbar-left">
          <Text className="stats-model-catalog-title" size="sm" fw={700}>接入模型</Text>
          <Text className="stats-model-catalog-subtitle" size="xs" c="dimmed">
            把文本、图片、视频模型接进当前工作台。Agent 只生成草案；确认写入后，节点和 AI 区才会使用这些配置。
          </Text>
        </div>
        <Group className="stats-model-catalog-toolbar-actions" gap={6} wrap="wrap">
          <DesignButton
            className="stats-model-catalog-toolbar-vendors"
            size="xs"
            variant="light"
            leftSection={<IconDatabaseCog className="stats-model-catalog-toolbar-vendors-icon" size={14} />}
            onClick={() => setVendorsModalOpened(true)}
          >
            厂商管理
          </DesignButton>
          <DesignButton
            className="stats-model-catalog-toolbar-export"
            size="xs"
            variant="light"
            leftSection={<IconDownload className="stats-model-catalog-toolbar-export-icon" size={14} />}
            onClick={() => void handleExport()}
            loading={exportSubmitting && exportMode === 'safe'}
          >
            导出配置
          </DesignButton>
          <DesignButton
            className="stats-model-catalog-toolbar-export-full"
            size="xs"
            variant="light"
            leftSection={<IconKey className="stats-model-catalog-toolbar-export-full-icon" size={14} />}
            onClick={() => void handleExportFull()}
            loading={exportSubmitting && exportMode === 'full'}
          >
            导出迁移包
          </DesignButton>
          <Tooltip className="stats-model-catalog-refresh-tooltip" label="刷新" withArrow>
            <IconActionButton className="stats-model-catalog-refresh" size="sm" variant="subtle" aria-label="刷新" onClick={() => void reloadAll()} loading={loading} icon={<IconRefresh className="stats-model-catalog-refresh-icon" size={14} />} />
          </Tooltip>
        </Group>
      </Group>

      <div className="stats-model-catalog-quickstart" aria-label="模型接入状态">
        <div className="stats-model-catalog-quickstart__step" data-state={vendors.length > 0 ? 'done' : 'todo'}>
          {vendors.length > 0 ? <IconCircleCheck className="stats-model-catalog-quickstart__icon" size={16} /> : <IconCircleDashed className="stats-model-catalog-quickstart__icon" size={16} />}
          <div className="stats-model-catalog-quickstart__text">
            <span>1. 导入平台</span>
            <small>{vendors.length > 0 ? `${vendors.length} 个平台` : '先粘贴文档或导入 JSON'}</small>
          </div>
        </div>
        <div className="stats-model-catalog-quickstart__step" data-state={apiKeyReadyCount > 0 ? 'done' : vendors.length > 0 ? 'warn' : 'todo'}>
          {apiKeyReadyCount > 0 ? <IconCircleCheck className="stats-model-catalog-quickstart__icon" size={16} /> : <IconAlertCircle className="stats-model-catalog-quickstart__icon" size={16} />}
          <div className="stats-model-catalog-quickstart__text">
            <span>2. 填 API Key</span>
            <small>{apiKeyReadyCount > 0 ? `${apiKeyReadyCount} 个平台可调用` : '在模型接入 Agent 或平台管理里填写密钥'}</small>
          </div>
        </div>
        <div className="stats-model-catalog-quickstart__step" data-state={readyModelCount > 0 ? 'done' : hasAnyConfig ? 'warn' : 'todo'}>
          {readyModelCount > 0 ? <IconCircleCheck className="stats-model-catalog-quickstart__icon" size={16} /> : <IconAlertCircle className="stats-model-catalog-quickstart__icon" size={16} />}
          <div className="stats-model-catalog-quickstart__text">
            <span>3. 在节点里使用</span>
            <small>{readyModelCount > 0 ? `${readyModelCount} 个模型已可选` : '需要启用模型和调用配置'}</small>
          </div>
        </div>
      </div>

      {!hasAnyConfig ? (
        <div className="stats-model-catalog-empty-guide" aria-label="模型管理空状态">
          <Text className="stats-model-catalog-empty-guide__title" size="sm" fw={700}>这里还没有可用模型</Text>
          <Text className="stats-model-catalog-empty-guide__desc" size="xs" c="dimmed">
            最快方式：把供应商文档或 curl 示例粘到下面，生成配置草稿并导入。导入后再填写 API Key，节点就能选择这些模型。
          </Text>
        </div>
      ) : null}

      <ModelCatalogImportSection
        importText={importText}
        setImportText={setImportText}
        importSubmitting={importSubmitting}
        lastImportResult={lastImportResult}
        onFillTemplate={fillTemplate}
        onSubmitImport={() => void submitImport()}
        onImportPackage={runImport}
        compact={compact}
      />

      <DesignButton
        className="stats-model-catalog-details-toggle"
        size="xs"
        variant="subtle"
        onClick={() => setCatalogDetailsOpened((current) => !current)}
      >
        {catalogDetailsOpened ? '收起模型列表和调用配置' : `查看模型列表和调用配置（${models.length} 个模型）`}
      </DesignButton>

      <Collapse className="stats-model-catalog-details-collapse" in={catalogDetailsOpened}>
        <Stack className="stats-model-catalog-details" gap="md">
          <ModelCatalogModelsSection
            loading={loading}
            models={models}
            vendorSelectData={vendorSelectData}
            isModelCapabilityEnabled={isModelCapabilityEnabled}
            onCreateModel={() => setModelEditor({ mode: 'create' })}
            onEditModel={(model) => setModelEditor({ mode: 'edit', model })}
            onDuplicateModel={(model) => setModelEditor({ mode: 'duplicate', model })}
            onDeleteModel={(model) => void handleDeleteModel(model)}
          />

          <ModelCatalogMappingsSection
            loading={loading}
            mappings={mappings}
            models={models}
            vendorSelectData={vendorSelectData}
            onCreateMapping={() => setMappingEditor({ mode: 'create' })}
            onEditMapping={(mapping) => setMappingEditor({ mode: 'edit', mapping })}
            onDeleteMapping={(mapping) => void handleDeleteMapping(mapping)}
          />
        </Stack>
      </Collapse>

      <DesignModal
        className="stats-model-catalog-vendors-modal"
        opened={vendorsModalOpened}
        onClose={() => setVendorsModalOpened(false)}
        title="厂商管理"
        size="xl"
        centered
        lockScroll={false}
      >
        <Stack className="stats-model-catalog-vendors-modal-body" gap="sm">
          <Text className="stats-model-catalog-vendors-modal-desc" size="xs" c="dimmed">
            这里维护系统级厂商、API Key 和鉴权信息；模型与映射仍在主页面管理。
          </Text>
          <ModelCatalogVendorsSection
            loading={loading}
            vendors={vendors}
            onCreateVendor={() => setVendorEditor({ mode: 'create' })}
            onEditVendor={(vendor) => setVendorEditor({ mode: 'edit', vendor })}
            onDeleteVendor={(vendor) => void handleDeleteVendor(vendor)}
            onOpenVendorApiKey={(vendor) => setVendorApiKeyVendor(vendor)}
          />
        </Stack>
      </DesignModal>

      <VendorApiKeyModal
        opened={!!vendorApiKeyVendor}
        vendor={vendorApiKeyVendor}
        onClose={() => setVendorApiKeyVendor(null)}
        onSaved={reloadAll}
      />

      <VendorEditModal
        editor={vendorEditor}
        onClose={() => setVendorEditor(null)}
        onSaved={reloadAll}
      />

      <ModelEditModal
        editor={modelEditor}
        vendorOptions={vendorOptions}
        onClose={() => setModelEditor(null)}
        onSaved={reloadAll}
      />

      <MappingEditModal
        editor={mappingEditor}
        vendorOptions={vendorOptions}
        onClose={() => setMappingEditor(null)}
        onSaved={reloadAll}
      />
    </Stack>
  )
}
