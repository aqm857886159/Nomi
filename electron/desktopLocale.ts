// 桌面 locale 的纯归一逻辑（零 electron / 零 node-API 顶层导入）。
//
// **为什么必须保持 electron-free**：打包后的裸 Node MCP launcher（mcpNodeLauncher，ELECTRON_RUN_AS_NODE=1）
// 会 require 到它——那个运行时里 app.asar 内没有 electron 模块，任何顶层 `require('electron')` 都会
// MODULE_NOT_FOUND、当场打死整条 MCP 客户端。历史上该函数住在 electron/i18n.ts（顶层 `import { app } from
// 'electron'`），T4 让 launcher 引它就破了「launcher 闭包 electron-free」这条不变量（2026-08-18 ship 事故）。
// 因此把这份纯逻辑单拎出来：i18n.ts 与 launcher 都从这里取，i18n 只是再导出保持公开面稳定。
// 这条 electron-free 由 mcpLauncherClosure.test.ts 结构钉死——别往本文件加任何 electron/node 顶层导入。

export type DesktopLocale = 'zh-CN' | 'en'

/**
 * 归一任意 locale 值 → 桌面双语枚举（en / zh-CN）。单一真相源：setDesktopLocale 与 MCP 传输取语言都用它。
 *
 * 判据是「**是不是中文**」，不是「是不是英文」：
 *   · 中文系统（zh-*）      → zh-CN
 *   · 其它任何可读语言      → en（英文是我们唯一的另一支持语言，也是国际通用兜底）
 *   · 读不到 / 空 / 非字符串 → zh-CN（无信号，回落 App 默认 DEFAULT_LOCALE）
 *
 * 为什么改（2026-08-28 用户在土耳其语 Windows 上实测）：旧判据是「非 en → zh-CN」，于是
 * `tr-TR`/`de-DE` 这类既不是英文也不是中文的系统，在主进程被判成中文，而渲染层用的是反过来的
 * 判据（非 zh → en）判成英文。同一台机器上界面是英文、主进程以为是中文，Agent 因此被要求用中文作答。
 * 两侧现在同一判据，由 localeNormalize.equivalence.test.ts 逐项钉死，不能再各写各的。
 */
export function normalizeDesktopLocale(value: unknown): DesktopLocale {
  if (typeof value !== 'string') return 'zh-CN'
  const raw = value.trim().toLowerCase()
  if (!raw) return 'zh-CN'
  return raw.startsWith('zh') ? 'zh-CN' : 'en'
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
