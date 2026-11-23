import { nodeHasGenerationComposer } from './resolveRenderKind'
import { NODE_COMPOSER_GAP, NODE_COMPOSER_WIDTH, TEXT_COMPOSER_GAP, TEXT_COMPOSER_MAX_WIDTH, TEXT_COMPOSER_MIN_WIDTH } from './nodeSizing'

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
export function composerCanvasPlacement(
  visualSize: { width: number; height: number },
  zoom: number,
  /** 'match-node'：文本节点的加工框——和节点同宽（屏幕宽，夹在上下限里）、紧贴在下面（间距 8）。 */
  variant: 'standard' | 'match-node' = 'standard',
): {
  left: number
  top: number
  width: number
  transform: string
  transformOrigin: 'top left'
} {
  const safeZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1
  if (variant === 'match-node') {
    return {
      left: visualSize.width / 2,
      top: visualSize.height + TEXT_COMPOSER_GAP,
      width: Math.min(TEXT_COMPOSER_MAX_WIDTH, Math.max(TEXT_COMPOSER_MIN_WIDTH, visualSize.width * safeZoom)),
      transform: `scale(${1 / safeZoom}) translateX(-50%)`,
      transformOrigin: 'top left',
    }
  }
  return {
    left: visualSize.width / 2,
    top: visualSize.height + NODE_COMPOSER_GAP,
    width: NODE_COMPOSER_WIDTH,
    transform: `scale(${1 / safeZoom}) translateX(-50%)`,
    transformOrigin: 'top left',
  }
}

/**
 * 画布生成浮框的高度上限（屏幕像素）——对焦预留用；卡片自己的 maxHeight 在 NodeGenerationComposer.tsx 的
 * `composerMaxHeight`，两边的数由 composerCanvasPlacement.test.ts 逐 kind 对账（NodeGenerationComposer 是 14 天热点文件，
 * 这次不动它，热点解除后把那份并到这里）。
 */
function composerMaxHeight(kind: string): number {
  return kind === 'video' ? 460 : 400
}

/** 文本加工框（预设 + 一句话）的最坏高度，屏幕像素。 */
const TEXT_COMPOSER_FOCUS_HEIGHT = 160

/** 对焦要给选中后出现的生成框留多大地方：没有生成框的 kind 返回 null。 */
export function composerFocusFootprint(kind: string): { gap: number; height: number } | null {
  if (!nodeHasGenerationComposer(kind)) return null
  return kind === 'text'
    ? { gap: TEXT_COMPOSER_GAP, height: TEXT_COMPOSER_FOCUS_HEIGHT }
    : { gap: NODE_COMPOSER_GAP, height: composerMaxHeight(kind) }
}

/**
 * 文本加工框 / 其余底栏「刚新建那一刻」的真实高度上限，屏幕像素（走查 `new-node-composer-in-view` 真量：图片、视频底栏 214，
 * 文本加工框 172；这里各多留不超过 24，两头由走查断言，数悄悄漂了就红）。
 */
const COMPOSER_INITIAL_HEIGHT = 220
const TEXT_COMPOSER_INITIAL_HEIGHT = 176

/**
 * 新建落点要给底栏留多大地方：只留它刚建出来那一刻的高度，不留最坏高度——最坏高度（上面 `composerFocusFootprint`，对焦用）
 * 让几乎所有窗口里新节点被提到舞台顶、标题小标签被切、小工具条压在节点上；底栏后来被撑高时被挡就挡（2026-09-25 用户拍板的位置规矩）。
 * 没有生成框的 kind 返回 null。
 */
export function composerInitialFootprint(kind: string): { gap: number; height: number } | null {
  if (!nodeHasGenerationComposer(kind)) return null
  return kind === 'text'
    ? { gap: TEXT_COMPOSER_GAP, height: TEXT_COMPOSER_INITIAL_HEIGHT }
    : { gap: NODE_COMPOSER_GAP, height: COMPOSER_INITIAL_HEIGHT }
}
