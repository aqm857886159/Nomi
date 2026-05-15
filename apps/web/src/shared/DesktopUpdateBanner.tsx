import { useEffect, useState } from 'react'
import { onDesktopUpdateAvailable, onDesktopUpdateReady, installDesktopUpdate, isDesktop } from './desktop'

export function DesktopUpdateBanner() {
  const [updateAvailable, setUpdateAvailable] = useState(false)
  const [updateReady, setUpdateReady] = useState(false)
  const [installing, setInstalling] = useState(false)

  useEffect(() => {
    if (!isDesktop) return
    onDesktopUpdateAvailable(() => setUpdateAvailable(true))
    onDesktopUpdateReady(() => setUpdateReady(true))
  }, [])

  if (!isDesktop || (!updateAvailable && !updateReady)) return null

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      zIndex: 9999,
      background: updateReady ? '#2563eb' : '#475569',
      color: '#fff',
      padding: '8px 16px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      fontSize: 14,
    }}>
      <span>
        {updateReady ? '新版本已下载完成，重启即可更新。' : '发现新版本，正在后台下载...'}
      </span>
      {updateReady && (
        <button
          onClick={async () => {
            setInstalling(true)
            await installDesktopUpdate()
          }}
          disabled={installing}
          style={{
            background: 'rgba(255,255,255,0.2)',
            border: 'none',
            color: '#fff',
            padding: '4px 12px',
            borderRadius: 4,
            cursor: installing ? 'not-allowed' : 'pointer',
            fontSize: 13,
          }}
        >
          {installing ? '重启中...' : '立即重启安装'}
        </button>
      )}
    </div>
  )
}
