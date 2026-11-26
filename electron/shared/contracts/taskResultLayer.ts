// 图层分离一层的通用描述：主进程 `readTaskLayers`（electron/tasks/taskLayerReading.ts）读出、随 TaskResult.assets
// 按下标平行送到渲染层；渲染层只认它，不读供应商原始响应（设计卡 docs/plan/2026-11-26-layer-split.md）。

/** `box` 是底图像素坐标 [左, 上, 右, 下]；没有框 = 铺满底图（底图本身）。 */
export type TaskResultLayer = {
  zIndex: number
  name?: string
  text?: string
  box?: { left: number; top: number; right: number; bottom: number }
}
