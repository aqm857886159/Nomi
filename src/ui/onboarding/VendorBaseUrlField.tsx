/**
 * 「接入地址」字段行 —— 内置家卡（VendorOnboardCard）与自定义中转家卡（CustomVendorManage）
 * **共用同一份**。此前两边各写了一份逻辑与 markup 完全相同的编辑块（同样的 upsertVendor、
 * 同样的 `data-model-connection-*`、同样那支 13px 铅笔），改一次要动两处 —— 违反 P1。
 *
 * 2026-08-18 从「灰小字 + 铅笔图标」改成带标签的字段行 +「修改」文字按钮：
 * 群里「要改 api url 翻了半天没找到」的根因之一就是那支铅笔——命中区只有 17×17（WCAG 2.2 AA
 * 要求 ≥24），颜色取 ink-30（全系统最弱的一档），旁边还是同样弱的灰色地址文本，整行读起来像
 * 一条只读的 metadata，不像可操作的控件。见 docs/plan/2026-08-18-vendor-connection-discoverability.md。
 *
 * 保存成功不在这里重探连接：地址一改，useVendorHealth 的 fingerprint 就变，effect 自动重探。
 */
import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { IconPencil } from '@tabler/icons-react'
import { cn } from '../../utils/cn'
import { DecisionBar } from '../../design'
import { getDesktopBridge } from '../../desktop/bridge'
import type { ModelSettingsConnectionFocus } from './modelSettingsNavigation'

type VendorBaseUrlFieldProps = {
  vendorKey: string
  /** 无障碍标签里用的供应商显示名。 */
  vendorName: string
  baseUrl: string
  /** 外层正忙（存 key / 删除中）时一并禁用，避免并发写 catalog。 */
  disabled?: boolean
  /** 存好后刷新外层目录。 */
  onSaved: () => void
  /** 地址为空时整行不渲染（内置家的既有行为：seed 没给地址就不显这行）。 */
  hideWhenEmpty?: boolean
  /** 连接恢复流程要求把光标送到地址框；本组件只认 target === 'baseUrl'。 */
  focus?: ModelSettingsConnectionFocus
}

export function VendorBaseUrlField({
  vendorKey,
  vendorName,
  baseUrl,
  disabled = false,
  onSaved,
  hideWhenEmpty = false,
  focus,
}: VendorBaseUrlFieldProps): JSX.Element | null {
  const { t } = useTranslation()
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState('')
  const inputRef = React.useRef<HTMLInputElement>(null)
  const handledFocusRequestRef = React.useRef<number | null>(null)

  React.useEffect(() => {
    if (!focus || focus.target !== 'baseUrl' || handledFocusRequestRef.current === focus.requestId) return
    handledFocusRequestRef.current = focus.requestId
    setDraft(baseUrl)
    setEditing(true)
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        inputRef.current?.focus({ preventScroll: false })
        inputRef.current?.scrollIntoView({ block: 'center' })
      })
    })
  }, [baseUrl, focus])

  const handleSave = React.useCallback(() => {
    const next = draft.trim().replace(/\/+$/, '')
    if (!/^https?:\/\/\S+$/.test(next)) {
      setError(t('onboardingProviders.vendorCard.invalidAddress'))
      return
    }
    const bridge = getDesktopBridge()
    if (!bridge) return
    setBusy(true)
    setError('')
    try {
      bridge.modelCatalog.upsertVendor({ key: vendorKey, baseUrlHint: next })
      setEditing(false)
      onSaved()
    } catch (e) {
      setError(t('onboardingProviders.vendorCard.saveFailed', { message: e instanceof Error ? e.message : String(e) }))
    } finally {
      setBusy(false)
    }
  }, [draft, vendorKey, onSaved, t])

  const locked = disabled || busy

  if (!editing && hideWhenEmpty && !baseUrl) return null

  if (editing) {
    return (
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap gap-2">
          <input
            ref={inputRef}
            data-model-connection-field="baseUrl"
            type="text"
            aria-label={t('onboardingProviders.vendorCard.addressAria', { name: vendorName })}
            placeholder={t('onboardingProviders.vendorCard.addressPlaceholder')}
            value={draft}
            onChange={(e) => setDraft(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSave()
              if (e.key === 'Escape') {
                setEditing(false)
                setError('')
              }
            }}
            disabled={locked}
            autoFocus
            className={cn(
              'min-w-[10rem] flex-[1_1_10rem] h-8 rounded-nomi-sm border border-nomi-line bg-nomi-paper px-2.5',
              'text-body-sm text-nomi-ink placeholder:text-nomi-ink-40 outline-none focus:border-nomi-accent',
            )}
          />
          <DecisionBar
            inline
            cancelLabel={t('common.cancel')}
            onCancel={() => {
              setEditing(false)
              setError('')
            }}
            cancelDisabled={locked}
            cancelProps={{ 'data-model-connection-edit': 'baseUrl' }}
            primaryLabel={t('onboardingProviders.vendorCard.save')}
            onPrimary={handleSave}
            primaryDisabled={locked}
            primaryProps={{ 'data-model-connection-save': 'baseUrl' }}
          />
        </div>
        {error ? <div className="text-caption text-workbench-danger">{error}</div> : null}
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2 min-w-0">
      <span className="shrink-0 text-caption text-nomi-ink-40">{t('onboardingProviders.customVendor.addressLabel')}</span>
      <span className="flex-1 min-w-0 truncate text-caption text-nomi-ink" title={baseUrl || undefined}>
        {baseUrl || t('onboardingProviders.customVendor.notSet')}
      </span>
      <button
        type="button"
        aria-label={t('onboardingProviders.vendorCard.editAddressAria', { name: vendorName })}
        onClick={() => {
          setDraft(baseUrl)
          setEditing(true)
        }}
        disabled={locked}
        className={cn(
          'shrink-0 inline-flex items-center gap-1 h-7 px-2.5 rounded-full',
          'border border-nomi-line text-caption text-nomi-ink-60',
          'hover:border-nomi-ink-20 hover:text-nomi-ink disabled:opacity-50 disabled:cursor-not-allowed',
        )}
      >
        <IconPencil size={13} stroke={1.6} />
        {t('onboardingProviders.customVendor.editAddress')}
      </button>
    </div>
  )
}
