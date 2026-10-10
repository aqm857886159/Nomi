import { walkDesignLabScreen } from './design-lab/walkScreen.mjs'
// 每种节点那三格是整列（2700 高）：视口给到整格高，列表的虚拟化才会把所有行都挂上。
await walkDesignLabScreen({ screen: 'generation-list', title: '生成页 · 列表视图', role: 'walk-generation-list', cellWidth: 1440, columns: 1, viewport: { width: 1440, height: 2300 } })
