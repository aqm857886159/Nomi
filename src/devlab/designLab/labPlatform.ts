// 设计实验室 · 按屏钉死「窗口平台」（2026-10-08，D-update 样张起用）。
//
// 为什么要在**所有模块求值之前**做：NomiAppBar / WindowControls 在模块顶层读一次
// `window.nomiDesktop?.platform === 'win32'` 决定画不画 Windows 自绘窗口栏、品牌放哪。
// 格子渲染时再装桥已经晚了——那两个模块早按「不是 Windows」求值完，截出来是 Mac 版顶栏。
// 所以这个文件必须是 designLab.tsx 的**第一条 import**（ES 模块按 import 顺序求值）。
//
// 只对登记在这里的屏生效，别的屏照旧是无桥环境（它们的夹具各自装自己的假桥）。
// 这里只给 `platform` 一个字段；格子要的其余桥（项目列表等）由各屏夹具在渲染时补上。
const WIN32_SCREENS = new Set(['update-reminder'])

const screenId = new URL(window.location.href).searchParams.get('screen')
if (screenId && WIN32_SCREENS.has(screenId)) {
  const host = window as unknown as { nomiDesktop?: Record<string, unknown> }
  host.nomiDesktop = { ...(host.nomiDesktop ?? {}), platform: 'win32' }
}

export {}
