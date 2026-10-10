// 外壳几何的单一来源（10-08 外壳重设计，设计卡 docs/plan/2026-10-08-shell-redesign.md）。
// 一条 40px 顶栏（应用栏与窗口栏合一）+ 60px 左栏 + 外壳底色包住的圆角工作面。
// 谁要让开顶栏、谁要知道左栏多宽、抽屉多宽，都从这里读，不许各处自己写数。

/** 顶栏高：与主进程 titleBarOverlay 的高度同值（electron/mainWindowChrome.ts TITLE_BAR_HEIGHT）。 */
export const SHELL_TOPBAR_HEIGHT = 40
export const SHELL_RAIL_WIDTH = 60
/** 工作面离窗口右缘 / 下缘、工作面之间的缝。 */
export const SHELL_GUTTER = 8
/** 抽屉默认宽（文稿 / 目录 / 流程 / Skill / 提示词）与素材抽屉默认宽；用户可拖宽，见 ShellRail。 */
export const SHELL_DRAWER_WIDTH = 280
export const SHELL_ASSET_DRAWER_WIDTH = 440
/** macOS 红绿灯（hiddenInset）让位。Windows 的让位读 CSS env(titlebar-area-*)，不写死。 */
export const SHELL_MAC_TRAFFIC_WIDTH = 76

export type ShellChromePlatform = 'win' | 'mac' | 'other'

export function shellChromePlatform(): ShellChromePlatform {
  const platform = typeof window === 'undefined' ? undefined : window.nomiDesktop?.platform
  return platform === 'win32' ? 'win' : platform === 'darwin' ? 'mac' : 'other'
}
