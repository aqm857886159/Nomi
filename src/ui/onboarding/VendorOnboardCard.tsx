/**
 * 供应商接入卡（apimart / kie 等已知供应商复用，P4 通用第一）。
 *
 * 方案 A：折成一行摘要（FoldableModelCard），点开 body 才露出 key 区 + 模型 chip + 推广。
 * - 待接入：默认展开，body 显 key 输入 + 解锁。
 * - 已连通：默认折叠；展开后 key 区显「已保存 · 更换/断开」，模型 chip 点亮。
 * 填 key → upsertVendorApiKey（后端零改动，模型已 seed）。模型清单从 catalog 派生。
 * 样张：docs/design/mockups/onboarding-panel-A.html
 */
import React from 'react'
import { IconKey, IconExternalLink } from '@tabler/icons-react'
import { cn } from '../../utils/cn'
import { getDesktopBridge } from '../../desktop/bridge'
import type { KnownVendor } from '../../config/knownVendors'
import { FoldableModelCard } from './FoldableModelCard'
import { ModelChipGroups, type ChipModel } from './ModelChipGroups'

type VendorOnboardCardProps = {
  directory: KnownVendor
  /** catalog 里的供应商显示名（vendor.name）。 */
  vendorName: string
  /** catalog 里的 baseUrlHint（信息展示用）。 */
  baseUrl: string
  /** 该供应商是否已绑定 key（catalog vendor.hasApiKey）。 */
  hasApiKey: boolean
  /** 该供应商的预置模型（从 catalog 派生）。 */
  models: ChipModel[]
  /** key 绑定/清除后刷新外层。 */
  onChanged: () => void
}

export function VendorOnboardCard({
  directory,
  vendorName,
  baseUrl,
  hasApiKey,
  models,
  onChanged,
}: VendorOnboardCardProps): JSX.Element {
  // 已连通默认折叠 key 输入（显「已保存」）；点「更换」展开输入。
  const [editing, setEditing] = React.useState(!hasApiKey)
  const [keyDraft, setKeyDraft] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState('')

  React.useEffect(() => {
    setEditing(!hasApiKey)
  }, [hasApiKey])

  const total = models.length

  const handleUnlock = React.useCallback(() => {
    const apiKey = keyDraft.trim()
    if (!apiKey) {
      setError('请先粘贴 API Key。')
      return
    }
    const bridge = getDesktopBridge()
    if (!bridge) return
    setBusy(true)
    setError('')
    try {
      bridge.modelCatalog.upsertVendorApiKey(directory.vendorKey, { apiKey, enabled: true })
      setKeyDraft('')
      setEditing(false)
      onChanged()
    } catch (e) {
      setError(`解锁失败：${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(false)
    }
  }, [keyDraft, directory.vendorKey, onChanged])

  const handleDisconnect = React.useCallback(() => {
    const bridge = getDesktopBridge()
    if (!bridge) return
    const ok = window.confirm(`断开「${vendorName}」？该家模型会回到"未连通"，需重新填 key。`)
    if (!ok) return
    setBusy(true)
    setError('')
    try {
      bridge.modelCatalog.clearVendorApiKey(directory.vendorKey)
      onChanged()
    } catch (e) {
      setError(`断开失败：${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(false)
    }
  }, [directory.vendorKey, vendorName, onChanged])

  const openPromo = React.useCallback(() => {
    if (directory.promo) window.open(directory.promo.url, '_blank', 'noopener')
  }, [directory.promo])

  return (
    <FoldableModelCard
      glyph={directory.logo
        ? <img src={directory.logo} alt="" className="w-full h-full object-contain" />
        : directory.glyph}
      glyphTone={directory.logo ? 'logo' : 'ink'}
      name={vendorName}
      subtitle={hasApiKey ? `${total} 个模型可用` : directory.tagline}
      status={hasApiKey ? 'ok' : 'todo'}
      defaultExpanded={false}
    >
      {/* key 区 */}
      {editing ? (
        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            <input
              type="password"
              aria-label={`${vendorName} API Key`}
              placeholder="粘贴你的 API Key（sk-…）"
              value={keyDraft}
              onChange={(e) => setKeyDraft(e.currentTarget.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleUnlock() }}
              disabled={busy}
              className={cn(
                'flex-1 min-w-0 h-8 rounded-nomi-sm border border-nomi-line bg-nomi-paper px-2.5',
                'text-body-sm text-nomi-ink placeholder:text-nomi-ink-40',
                'outline-none focus:border-nomi-accent',
              )}
            />
            <button
              type="button"
              onClick={handleUnlock}
              disabled={busy}
              className={cn(
                'shrink-0 h-8 px-3 rounded-nomi-sm bg-nomi-ink text-nomi-paper',
                'text-body-sm font-semibold inline-flex items-center gap-1.5',
                'hover:bg-nomi-accent disabled:opacity-50 disabled:cursor-not-allowed',
              )}
            >
              <IconKey size={14} stroke={1.6} />解锁
            </button>
          </div>
          <div className="text-caption text-nomi-ink-40">填一次即可，密钥本地加密存储、只在调用时使用。</div>
          {hasApiKey ? (
            <button
              type="button"
              onClick={() => setEditing(false)}
              disabled={busy}
              className="self-start text-caption text-nomi-ink-40 hover:text-nomi-ink-60"
            >
              取消
            </button>
          ) : null}
        </div>
      ) : (
        <div className="flex items-center justify-between gap-2">
          <span className="text-caption text-nomi-ink-60">API Key 已保存</span>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setEditing(true)}
              disabled={busy}
              className="text-caption text-nomi-ink-60 border border-nomi-line rounded-full px-2.5 py-[3px] hover:border-nomi-ink-20"
            >
              更换
            </button>
            <button
              type="button"
              onClick={handleDisconnect}
              disabled={busy}
              className="text-caption text-nomi-ink-40 px-1 hover:text-workbench-danger"
            >
              断开
            </button>
          </div>
        </div>
      )}

      {error ? <div className="text-caption text-workbench-danger">{error}</div> : null}

      {baseUrl ? <div className="text-caption text-nomi-ink-30 truncate">接入地址：{baseUrl}</div> : null}

      <ModelChipGroups models={models} connected={hasApiKey} />

      {/* 推广位：移到 body 末尾，折叠态不显（减噪）；软话术、不营销 */}
      {directory.promo ? (
        <div className="flex items-center gap-2 border-t border-nomi-line-soft pt-3">
          <span className="flex-1 min-w-0 text-caption text-nomi-ink-40 leading-snug">{directory.promo.text}</span>
          <button
            type="button"
            onClick={openPromo}
            className="shrink-0 inline-flex items-center gap-1 text-caption text-nomi-ink-60 hover:text-nomi-accent"
          >
            {directory.promo.ctaLabel}
            <IconExternalLink size={13} stroke={1.6} />
          </button>
        </div>
      ) : null}
    </FoldableModelCard>
  )
}
