// 设置 → AI → TikHub 数据源（分享链接直拆）。小 UI，照 CustomVendorManage 的凭证卡先例。
//
// 这是一个「数据 connector」的 BYO-key 配置卡：用户填自己的 TikHub key，Nomi 就能把
// 抖音/TikTok 分享链接解析成无水印直链、落成项目视频素材再用现有节点拆解。
// key 走主进程 safeStorage 加密存储（与其它供应商同一条凭据边界），永不回传明文。
// 语义/管线见 docs/plan/2026-09-01-tikhub-connector-v1.md。
import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconKey, IconExternalLink } from '@tabler/icons-react'

import { cn } from '../../utils/cn'
import { getDesktopBridge } from '../../desktop/bridge'
import type { TikhubKeyStatus } from '../../desktop/bridgeConnector'

export function TikhubConnectorCard(): JSX.Element {
  const { t } = useTranslation()
  const [status, setStatus] = React.useState<TikhubKeyStatus['status']>('missing')
  const [keyEditing, setKeyEditing] = React.useState(true)
  const [keyDraft, setKeyDraft] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState('')

  const hasKey = status === 'ok'

  const refresh = React.useCallback(() => {
    const bridge = getDesktopBridge()
    if (!bridge?.connector?.tikhub) return
    void bridge.connector.tikhub
      .keyStatus()
      .then((next) => {
        const value = next as TikhubKeyStatus
        setStatus(value.status)
        setKeyEditing(value.status !== 'ok')
      })
      .catch(() => {
        /* 读态失败不致命：保持未配置视图 */
      })
  }, [])

  React.useEffect(() => {
    refresh()
  }, [refresh])

  const handleSaveKey = React.useCallback(() => {
    const apiKey = keyDraft.trim()
    if (!apiKey) {
      setError(t('settings.ai.tikhub.keyRequired'))
      return
    }
    const bridge = getDesktopBridge()
    if (!bridge?.connector?.tikhub) return
    setBusy(true)
    setError('')
    void bridge.connector.tikhub
      .saveKey({ apiKey })
      .then((next) => {
        const value = next as TikhubKeyStatus
        setStatus(value.status)
        setKeyDraft('')
        setKeyEditing(value.status !== 'ok')
        if (value.status !== 'ok') setError(t('settings.ai.tikhub.saveFailed'))
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : t('settings.ai.tikhub.saveFailed'))
      })
      .finally(() => setBusy(false))
  }, [keyDraft, t])

  const handleDisconnect = React.useCallback(() => {
    const bridge = getDesktopBridge()
    if (!bridge?.connector?.tikhub) return
    setBusy(true)
    setError('')
    void bridge.connector.tikhub
      .clearKey()
      .then((next) => {
        const value = next as TikhubKeyStatus
        setStatus(value.status)
        setKeyEditing(true)
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : t('settings.ai.tikhub.saveFailed'))
      })
      .finally(() => setBusy(false))
  }, [t])

  return (
    <section className="mt-6 flex flex-col gap-2" data-settings-section="tikhub-connector">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-body font-medium text-nomi-ink">{t('settings.ai.tikhub.title')}</h3>
        <a
          href="https://tikhub.io"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-caption text-nomi-ink-40 hover:text-nomi-ink-60"
        >
          {t('settings.ai.tikhub.getKey')}
          <IconExternalLink size={12} stroke={1.6} aria-hidden="true" />
        </a>
      </div>
      <p className="text-caption leading-relaxed text-nomi-ink-40">{t('settings.ai.tikhub.description')}</p>

      <div className="flex flex-col rounded-nomi border border-nomi-line">
        <div className="flex flex-col gap-2.5 p-2.5">
          {keyEditing ? (
            <div className="flex flex-col gap-2">
              <div className="flex gap-2">
                <input
                  type="password"
                  aria-label={t('settings.ai.tikhub.keyAria')}
                  placeholder={t('settings.ai.tikhub.keyPlaceholder')}
                  value={keyDraft}
                  onChange={(e) => setKeyDraft(e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSaveKey()
                  }}
                  disabled={busy}
                  className={cn(
                    'flex-1 min-w-0 h-8 rounded-nomi-sm border border-nomi-line bg-nomi-paper px-2.5',
                    'text-body-sm text-nomi-ink placeholder:text-nomi-ink-40 outline-none focus:border-nomi-accent',
                  )}
                />
                <button
                  type="button"
                  onClick={handleSaveKey}
                  disabled={busy}
                  className={cn(
                    'shrink-0 h-8 px-3 rounded-nomi-sm bg-nomi-ink text-nomi-paper text-body-sm font-semibold',
                    'inline-flex items-center gap-1.5 hover:bg-nomi-accent disabled:opacity-50 disabled:cursor-not-allowed',
                  )}
                >
                  <IconKey size={14} stroke={1.6} aria-hidden="true" />
                  {t('settings.ai.tikhub.save')}
                </button>
              </div>
              {hasKey ? (
                <button
                  type="button"
                  onClick={() => setKeyEditing(false)}
                  disabled={busy}
                  className="self-start text-caption text-nomi-ink-40 hover:text-nomi-ink-60"
                >
                  {t('common.cancel')}
                </button>
              ) : null}
            </div>
          ) : (
            <div className="flex items-center justify-between gap-2">
              <span className="text-caption text-nomi-ink-60">{t('settings.ai.tikhub.connected')}</span>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setKeyEditing(true)}
                  disabled={busy}
                  className="text-caption text-nomi-ink-60 border border-nomi-line rounded-full px-2.5 py-[3px] hover:border-nomi-ink-20"
                >
                  {t('settings.ai.tikhub.replace')}
                </button>
                <button
                  type="button"
                  onClick={handleDisconnect}
                  disabled={busy}
                  className="text-caption text-nomi-ink-40 px-1 hover:text-workbench-danger"
                >
                  {t('settings.ai.tikhub.disconnect')}
                </button>
              </div>
            </div>
          )}

          {error ? <div className="text-caption text-workbench-danger">{error}</div> : null}
        </div>
      </div>

      <p className="text-caption leading-relaxed text-nomi-ink-40">{t('settings.ai.tikhub.honestNote')}</p>
    </section>
  )
}
