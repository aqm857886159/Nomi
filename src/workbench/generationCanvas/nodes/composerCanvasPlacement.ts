import { NODE_COMPOSER_GAP, NODE_COMPOSER_WIDTH } from './nodeSizing'

/**
 * 画布生成浮框的位置——**唯一 owner**。
 *
 * 不变量（2026-09-25 用户拍板「钉在节点正下方、宽度固定、被挡就挡」）：
 * 浮框的位置与宽度**只**是「节点画布尺寸 + 画布缩放」的函数。签名里没有视口、没有停靠区、没有别的节点，
 * 所以它在结构上就不可能去躲任何东西、不可能被别的布局变化带着漂——以前那套每帧量矩形的放置层
 * （clamp / 翻转 / 让左缘工具条 / 让底部缩放条）就是「位置错位、长度忽长忽短」的来源，已整个删除。
 *
 * 坐标系：浮框是节点 DOM 的子元素，left/top 用节点内的画布单位；宽度是屏幕像素（反向缩放抵掉画布缩放）。
 * 变换顺序：先 translateX(-50%) 把自身中线挪到 left 上，再以左上角为原点 scale(1/zoom)——
 * 屏幕上的中线恰好落在节点中线，屏幕宽恒为 NODE_COMPOSER_WIDTH。
 */
export function composerCanvasPlacement(visualSize: { width: number; height: number }, zoom: number): {
  left: number
  top: number
  width: number
  transform: string
  transformOrigin: 'top left'
} {
  const safeZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1
  return {
    left: visualSize.width / 2,
    top: visualSize.height + NODE_COMPOSER_GAP,
    width: NODE_COMPOSER_WIDTH,
    transform: `scale(${1 / safeZoom}) translateX(-50%)`,
    transformOrigin: 'top left',
  }
}
