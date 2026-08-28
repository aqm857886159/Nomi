/**
 * ComfyUI 接入卡（无鉴权后端的「启用开关」，用户拍板形状②）。地址可填本机（默认 127.0.0.1:8188）
 * 或云平台 ComfyUI（cnb.cool、cloudstudio.net 等，Issue #43）——同一张卡、同一条「接入地址」，
 * 云端只是把地址改成云平台给的 URL，不另起并行卡（本地/云端走同一无鉴权 transport）。
 *
 * ComfyUI 是无 key 的服务，Nomi 生成门槛本就「authType:'none' + vendor.enabled 即可执行」（不要 key），
 * 故接入 = 把种子 vendor（默认 enabled:false，防污染 99% 不用本地的人）翻成 enabled:true。启用时先探
 * /system_stats 报是否连上（effect-first：当场告诉用户通没通，别等生成才失败）；探测是建议性的，不阻断启用
 * （可先启用、再起 ComfyUI）。地址可改（有人跑在别的端口/主机）。
 *
 * 特殊卡（不走通用自定义供应商卡 CustomVendorManage）：那张卡假设有 key + BaseURL 手填，对无 key 本地后端
 * 是错的隐喻；本地后端要的是「启用/停用 + 健康状态」，同即梦会员卡一样各有专属卡（非并行版）。
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { translateModelDisplayText } from '../../i18n/modelDisplayText'
import { IconServerBolt, IconPlugConnected, IconCircleCheck, IconAlertTriangle, IconPhoto, IconMovie, IconRefresh, IconExternalLink, IconCheck, IconX, IconTrash, IconChevronRight } from '@tabler/icons-react'
import { cn } from '../../utils/cn'
import { getDesktopBridge } from '../../desktop/bridge'
import { toast } from '../toast'
import { alertDialog, confirmDialog } from '../../design'
import { FoldableModelCard } from './FoldableModelCard'
import { ComfyuiWorkflowImportPanel } from './ComfyuiWorkflowImportPanel'
import { ComfyuiPresetSection } from './ComfyuiPresetSection'
import { ComfyuiTemplateLibrary } from './ComfyuiTemplateLibrary'
import { ComfyuiWorkflowSettingsPage } from './workflowPage/ComfyuiWorkflowSettingsPage'
import { normalizeComfyuiAddressInput } from './comfyuiAddress'

/** 与后端 comfyuiLocal.ts 的 vendor key 对齐（稳定契约）。 */
export const COMFYUI_VENDOR_KEY = 'comfyui-local'
const BUILTIN_COMFYUI_TXT2IMG_MODEL_KEY = 'comfyui-txt2img'

type ComfyuiHealth = { ok: true; summary: string; version?: string; protocol?: 'enhanced' | 'compatibility' } | { ok: false; error: string }

type ComfyuiLocalCardProps = {
  /** 多实例：这张卡是哪一台（第一台=comfyui-local，第 2+ 台=comfyui-local-*）。缺省第一台。 */
  vendorKey?: string
  /** 这台的显示名（vendor.name）——卡头显示它，用户靠名字认机器。 */
  instanceName?: string
  /** vendor.enabled（父组件从 listVendors 下传，单一来源）。 */
  enabled: boolean
  /** vendor.baseUrlHint（缺省回落默认端口）。 */
  baseUrl: string
  /** 该 vendor 的模型（内置一个「本地·文生图」）。 */
  models: Array<{ modelKey: string; labelZh: string; kind?: string; enabled: boolean; meta?: unknown }>
  /** ComfyUI workflow mapping；旧导入没有 meta 草稿时，用 mapping 里的模板图回填编辑入口。 */
  mappings?: Array<{ vendorKey?: string; modelKey?: string; create?: unknown }>
  /** 启用/停用/改地址后冒泡，父组件重查 + 重新分桶。 */
  onChanged: () => void
  onOpenDetails?: () => void
  detailMode?: boolean
}

/**
 * 这条工作流能不能进「工作流设置」整页 = 有没有留下可回读的图。
 * 判据与整页数据层 useWorkflowCatalog 的 draftOf 一致（meta 草稿优先，老导入回落 mapping 里的模板图）——
 * 两处都只问「有没有图」，不各自另立一套，否则会出现「卡里可点、进去说没草稿」。
 */
function hasWorkflowGraph(meta: unknown, mappings: ComfyuiLocalCardProps['mappings'], modelKey: string, vendorKeyForMapping: string): boolean {
  const draft = meta && typeof meta === 'object' ? (meta as { comfyWorkflowImport?: unknown }).comfyWorkflowImport : null
  if (draft && typeof draft === 'object' && typeof (draft as { text?: unknown }).text === 'string') return true
  const mapping = mappings?.find((item) => item.vendorKey === vendorKeyForMapping && item.modelKey === modelKey)
  const create = mapping?.create
  const body = create && typeof create === 'object' ? (create as { body?: unknown }).body : null
  const prompt = body && typeof body === 'object' ? (body as { prompt?: unknown }).prompt : null
  return Boolean(prompt && typeof prompt === 'object' && !Array.isArray(prompt))
}

export function ComfyuiLocalCard({ vendorKey, instanceName, enabled, baseUrl, models, mappings, onChanged, onOpenDetails, detailMode = false }: ComfyuiLocalCardProps): JSX.Element | null {
  const { t } = useTranslation()
  // 多实例：所有写操作都打到**这一台**（缺省第一台，存量调用零改动）。
  const key = vendorKey || COMFYUI_VENDOR_KEY
  const isFirstInstance = key === COMFYUI_VENDOR_KEY
  const catalog = getDesktopBridge()?.modelCatalog
  const [health, setHealth] = React.useState<ComfyuiHealth | null>(null)
  const [checking, setChecking] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [editing, setEditing] = React.useState(false)
  // 打开「工作流设置」整页（'' = 只开页不预选某条）。整页是配置动作的唯一入口（2026-08-12 拍板）。
  const [workflowPageKey, setWorkflowPageKey] = React.useState<string | null>(null)
  const [activeWorkflowActionKey, setActiveWorkflowActionKey] = React.useState<string | null>(null)
  const [addrDraft, setAddrDraft] = React.useState(baseUrl || 'http://127.0.0.1:8188')
  const shownAddr = baseUrl || 'http://127.0.0.1:8188'

  const probe = React.useCallback(async (): Promise<ComfyuiHealth> => {
    if (!catalog?.probeComfyui) return { ok: false, error: t('onboardingProviders.comfyLocal.unsupportedProbe') }
    setChecking(true)
    try {
      const r = await catalog.probeComfyui(normalizeComfyuiAddressInput(baseUrl))
      setHealth(r)
      return r
    } catch (e) {
      const r = { ok: false as const, error: e instanceof Error ? e.message : String(e) }
      setHealth(r)
      return r
    } finally {
      setChecking(false)
    }
  }, [catalog, baseUrl, t])

  // 已启用则进卡时探一次，显示当前连接状态。
  React.useEffect(() => {
    if (enabled) void probe()
    else setHealth(null)
  }, [enabled, probe])

  if (!catalog) return null

  const handleEnable = async () => {
    setBusy(true)
    try {
      const r = await probe()
      catalog.upsertVendor({ key, enabled: true, baseUrlHint: normalizeComfyuiAddressInput(baseUrl) })
      onChanged()
      toast(r.ok ? t('onboardingProviders.comfyLocal.enabled') : t('onboardingProviders.comfyLocal.enabledWithoutConnection'), r.ok ? 'success' : 'info')
    } catch (e) {
      toast(e instanceof Error ? e.message : t('onboardingProviders.comfyLocal.enableFailed'), 'error')
    } finally {
      setBusy(false)
    }
  }

  const handleDisable = () => {
    setBusy(true)
    try {
      catalog.upsertVendor({ key, enabled: false })
      setHealth(null)
      onChanged()
      toast(t('onboardingProviders.comfyLocal.disabled'), 'success')
    } catch (e) {
      toast(e instanceof Error ? e.message : t('onboardingProviders.comfyLocal.disableFailed'), 'error')
    } finally {
      setBusy(false)
    }
  }

  const handleSaveAddr = async () => {
    const next = normalizeComfyuiAddressInput(addrDraft)
    if (!next) return
    catalog.upsertVendor({ key, baseUrlHint: next })
    setEditing(false)
    onChanged() // 父组件重查 → baseUrl 变 → useEffect 重探
    toast(t('onboardingProviders.comfyLocal.addressUpdated'), 'success')
  }

  const cancelAddressEditing = (): void => {
    setEditing(false)
    setAddrDraft(shownAddr)
  }

  /** 整台移除（仅自己加的第 2+ 台）：连同它名下的工作流一起删——那些工作流指向的是这台的地址，留着是死的。 */
  const handleRemoveInstance = async () => {
    const ok = await confirmDialog({
      title: t('onboardingProviders.comfyInstance.removeTitle'),
      message: t('onboardingProviders.comfyInstance.removeMessage', { name: instanceName || key, count: models.length }),
      confirmLabel: t('common.delete'),
      danger: true,
    })
    if (!ok) return
    setBusy(true)
    try {
      if (models.length > 0) catalog.deleteModels(models.map((m) => ({ vendorKey: key, modelKey: m.modelKey })))
      catalog.deleteVendor?.(key)
      onChanged()
      toast(t('onboardingProviders.comfyInstance.removed', { name: instanceName || key }), 'success')
    } catch (e) {
      void alertDialog({ title: t('onboardingProviders.drawer.deleteFailed'), message: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy(false)
    }
  }

  const handleDeleteModel = async (model: { modelKey: string; labelZh: string }) => {
    const ok = await confirmDialog({
      title: t('onboardingProviders.comfyLocal.deleteWorkflowTitle'),
      message: t('onboardingProviders.comfyLocal.deleteWorkflowMessage', { name: model.labelZh }),
      confirmLabel: t('common.delete'),
      danger: true,
    })
    if (!ok) return
    try {
      catalog.deleteModels([{ vendorKey: key, modelKey: model.modelKey }])
      onChanged()
      toast(t('onboardingProviders.comfyLocal.workflowDeleted', { name: model.labelZh }), 'success')
    } catch (e) {
      void alertDialog({ title: t('onboardingProviders.drawer.deleteFailed'), message: e instanceof Error ? e.message : String(e) })
    }
  }

  const cardStatus: 'ok' | 'todo' = enabled && health?.ok ? 'ok' : 'todo'
  const statusLabel = !enabled
    ? t('onboardingProviders.comfyLocal.status.notEnabled')
    : checking && !health
      ? t('onboardingProviders.comfyLocal.status.checking')
      : health?.ok
        ? t('onboardingProviders.comfyLocal.status.running')
        : t('onboardingProviders.comfyLocal.status.disconnected')

  const addrRow = (
    <div className="flex items-center gap-2">
      <span className="text-caption text-nomi-ink-60 whitespace-nowrap">{t('onboardingProviders.comfyLocal.addressLabelCloud')}</span>
      {editing ? (
        <div
          data-nomi-escape-owner="true"
          className="flex min-w-0 flex-1 items-center gap-2"
          onKeyDown={(event) => {
            if (event.key !== 'Escape' || event.nativeEvent.isComposing) return
            event.preventDefault()
            event.stopPropagation()
            cancelAddressEditing()
          }}
        >
          <input
            value={addrDraft} onChange={(e) => setAddrDraft(e.target.value)} spellCheck={false}
            aria-label={t('onboardingProviders.comfyLocal.addressLabelCloud')}
            autoFocus
            className="flex-1 h-8 px-2 rounded-nomi-sm border border-nomi-line bg-nomi-paper text-caption font-mono text-nomi-ink focus:border-nomi-accent outline-none"
          />
          <button type="button" onClick={handleSaveAddr} className="h-8 w-8 grid place-items-center rounded-nomi-sm text-workbench-success hover:bg-nomi-ink-05" aria-label={t('onboardingProviders.comfyLocal.saveAddress')}><IconCheck size={15} stroke={1.8} /></button>
          <button type="button" onClick={cancelAddressEditing} className="h-8 w-8 grid place-items-center rounded-nomi-sm text-nomi-ink-40 hover:bg-nomi-ink-05" aria-label={t('common.cancel')}><IconX size={15} stroke={1.8} /></button>
        </div>
      ) : (
        <>
          <code className="flex-1 text-caption font-mono text-nomi-ink bg-nomi-ink-05 rounded-nomi-sm px-2 py-1.5 truncate">{shownAddr}</code>
          <button type="button" onClick={() => { setAddrDraft(shownAddr); setEditing(true) }} className="h-8 px-2 text-caption text-nomi-ink-60 hover:text-nomi-accent">{t('onboardingProviders.comfyLocal.editAddressShort')}</button>
        </>
      )}
    </div>
  )

  // 整页在卡之外单挂（Portal 到 body）：卡收起来它也还开着，且不受卡内布局约束。
  const workflowPage = workflowPageKey !== null ? (
    <ComfyuiWorkflowSettingsPage
      vendorKey={key}
      {...(workflowPageKey ? { initialModelKey: workflowPageKey } : {})}
      onClose={() => setWorkflowPageKey(null)}
      onChanged={onChanged}
    />
  ) : null

  return (
    <>
    {workflowPage}
    <FoldableModelCard
      glyph={<IconServerBolt size={16} stroke={1.6} />}
      glyphTone="ink"
      name={translateModelDisplayText(instanceName || t('onboardingProviders.comfyLocal.cardName'))}
      subtitle={t('onboardingProviders.comfyLocal.cloudSubtitle')}
      status={cardStatus}
      statusLabel={statusLabel}
      defaultExpanded={false}
      onOpenDetails={onOpenDetails}
      detailMode={detailMode}
    >
      {!enabled ? (
        <>
          {addrRow}
          <div className="text-micro text-nomi-ink-30 leading-relaxed">
            {t('onboardingProviders.comfyLocal.defaultLocalPrefix')} <code className="font-mono">127.0.0.1:8188</code>{t('onboardingProviders.comfyLocal.cloudAddressHint')}
          </div>
          <button
            type="button" onClick={handleEnable} disabled={busy || checking}
            className={cn('w-full h-9 rounded-nomi-sm bg-nomi-ink text-nomi-paper text-body-sm font-semibold',
              'inline-flex items-center justify-center gap-1.5 hover:bg-nomi-accent disabled:opacity-50')}
          >
            <IconPlugConnected size={15} stroke={1.8} />{checking ? t('onboardingProviders.comfyLocal.checkingButton') : t('onboardingProviders.comfyLocal.enableButton')}
          </button>
          <button type="button" onClick={() => window.open('https://github.com/comfyanonymous/ComfyUI', '_blank', 'noopener')} className="self-start inline-flex items-center gap-1 text-micro text-nomi-ink-30 hover:text-nomi-accent">
            {t('onboardingProviders.comfyLocal.installHintCloud')}<IconExternalLink size={12} stroke={1.6} />
          </button>
        </>
      ) : (
        <>
          {health?.ok ? (
            <div className="flex items-start gap-2 rounded-nomi-sm bg-nomi-ink-05 px-3 py-2.5">
              <IconCircleCheck size={17} className="shrink-0 mt-0.5 text-workbench-success" />
              <div className="min-w-0">
                <div className="text-body-sm font-semibold text-nomi-ink">{t('onboardingProviders.comfyLocal.connected')}{health.version ? <span className="text-nomi-ink-60 font-normal">{t('onboardingProviders.comfyLocal.version', { version: health.version })}</span> : null}</div>
                <div className="text-caption text-nomi-ink-60 mt-0.5">{translateModelDisplayText(health.summary)}</div>
                {health.protocol ? (
                  <div className="text-micro text-nomi-ink-40 mt-0.5">
                    {health.protocol === 'enhanced'
                      ? t('onboardingProviders.comfyLocal.protocolEnhanced')
                      : t('onboardingProviders.comfyLocal.protocolCompatibility')}
                  </div>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-2 rounded-nomi-sm bg-nomi-ink-05 px-3 py-2.5">
              <IconAlertTriangle size={17} className="shrink-0 mt-0.5 text-nomi-accent" />
              <div className="min-w-0">
                <div className="text-body-sm font-semibold text-nomi-ink">{checking ? t('onboardingProviders.comfyLocal.checkingShort') : t('onboardingProviders.comfyLocal.enabledButDisconnectedShort')}</div>
                <div className="text-caption text-nomi-ink-60 mt-0.5">{t('onboardingProviders.comfyLocal.reconnectBeforeAddress')} <code className="font-mono">{shownAddr}</code>{t('onboardingProviders.comfyLocal.reconnectAfterShort')}</div>
              </div>
            </div>
          )}

          {/* 工作流行 = 进「工作流设置」整页的入口。**整行可点**，不再单挂一个铅笔：
              「配置这条工作流」只有一个家（§1.5.2），点它要配的那个东西本身是最短的路
              （原来铅笔只在 hover 时冒出来，用户得先猜到那儿有东西）。删除仍是 hover 出现的次要动作。 */}
          {models.map((m) => {
            const isVideo = m.kind === 'video'
            const Icon = isVideo ? IconMovie : IconPhoto
            const canDelete = m.modelKey !== BUILTIN_COMFYUI_TXT2IMG_MODEL_KEY
            const canConfigure = canDelete && hasWorkflowGraph(m.meta, mappings, m.modelKey, key)
            const actionsVisible = activeWorkflowActionKey === m.modelKey
            const rowBody = (
              <>
                <Icon size={16} className="text-nomi-ink-60 shrink-0" />
                <div className="flex-1 min-w-0 text-left"><div className="text-body-sm text-nomi-ink truncate">{m.labelZh}</div><div className="text-micro text-nomi-ink-30">{isVideo ? t('onboardingProviders.comfyWorkflow.video') : t('onboardingProviders.comfyWorkflow.image')} {t('onboardingProviders.comfyLocal.workflowKindSuffix')}</div></div>
              </>
            )
            return (
              <div
                key={m.modelKey}
                className="flex items-center gap-2.5 pr-3 bg-nomi-ink-05 rounded-nomi-sm"
                onMouseEnter={() => setActiveWorkflowActionKey(m.modelKey)}
                onMouseLeave={() => setActiveWorkflowActionKey((current) => current === m.modelKey ? null : current)}
                onFocus={() => setActiveWorkflowActionKey(m.modelKey)}
                onBlur={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget)) {
                    setActiveWorkflowActionKey((current) => current === m.modelKey ? null : current)
                  }
                }}
              >
                {canConfigure ? (
                  <button
                    type="button"
                    onClick={() => setWorkflowPageKey(m.modelKey)}
                    aria-label={t('comfyuiWorkflowPage.openAria', { name: m.labelZh })}
                    className="flex flex-1 min-w-0 items-center gap-2.5 px-3 py-2 rounded-nomi-sm hover:text-nomi-accent"
                  >
                    {rowBody}
                    <IconChevronRight size={14} stroke={1.8} className="shrink-0 text-nomi-ink-30" />
                  </button>
                ) : (
                  <div className="flex flex-1 min-w-0 items-center gap-2.5 px-3 py-2">{rowBody}</div>
                )}
                {canDelete && actionsVisible ? (
                  <button
                    type="button"
                    aria-label={t('onboardingProviders.comfyLocal.deleteWorkflowAria', { name: m.labelZh })}
                    title={t('onboardingProviders.comfyLocal.deleteWorkflowActionTitle')}
                    onClick={() => void handleDeleteModel(m)}
                    className="grid size-7 shrink-0 place-items-center rounded-nomi-sm text-nomi-ink-30 hover:bg-nomi-ink-10 hover:text-workbench-danger"
                  >
                    <IconTrash size={14} stroke={1.7} />
                  </button>
                ) : (
                  <span className="text-micro text-nomi-accent bg-nomi-accent-soft px-2 py-0.5 rounded-full shrink-0">{t('onboardingProviders.comfyLocal.modelEnabled')}</span>
                )}
              </div>
            )
          })}

          {/* 模板库（T2）：读用户自己 ComfyUI 里的几百个官方模板——「我这台能用什么」的主入口 */}
          <ComfyuiTemplateLibrary vendorKey={key} modelLabels={models.map((m) => m.labelZh)} onImported={onChanged} />

          {/* 预置模板（S5）：内置 WAN2.2，离线也有一条能用的路（ComfyUI 没模板包时的兜底） */}
          <ComfyuiPresetSection modelLabels={models.map((m) => m.labelZh)} onImported={onChanged} />

          {/* 自定义工作流导入（S4）：贴普通或 API workflow JSON，属**接入**动作，留在卡里。
              导入之后的一切配置（改绑定/改字段/改名/删）都在「工作流设置」整页，不留第二套（P1）。 */}
          <ComfyuiWorkflowImportPanel vendorKey={key} onImported={onChanged} />

          {/* 整页的常规入口：没有工作流可点的那一行时（比如只剩内置文生图），这里也进得去改地址/加机器。 */}
          <button
            type="button"
            onClick={() => setWorkflowPageKey('')}
            className={cn('self-start inline-flex items-center gap-1.5 h-8 px-3 rounded-nomi-sm border border-nomi-line',
              'text-caption text-nomi-ink-60 hover:text-nomi-accent hover:border-nomi-accent')}
          >
            {t('comfyuiWorkflowPage.open')}<IconChevronRight size={13} stroke={1.8} />
          </button>

          {addrRow}

          <div className="flex items-center gap-2">
            <button type="button" onClick={() => void probe()} disabled={checking} className="inline-flex items-center gap-1 h-8 px-2.5 text-caption text-nomi-ink-60 rounded-nomi-sm border border-nomi-line hover:border-nomi-accent hover:text-nomi-accent disabled:opacity-50">
              <IconRefresh size={13} stroke={1.7} className={checking ? 'animate-spin' : undefined} />{checking ? t('onboardingProviders.comfyLocal.checkingInline') : t('onboardingProviders.comfyLocal.recheck')}
            </button>
            <span className="flex-1" />
            <button type="button" onClick={handleDisable} disabled={busy} className="text-caption text-nomi-ink-40 hover:text-workbench-danger disabled:opacity-50">{t('onboardingProviders.comfyLocal.disable')}</button>
            {/* 多实例：自己加的那几台可以整台移除；第一台是种子（只能停用，不给删——删了种子会被重种回来） */}
            {!isFirstInstance ? (
              <button type="button" onClick={handleRemoveInstance} disabled={busy} className="text-caption text-nomi-ink-40 hover:text-workbench-danger disabled:opacity-50">
                {t('onboardingProviders.comfyInstance.remove')}
              </button>
            ) : null}
          </div>
        </>
      )}
    </FoldableModelCard>
    </>
  )
}
