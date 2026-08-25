/**
 * 「+ 再接一台 ComfyUI」（M 轨 · 2026-08-02 拍板四幕样张第④幕）。
 *
 * 用户摩擦：家里一台笔记本、工作室一台 4090，以前只能接一台——想换机器要改地址，
 * 改完之前那台的工作流全乱。现在每台一张卡，**选模型 = 选机器**，两台能同时跑。
 *
 * 身份：第 2+ 台的 vendorKey = `comfyui-local-{slug}`（前缀判据见 electron/catalog/types.isComfyuiVendor）。
 * 起的名字直接当 vendor.name，卡头显示它，画布上模型名也带它——用户靠名字认机器。
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconPlus, IconServerBolt } from '@tabler/icons-react'
import { cn } from '../../utils/cn'
import { getDesktopBridge } from '../../desktop/bridge'
import { toast } from '../toast'
import { COMFYUI_VENDOR_KEY } from './ComfyuiLocalCard'
import { normalizeComfyuiAddressInput } from './comfyuiAddress'

/** 名字 → key 片段：ASCII 保底（中文名回落时间戳，key 只是身份、用户看到的是 name）。 */
function slugFromName(name: string): string {
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 24)
  return slug || `n${Date.now().toString(36)}`
}

export function AddComfyuiInstanceButton({ onAdded }: { onAdded: () => void }): JSX.Element {
  const { t } = useTranslation()
  const [open, setOpen] = React.useState(false)
  const [name, setName] = React.useState('')
  const [addr, setAddr] = React.useState('http://192.168.1.10:8188')
  const [busy, setBusy] = React.useState(false)

  const submit = async () => {
    const bridge = getDesktopBridge()?.modelCatalog
    if (!bridge?.upsertVendor) return
    const trimmedName = name.trim()
    const trimmedAddr = addr.trim()
    if (!trimmedName || !trimmedAddr) return
    setBusy(true)
    try {
      const existing = (await bridge.listVendors() as Array<{ key?: unknown }>).map((v) => String(v.key))
      let key = `${COMFYUI_VENDOR_KEY}-${slugFromName(trimmedName)}`
      while (existing.includes(key)) key = `${key}-2` // 重名不覆盖既有那台（宁可多一台也不丢用户配置）
      bridge.upsertVendor({ key, name: trimmedName, baseUrlHint: normalizeComfyuiAddressInput(trimmedAddr), authType: 'none', enabled: true })
      toast(t('onboardingProviders.comfyInstance.added', { name: trimmedName }), 'success')
      setOpen(false)
      setName('')
      onAdded()
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn('flex items-center justify-center gap-1.5 h-9 w-full rounded-nomi',
          'border border-dashed border-nomi-line text-caption text-nomi-ink-60',
          'hover:border-nomi-accent hover:text-nomi-accent')}
      >
        <IconPlus size={14} stroke={1.8} />{t('onboardingProviders.comfyInstance.addButton')}
      </button>
    )
  }

  return (
    <div className="flex flex-col gap-2 rounded-nomi border border-nomi-accent/40 bg-nomi-paper p-3">
      <div className="flex items-center gap-2">
        <IconServerBolt size={15} stroke={1.7} className="text-nomi-ink-60" />
        <span className="text-body-sm font-semibold text-nomi-ink flex-1">{t('onboardingProviders.comfyInstance.title')}</span>
      </div>
      <label className="text-micro text-nomi-ink-40">{t('onboardingProviders.comfyInstance.nameLabel')}</label>
      <input
        value={name} onChange={(e) => setName(e.target.value)} autoFocus
        placeholder={t('onboardingProviders.comfyInstance.namePlaceholder')}
        aria-label={t('onboardingProviders.comfyInstance.nameLabel')}
        className="h-8 px-2.5 rounded-nomi-sm border border-nomi-line bg-nomi-paper text-caption text-nomi-ink placeholder:text-nomi-ink-30 focus:border-nomi-accent outline-none"
      />
      <label className="text-micro text-nomi-ink-40">{t('onboardingProviders.comfyInstance.addrLabel')}</label>
      <input
        value={addr} onChange={(e) => setAddr(e.target.value)} spellCheck={false}
        aria-label={t('onboardingProviders.comfyInstance.addrLabel')}
        className="h-8 px-2.5 rounded-nomi-sm border border-nomi-line bg-nomi-paper font-mono text-caption text-nomi-ink focus:border-nomi-accent outline-none"
      />
      <div className="flex items-center gap-2 pt-0.5">
        <button
          type="button" onClick={submit} disabled={busy || !name.trim() || !addr.trim()}
          className={cn('inline-flex items-center h-8 px-3.5 rounded-nomi-sm bg-nomi-ink text-nomi-paper',
            'text-caption font-medium hover:bg-nomi-accent disabled:opacity-45')}
        >
          {t('onboardingProviders.comfyInstance.confirm')}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="text-caption text-nomi-ink-40 hover:text-nomi-ink">
          {t('common.cancel')}
        </button>
        <span className="flex-1" />
      </div>
      <div className="text-micro text-nomi-ink-30 leading-relaxed">{t('onboardingProviders.comfyInstance.hint')}</div>
    </div>
  )
}
