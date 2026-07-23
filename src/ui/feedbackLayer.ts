/**
 * 全局反馈层（toast / notifications）z-index。
 * 不变量：反馈层必须是全 App 最顶层——任何全屏浮层（3D 全屏编辑器、库面板、灯箱等）
 * 都不得高于它，否则浮层打开期间 toast 全部渲染在浮层底下、肉眼不可见
 * （2026-07-24 全景图导入「点了没反应」的根因之一）。结构保证见 feedbackLayer.test.ts。
 */
export const FEEDBACK_LAYER_Z_INDEX = 2147483647
