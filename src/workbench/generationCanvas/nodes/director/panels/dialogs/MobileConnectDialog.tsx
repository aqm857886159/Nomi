/**
 * [INPUT]: 依赖 react、react-i18next、../../../../../../design 的 DesignModal / WorkbenchButton、
 *          ../../../../../../vendor/tablerIcons、../../../../../../ui/toast、../../fields/SliderNumberField、
 *          ../../MobileCameraContext
 * [OUTPUT]: 对外提供 MobileConnectDialog：二维码（主进程 SVG）+ 复制链接 + 设备/延迟 + 三步指南 + 平移/升降速度 + 断开服务 ⇄ 重新开启
 * [POS]: director/panels/dialogs 的手机虚拟相机对话框（清单 §6 C5）：打开即起局域网桥；关掉对话框不停服务，点「断开」才停；
 *        服务关闭态不摆空二维码 / 空链接，只留一句状态 + 「重新开启」。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { DesignModal, WorkbenchButton } from '../../../../../../design'
import { toast } from '../../../../../../ui/toast'
import { IconCheck, IconCopy } from '../../../../../../vendor/tablerIcons'
import { useMobileCameraApi } from '../../MobileCameraContext'
import { SliderNumberField } from '../fields/SliderNumberField'

function preferredUrl(urls: string[]): string {
  return urls.find((url) => !url.includes('127.0.0.1') && !url.includes('localhost')) ?? urls[0] ?? ''
}

function hostLabel(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

const NO_URLS: string[] = []

export function MobileConnectDialog(): JSX.Element {
  const { t } = useTranslation()
  const mobile = useMobileCameraApi()
  const urls = mobile.status?.urls ?? NO_URLS
  const [activeUrl, setActiveUrl] = React.useState('')
  const [copied, setCopied] = React.useState(false)
  const selected = urls.includes(activeUrl) ? activeUrl : preferredUrl(urls)
  const qrSvg = selected ? mobile.status?.qrByUrl?.[selected] : undefined
  const devices = mobile.status?.devices ?? []
  const lanMissing = urls.length > 0 && urls.every((url) => url.includes('127.0.0.1') || url.includes('localhost'))
  const running = Boolean(mobile.status?.running)
  const idleText = mobile.starting ? t('director.camera.mobileStarting') : running ? t('director.camera.mobileWaiting') : t('director.camera.mobileStopped')

  React.useEffect(() => {
    setActiveUrl(preferredUrl(urls))
  }, [urls])

  const copy = async () => {
    if (!selected) return
    try {
      await navigator.clipboard.writeText(selected)
      setCopied(true)
      toast(t('director.camera.mobileCopied'), 'success')
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      toast(t('director.camera.mobileCopyFailed'), 'error')
    }
  }

  return (
    <DesignModal
      opened={mobile.dialogOpen}
      onClose={() => mobile.setDialogOpen(false)}
      title={t('director.camera.mobileTitle')}
      size="md"
      centered
    >
      <div className="flex flex-col gap-3" data-nomi-escape-layer="director-mobile-dialog" data-testid="director-mobile-dialog">
        {!mobile.available ? (
          <p className="text-caption text-nomi-ink-60">{t('director.camera.mobileNeedDesktop')}</p>
        ) : (
          <>
            <ol className="list-decimal space-y-1 pl-4 text-caption text-nomi-ink-80">
              <li>{t('director.camera.mobileStep1')}</li>
              <li>{t('director.camera.mobileStep2')}</li>
              <li>{t('director.camera.mobileStep3')}</li>
            </ol>
            {lanMissing ? <p className="text-caption text-nomi-warning">{t('director.camera.mobileNoLan')}</p> : null}
            <div className="flex flex-wrap items-start gap-3">
              <div className="relative flex size-48 items-center justify-center overflow-hidden rounded-nomi border border-nomi-line bg-nomi-paper p-2" aria-label={t('director.camera.mobileQrAlt')}>
                {qrSvg ? (
                  <div className="size-full [&>svg]:size-full" dangerouslySetInnerHTML={{ __html: qrSvg }} />
                ) : (
                  <span className="text-center text-caption text-nomi-ink-40">{idleText}</span>
                )}
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                {urls.length > 1 ? (
                  <div className="flex flex-wrap gap-1">
                    {urls.map((url) => (
                      <WorkbenchButton key={url} size="sm" variant={url === selected ? 'primary' : 'default'} onClick={() => setActiveUrl(url)}>
                        {hostLabel(url)}
                      </WorkbenchButton>
                    ))}
                  </div>
                ) : null}
                {selected ? (
                  <>
                    <code className="break-all rounded-nomi border border-nomi-line bg-nomi-bg px-2 py-1 font-nomi-mono text-micro text-nomi-ink">{selected}</code>
                    <WorkbenchButton size="sm" onClick={() => void copy()}>
                      {copied ? <IconCheck size={14} stroke={1.5} /> : <IconCopy size={14} stroke={1.5} />}
                      {copied ? t('director.camera.mobileCopied') : t('director.camera.mobileCopy')}
                    </WorkbenchButton>
                  </>
                ) : null}
                {!running ? null : devices.length === 0 ? (
                  <p className="text-caption text-nomi-ink-40">{t('director.camera.mobileWaiting')}</p>
                ) : (
                  <ul className="space-y-1 text-caption text-nomi-ink">
                    {devices.map((device) => (
                      <li key={device.id}>
                        {t('director.camera.mobileDevice', {
                          name: device.name,
                          latency: device.latencyMs == null ? t('director.camera.mobileLatencyPending') : t('director.camera.mobileLatency', { ms: Math.round(device.latencyMs) }),
                        })}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
            <SliderNumberField
              label={t('director.camera.mobileMoveSpeed')}
              value={mobile.speeds.moveMetersPerSecond}
              min={0.2}
              max={8}
              step={0.1}
              unit="m/s"
              digits={1}
              onChange={(value) => mobile.setSpeeds({ ...mobile.speeds, moveMetersPerSecond: value })}
            />
            <SliderNumberField
              label={t('director.camera.mobileElevationSpeed')}
              value={mobile.speeds.elevationMetersPerSecond}
              min={0.2}
              max={6}
              step={0.1}
              unit="m/s"
              digits={1}
              onChange={(value) => mobile.setSpeeds({ ...mobile.speeds, elevationMetersPerSecond: value })}
            />
            <div className="flex justify-end">
              {running ? (
                <WorkbenchButton size="sm" onClick={() => void mobile.stop()}>
                  {t('director.camera.mobileDisconnect')}
                </WorkbenchButton>
              ) : (
                <WorkbenchButton size="sm" variant="primary" disabled={mobile.starting} onClick={() => void mobile.start()}>
                  {t('director.camera.mobileRestart')}
                </WorkbenchButton>
              )}
            </div>
          </>
        )}
      </div>
    </DesignModal>
  )
}
