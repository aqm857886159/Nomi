/**
 * 本地 ComfyUI 接入卡（无鉴权本地后端的「启用开关」，用户拍板形状②）。
 *
 * ComfyUI 是无 key 的本地服务，Nomi 生成门槛本就「authType:'none' + vendor.enabled 即可执行」（不要 key），
 * 故接入 = 把种子 vendor（默认 enabled:false，防污染 99% 不用本地的人）翻成 enabled:true。启用时先探
 * /system_stats 报是否连上（effect-first：当场告诉用户通没通，别等生成才失败）；探测是建议性的，不阻断启用
 * （可先启用、再起 ComfyUI）。地址可改（有人跑在别的端口/主机）。
 *
 * 特殊卡（不走通用自定义供应商卡 CustomVendorManage）：那张卡假设有 key + BaseURL 手填，对无 key 本地后端
 * 是错的隐喻；本地后端要的是「启用/停用 + 健康状态」，同即梦会员卡一样各有专属卡（非并行版）。
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import {
  IconServerBolt,
  IconPlugConnected,
  IconCircleCheck,
  IconAlertTriangle,
  IconPhoto,
  IconRefresh,
  IconExternalLink,
  IconCheck,
  IconX,
} from '@tabler/icons-react'
import { cn } from '../../utils/cn'
import { getDesktopBridge } from '../../desktop/bridge'
import { toast } from '../toast'
import { FoldableModelCard } from './FoldableModelCard'
import { ComfyuiWorkflowImportPanel } from './ComfyuiWorkflowImportPanel'

/** 与后端 comfyuiLocal.ts 的 vendor key 对齐（稳定契约）。 */
export const COMFYUI_VENDOR_KEY = 'comfyui-local'

type ComfyuiHealth = { ok: true; summary: string; version?: string } | { ok: false; error: string }

type ComfyuiLocalCardProps = {
  /** vendor.enabled（父组件从 listVendors 下传，单一来源）。 */
  enabled: boolean
  /** vendor.baseUrlHint（缺省回落默认端口）。 */
  baseUrl: string
  /** 该 vendor 的模型（内置一个「本地·文生图」）。 */
  models: Array<{ modelKey: string; labelZh: string; enabled: boolean }>
  /** 启用/停用/改地址后冒泡，父组件重查 + 重新分桶。 */
  onChanged: () => void
}

export function ComfyuiLocalCard({ enabled, baseUrl, models, onChanged }: ComfyuiLocalCardProps): JSX.Element | null {
  const { t } = useTranslation()
  const catalog = getDesktopBridge()?.modelCatalog
  const [health, setHealth] = React.useState<ComfyuiHealth | null>(null)
  const [checking, setChecking] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [editing, setEditing] = React.useState(false)
  const [addrDraft, setAddrDraft] = React.useState(baseUrl || 'http://127.0.0.1:8188')
  const shownAddr = baseUrl || 'http://127.0.0.1:8188'

  const probe = React.useCallback(async (): Promise<ComfyuiHealth> => {
    if (!catalog?.probeComfyui) return { ok: false, error: t('onboardingProviders.comfyLocal.unsupportedProbe') }
    setChecking(true)
    try {
      const r = await catalog.probeComfyui(baseUrl || undefined)
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
      catalog.upsertVendor({ key: COMFYUI_VENDOR_KEY, enabled: true }) // 只翻 enabled，applyVendorUpsert 保留 authType/baseUrl
      onChanged()
      toast(
        r.ok
          ? t('onboardingProviders.comfyLocal.enabled')
          : t('onboardingProviders.comfyLocal.enabledWithoutConnection'),
        r.ok ? 'success' : 'info',
      )
    } catch (e) {
      toast(e instanceof Error ? e.message : t('onboardingProviders.comfyLocal.enableFailed'), 'error')
    } finally {
      setBusy(false)
    }
  }

  const handleDisable = () => {
    setBusy(true)
    try {
      catalog.upsertVendor({ key: COMFYUI_VENDOR_KEY, enabled: false })
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
    const next = addrDraft.trim()
    if (!next) return
    catalog.upsertVendor({ key: COMFYUI_VENDOR_KEY, baseUrlHint: next })
    setEditing(false)
    onChanged() // 父组件重查 → baseUrl 变 → useEffect 重探
    toast(t('onboardingProviders.comfyLocal.addressUpdated'), 'success')
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
      <span className="text-caption text-nomi-ink-60 whitespace-nowrap">
        {t('onboardingProviders.comfyLocal.address')}
      </span>
      {editing ? (
        <>
          <input
            value={addrDraft}
            onChange={(e) => setAddrDraft(e.target.value)}
            spellCheck={false}
            className="flex-1 h-8 px-2 rounded-nomi-sm border border-nomi-line bg-nomi-paper text-caption font-mono text-nomi-ink focus:border-nomi-accent outline-none"
          />
          <button
            type="button"
            onClick={handleSaveAddr}
            className="h-8 w-8 grid place-items-center rounded-nomi-sm text-workbench-success hover:bg-nomi-ink-05"
            aria-label={t('onboardingProviders.comfyLocal.saveAddress')}
          >
            <IconCheck size={15} stroke={1.8} />
          </button>
          <button
            type="button"
            onClick={() => {
              setEditing(false)
              setAddrDraft(shownAddr)
            }}
            className="h-8 w-8 grid place-items-center rounded-nomi-sm text-nomi-ink-40 hover:bg-nomi-ink-05"
            aria-label={t('common.cancel')}
          >
            <IconX size={15} stroke={1.8} />
          </button>
        </>
      ) : (
        <>
          <code className="flex-1 text-caption font-mono text-nomi-ink bg-nomi-ink-05 rounded-nomi-sm px-2 py-1.5 truncate">
            {shownAddr}
          </code>
          <button
            type="button"
            onClick={() => {
              setAddrDraft(shownAddr)
              setEditing(true)
            }}
            className="h-8 px-2 text-caption text-nomi-ink-60 hover:text-nomi-accent"
          >
            {t('onboardingProviders.comfyLocal.editAddress')}
          </button>
        </>
      )}
    </div>
  )

  return (
    <FoldableModelCard
      glyph={<IconServerBolt size={16} stroke={1.6} />}
      glyphTone="ink"
      name={t('onboardingProviders.comfyLocal.name')}
      subtitle={t('onboardingProviders.comfyLocal.subtitle')}
      status={cardStatus}
      statusLabel={statusLabel}
      defaultExpanded={false}
    >
      {!enabled ? (
        <>
          <div className="text-caption text-nomi-ink-60 leading-relaxed">
            {t('onboardingProviders.comfyLocal.setupBeforeAddress')}{' '}
            <code className="font-mono text-nomi-ink">127.0.0.1:8188</code>
            {t('onboardingProviders.comfyLocal.setupAfterAddress')}
          </div>
          {addrRow}
          <button
            type="button"
            onClick={handleEnable}
            disabled={busy || checking}
            className={cn(
              'w-full h-9 rounded-nomi-sm bg-nomi-ink text-nomi-paper text-body-sm font-semibold',
              'inline-flex items-center justify-center gap-1.5 hover:bg-nomi-accent disabled:opacity-50',
            )}
          >
            <IconPlugConnected size={15} stroke={1.8} />
            {checking ? t('onboardingProviders.comfyLocal.checkingLocal') : t('onboardingProviders.comfyLocal.enable')}
          </button>
          <button
            type="button"
            onClick={() => window.open('https://github.com/comfyanonymous/ComfyUI', '_blank', 'noopener')}
            className="self-start inline-flex items-center gap-1 text-micro text-nomi-ink-30 hover:text-nomi-accent"
          >
            {t('onboardingProviders.comfyLocal.installOnGithub')}
            <IconExternalLink size={12} stroke={1.6} />
          </button>
        </>
      ) : (
        <>
          {health?.ok ? (
            <div className="flex items-start gap-2 rounded-nomi-sm bg-[var(--workbench-success-soft)] px-3 py-2.5">
              <IconCircleCheck size={17} className="shrink-0 mt-0.5 text-workbench-success" />
              <div className="min-w-0">
                <div className="text-body-sm font-semibold text-nomi-ink">
                  {t('onboardingProviders.comfyLocal.connected')}
                  {health.version ? (
                    <span className="text-nomi-ink-60 font-normal">
                      {t('onboardingProviders.comfyLocal.version', { version: health.version })}
                    </span>
                  ) : null}
                </div>
                <div className="text-caption text-nomi-ink-60 mt-0.5">{health.summary}</div>
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-2 rounded-nomi-sm bg-nomi-ink-05 px-3 py-2.5">
              <IconAlertTriangle size={17} className="shrink-0 mt-0.5 text-nomi-accent" />
              <div className="min-w-0">
                <div className="text-body-sm font-semibold text-nomi-ink">
                  {checking
                    ? t('onboardingProviders.comfyLocal.checkingShort')
                    : t('onboardingProviders.comfyLocal.enabledButDisconnected')}
                </div>
                <div className="text-caption text-nomi-ink-60 mt-0.5">
                  {t('onboardingProviders.comfyLocal.reconnectBeforeAddress')}{' '}
                  <code className="font-mono">{shownAddr}</code>
                  {t('onboardingProviders.comfyLocal.reconnectAfterAddress')}
                </div>
              </div>
            </div>
          )}

          {models.map((m) => (
            <div key={m.modelKey} className="flex items-center gap-2.5 px-3 py-2 bg-nomi-ink-05 rounded-nomi-sm">
              <IconPhoto size={16} className="text-nomi-ink-60" />
              <div className="flex-1 min-w-0">
                <div className="text-body-sm text-nomi-ink truncate">{m.labelZh}</div>
                <div className="text-micro text-nomi-ink-30">{t('onboardingProviders.comfyLocal.workflowKind')}</div>
              </div>
              <span className="text-micro text-workbench-success bg-[var(--workbench-success-soft)] px-2 py-0.5 rounded-full">
                {t('onboardingProviders.comfyLocal.modelEnabled')}
              </span>
            </div>
          ))}

          {/* 自定义工作流导入（S4）：内置文生图之外，用户可导入自己的 WAN 文生/图生视频等工作流 */}
          <ComfyuiWorkflowImportPanel onImported={onChanged} />

          {addrRow}

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void probe()}
              disabled={checking}
              className="inline-flex items-center gap-1 h-8 px-2.5 text-caption text-nomi-ink-60 rounded-nomi-sm border border-nomi-line hover:border-nomi-accent hover:text-nomi-accent disabled:opacity-50"
            >
              <IconRefresh size={13} stroke={1.7} className={checking ? 'animate-spin' : undefined} />
              {checking
                ? t('onboardingProviders.comfyLocal.checkingShort')
                : t('onboardingProviders.comfyLocal.recheck')}
            </button>
            <span className="flex-1" />
            <button
              type="button"
              onClick={handleDisable}
              disabled={busy}
              className="text-caption text-nomi-ink-40 hover:text-workbench-danger disabled:opacity-50"
            >
              {t('onboardingProviders.comfyLocal.disable')}
            </button>
          </div>
        </>
      )}
    </FoldableModelCard>
  )
}
