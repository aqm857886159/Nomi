// 助手模型选择器：让用户指定创作/画布 agent 用哪个 text 模型（根治「盲选第一个=撞到不响应的就全卡」）。
// 写偏好到 localStorage（assistantModelPref），runWorkbenchAgent 自动带进 payload，两个面板都生效。
import React from 'react'
import { useTranslation } from 'react-i18next'
import { listWorkbenchModelCatalogModels, listWorkbenchModelCatalogVendors, type ModelCatalogModelDto } from '../api/modelCatalogApi'
import { decodeModelIdentity, encodeModelIdentity, filterUsableAssistantTextModels } from './assistantModelIdentity'
import { getAssistantModelPref, setAssistantModelPref } from './assistantModelPref'
import { NomiSelect, NomiSkeleton, WorkbenchButton } from '../../design'
import type { ModelOption } from '../../config/models'
import { useDedupedModelSelect } from '../common/useDedupedModelSelect'

// 与后端 chooseTextModel 一致的"像通用对话模型"判定：vision/preview 等不可靠发 tool_use 的降权，
// 选默认时排到最后。让默认就是一个具体的、能用的模型（而不是看不懂的「自动选模型」）。
const DEPRIORITIZE = /vision|preview|audio|tts|whisper|embed|rerank|ocr|search|thinking/i
function pickDefaultModel(models: ModelCatalogModelDto[]): ModelCatalogModelDto | undefined {
  return [...models].sort(
    (a, b) =>
      (DEPRIORITIZE.test(`${a.modelKey} ${a.labelZh}`) ? 1 : 0) -
      (DEPRIORITIZE.test(`${b.modelKey} ${b.labelZh}`) ? 1 : 0),
  )[0]
}

export default function AssistantModelPicker({ className }: { className?: string } = {}): JSX.Element | null {
  const { t } = useTranslation()
  const [models, setModels] = React.useState<ModelCatalogModelDto[]>([])
  const modelsRef = React.useRef(models)
  modelsRef.current = models
  const loadRequestRef = React.useRef(0)
  const [vendorNames, setVendorNames] = React.useState<Record<string, string>>({})
  const [loaded, setLoaded] = React.useState(false)
  // 选中值是**两段身份**（vendorKey + modelKey）——只用 modelKey 会在同名模型上张冠李戴，见 assistantModelIdentity。
  const [selected, setSelected] = React.useState<string>(() => {
    const pref = getAssistantModelPref()
    return pref ? encodeModelIdentity(pref) : ''
  })

  const loadCatalog = React.useCallback(async () => {
    const requestId = ++loadRequestRef.current
    try {
      const [vendors, rows] = await Promise.all([
        listWorkbenchModelCatalogVendors(),
        listWorkbenchModelCatalogModels({ kind: 'text', enabled: true }),
      ])
      if (requestId !== loadRequestRef.current) return
      const usableRows = filterUsableAssistantTextModels(rows, vendors)
      setVendorNames(Object.fromEntries(vendors.map((v) => [v.key, v.name])))
      setModels(usableRows)

      // 存量偏好自愈：老记录允许 vendorKey 为空（见 assistantModelPref 的 getter），
      // 那样拼出的身份匹配不上任何选项 → 下拉显示空白。这里按 modelKey 找回它真正的供应商
      // 并把完整身份写回去；若偏好已经不在真实可用目录，则清掉它，绝不保留假选中态。
      const pref = getAssistantModelPref()
      const found = pref
        ? usableRows.find((row) => row.modelKey === pref.modelKey && (!pref.vendorKey || row.vendorKey === pref.vendorKey))
        : undefined
      if (found) {
        if (!pref?.vendorKey || pref.vendorKey !== found.vendorKey) {
          setAssistantModelPref({ vendorKey: found.vendorKey, modelKey: found.modelKey })
        }
        setSelected(encodeModelIdentity(found))
      } else {
        if (pref) setAssistantModelPref(null)
        const def = pickDefaultModel(usableRows)
        if (def) {
          setAssistantModelPref({ vendorKey: def.vendorKey, modelKey: def.modelKey })
          setSelected(encodeModelIdentity(def))
        } else {
          setSelected('')
        }
      }
    } catch {
      if (requestId !== loadRequestRef.current) return
      setModels([])
      setSelected('')
    } finally {
      if (requestId === loadRequestRef.current) setLoaded(true)
    }
  }, [])

  const modelOptions = React.useMemo<ModelOption[]>(() => models.map((model) => ({
    value: model.modelKey,
    label: model.labelZh || model.modelKey,
    vendor: model.vendorKey,
    vendorName: vendorNames[model.vendorKey],
    modelKey: model.modelKey,
    meta: model.meta,
  })), [models, vendorNames])
  const selectedIdentity = decodeModelIdentity(selected)
  const modelSelect = useDedupedModelSelect(
    modelOptions,
    selectedIdentity?.modelKey || '',
    (modelKey, vendorKey) => {
      if (!vendorKey) return
      const identity = { vendorKey, modelKey }
      setSelected(encodeModelIdentity(identity))
      setAssistantModelPref(identity)
    },
    selectedIdentity?.vendorKey,
  )

  React.useEffect(() => {
    void loadCatalog()
    const sync = () => {
      const pref = getAssistantModelPref()
      if (!pref) {
        setSelected('')
        return
      }
      const selectedStillExists = modelsRef.current.some((model) => model.vendorKey === pref.vendorKey && model.modelKey === pref.modelKey)
      if (selectedStillExists) setSelected(encodeModelIdentity(pref))
    }
    window.addEventListener('nomi:assistant-model-changed', sync)
    window.addEventListener('nomi-model-catalog-changed', loadCatalog)
    return () => {
      loadRequestRef.current += 1
      window.removeEventListener('nomi:assistant-model-changed', sync)
      window.removeEventListener('nomi-model-catalog-changed', loadCatalog)
    }
  }, [loadCatalog])

  // pending 规范 #3:加载中给占位骨架,不再凭空消失(return null 让选择器闪现)。
  if (!loaded) {
    return <NomiSkeleton className={`h-7 w-[120px] ${className ?? ''}`} />
  }
  // 加载完确实没有可选 text 模型 → 入口仍在，点它进入模型接入；不能静默消失。
  if (models.length === 0) {
    return (
      <WorkbenchButton
        variant="accent"
        size="sm"
        className={className}
        data-assistant-model-picker="true"
        data-state="empty"
        // 点破缺的是**文本模型/大脑**（不是任意模型）：这个入口的 empty 态只在没有可用 text 模型时出现，
        // 泛泛「去配置模型」让人以为要配图/视频模型（2026-08-25 走查 F2）。模型配置的家仍在顶栏「模型」，
        // 这里只是缺大脑的就近提示，不新增第二个配置入口（一功能一个家）。
        aria-label={t('generationCommon.parameters.selectTextModel')}
        title={t('generationCommon.parameters.openModelCatalog')}
        onClick={() => window.dispatchEvent(new CustomEvent('nomi-open-model-catalog'))}
      >
        {t('generationCommon.parameters.selectTextModel')}
      </WorkbenchButton>
    )
  }

  return (
    <NomiSelect
      ariaLabel={t('creationAi.assistantMessage.modelAria')}
      title={t('creationAi.assistantMessage.modelHint')}
      size="xs"
      className={className}
      triggerMaxWidth={160}
      value={modelSelect.modelValue}
      options={modelSelect.modelOptions}
      onChange={modelSelect.onModelPick}
      onChipChange={(optionValue, chipValue) => {
        if (optionValue === modelSelect.modelValue) modelSelect.onProviderPick(chipValue)
        else modelSelect.onModelProviderPick(optionValue, chipValue)
      }}
    />
  )
}
