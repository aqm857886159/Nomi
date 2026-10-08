// 设置 → 模型 → 数据源 → TikHub（分享链接直拆）。小 UI，照 CustomVendorManage 的凭证卡先例。
// 2026-09-01 归位：从「AI 策略」tab 搬到「模型」tab 的数据源区——它是数据源接入（换来一路素材），
// 不是 AI 策略（在已接入能力上定规则）。判据见 docs/design/nomi-design-system.md §1.7.2。
//
// 这是一个「数据 connector」的 BYO-key 配置卡：用户填自己的 TikHub key，Nomi 就能把
// 抖音/TikTok 分享链接解析成无水印直链、落成项目视频素材再用现有节点拆解。
// key 走主进程 safeStorage 加密存储（与其它供应商同一条凭据边界），永不回传明文。
// 语义/管线见 docs/plan/2026-09-01-tikhub-connector-v1.md。
import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { IconExternalLink, IconChevronDown } from '@tabler/icons-react'

import { cn } from '../../utils/cn'
import { DecisionBar } from '../../design'
import { getDesktopBridge } from '../../desktop/bridge'
import type { TikhubKeyStatus, TikhubRouteMode, TikhubRouteStatus } from '../../desktop/bridgeConnector'
import { tikhubErrorKindOf } from '../../../electron/shared/contracts/tikhubErrorKinds'

const ROUTE_MODES: readonly TikhubRouteMode[] = ['auto', 'io', 'dev']

/**
 * 「线路」折叠行（双域名全球化）——照 #282 NetworkSection 的折叠先例：收起态一行 + 状态胶囊
 * （一眼看到「现在实际走哪条线」），展开态分段选择器（自动 / 主线路 / 大陆加速）+ 生效线路说明。
 * 只在已连接 key 后出现：线路只有在真用它时才有意义（§1.5 归位，不给未配置用户添噪）。
 */
function TikhubRouteRow(): JSX.Element | null {
  const { t } = useTranslation()
  const [expanded, setExpanded] = React.useState(false)
  const [route, setRoute] = React.useState<TikhubRouteStatus | null>(null)
  const bodyId = React.useId()

  const refresh = React.useCallback(() => {
    const bridge = getDesktopBridge()
    if (!bridge?.connector?.tikhub?.routeStatus) return
    void bridge.connector.tikhub
      .routeStatus()
      .then((next) => setRoute(next as TikhubRouteStatus))
      .catch(() => {
        /* 读态失败不致命 */
      })
  }, [])

  React.useEffect(() => {
    refresh()
  }, [refresh])

  const selectMode = React.useCallback((mode: TikhubRouteMode) => {
    const bridge = getDesktopBridge()
    if (!bridge?.connector?.tikhub?.setRoute) return
    // 乐观切档（立刻反馈），落盘结果回来再对齐生效域。
    setRoute((current) => (current ? { ...current, mode } : current))
    void bridge.connector.tikhub
      .setRoute({ mode })
      .then((next) => setRoute(next as TikhubRouteStatus))
      .catch(() => refresh())
  }, [refresh])

  // 桥不在（网页预览/测试）或还没读到态：整行不渲染，别给点不动的空壳。
  if (!route) return null

  // 状态胶囊语义：auto 且已选出生效域 → 「自动 · 走 {host}」；auto 未连接过 → 「自动选路」；手动 → 对应线路名。
  const pillKey =
    route.mode === 'io'
      ? 'pillIo'
      : route.mode === 'dev'
        ? 'pillDev'
        : route.activeHost
          ? 'pillAutoActive'
          : 'pillAuto'
  const hint =
    route.mode === 'io'
      ? t('settings.ai.tikhub.route.hintIo')
      : route.mode === 'dev'
        ? t('settings.ai.tikhub.route.hintDev')
        : route.activeHost
          ? t('settings.ai.tikhub.route.hintAutoActive', { host: route.activeHost })
          : t('settings.ai.tikhub.route.hintAuto')
  // auto 生效态才算「有确定线路」（绿点）；否则中性灰点。
  const routeSettled = route.mode !== 'auto' || Boolean(route.activeHost)

  return (
    <div className="flex flex-col border-t border-nomi-line-soft pt-2 mt-1">
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={bodyId}
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-2 w-full text-left px-0.5 py-1.5 group"
      >
        <span className="text-micro font-semibold text-nomi-ink-40">{t('settings.ai.tikhub.route.label')}</span>
        <span className="inline-flex items-center gap-1.5 px-2 py-[3px] rounded-full text-micro font-semibold bg-nomi-ink-10 text-nomi-ink-60">
          <span className={cn('w-1.5 h-1.5 rounded-full', routeSettled ? 'bg-workbench-success' : 'bg-nomi-ink-30')} />
          {t(`settings.ai.tikhub.route.${pillKey}`, { host: route.activeHost })}
        </span>
        <span className="flex-1" />
        <IconChevronDown
          size={15}
          stroke={1.8}
          className={cn(
            'shrink-0 text-nomi-ink-30 transition-transform duration-150 group-hover:text-nomi-ink-40',
            expanded && 'rotate-180',
          )}
          aria-hidden="true"
        />
      </button>

      {expanded ? (
        <div id={bodyId} className="flex flex-col gap-2 pt-0.5 pb-1">
          <div className="flex gap-0.5 p-0.5 bg-nomi-ink-05 rounded-nomi-sm" role="group" aria-label={t('settings.ai.tikhub.route.label')}>
            {ROUTE_MODES.map((mode) => (
              <button
                key={mode}
                type="button"
                aria-pressed={route.mode === mode}
                onClick={() => selectMode(mode)}
                className={cn(
                  'flex-1 py-1 rounded-nomi-sm text-caption transition-colors',
                  route.mode === mode
                    ? 'bg-nomi-paper text-nomi-ink font-semibold shadow-[0_0_0_1px_var(--nomi-line)]'
                    : 'text-nomi-ink-60 hover:text-nomi-ink',
                )}
              >
                {t(`settings.ai.tikhub.route.mode${mode === 'auto' ? 'Auto' : mode === 'io' ? 'Io' : 'Dev'}`)}
              </button>
            ))}
          </div>
          <p className="text-micro text-nomi-ink-40 leading-relaxed">{hint}</p>
        </div>
      ) : null}
    </div>
  )
}

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

  // 保存失败态：connector kind → 诚实文案。核心是把「假成功」变成三段式真话——
  // auth=Key 无效（别再说「已连接」）；no-route/upstream=网络/线路不通（是网的事，不是 key 的事，让用户会去检查网络而非狂换 key）。
  const describeSaveError = React.useCallback((err: unknown): string => {
    const kind = tikhubErrorKindOf(err)
    if (kind === 'auth') return t('settings.ai.tikhub.keyInvalid')
    if (kind === 'quota') return t('settings.ai.tikhub.keyQuota')
    if (kind === 'no-route' || kind === 'upstream') return t('settings.ai.tikhub.verifyNetwork')
    return t('settings.ai.tikhub.saveFailed')
  }, [t])

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
      // saveKey 现在会**先真实校验再落盘**：成功回来即代表这把 key 真能用（不再是乱填也「已连接」）。
      .saveKey({ apiKey })
      .then((next) => {
        const value = next as TikhubKeyStatus
        setStatus(value.status)
        // 只有真存进去（status:'ok'）才清草稿、收起输入；否则留住输入让用户改。
        if (value.status === 'ok') {
          setKeyDraft('')
          setKeyEditing(false)
        } else {
          setError(t('settings.ai.tikhub.saveFailed'))
        }
      })
      .catch((err) => {
        // 校验失败在这里落地（auth/quota/no-route/…）：坏 key 没落盘，据 kind 给诚实文案。
        setError(describeSaveError(err))
      })
      .finally(() => setBusy(false))
  }, [keyDraft, t, describeSaveError])

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
        // 走同一条诚实映射（也顺带剥掉 message 里的机读 kind 前缀，绝不把 [tikhub:…] 露给用户）。
        setError(describeSaveError(err))
      })
      .finally(() => setBusy(false))
  }, [describeSaveError])

  return (
    // 家在设置「模型」tab 的「数据源」区（ModelSettingsHome 已给了 SectionHeading + 区块间距），故这里 mt-0。
    <section className="flex flex-col gap-2" data-settings-section="tikhub-connector">
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
              <div className="flex flex-wrap gap-2">
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
                    'min-w-[10rem] flex-[1_1_10rem] h-8 rounded-nomi-sm border border-nomi-line bg-nomi-paper px-2.5',
                    'text-body-sm text-nomi-ink placeholder:text-nomi-ink-40 outline-none focus:border-nomi-accent',
                  )}
                />
                <DecisionBar
                  inline
                  cancelLabel={hasKey ? t('common.cancel') : undefined}
                  onCancel={() => setKeyEditing(false)}
                  cancelDisabled={busy}
                  primaryLabel={busy ? t('settings.ai.tikhub.verifying') : t('settings.ai.tikhub.save')}
                  onPrimary={handleSaveKey}
                  primaryDisabled={busy}
                />
              </div>
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

          {/* 线路（双域名全球化）：仅在已连接后出现——线路只有真用它时才有意义。 */}
          {hasKey ? <TikhubRouteRow /> : null}
        </div>
      </div>

      <p className="text-caption leading-relaxed text-nomi-ink-40">{t('settings.ai.tikhub.honestNote')}</p>
    </section>
  )
}
