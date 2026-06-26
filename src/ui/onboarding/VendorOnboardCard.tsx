/**
 * 供应商接入卡（apimart / kie 等已知供应商复用，P4 通用第一）。
 *
 * 方案 A：折成一行摘要（FoldableModelCard），点开 body 才露出 key 区 + 模型 chip + 推广。
 * - 待接入：默认展开，body 显 key 输入 + 解锁。
 * - 已连通：默认折叠；展开后 key 区显「已保存 · 更换/断开」，模型 chip 点亮。
 * 填 key → upsertVendorApiKey（后端零改动，模型已 seed）。模型清单从 catalog 派生。
 * 接入地址可就地编辑 → upsertVendor 只改 baseUrlHint（seed 存在即跳过，用户改动不被启动刷回）。
 * 样张：docs/design/mockups/onboarding-panel-A.html
 */
import React from 'react'
import { IconKey, IconExternalLink, IconPencil } from '@tabler/icons-react'
import { cn } from '../../utils/cn'
import { getDesktopBridge } from '../../desktop/bridge'
import { confirmDialog } from '../../design'
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
  // 多段凭证（如火山语音 App ID + Access Token）的草稿，按字段 key 存；单段家只有一个字段。
  const [drafts, setDrafts] = React.useState<Record<string, string>>({})
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState('')
  const [urlEditing, setUrlEditing] = React.useState(false)
  const [urlDraft, setUrlDraft] = React.useState('')

  React.useEffect(() => {
    setEditing(!hasApiKey)
  }, [hasApiKey])

  const total = models.length

  // 凭证字段：档案声明了 credentialFields 就按声明渲染多框；否则退化成单框（沿用 credentialPlaceholder）。
  const fields = React.useMemo(
    () =>
      directory.credentialFields ?? [
        {
          key: 'apiKey',
          label: '',
          placeholder: directory.credentialPlaceholder ?? '粘贴你的 API Key（sk-…）',
          secret: true,
        },
      ],
    [directory.credentialFields, directory.credentialPlaceholder],
  )
  const isMulti = fields.length > 1

  const setDraft = React.useCallback((key: string, value: string) => {
    setDrafts((prev) => ({ ...prev, [key]: value }))
  }, [])

  const handleUnlock = React.useCallback(() => {
    const parts = fields.map((field) => (drafts[field.key] ?? '').trim())
    if (parts.some((part) => !part)) {
      setError(isMulti ? '请把上面每一项都填上。' : '请先粘贴 API Key。')
      return
    }
    // 多段拼成单串存进唯一 key 槽（火山语音 → APP_ID:ACCESS_KEY）；后端按同一分隔符拆。
    const apiKey = parts.join(directory.credentialJoin ?? ':')
    const bridge = getDesktopBridge()
    if (!bridge) return
    setBusy(true)
    setError('')
    try {
      bridge.modelCatalog.upsertVendorApiKey(directory.vendorKey, { apiKey, enabled: true })
      setDrafts({})
      setEditing(false)
      onChanged()
    } catch (e) {
      setError(`解锁失败：${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(false)
    }
  }, [fields, drafts, isMulti, directory.vendorKey, directory.credentialJoin, onChanged])

  const handleDisconnect = React.useCallback(async () => {
    const bridge = getDesktopBridge()
    if (!bridge) return
    const ok = await confirmDialog({
      title: '断开供应商',
      message: `断开「${vendorName}」？该家模型会回到"未连通"，需重新填 key。`,
      confirmLabel: '断开',
      danger: true,
    })
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

  const handleSaveBaseUrl = React.useCallback(() => {
    const next = urlDraft.trim().replace(/\/+$/, '')
    if (!/^https?:\/\/\S+$/.test(next)) {
      setError('接入地址需以 http(s):// 开头。')
      return
    }
    const bridge = getDesktopBridge()
    if (!bridge) return
    setBusy(true)
    setError('')
    try {
      bridge.modelCatalog.upsertVendor({ key: directory.vendorKey, baseUrlHint: next })
      setUrlEditing(false)
      onChanged()
    } catch (e) {
      setError(`保存失败：${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(false)
    }
  }, [urlDraft, directory.vendorKey, onChanged])

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
      badge={!hasApiKey && directory.recommended ? (
        <span className="text-micro font-semibold text-nomi-accent bg-nomi-accent-soft rounded-full px-2 py-[2px] whitespace-nowrap">新手推荐</span>
      ) : undefined}
      defaultExpanded={false}
    >
      {/* key 区 */}
      {editing ? (
        <div className="flex flex-col gap-2">
          {isMulti ? (
            // 多段凭证：每段一个标注好的独立框，别让用户自己拼（D1）。
            <div className="flex flex-col gap-2.5">
              {fields.map((field) => (
                <div key={field.key} className="flex flex-col gap-1">
                  <label
                    htmlFor={`${directory.vendorKey}-${field.key}`}
                    className="text-caption font-medium text-nomi-ink-80"
                  >
                    {field.label}
                  </label>
                  <input
                    id={`${directory.vendorKey}-${field.key}`}
                    type={field.secret ? 'password' : 'text'}
                    aria-label={`${vendorName} ${field.label}`}
                    placeholder={field.placeholder}
                    value={drafts[field.key] ?? ''}
                    onChange={(e) => setDraft(field.key, e.currentTarget.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleUnlock() }}
                    disabled={busy}
                    className={cn(
                      'h-8 rounded-nomi-sm border border-nomi-line bg-nomi-paper px-2.5',
                      'text-body-sm text-nomi-ink placeholder:text-nomi-ink-40',
                      'outline-none focus:border-nomi-accent',
                    )}
                  />
                  {field.hint ? <div className="text-micro text-nomi-ink-40">{field.hint}</div> : null}
                </div>
              ))}
              <div className="flex items-center gap-2">
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
                {hasApiKey ? (
                  <button
                    type="button"
                    onClick={() => setEditing(false)}
                    disabled={busy}
                    className="text-caption text-nomi-ink-40 hover:text-nomi-ink-60"
                  >
                    取消
                  </button>
                ) : null}
              </div>
            </div>
          ) : (
            // 单段凭证：输入框 + 解锁按钮同排（绝大多数家）。
            <>
              <div className="flex gap-2">
                <input
                  type={fields[0].secret ? 'password' : 'text'}
                  aria-label={`${vendorName} API Key`}
                  placeholder={fields[0].placeholder}
                  value={drafts[fields[0].key] ?? ''}
                  onChange={(e) => setDraft(fields[0].key, e.currentTarget.value)}
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
            </>
          )}
          <div className="text-caption text-nomi-ink-40">{directory.credentialHint ?? '填一次即可，密钥本地加密存储、只在调用时使用。'}</div>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-2">
          <span className="text-caption text-nomi-ink-60">凭证已保存</span>
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

      {urlEditing ? (
        <div className="flex gap-2">
          <input
            type="text"
            aria-label={`${vendorName} 接入地址`}
            placeholder="https://…"
            value={urlDraft}
            onChange={(e) => setUrlDraft(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSaveBaseUrl()
              if (e.key === 'Escape') { setUrlEditing(false); setError('') }
            }}
            disabled={busy}
            autoFocus
            className={cn(
              'flex-1 min-w-0 h-8 rounded-nomi-sm border border-nomi-line bg-nomi-paper px-2.5',
              'text-body-sm text-nomi-ink placeholder:text-nomi-ink-40',
              'outline-none focus:border-nomi-accent',
            )}
          />
          <button
            type="button"
            onClick={handleSaveBaseUrl}
            disabled={busy}
            className={cn(
              'shrink-0 h-8 px-3 rounded-nomi-sm bg-nomi-ink text-nomi-paper',
              'text-body-sm font-semibold',
              'hover:bg-nomi-accent disabled:opacity-50 disabled:cursor-not-allowed',
            )}
          >
            保存
          </button>
          <button
            type="button"
            onClick={() => { setUrlEditing(false); setError('') }}
            disabled={busy}
            className="shrink-0 text-caption text-nomi-ink-40 hover:text-nomi-ink-60"
          >
            取消
          </button>
        </div>
      ) : baseUrl ? (
        <div className="flex items-center gap-1 min-w-0">
          <span className="text-caption text-nomi-ink-30 truncate">接入地址：{baseUrl}</span>
          <button
            type="button"
            aria-label={`编辑 ${vendorName} 接入地址`}
            onClick={() => { setUrlDraft(baseUrl); setUrlEditing(true) }}
            disabled={busy}
            className="shrink-0 p-0.5 text-nomi-ink-30 hover:text-nomi-ink-60"
          >
            <IconPencil size={13} stroke={1.6} />
          </button>
        </div>
      ) : null}

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
