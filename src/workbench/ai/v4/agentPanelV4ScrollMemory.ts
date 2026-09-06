// 「他读到哪儿了」的存放处（09-01 定稿 §11.2：点角标 = 原宽**原状态**还原）。
//
// 收起会把对话流那棵子树整个摘掉，`scrollTop` 跟着 DOM 一起没了；展开时若一律跟到底，
// 翻着历史顺手收起的人再点开就被弹回最新一条——收起于是成了一个会悄悄弄丢阅读位置的动作。
//
// 为什么住在模块里、不住在组件的 `useRef` 上：收起时**面板整棵子树换了个挂点**，
// 常驻壳自己也跟着重新挂载（portal 容器换人），组件里的 ref 一起归零——2026-09-06 真机走查
// 实测：ref 版本展开后 scrollTop 是 259.5（底），跟没存过一模一样。模块级的盒子活得比它久。
//
// 按**线程**分而不是按面分：位置属于那条对话。换项目、换线程都是另一条对话，各记各的；
// 切回来还能回到当时停的地方。上限 16 条，超了从最早的开始丢——这是个便利，不是要落盘的东西。

/** 停在哪儿（`top`），以及停的是不是底（`atBottom` → 还原时跟到**新的**底，不是回到旧的那个像素）。 */
export type V4FlowScrollMemory = { top: number; atBottom: boolean }

/** 和 `React.MutableRefObject` 同形，好让面板那侧不认识这个模块也能用。 */
export type V4FlowScrollMemoryBox = { current: V4FlowScrollMemory }

const MAX_REMEMBERED_THREADS = 16
const boxes = new Map<string, V4FlowScrollMemoryBox>()

/** 同一条线程永远拿到同一个盒子；没有线程（还没开对话）时也给一个，键是 `none`。 */
export function flowScrollMemoryFor(surface: string, threadId: string | null): V4FlowScrollMemoryBox {
  const key = `${surface}::${threadId ?? 'none'}`
  const existing = boxes.get(key)
  if (existing) {
    // 重新插一遍 = 把它挪到 Map 的末尾，淘汰时才淘汰真正最久没碰的那条。
    boxes.delete(key)
    boxes.set(key, existing)
    return existing
  }
  const created: V4FlowScrollMemoryBox = { current: { top: 0, atBottom: true } }
  boxes.set(key, created)
  while (boxes.size > MAX_REMEMBERED_THREADS) {
    const oldest = boxes.keys().next()
    if (oldest.done) break
    boxes.delete(oldest.value)
  }
  return created
}

/** 只给测试用：清掉全部记忆，免得用例之间互相看见对方的位置。 */
export function resetFlowScrollMemory(): void {
  boxes.clear()
}
