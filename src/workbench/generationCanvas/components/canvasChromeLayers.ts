// 画布外框控件（加节点条、缩放簇）和节点生成框的层级值——收在一处。
// 待并入画布层级表（I-groupheader 线在建，那张表合入后这里的数字改成引用它，本文件删掉）。
//
// 先说一条容易看错的事实：数字不能单独决定谁盖谁。React Flow 的视口（transform）和渲染层（z-4）各是一个层叠上下文，
// 生成框（节点的子元素）被关在里面，对外只有「渲染层」这一个层级；加节点条 / 缩放簇是舞台的直接子元素。
// 所以生成框无论写多大，都盖不过比渲染层高的外框控件——这里的数字只管外框控件之间、以及外框控件对渲染层的关系。
// 「生成框永远在外框控件之上」靠另一条：useCanvasChromeOcclusion 把外框控件被生成框压住的那一块裁掉（命中也一起没了），
// 效果与「生成框层级更高」逐像素一致，不需要把生成框搬出画布。
export const CANVAS_CHROME_LAYERS = {
  /** React Flow 渲染层（视口 + 节点 + 生成框都在里面）：xyflow 自带 style.css 的 .react-flow__renderer。 */
  flowRenderer: 4,
  /** 选中的节点（BaseGenerationNode 的 data-[selected=true]:z-[5] / generationCanvasReactFlow.css 的 .selected）。 */
  nodeSelected: 5,
  /** 节点生成框（NodeGenerationComposer，在节点里面，对外沿用节点所在的渲染层）。 */
  composer: 8,
  /** 加节点条、缩放簇：舞台直接子元素，压在渲染层之上，被生成框压住的部分由 useCanvasChromeOcclusion 裁掉。 */
  chromeDock: 8,
} as const

/** 生成框根节点的类名：占用检测靠它找生成框（NodeGenerationComposer / TextNodeComposer 的根都带它）。 */
export const COMPOSER_ROOT_SELECTOR = '.generation-canvas-v2-node__composer'
