/**
 * ComfyUI 预置模板区（S5 · 2026-08-01 拍板「做，带缺件闸」，样张已过）。
 * 形状：模板行（名字 + 就绪/缺件 chip）→ 展开逐文件清单（状态 ✓/缺 · 目录 · 复制名 · 官方下载链）→
 * 「一键启用」+「重新检测」。
 *
 * 2026-08-11 改口径（用户原话「comfyui 文件是否缺失不做强制检测」）：缺件**不再是死门**。
 * 原来 disabled={!ready} 把人拦在外面，可 /object_info 只知道「本机此刻装了什么」——用户可能
 * 正边下模型边配、模型在别的路径、或干脆想先把模板加到画布上回头再补。检测继续跑、缺什么照说，
 * 但按钮走 resolvePrecheckGateAction 的 arm→confirm 二次确认（与 manual 接入同一份门槛逻辑，P1）。
 * 检测复用 Tier-1 的 reconcileComfyWorkflow（/object_info 对账）；提交统一进入
 * integration session handoff，不直接启用 Catalog。
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconMovie, IconCheck, IconX, IconCopy, IconExternalLink, IconRefresh, IconAlertTriangle } from '@tabler/icons-react'
import { cn } from '../../utils/cn'
import { getDesktopBridge } from '../../desktop/bridge'
import { toast } from '../toast'
import { resolvePrecheckGateAction } from './precheckGate'
import { translateModelDisplayText } from '../../i18n/modelDisplayText'

type Preset = {
  key: string; labelZh: string; descZh: string; workflowText: string; binding: unknown
  models: Array<{ file: string; dir: string; url: string }>
}
type Reconcile = {
  serverReachable: boolean
  unknownNodeTypes: string[]
  missingEnumValues: Array<{ value: string }>
}

type ComfyuiPresetSectionProps = {
  vendorKey: string
  /** 已有模型标签集合（判「已启用」防重复导入）。 */
  modelLabels: string[]
  onImported: () => void
  onVerificationRequested?: () => void
}

export function ComfyuiPresetSection({ vendorKey, modelLabels, onImported, onVerificationRequested }: ComfyuiPresetSectionProps): JSX.Element | null {
  const { t } = useTranslation()
  const catalog = getDesktopBridge()?.modelCatalog
  const presets = React.useMemo<Preset[]>(() => {
    try { return (catalog?.listComfyuiPresets?.() as Preset[]) ?? [] } catch { return [] }
  }, [catalog])
  const [openKey, setOpenKey] = React.useState<string | null>(null)
  const [reconcileByKey, setReconcileByKey] = React.useState<Record<string, Reconcile | 'checking' | null>>({})
  const [busy, setBusy] = React.useState(false)
  /** 哪个模板已进入「仍要启用」的二次确认态（同时最多一个）。 */
  const [armedKey, setArmedKey] = React.useState<string | null>(null)

  const check = React.useCallback((preset: Preset) => {
    const call = catalog?.reconcileComfyWorkflow
    if (!call) return
    // 重新检测 = 重新给判断依据，之前那次「仍要启用」的确认作废（否则装完模型再点会直接冲过去）。
    setArmedKey((k) => (k === preset.key ? null : k))
    setReconcileByKey((m) => ({ ...m, [preset.key]: 'checking' }))
    void call(preset.workflowText)
      .then((r) => setReconcileByKey((m) => ({ ...m, [preset.key]: r && r.ok ? (r as Reconcile) : null })))
      .catch(() => setReconcileByKey((m) => ({ ...m, [preset.key]: null })))
  }, [catalog])

  if (!catalog || presets.length === 0) return null

  const enable = async (preset: Preset) => {
    const prepare = getDesktopBridge()?.onboarding?.integrationSessionPrepareComfy
    if (!prepare) return
    setBusy(true)
    try {
      await prepare({ vendorKey, name: preset.labelZh, workflow: preset.workflowText, binding: preset.binding })
      toast(t('onboardingProviders.comfyWorkflow.awaitingVerification', { name: preset.labelZh }), 'info')
      onImported()
      onVerificationRequested?.()
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), 'error')
    } finally { setBusy(false) }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="text-micro text-nomi-ink-30">{t('onboardingProviders.comfyPreset.sectionTitle')}</div>
      {presets.map((preset) => {
        const alreadyEnabled = modelLabels.includes(preset.labelZh)
        const open = openKey === preset.key
        const rec = reconcileByKey[preset.key]
        const checking = rec === 'checking'
        const result = rec && rec !== 'checking' ? rec : null
        const missing = new Set((result?.missingEnumValues ?? []).map((m) => m.value))
        const missingCount = preset.models.filter((m) => missing.has(m.file)).length
        const ready = Boolean(result && result.serverReachable && result.unknownNodeTypes.length === 0 && missingCount === 0)
        // 非阻断门槛：真正 disabled 的只有「忙」和「已启用」——缺件/未连接一律走二次确认。
        const gate = resolvePrecheckGateAction({
          actionable: !busy && !alreadyEnabled,
          precheckPassed: ready,
          forceArmed: armedKey === preset.key,
        })
        const offline = Boolean(result && !result.serverReachable)
        // 风险话术按**成因**给（D6：让用户看懂「会发生什么」，不是一句笼统的「可能失败」）。
        // 没检测过就点的，也当未知风险说——未跑 ≠ 没风险，但一样不拦。
        const riskNote = offline || !result
          ? t('onboardingProviders.comfyPreset.riskOffline')
          : t('onboardingProviders.comfyPreset.riskMissing', { count: missingCount + result.unknownNodeTypes.length })
        return (
          <div key={preset.key} className="rounded-nomi-sm border border-nomi-line bg-nomi-paper">
            <button
              type="button"
              onClick={() => {
                const next = open ? null : preset.key
                setOpenKey(next)
                if (next && !reconcileByKey[preset.key]) check(preset)
              }}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-left"
              aria-expanded={open}
            >
              <IconMovie size={16} className="text-nomi-ink-60 shrink-0" />
              <span className="flex-1 min-w-0">
                <span className="block text-body-sm text-nomi-ink truncate">{translateModelDisplayText(preset.labelZh)}</span>
                <span className="block text-micro text-nomi-ink-30 truncate">{translateModelDisplayText(preset.descZh)}</span>
              </span>
              {alreadyEnabled ? (
                <span className="text-micro text-nomi-accent bg-nomi-accent-soft px-2 py-0.5 rounded-full shrink-0">{t('onboardingProviders.comfyPreset.chipEnabled')}</span>
              ) : result ? (
                ready ? (
                  <span className="text-micro text-workbench-success bg-[var(--workbench-success-soft)] px-2 py-0.5 rounded-full shrink-0">{t('onboardingProviders.comfyPreset.chipReady')}</span>
                ) : (
                  <span className="text-micro text-workbench-danger bg-[var(--workbench-danger-soft)] px-2 py-0.5 rounded-full shrink-0">
                    {result.serverReachable
                      ? t('onboardingProviders.comfyPreset.chipMissing', { count: missingCount + result.unknownNodeTypes.length })
                      : t('onboardingProviders.comfyPreset.chipOffline')}
                  </span>
                )
              ) : (
                <span className="text-micro text-nomi-ink-30 shrink-0">{checking ? t('onboardingProviders.comfyPreset.chipChecking') : t('onboardingProviders.comfyPreset.chipTap')}</span>
              )}
            </button>
            {open ? (
              <div className="border-t border-nomi-line px-3 py-2.5 flex flex-col gap-2">
                {result && !result.serverReachable ? (
                  <div className="text-caption text-nomi-ink-40">{t('onboardingProviders.comfyPreset.offlineNote')}</div>
                ) : null}
                {result && result.unknownNodeTypes.length > 0 ? (
                  <div className="flex items-start gap-2 rounded-nomi-sm bg-[var(--workbench-danger-soft)] px-2.5 py-2">
                    <IconAlertTriangle size={14} className="shrink-0 mt-0.5 text-workbench-danger" />
                    <span className="text-caption text-nomi-ink leading-relaxed">{t('onboardingProviders.comfyPreset.missingNodes', { list: result.unknownNodeTypes.join(' · ') })}</span>
                  </div>
                ) : null}
                {preset.models.map((m) => {
                  const isMissing = result && result.serverReachable ? missing.has(m.file) : null
                  return (
                    <div key={m.file} className="flex items-center gap-2 text-caption min-w-0">
                      {isMissing === null ? (
                        <span className="size-3.5 shrink-0 rounded-full bg-nomi-ink-10" aria-hidden="true" />
                      ) : isMissing ? (
                        <IconX size={14} className="text-workbench-danger shrink-0" aria-label={t('onboardingProviders.comfyPreset.fileMissing')} />
                      ) : (
                        <IconCheck size={14} className="text-workbench-success shrink-0" aria-label={t('onboardingProviders.comfyPreset.fileReady')} />
                      )}
                      <code className="flex-1 min-w-0 truncate font-mono text-nomi-ink" title={m.file}>{m.file}</code>
                      <span className="text-nomi-ink-30 shrink-0">{t('onboardingProviders.comfyPreset.dirLabel', { dir: m.dir })}</span>
                      <button
                        type="button"
                        aria-label={t('onboardingProviders.comfyPreset.copyName', { name: m.file })}
                        title={t('onboardingProviders.comfyPreset.copyNameShort')}
                        onClick={() => { void navigator.clipboard.writeText(m.file); toast(t('onboardingProviders.comfyPreset.copied'), 'success') }}
                        className="grid size-6 shrink-0 place-items-center rounded-nomi-sm text-nomi-ink-30 hover:bg-nomi-ink-05 hover:text-nomi-ink-60"
                      >
                        <IconCopy size={13} stroke={1.7} />
                      </button>
                      <button
                        type="button"
                        aria-label={t('onboardingProviders.comfyPreset.downloadAria', { name: m.file })}
                        title={t('onboardingProviders.comfyPreset.downloadTitle')}
                        onClick={() => window.open(m.url, '_blank', 'noopener')}
                        className="grid size-6 shrink-0 place-items-center rounded-nomi-sm text-nomi-ink-30 hover:bg-nomi-ink-05 hover:text-nomi-accent"
                      >
                        <IconExternalLink size={13} stroke={1.7} />
                      </button>
                    </div>
                  )
                })}
                <div className="flex items-center gap-2 pt-0.5">
                  <button
                    type="button"
                    disabled={gate === 'disabled'}
                    // arm = 首次点击（缺件/未连接）→ 只把风险摊开，不启用；再点一次才真启用。
                    onClick={() => { if (gate === 'arm') setArmedKey(preset.key); else enable(preset) }}
                    title={gate === 'arm' || gate === 'confirm' ? riskNote : undefined}
                    // shrink-0 + nowrap：面板只有 ~340px 宽，不钉住会被旁边的说明挤成方块/折成两行（走查截图实见）。
                    className={cn('inline-flex shrink-0 items-center gap-1.5 h-8 px-3 whitespace-nowrap rounded-nomi-sm bg-nomi-ink text-nomi-paper text-caption font-medium',
                      'hover:bg-nomi-accent disabled:opacity-45')}
                  >
                    {alreadyEnabled
                      ? t('onboardingProviders.comfyPreset.enabledButton')
                      : gate === 'arm'
                        ? t('onboardingProviders.comfyPreset.enableAnyway')
                        : gate === 'confirm'
                          ? t('onboardingProviders.comfyPreset.enableConfirm')
                          : t('onboardingProviders.comfyPreset.enableButton')}
                  </button>
                  <button
                    type="button"
                    onClick={() => check(preset)}
                    disabled={checking}
                    className="inline-flex shrink-0 items-center gap-1 h-8 px-2.5 whitespace-nowrap text-caption text-nomi-ink-60 rounded-nomi-sm border border-nomi-line hover:border-nomi-accent hover:text-nomi-accent disabled:opacity-50"
                  >
                    <IconRefresh size={13} stroke={1.7} className={checking ? 'animate-spin' : undefined} />{t('onboardingProviders.comfyPreset.recheck')}
                  </button>
                  {gate === 'confirm' ? null : (
                    <span className="min-w-0 text-micro text-nomi-ink-30">{t('onboardingProviders.comfyPreset.gateNote')}</span>
                  )}
                </div>
                {/* 风险话术放按钮**下方**：放上方会把主按钮往下顶出可视区，用户点完第一下得去找第二下（走查实见）。 */}
                {gate === 'confirm' ? (
                  <div className="flex items-start gap-2 rounded-nomi-sm bg-[var(--workbench-danger-soft)] px-2.5 py-2">
                    <IconAlertTriangle size={14} className="shrink-0 mt-0.5 text-workbench-danger" />
                    <span className="text-caption text-nomi-ink leading-relaxed">{riskNote}</span>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
