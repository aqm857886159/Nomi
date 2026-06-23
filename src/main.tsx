import React from 'react'
import { createRoot } from 'react-dom/client'
import NomiRouterApp from './NomiRouterApp'
// 自托管品牌字体（本地优先：不依赖系统是否装 Inter/Fraunces，保证任意机器一致）。
// 变量字体族名为 'Inter Variable' / 'Fraunces Variable'，已在 nomi-tokens.css 字栈置首。
import '@fontsource-variable/inter/wght.css'
import '@fontsource-variable/fraunces/wght.css'
import './styles/index.css'
import { NomiAppProviders } from './NomiAppProviders'

// 浅色单一模式（设计系统原则：光模式）。预渲染钉死 color-scheme 属性，让 tailwind base 层的
// :root[data-mantine-color-scheme="light"] 选择器即刻命中，避免首帧无样式闪烁。
document.documentElement.setAttribute('data-mantine-color-scheme', 'light')

const container = document.getElementById('root')
if (!container) throw new Error('Root container not found')
const root = container ? createRoot(container) : null

root?.render(
  <React.StrictMode>
    <NomiAppProviders>
      <NomiRouterApp />
    </NomiAppProviders>
  </React.StrictMode>
)
