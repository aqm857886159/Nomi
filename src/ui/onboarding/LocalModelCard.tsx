/**
 * 「本地模型」接入卡（无鉴权本地文本端点的「发现 + 一键连」，仿 ComfyuiLocalCard / CodexLocalImageCard）。
 *
 * 解决的真实摩擦（可发现性缺口，非能力缺口）：buildAiSdkModel 早就能连任意 OpenAI-兼容端点（含免鉴权，
 * authType:'none'），但普通用户根本不知道「自定义供应商」能填 http://localhost:11434/v1。这张卡把已有原语
 * 接到用户摸得着的地方——自动探常见端口（Ollama 11434 / LM Studio 1234 / LocalAI 8080），一键连、拉模型列表、
 * 建档，并**诚实**告诉用户每个模型带不带得动 Agent（能力预检）。
 *
 * 零供应商专有代码（P4 通用第一）：三家都是 OpenAI-兼容，走同一条通用路径。只做**文本**——本地图像/视频
 * 已归 ComfyUI（不开并行版 P1）。没开本地服务时卡片安静不打扰。
 *
 * 建档路径复用现有自定义供应商/OpenAI-兼容那条：把种子 vendor（local-text）的 baseUrlHint 指向探到的端口 +
 * authType:'none' + 翻 enabled，再 upsertModel 一个 kind:'text' 的模型。运行时按 vendor.baseUrlHint /
 * providerKind / authType 直连 chat（见 electron/ai/vendorModelConnection.ts），不新造管线。
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import {
  IconServerBolt, IconPlugConnected, IconCircleCheck, IconAlertTriangle, IconRefresh,
  IconExternalLink, IconRobot, IconMessage, IconHelp, IconCheck,
} from '@tabler/icons-react'
import { cn } from '../../utils/cn'
import { getDesktopBridge } from '../../desktop/bridge'
import { toast } from '../toast'
import { alertDialog } from '../../design'
import { FoldableModelCard } from './FoldableModelCard'
import { translateModelDisplayText } from '../../i18n/modelDisplayText'

/** 稳定契约：与后端 electron/localRuntime/localTextVendorSeed.ts 的 vendor key 对齐。 */
export const LOCAL_TEXT_VENDOR_KEY = 'local-text'

type EndpointHit = { id: 'ollama' | 'lmstudio' | 'localai'; label: string; baseUrl: string; models: string[] }
type CapabilityVerdict = 'agent' | 'chat-only' | 'unknown'

/**
 * 三家运行时的展示名 + 官网（「去装它」链接）。与后端候选表同源，UI 侧用于安装引导。
 * label 是产品品牌名（不翻译），放数据里而非 JSX 字面量——品牌名不进 i18n，也别硬编码在 JSX 表达式。
 */
const RUNTIME_META: Record<EndpointHit['id'], { label: string; homepage: string }> = {
  ollama: { label: 'Ollama', homepage: 'https://ollama.com/download' },
  lmstudio: { label: 'LM Studio', homepage: 'https://lmstudio.ai' },
  localai: { label: 'LocalAI', homepage: 'https://localai.io' },
}
const RUNTIME_ORDER: ReadonlyArray<EndpointHit['id']> = ['ollama', 'lmstudio', 'localai']

type LocalModelCardProps = {
  /** vendor.enabled（父组件从 listVendors 下传，单一来源）。 */
  enabled: boolean
  /** 该 vendor 名下已建档的模型（连上后每个模型一行，带能力徽标）。 */
  models: Array<{ modelKey: string; labelZh: string; enabled: boolean; capability?: CapabilityVerdict }>
  /** 连接/断开/建档后冒泡，父组件重查 + 重新分桶。 */
  onChanged: () => void
  onOpenDetails?: () => void
  detailMode?: boolean
}

export function LocalModelCard({ enabled, models, onChanged, onOpenDetails, detailMode = false }: LocalModelCardProps): JSX.Element | null {
  const { t } = useTranslation()
  const catalog = getDesktopBridge()?.modelCatalog
  const [hits, setHits] = React.useState<EndpointHit[] | null>(null)
  const [probing, setProbing] = React.useState(false)
  const [busyModel, setBusyModel] = React.useState<string | null>(null)
  // 能力预检结果按 modelKey 记（探针跑完存这里，卡里显示「支持 Agent / 仅对话」）。
  const [verdicts, setVerdicts] = React.useState<Record<string, CapabilityVerdict>>({})

  const probe = React.useCallback(async () => {
    if (!catalog?.probeLocalTextEndpoints) return
    setProbing(true)
    try {
      const r = await catalog.probeLocalTextEndpoints()
      setHits(r.hits)
    } catch {
      setHits([])
    } finally {
      setProbing(false)
    }
  }, [catalog])

  // 进卡即探一次（没开本地服务 → hits 为空 → 安静提示，不报错）。
  React.useEffect(() => { void probe() }, [probe])

  if (!catalog?.upsertVendor) return null

  /** 对某个探到的模型跑能力预检，回填 verdicts。 */
  const runCapabilityCheck = async (endpointBaseUrl: string, modelId: string): Promise<CapabilityVerdict> => {
    const probeCap = catalog.probeLocalTextCapability
    if (!probeCap) return 'unknown'
    try {
      const r = await probeCap({ baseUrl: endpointBaseUrl, modelId })
      setVerdicts((current) => ({ ...current, [modelId]: r.verdict }))
      return r.verdict
    } catch {
      setVerdicts((current) => ({ ...current, [modelId]: 'unknown' }))
      return 'unknown'
    }
  }

  /** 一键连某个探到的模型：把 vendor 指向这台端口 + authType none + enable，再建档该模型，并跑能力预检。 */
  const handleConnect = async (hit: EndpointHit, modelId: string) => {
    setBusyModel(modelId)
    try {
      // ① vendor 指向探到的端口（authType none = 本地无鉴权，运行时不发空 Authorization 头）。
      catalog.upsertVendor({ key: LOCAL_TEXT_VENDOR_KEY, enabled: true, baseUrlHint: hit.baseUrl, authType: 'none', providerKind: 'openai-compatible' })
      // ② 建档该模型（kind text；无 mapping → 运行时走 buildLanguageModelForVendor 直连 chat）。
      catalog.upsertModel({ vendorKey: LOCAL_TEXT_VENDOR_KEY, modelKey: modelId, labelZh: modelId, kind: 'text', enabled: true })
      onChanged()
      // ③ 能力预检（诚实交付）：当场探这个模型带不带得动工具调用。
      const verdict = await runCapabilityCheck(hit.baseUrl, modelId)
      toast(
        verdict === 'agent'
          ? t('onboardingProviders.localModel.connectedAgent', { model: modelId })
          : verdict === 'chat-only'
            ? t('onboardingProviders.localModel.connectedChatOnly', { model: modelId })
            : t('onboardingProviders.localModel.connectedUnknown', { model: modelId }),
        verdict === 'chat-only' ? 'info' : 'success',
      )
    } catch (e) {
      void alertDialog({ title: t('onboardingProviders.localModel.connectFailed'), message: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusyModel(null)
    }
  }

  /** 断开某个已建档模型（删模型；名下无模型时整卡回到未连态由父组件分桶决定）。 */
  const handleDisconnect = (modelKey: string) => {
    setBusyModel(modelKey)
    try {
      catalog.deleteModels([{ vendorKey: LOCAL_TEXT_VENDOR_KEY, modelKey }])
      // 名下已无模型 → 停用 vendor（回到「可接入」桶）。
      if (models.length <= 1) catalog.upsertVendor({ key: LOCAL_TEXT_VENDOR_KEY, enabled: false })
      onChanged()
      toast(t('onboardingProviders.localModel.disconnected', { model: modelKey }), 'success')
    } catch (e) {
      void alertDialog({ title: t('onboardingProviders.localModel.disconnectFailed'), message: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusyModel(null)
    }
  }

  const connectedModelKeys = new Set(models.map((m) => m.modelKey))
  // 状态字面量不本地声明 union（避免与 FoldableModelCard.status 重复登记）：inferred 'ok'|'todo' 即可，
  // 直接传入共享卡片（它的 status 是 'ok'|'todo'|'error' 的超集）。见 vocabularies-baseline.json 的收敛说明。
  const cardStatus = enabled && models.length > 0 ? 'ok' : 'todo'
  const statusLabel = enabled && models.length > 0
    ? t('onboardingProviders.localModel.status.connected', { count: models.length })
    : probing
      ? t('onboardingProviders.localModel.status.detecting')
      : hits && hits.length > 0
        ? t('onboardingProviders.localModel.status.detected')
        : t('onboardingProviders.localModel.status.notDetected')

  const capabilityBadge = (verdict?: CapabilityVerdict): JSX.Element => {
    if (verdict === 'agent') {
      return (
        <span className="inline-flex items-center gap-1 text-micro text-workbench-success bg-nomi-accent-soft px-2 py-0.5 rounded-full shrink-0">
          <IconRobot size={11} stroke={1.8} />{t('onboardingProviders.localModel.capability.agent')}
        </span>
      )
    }
    if (verdict === 'chat-only') {
      return (
        <span className="inline-flex items-center gap-1 text-micro text-nomi-ink-60 bg-nomi-ink-05 px-2 py-0.5 rounded-full shrink-0">
          <IconMessage size={11} stroke={1.8} />{t('onboardingProviders.localModel.capability.chatOnly')}
        </span>
      )
    }
    return (
      <span className="inline-flex items-center gap-1 text-micro text-nomi-ink-40 bg-nomi-ink-05 px-2 py-0.5 rounded-full shrink-0">
        <IconHelp size={11} stroke={1.8} />{t('onboardingProviders.localModel.capability.unknown')}
      </span>
    )
  }

  const installHints = (
    <div className="flex flex-col gap-1">
      {RUNTIME_ORDER.map((id) => (
        <button
          key={id}
          type="button"
          onClick={() => window.open(RUNTIME_META[id].homepage, '_blank', 'noopener')}
          className="self-start inline-flex items-center gap-1 text-micro text-nomi-ink-30 hover:text-nomi-accent"
        >
          {RUNTIME_META[id].label}
          <IconExternalLink size={11} stroke={1.6} />
        </button>
      ))}
    </div>
  )

  return (
    <FoldableModelCard
      glyph={<IconServerBolt size={16} stroke={1.6} />}
      glyphTone="ink"
      name={t('onboardingProviders.localModel.cardName')}
      subtitle={t('onboardingProviders.localModel.subtitle')}
      status={cardStatus}
      statusLabel={statusLabel}
      defaultExpanded={false}
      onOpenDetails={onOpenDetails}
      detailMode={detailMode}
    >
      {/* 已建档模型（连上后每行带能力徽标 + 断开）。 */}
      {models.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          {models.map((m) => (
            <div key={m.modelKey} className="flex items-center gap-2.5 px-3 py-2 bg-nomi-ink-05 rounded-nomi-sm">
              <IconCircleCheck size={16} className="shrink-0 text-workbench-success" />
              <div className="flex-1 min-w-0">
                <div className="text-body-sm text-nomi-ink truncate font-mono">{translateModelDisplayText(m.labelZh)}</div>
              </div>
              {capabilityBadge(verdicts[m.modelKey] ?? m.capability)}
              <button
                type="button"
                onClick={() => handleDisconnect(m.modelKey)}
                disabled={busyModel === m.modelKey}
                className="text-micro text-nomi-ink-40 hover:text-workbench-danger disabled:opacity-50 shrink-0"
              >
                {t('onboardingProviders.localModel.disconnect')}
              </button>
            </div>
          ))}
        </div>
      ) : null}

      {/* 探到的运行时 + 可连的模型（尚未建档的那些）。 */}
      {hits && hits.length > 0 ? (
        <div className="flex flex-col gap-2.5">
          {hits.map((hit) => {
            const connectable = hit.models.filter((modelId) => !connectedModelKeys.has(modelId))
            return (
              <div key={hit.id} className="flex flex-col gap-1.5 rounded-nomi-sm border border-nomi-line px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <IconCircleCheck size={15} className="shrink-0 text-workbench-success" />
                  <span className="text-body-sm font-semibold text-nomi-ink">{hit.label}</span>
                  <code className="text-micro font-mono text-nomi-ink-40">{hit.baseUrl}</code>
                </div>
                {connectable.length > 0 ? (
                  connectable.map((modelId) => (
                    <div key={modelId} className="flex items-center gap-2 pl-6">
                      <span className="flex-1 min-w-0 text-caption font-mono text-nomi-ink-60 truncate">{modelId}</span>
                      <button
                        type="button"
                        onClick={() => handleConnect(hit, modelId)}
                        disabled={busyModel === modelId}
                        className={cn('inline-flex items-center gap-1 h-7 px-2.5 rounded-nomi-sm text-micro font-semibold shrink-0',
                          'bg-nomi-ink text-nomi-paper hover:bg-nomi-accent disabled:opacity-50')}
                      >
                        {busyModel === modelId
                          ? <IconRefresh size={12} stroke={1.8} className="animate-spin" />
                          : <IconPlugConnected size={12} stroke={1.8} />}
                        {t('onboardingProviders.localModel.connect')}
                      </button>
                    </div>
                  ))
                ) : (
                  <div className="pl-6 text-micro text-nomi-ink-30 inline-flex items-center gap-1">
                    <IconCheck size={12} stroke={1.8} className="text-workbench-success" />
                    {hit.models.length > 0
                      ? t('onboardingProviders.localModel.allConnected')
                      : t('onboardingProviders.localModel.noModelsLoaded')}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      ) : models.length === 0 ? (
        // 没探到任何本地服务：安静提示 + 安装引导（不报错——本地服务本就常没开）。
        <div className="flex items-start gap-2 rounded-nomi-sm bg-nomi-ink-05 px-3 py-2.5">
          <IconAlertTriangle size={17} className="shrink-0 mt-0.5 text-nomi-ink-40" />
          <div className="min-w-0">
            <div className="text-body-sm font-semibold text-nomi-ink">
              {probing ? t('onboardingProviders.localModel.detecting') : t('onboardingProviders.localModel.notDetectedTitle')}
            </div>
            <div className="text-caption text-nomi-ink-60 mt-0.5">{t('onboardingProviders.localModel.notDetectedBody')}</div>
          </div>
        </div>
      ) : null}

      {/* 重新检测 + 安装引导。 */}
      <div className="flex items-start justify-between gap-2">
        <button
          type="button"
          onClick={() => void probe()}
          disabled={probing}
          className="inline-flex items-center gap-1 h-8 px-2.5 text-caption text-nomi-ink-60 rounded-nomi-sm border border-nomi-line hover:border-nomi-accent hover:text-nomi-accent disabled:opacity-50"
        >
          <IconRefresh size={13} stroke={1.7} className={probing ? 'animate-spin' : undefined} />
          {probing ? t('onboardingProviders.localModel.detectingInline') : t('onboardingProviders.localModel.redetect')}
        </button>
        {installHints}
      </div>
    </FoldableModelCard>
  )
}
