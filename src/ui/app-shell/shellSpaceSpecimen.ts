// 样张专用开关（design/shell-space，2026-10-08 外壳重设计，设计卡 docs/plan/2026-10-08-shell-redesign.md）：
//   ① 全 App 一条 40px 顶栏（窗口栏与应用栏合一，项目库同一条）；② 60px 左栏 + 浮在内容上的抽屉；
//   ③ Agent 三形态（小球 / 浮窗 / 停靠），每页记住自己的形态；④ 列表松绑 + 点卡 = 大详情。
// 生产没有任何代码写这个键，所以恒为 false、现役行为不变。样张分支不合入；
// 实现线落地时删掉本文件和所有 `SHELL_SPACE_SPECIMEN` 分支，新外壳成为唯一形态（P1：不留两套）。
//
// 取值：'1' = 按真实平台画窗口按钮位；'mac' = 按 macOS 画（红绿灯在最左）；'win' = 按 Windows 画。
// 窗口按钮在样张里只是**占位**（生产主进程还没开 titleBarOverlay / hiddenInset）。
const KEY = 'nomi:specimen:shell-space'

function read(): string | null {
  try {
    return window.localStorage.getItem(KEY)
  } catch {
    return null
  }
}

const value = typeof window === 'undefined' ? null : read()

/** 外壳重设计样张是否开着。 */
export const SHELL_SPACE_SPECIMEN = value === '1' || value === 'mac' || value === 'win'

/** 样张按哪个平台画窗口按钮占位（只影响外壳的占位与让位，不影响任何业务分流）。 */
export const SHELL_SPACE_CHROME_PLATFORM: 'mac' | 'win' = value === 'mac'
  ? 'mac'
  : value === 'win'
    ? 'win'
    : typeof window !== 'undefined' && window.nomiDesktop?.platform === 'darwin' ? 'mac' : 'win'

/** 新外壳的几何（单一来源：顶栏高、左栏宽、抽屉宽）。 */
export const SHELL_TOPBAR_HEIGHT = 40
export const SHELL_RAIL_WIDTH = 60
export const SHELL_DRAWER_WIDTH = 300
export const SHELL_ASSET_DRAWER_WIDTH = 500
/** Windows 原生窗口按钮（titleBarOverlay）三颗 46px 的让位；macOS 红绿灯（hiddenInset）的让位。 */
export const SHELL_WIN_CONTROLS_WIDTH = 138
export const SHELL_MAC_TRAFFIC_WIDTH = 76
