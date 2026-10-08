// 新外壳的骨架：Mantine AppShell（static 模式 = 网格布局，不用 fixed 定位）—— Header 40 / Navbar 60 / Main。
// Agent 的停靠不用 AppShell.Aside：停靠栏住在各工作区自己的网格里（生成页时间轴要横贯 Agent 下方，
// 09-14 用户拍板；预览页的面板组由 react-resizable-panels 管），换成 Aside 会把这两条拍板拆掉（设计卡冲突清单 C4）。
// 视觉一律用 Nomi token 的 className，不吃 Mantine 默认的颜色与间距。
import React, { type JSX } from 'react'
import { AppShell } from '@mantine/core'
import { SHELL_RAIL_WIDTH, SHELL_TOPBAR_HEIGHT } from '../shellSpaceSpecimen'

export function ShellFrame({ topBar, rail, children }: { topBar: React.ReactNode; rail: React.ReactNode; children: React.ReactNode }): JSX.Element {
  return (
    <AppShell
      mode="static"
      header={{ height: SHELL_TOPBAR_HEIGHT }}
      navbar={{ width: SHELL_RAIL_WIDTH, breakpoint: 'xs' }}
      withBorder={false}
      padding={0}
      className="h-full overflow-hidden bg-nomi-bg text-nomi-ink"
      data-shell-frame
    >
      <AppShell.Header className="bg-transparent">{topBar}</AppShell.Header>
      <AppShell.Navbar className="bg-transparent">{rail}</AppShell.Navbar>
      <AppShell.Main className="relative flex min-h-0 min-w-0 overflow-hidden">{children}</AppShell.Main>
    </AppShell>
  )
}
