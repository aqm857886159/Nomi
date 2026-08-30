// 桌面 locale 的纯归一逻辑（零 electron / 零 node-API 顶层导入）。
//
// **为什么必须保持 electron-free**：打包后的裸 Node MCP launcher（mcpNodeLauncher，ELECTRON_RUN_AS_NODE=1）
// 会 require 到它——那个运行时里 app.asar 内没有 electron 模块，任何顶层 `require('electron')` 都会
// MODULE_NOT_FOUND、当场打死整条 MCP 客户端。历史上该函数住在 electron/i18n.ts（顶层 `import { app } from
// 'electron'`），T4 让 launcher 引它就破了「launcher 闭包 electron-free」这条不变量（2026-08-18 ship 事故）。
// 因此把这份纯逻辑单拎出来：i18n.ts 与 launcher 都从这里取，i18n 只是再导出保持公开面稳定。
// 这条 electron-free 由 mcpLauncherClosure.test.ts 结构钉死——别往本文件加任何 electron/node 顶层导入。

export type DesktopLocale = 'zh-CN' | 'en'

/** 归一任意 locale 值 → 桌面双语枚举（en / zh-CN）。单一真相源：setDesktopLocale 与 MCP 传输取语言都用它。 */
export function normalizeDesktopLocale(value: unknown): DesktopLocale {
  return value === 'en' || (typeof value === 'string' && value.toLowerCase().startsWith('en')) ? 'en' : 'zh-CN'
}

// 当前 locale 的状态也住这里（同样零 electron）：主进程里除了 desktopT，还有别的 electron-free 模块
// 需要知道界面语言——判官 prompt 就是一例（reason 要按界面语言写）。若让它们去 import i18n.ts，就会
// 顺带把 `require('electron')` 拖进本不该碰 electron 的闭包，正是上面那条不变量要防的事。
// i18n.ts 继续再导出这两个函数，对既有消费者公开面不变（P1：只此一处定义）。
let currentLocale: DesktopLocale = 'zh-CN'

export function setDesktopLocale(value: unknown): void {
  currentLocale = normalizeDesktopLocale(value)
}

/** 当前桌面 locale（供 MCP 结果文案与判官 prompt 跟随 App/系统语言；GUI 路由渲染层语言开关同步）。 */
export function getDesktopLocale(): DesktopLocale {
  return currentLocale
}
