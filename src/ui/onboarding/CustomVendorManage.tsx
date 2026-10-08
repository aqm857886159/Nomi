/**
 * 自定义 / 中转站供应商的「连接」组（改地址 / 换 key / 断开 / 删除整个供应商）。
 * 用户反馈（2026-07-04）：自定义接入的供应商卡此前只能删单个模型，没法改 BaseURL、换 key、
 * 也没法整家删掉没用的 API。后端接口（upsertVendor / upsertVendorApiKey / clearVendorApiKey /
 * deleteVendor）本就现成，只是没在这张卡上露出来——本组件把它们补齐。
 *
 * 2026-08-18 改成**有边界、有标题的字段组**，并由 CustomVendorCard 排到模型列表**之前**：
 * 群里「要改 api url 翻了半天没找到」的实测根因是——本组件此前排在 24 行模型列表之后，落地
 * 连接详情页那一屏它整个被弹窗 overflow 裁在窗外（铅笔 y=817 / 弹窗底边 y=706）。
 * 见 docs/plan/2026-08-18-vendor-connection-discoverability.md。
 * 删除整家在这里是**唯一入口**（卡头那个垃圾桶图标同步删掉，§1.5.2 一功能一个家）。
 *
 * 地址行与内置家卡共用 VendorBaseUrlField（P1）；区别：自定义家凭证恒为单个 apiKey、
 * 地址恒可改、且可**整家删除**（内置家是 seed 的、只断 key 不删）。
 */
import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { IconTrash } from '@tabler/icons-react'
import { cn } from '../../utils/cn'
import { getDesktopBridge } from '../../desktop/bridge'
import { confirmDialog, DecisionBar } from '../../design'
import { confirmAndDeleteVendor } from './vendorDeleteAction'
import { VendorBaseUrlField } from './VendorBaseUrlField'
import { VendorConnectionNotice } from './VendorConnectionNotice'
import { VendorFieldLossNotice } from './VendorFieldLossNotice'
import { withoutVendorFieldLossNotice } from '../../../electron/shared/vendorFieldLossNotice'
import type { VendorConnection } from './useVendorHealth'
import type { ModelSettingsConnectionFocus } from './modelSettingsNavigation'

type CustomVendorManageProps = {
  vendorKey: string
  vendorName: string
  baseUrl: string
  hasApiKey: boolean
  modelCount: number
  /** 连接健康（由 CustomVendorCard 持有，与卡片胶囊同一份，不各自探）。 */
  connection: VendorConnection | null
  /** v12→v13 迁移盖的「这家的声明我补不了」标记时间戳；空 = 没盖过。 */
  fieldLossNoticeAt?: string | null
  /** 这家 vendor 记录当前的 meta（关掉提示时要把它原样写回、只去掉那一个键）。 */
  vendorMetaRaw?: unknown
  onRecheck: () => void
  /** 变更后刷新外层目录。 */
  onChanged: () => void
  focus?: ModelSettingsConnectionFocus
}

export function CustomVendorManage({
  vendorKey,
  vendorName,
  baseUrl,
  hasApiKey,
  modelCount,
  connection,
  fieldLossNoticeAt,
  vendorMetaRaw,
  onRecheck,
  onChanged,
  focus,
}: CustomVendorManageProps): JSX.Element {
  const { t } = useTranslation()
  const [keyEditing, setKeyEditing] = React.useState(!hasApiKey)
  const [keyDraft, setKeyDraft] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState('')
  const keyInputRef = React.useRef<HTMLInputElement>(null)
  const handledFocusRequestRef = React.useRef<number | null>(null)

  React.useEffect(() => {
    setKeyEditing(!hasApiKey)
  }, [hasApiKey])

  // 只管 apiKey 那一路；baseUrl 的聚焦请求由 VendorBaseUrlField 自己认（它持有那个 input）。
  React.useEffect(() => {
    if (!focus || focus.target !== 'apiKey' || handledFocusRequestRef.current === focus.requestId) return
    handledFocusRequestRef.current = focus.requestId
    setKeyEditing(true)
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        keyInputRef.current?.focus({ preventScroll: false })
        keyInputRef.current?.scrollIntoView({ block: 'center' })
      })
    })
  }, [focus])

  const handleSaveKey = React.useCallback(async () => {
    const apiKey = keyDraft.trim()
    if (!apiKey) {
      setError(t('onboardingProviders.vendorCard.pasteApiKeyFirst'))
      return
    }
    const bridge = getDesktopBridge()
    if (!bridge) return
    setBusy(true)
    setError('')
    try {
      await bridge.modelCatalog.upsertVendorApiKey(vendorKey, { apiKey, enabled: false })
      setKeyDraft('')
      setKeyEditing(false)
      onChanged()
      // 换 key 不改地址（健康检查的 fingerprint 不变），所以显式重探一次。
      onRecheck()
    } catch (e) {
      setError(t('onboardingProviders.vendorCard.saveFailed', { message: e instanceof Error ? e.message : String(e) }))
    } finally {
      setBusy(false)
    }
  }, [keyDraft, vendorKey, onChanged, onRecheck, t])

  const handleDisconnect = React.useCallback(async () => {
    const bridge = getDesktopBridge()
    if (!bridge) return
    const ok = await confirmDialog({
      title: t('onboardingProviders.vendorCard.disconnectTitle'),
      message: t('onboardingProviders.vendorCard.disconnectMessage', { name: vendorName }),
      confirmLabel: t('onboardingProviders.vendorCard.disconnect'),
      danger: true,
    })
    if (!ok) return
    setBusy(true)
    setError('')
    try {
      bridge.modelCatalog.clearVendorApiKey(vendorKey)
      onChanged()
    } catch (e) {
      setError(
        t('onboardingProviders.vendorCard.disconnectFailed', { message: e instanceof Error ? e.message : String(e) }),
      )
    } finally {
      setBusy(false)
    }
  }, [vendorKey, vendorName, onChanged, t])

  // 关掉提示 = 把 meta 原样写回、只去掉那一个键。走现成的 upsertVendor，不新造 IPC。
  const handleDismissFieldLoss = React.useCallback(async () => {
    setBusy(true)
    setError('')
    try {
      await getDesktopBridge()?.modelCatalog.upsertVendor({
        key: vendorKey,
        meta: withoutVendorFieldLossNotice(vendorMetaRaw) ?? null,
      })
      onChanged()
    } catch (e) {
      // 跨进程命令被拒绝时必须说出来：否则按钮像是生效了、提示却还在，用户以为是 bug。
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [vendorKey, vendorMetaRaw, onChanged])

  const handleDeleteVendor = React.useCallback(async () => {
    setBusy(true)
    setError('')
    const res = await confirmAndDeleteVendor({ vendorKey, vendorName, modelCount, onChanged })
    if (res.error) setError(res.error)
    setBusy(false)
  }, [vendorKey, vendorName, modelCount, onChanged])

  return (
    <section className="flex flex-col gap-2" data-vendor-connection-group>
      {/* 连接失败最先说：它是用户点进这一页的理由，且治它的地址/凭证就在紧接着的两行里。 */}
      <VendorConnectionNotice connection={connection} onRecheck={onRecheck} disabled={busy} />
      <VendorFieldLossNotice noticeAt={fieldLossNoticeAt} onDismiss={handleDismissFieldLoss} disabled={busy} />

      <h3 className="text-caption font-semibold text-nomi-ink-60">
        {t('onboardingProviders.customVendor.connectionSection')}
      </h3>

      <div className="flex flex-col rounded-nomi border border-nomi-line [&>*+*]:border-t [&>*+*]:border-nomi-line-soft">
      <div className="flex flex-col gap-2.5 p-2.5">
      {/* 凭证：已存→更换/断开；未存/更换中→输入框 */}
      {keyEditing ? (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            <input
              ref={keyInputRef}
              data-model-connection-field="apiKey"
              type="password"
              aria-label={t('onboardingProviders.vendorCard.apiKeyAria', { name: vendorName })}
              placeholder={t('onboardingProviders.customVendor.newKeyPlaceholder')}
              value={keyDraft}
              onChange={(e) => setKeyDraft(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSaveKey()
              }}
              disabled={busy}
              className={cn(
                'min-w-[10rem] flex-[1_1_10rem] h-8 rounded-nomi-sm border border-nomi-line bg-nomi-paper px-2.5',
                'text-body-sm text-nomi-ink placeholder:text-nomi-ink-40 outline-none focus:border-nomi-accent',
              )}
            />
            <DecisionBar
              inline
              cancelLabel={hasApiKey ? t('common.cancel') : undefined}
              onCancel={() => setKeyEditing(false)}
              cancelDisabled={busy}
              primaryLabel={t('onboardingProviders.vendorCard.save')}
              onPrimary={handleSaveKey}
              primaryDisabled={busy}
            />
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-2">
          <span className="text-caption text-nomi-ink-60">{t('onboardingProviders.vendorCard.credentialSaved')}</span>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setKeyEditing(true)}
              data-model-connection-edit="apiKey"
              disabled={busy}
              className="text-caption text-nomi-ink-60 border border-nomi-line rounded-full px-2.5 py-[3px] hover:border-nomi-ink-20"
            >
              {t('onboardingProviders.vendorCard.replace')}
            </button>
            <button
              type="button"
              onClick={handleDisconnect}
              disabled={busy}
              className="text-caption text-nomi-ink-40 px-1 hover:text-workbench-danger"
            >
              {t('onboardingProviders.vendorCard.disconnect')}
            </button>
          </div>
        </div>
      )}

      {error ? <div className="text-caption text-workbench-danger">{error}</div> : null}
      </div>

      {/* 接入地址（可就地改——StepFun 那类填错地址的根因入口）。与内置家卡共用同一份实现。 */}
      <div className="p-2.5">
        <VendorBaseUrlField
          vendorKey={vendorKey}
          vendorName={vendorName}
          baseUrl={baseUrl}
          disabled={busy}
          onSaved={onChanged}
          focus={focus}
        />
      </div>

      {/* 删除整个供应商（用户主诉：没用的 API 一键删掉）。这是**唯一**入口——卡头不再放垃圾桶图标。
          后果写在按钮旁边：一次点掉 N 个模型，用户有权在点之前就知道。 */}
      <div className="flex items-center gap-2 p-2.5">
        <span className="flex-1 min-w-0 text-caption text-nomi-ink-40">
          {t('onboardingProviders.customVendor.deleteEntireHint', { count: modelCount })}
        </span>
        <button
          type="button"
          onClick={handleDeleteVendor}
          disabled={busy}
          className={cn(
            'shrink-0 inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full',
            'text-caption text-workbench-danger border border-[var(--workbench-danger-soft)]',
            'hover:bg-[var(--workbench-danger-soft)] disabled:opacity-50 disabled:cursor-not-allowed',
          )}
        >
          <IconTrash size={14} stroke={1.7} />
          {t('onboardingProviders.customVendor.deleteEntire')}
        </button>
      </div>
      </div>
    </section>
  )
}
