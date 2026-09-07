import React from 'react'
import { createRoot } from 'react-dom/client'
import NomiRouterApp from './NomiRouterApp'
import { BrowserAssetOverlayApp } from './ui/browser/overlay/BrowserAssetOverlayApp'
// 自托管品牌字体（本地优先：不依赖系统是否装 Inter/Fraunces，保证任意机器一致）。
// 变量字体族名为 'Inter Variable' / 'Fraunces Variable'，已在 nomi-tokens.css 字栈置首。
import '@fontsource-variable/inter/wght.css'
import '@fontsource-variable/fraunces/wght.css'
// Mantine 的组件样式是独立 CSS，必须显式导入——toast 三合一迁 @mantine/notifications 时漏了这步，
// 容器没有 position:fixed/z-index，全 App toast 一度渲染在页面流底部肉眼不可见（v0.16.7~v0.17.0）。
// 这里只保留 `@mantine/notifications`：它是**独立包**，不在 core 整包 CSS 里。
//
// 2026-09-08：**不要**在这里 import `@mantine/core/styles/<组件>.css` 单份样式。
// core 整包 `@mantine/core/styles.css` 已由 `scripts/build-tailwind.mjs:42-47` 拼进
// `public/tailwind.generated.css`；index.html 先 link 它，Vite 再把这里 import 的 CSS 注在后面
// ——两者特指度同为 (0,1,0)，**后来者赢**。此前重复引了 UnstyledButton/CloseButton/Notification
// 三份（内容 100% 已在整包内），于是 `.m_87cf2631{background:transparent;border:0}` 盖掉了
// Pagination 控件的底色与边框，当前页选中态整个看不见（实验室基线里那排按钮连边框都没有，
// 就是这个指纹）。真要单份样式，先确认它**不在**整包里。
import '@mantine/notifications/styles.css'
import './styles/index.css'
import { NomiAppProviders } from './NomiAppProviders'
import { NomiColorSchemeProvider } from './theme/NomiColorSchemeProvider'
import { primeNomiColorScheme } from './theme/colorScheme'

// 预渲染钉死 color-scheme 属性（未手动选过时按本地时间「天黑自动暗」、之后用户存储），让
// tailwind base 层的 [data-mantine-color-scheme="dark|light"] 选择器即刻命中，避免首帧主题闪烁。
primeNomiColorScheme()

const container = document.getElementById('root')
if (!container) throw new Error('Root container not found')
const root = container ? createRoot(container) : null
const browserAssetOverlay = new URL(window.location.href).searchParams.get('nomiOverlay') === 'browserAsset'
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
