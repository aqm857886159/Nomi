// 外壳骨架（10-08 外壳拍板稿）：Mantine AppShell（static 模式 = 网格布局，不用 fixed 定位）——Header 40 / Navbar 60 / Main。
// 外壳底色（--nomi-chrome）包住顶栏、左栏和工作面四周；内容是浮在上面的圆角工作面（各工作区自己画），
// 工作面离右 / 下缘 8px，左栏收起或没有左栏（项目库）时离左缘也 8px。层次靠底色，不靠分割线。
// Agent 的停靠不用 AppShell.Aside：停靠栏住在各工作区自己的网格里（生成 / 预览页时间轴横贯 Agent 下方，09-14 用户拍板；
// 10-08 C4 裁决）。视觉一律 Nomi token className，不吃 Mantine 默认的颜色与间距。
import React, { type JSX } from 'react'
import { AppShell } from '@mantine/core'
import { NomiColorSchemeContext } from '../../../theme/colorScheme'
import { SHELL_GUTTER, SHELL_RAIL_WIDTH, SHELL_TOPBAR_HEIGHT, shellChromePlatform } from '../shellGeometry'

/** canvas 把任意 CSS 颜色（含 oklch）落成 #rrggbb——Electron 的 titleBarOverlay 只认 hex。 */
function cssColorToHex(color: string): string | null {
  const canvas = document.createElement('canvas')
  canvas.width = 1
  canvas.height = 1
  const context = canvas.getContext('2d')
  if (!context) return null
  context.fillStyle = color
  context.fillRect(0, 0, 1, 1)
  const [r, g, b] = context.getImageData(0, 0, 1, 1).data
  return `#${[r, g, b].map((value) => (value ?? 0).toString(16).padStart(2, '0')).join('')}`
}

/** Windows 原生窗口按钮的底色 / 符号色跟着 App 光暗走（外壳底色 + 主墨色）。 */
function useWindowControlsColors(): void {
  const scheme = React.useContext(NomiColorSchemeContext)
  const isDark = scheme?.isDark ?? false
  React.useEffect(() => {
    if (shellChromePlatform() !== 'win') return
    const setOverlay = window.nomiDesktop?.window?.setTitleBarOverlay
    if (!setOverlay) return
    // 等这一帧主题属性落到 <html> 上再读 token。
    const frame = window.requestAnimationFrame(() => {
      const styles = getComputedStyle(document.documentElement)
      const color = cssColorToHex(styles.getPropertyValue('--nomi-chrome').trim())
      const symbolColor = cssColorToHex(styles.getPropertyValue('--nomi-ink').trim())
      if (color && symbolColor) void setOverlay({ color, symbolColor }).catch(() => undefined)
    })
    return () => window.cancelAnimationFrame(frame)
  }, [isDark])
}

export function ShellFrame({ topBar, rail, children }: {
  topBar: React.ReactNode
  /** 不给（项目库）或左栏收起 = 没有 Navbar，工作面左边也留 8px 外壳底色。 */
  rail?: React.ReactNode
  children: React.ReactNode
}): JSX.Element {
  useWindowControlsColors()
  const hasRail = Boolean(rail)
  return (
    <AppShell
      mode="static"
      header={{ height: SHELL_TOPBAR_HEIGHT }}
      // breakpoint 不能写 0：Mantine 的 static 模式只在 breakpoint 为真时才给 Navbar / Main 排网格列（assign-navbar-variables），
      // 写 0 = 左栏退回 fixed 浮在工作面上、工作面从 x=0 起画（10-08 首轮截图实测）。App 最小宽远大于 xs(576px)。
      navbar={{ width: SHELL_RAIL_WIDTH, breakpoint: 'xs', collapsed: { desktop: !hasRail, mobile: !hasRail } }}
      withBorder={false}
      padding={0}
      className="h-full overflow-hidden bg-nomi-chrome text-nomi-ink"
      data-shell-frame
    >
      <AppShell.Header className="bg-nomi-chrome">{topBar}</AppShell.Header>
      {hasRail ? <AppShell.Navbar className="bg-nomi-chrome">{rail}</AppShell.Navbar> : null}
      <AppShell.Main
        className="relative flex min-h-0 min-w-0 overflow-hidden bg-nomi-chrome"
        style={{ paddingRight: SHELL_GUTTER, paddingBottom: SHELL_GUTTER, paddingLeft: hasRail ? 0 : SHELL_GUTTER }}
        data-shell-main
      >
        {children}
      </AppShell.Main>
    </AppShell>
  )
}
