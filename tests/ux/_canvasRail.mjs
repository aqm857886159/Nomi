// 加节点条的**共享点法**——现在只是 `_shell.mjs` 的 `addCanvasNode` 的旧名字（外壳重设计后它不再是「左缘竖排」，
// 是内容区底部正中的横排）。留着这个名字只为不改几十份走查的 import；新写的走查直接用 `_shell.mjs`。
//
// 立项根因（2026-09-06「第三档」）：收进「更多」的几种节点菜单没展开时根本不在 DOM 里，走查里的软守卫
// `if ((await x.count()) > 0) await x.click()` 遇上这种情况只会静默什么都不做——所以点加节点条只准走一个口，找不到就抛。
export { addCanvasNode as addCanvasNodeFromRail } from './_shell.mjs'
