/**
 * 「从报错卡跳进自定义调用编辑器」的一次性意图传递。
 * 报错卡先 set 再 dispatch `nomi-open-model-catalog`；设置控制器负责打开「模型」tab，
 * OnboardingDrawer 挂载/事件时 consume 并直接弹编辑器（无需展开对应卡——编辑器是全局弹窗）。
 * 用模块级单值而非事件 detail：模型页可能在事件之后才挂载（首开竞态），单值可被晚到者消费。
 */
export type CustomCallIntent = { vendorKey: string; modelKey: string }

let pending: CustomCallIntent | null = null

export function setPendingCustomCallIntent(intent: CustomCallIntent): void {
  pending = intent
}

export function hasPendingCustomCallIntent(): boolean {
  return pending !== null
}

export function consumePendingCustomCallIntent(): CustomCallIntent | null {
  const value = pending
  pending = null
  return value
}

/** AI 生成脚本兜底剥 ``` 围栏（指令已要求裸函数体，这里兜没听话的）。放这里而非组件文件：
 *  纯函数、可单测，且不破坏 CustomCallEditor 的 fast-refresh（react-refresh/only-export-components）。 */
export function stripCodeFences(text: string): string {
  const trimmed = text.trim()
  const fenced = trimmed.match(/^```[a-zA-Z]*\n([\s\S]*?)\n?```$/)
  return (fenced ? fenced[1] : trimmed).trim()
}
