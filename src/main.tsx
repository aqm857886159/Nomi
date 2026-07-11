import React from 'react'
import { createRoot } from 'react-dom/client'
import NomiRouterApp from './NomiRouterApp'
import { BrowserAssetOverlayApp } from './ui/browser/overlay/BrowserAssetOverlayApp'
// 自托管品牌字体（本地优先：不依赖系统是否装 Inter/Fraunces，保证任意机器一致）。
// 变量字体族名为 'Inter Variable' / 'Fraunces Variable'，已在 nomi-tokens.css 字栈置首。
import '@fontsource-variable/inter/wght.css'
import '@fontsource-variable/fraunces/wght.css'
import './styles/index.css'
import { NomiAppProviders } from './NomiAppProviders'
import { NomiColorSchemeProvider } from './theme/NomiColorSchemeProvider'
import { primeNomiColorScheme } from './theme/colorScheme'
import { preloadRemoveBackground } from './lib/removeBackground'

// 预渲染钉死 color-scheme 属性（未手动选过时按本地时间「天黑自动暗」、之后用户存储），让
// tailwind base 层的 [data-mantine-color-scheme="dark|light"] 选择器即刻命中，避免首帧主题闪烁。
primeNomiColorScheme()

const container = document.getElementById('root')
if (!container) throw new Error('Root container not found')
const root = container ? createRoot(container) : null
const browserAssetOverlay = new URL(window.location.href).searchParams.get('nomiOverlay') === 'browserAsset'
if (!browserAssetOverlay) preloadRemoveBackground()
if (browserAssetOverlay) {
  document.documentElement.dataset.nomiOverlay = 'browserAsset'
  document.documentElement.style.background = 'transparent'
  document.documentElement.style.backgroundImage = 'none'
  document.body.style.background = 'transparent'
  document.body.style.backgroundImage = 'none'
  document.body.style.overflow = 'hidden'
  container.style.background = 'transparent'
  container.style.backgroundImage = 'none'
}

root?.render(
  <React.StrictMode>
    <NomiColorSchemeProvider>
      <NomiAppProviders>
        {browserAssetOverlay ? <BrowserAssetOverlayApp /> : <NomiRouterApp />}
      </NomiAppProviders>
    </NomiColorSchemeProvider>
  </React.StrictMode>
)
