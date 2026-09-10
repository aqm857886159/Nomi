/**
 * [INPUT]: 无依赖
 * [OUTPUT]: 对外提供 FULLSCREEN_Z_INDEX
 * [POS]: nodes/ 下全屏编辑器（导演台 / 画板）共用的层级常量（原 V1 scene3dConstants，切换门入籍）：
 *        需盖过工作台常规 UI（≤2000），但必须低于全局模态层（3400+：付费确认 3500、库面板 4000、灯箱 4200）
 *        与反馈层（src/ui/feedbackLayer.ts）——曾设 int32 最大值，导致编辑器打开期间 toast / 付费确认全被压在底下。
 *        不变量测试见 src/ui/feedbackLayer.test.ts。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
export const FULLSCREEN_Z_INDEX = 3000
