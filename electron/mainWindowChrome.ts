// 主窗口的系统 chrome（10-08 外壳重设计，设计卡 docs/plan/2026-10-08-shell-redesign.md）。
//
// 一条 40px 顶栏同时是应用栏和窗口栏：
//   - Windows：系统原生的最小化 / 最大化 / 关闭三颗（Electron `titleBarOverlay`），颜色随 App 光暗切换；
//     渲染层只让位（CSS `env(titlebar-area-*)`），不再自绘按钮。双击拖动区最大化、Snap 布局交给系统。
//   - macOS：`hiddenInset` + `trafficLightPosition`，红绿灯落在 40px 栏的竖直中线，品牌往右让 76px。
//   - Linux：保留原生窗口框（零回归）。
// 颜色从渲染层来：App 的光 / 暗由渲染层的 provider 决定（按时间自动暗、用户显式选择），主进程没有这份事实。
import { BrowserWindow, ipcMain, type BrowserWindowConstructorOptions } from "electron";
import { assertTrustedUiSender } from "./ipcSenderGuard";

export const TITLE_BAR_HEIGHT = 40;
/** 首帧（渲染层报颜色之前）的浅色外壳底与字色，与 tailwind 的 --nomi-chrome / --nomi-ink 浅色档一致。 */
const INITIAL_OVERLAY = { color: "#f5f4f2", symbolColor: "#2b2925" } as const;

export function mainWindowChromeOptions(platform: NodeJS.Platform): BrowserWindowConstructorOptions {
  if (platform === "win32") {
    return {
      titleBarStyle: "hidden",
      titleBarOverlay: { ...INITIAL_OVERLAY, height: TITLE_BAR_HEIGHT },
    };
  }
  if (platform === "darwin") {
    // 红绿灯 12px：y = (40 − 12) / 2 = 14；x 与顶栏左内边距对齐。
    return { titleBarStyle: "hiddenInset", trafficLightPosition: { x: 14, y: 14 } };
  }
  return {};
}

const HEX = /^#[0-9a-f]{6}$/i;

/** 渲染层主题变了 → 更新 Windows 原生窗口按钮的底色与符号色（只认 #rrggbb）。 */
export function registerMainWindowChromeIpc(): void {
  ipcMain.handle("nomi:window:set-titlebar-overlay", (event, input: unknown) => {
    assertTrustedUiSender(event);
    if (process.platform !== "win32") return;
    const value = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
    const color = typeof value.color === "string" && HEX.test(value.color) ? value.color : null;
    const symbolColor = typeof value.symbolColor === "string" && HEX.test(value.symbolColor) ? value.symbolColor : null;
    if (!color || !symbolColor) return;
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window || window.isDestroyed()) return;
    window.setTitleBarOverlay({ color, symbolColor, height: TITLE_BAR_HEIGHT });
  });
}
