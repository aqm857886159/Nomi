/**
 * 节点内任何可滚动/可编辑区域（提示词框、参数列表、版本堆、参考区……）都必须带这三个 class，
 * 否则鼠标滚轮会被 React Flow 的画布缩放吃掉——用户在框里滚，画布跟着缩放/平移（R28：防线建在
 * 最早能拦住的那层）。
 *
 * 根因不是「忘了 stopPropagation」：d3-zoom 的 wheel 监听器直接挂在 `.react-flow__pane`
 * 这个 DOM 节点上（原生 addEventListener），而 React 的合成事件是在应用根节点上统一分发的。
 * 冒泡顺序是「先到最近的原生监听器，后到 React 根」——所以节点内 onWheel 里调
 * `event.stopPropagation()` 触发的时候，pane 上那个更靠近事件源的监听器早就已经缩放完了；
 * stopPropagation 拦的是「事件到达 React 根之后」的传播，拦不住「事件到达 pane 原生监听器」
 * 这一步。真正生效的机制是 React Flow 自己的 `noWheelClassName`（默认 class 名
 * `nowheel`）：d3-zoom 的监听器在处理 wheel 事件前，先对**事件真实 target**做
 * `closest('.nowheel')`，命中就直接跳过缩放——这一步不依赖冒泡顺序，在源头就短路。
 * （见 docs/plan/2026-09-11 node-wheel 调研；@xyflow/react 12.11.5 default:
 * noWheelClassName='nowheel', noDragClassName='nodrag'。）
 *
 * 三个 class 各管一件事，同时贴、不必单独判断要不要某一个：
 * - `nowheel`（React Flow 默认 noWheelClassName）——挡住 wheel 缩放/平移。
 * - `nodrag`（React Flow 默认 noDragClassName）——挡住在这块区域按下拖出节点位移。
 * - `generation-canvas-react-flow__no-pan`——本画布把 `noPanClassName` 从默认 `nopan`
 *   改成了这个自定义名字（见 GenerationCanvasReactFlowViewport.tsx），所以必须用这个字面量，
 *   贴默认的 `nopan` 在本画布里没有任何效果。
 *
 * 新增任何节点内滚动区/可编辑区，用这个常量而不是各写各的字符串——
 * `nodeInnerScrollNoWheel.test.ts` 会扫 `nodes/**` 下的 overflow-auto/textarea，
 * 没贴（且不在该测试的豁免名单里）就红。
 */
export const NODE_SCROLL_REGION_CLASS_NAME = 'nowheel nodrag generation-canvas-react-flow__no-pan'
