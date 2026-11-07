// 外壳顶栏的层级从哪来（2026-10-27，开屏「跳过」被顶栏压住）。
//
// 实测：顶栏外层是 Mantine `AppShell.Header`，它的 z-index 来自 AppShell 的 `zIndex`（CSS 变量
// --app-shell-header-z-index），ShellFrame 不传就取 Mantine 默认 100——开屏手写 z-[60]，于是顶栏压在开屏上面。
// 现在顶栏层级只来自主题里 AppShell 的默认值（= 刻度地板 shellChrome）。这里按服务端渲染读真实输出：
//   · 渲染出的顶栏取 shellChrome；
//   · 阳性对照：把主题默认改成 7，顶栏跟着变 7——证明 ShellFrame 自己没偷偷传一份（传了就盖住主题接线）。
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MantineProvider } from '@mantine/core'
import { describe, expect, it } from 'vitest'
import { NOMI_OVERLAY_Z_INDEX } from '../../../design/overlayLayers'
import { buildNomiTheme } from '../../../theme/nomiTheme'
import { ShellFrame } from './ShellFrame'

function headerZIndexVar(theme: ReturnType<typeof buildNomiTheme>): string | null {
  const html = renderToStaticMarkup(
    <MantineProvider theme={theme}>
      <ShellFrame topBar={<span>bar</span>}>content</ShellFrame>
    </MantineProvider>,
  )
  return /--app-shell-header-z-index:\s*([^;"]+)/.exec(html)?.[1]?.trim() ?? null
}

describe('shell top bar layer comes from the overlay scale', () => {
  it('renders the AppShell header at the shellChrome tier', () => {
    expect(headerZIndexVar(buildNomiTheme())).toBe(String(NOMI_OVERLAY_Z_INDEX.shellChrome))
  })

  it('positive control: the header follows the theme default, so ShellFrame passes no zIndex of its own', () => {
    const theme = buildNomiTheme()
    const patched = { ...theme, components: { ...theme.components, AppShell: { defaultProps: { zIndex: 7 } } } }
    expect(headerZIndexVar(patched)).toBe('7')
  })
})
