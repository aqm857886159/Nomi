// 设计实验室就绪判据的「懒加载到齐没有」这一半（2026-11-14）。
//
// 就绪旗原来只等「格子登记的持有释放 + 两帧」。打包产物里页面起得快，旗举起来的时候
// 应用里 React.lazy 的块还在路上：外壳画出来了、Suspense 还挂着加载标（或 fallback={null} 一片空），
// 截到的是没加载完的样子。开发服务器慢，碰巧盖住了。
//
// 「懒加载到齐」用 React 自己的判法：Suspense 边界显示 fallback 时，它在已提交的树上的状态非空
// （React DevTools 判「这个边界挂起了」看的也是这一处）。这里从实验室的根容器拿到 React 的根，
// 顺着当前已提交的树（含 portal 出去的弹窗）数还在显示 fallback 的边界。
// 产品代码不碰，产品组件也不用各自报「我加载完了」——这一处对所有懒加载的格子同时生效。
//
// 为什么不接 `__REACT_DEVTOOLS_GLOBAL_HOOK__`：react-dom 在模块顶层只读一次那个钩子，
// 打包后 react-dom 在单独的 vendor 块里、比实验室入口先求值，钩子装不进去；从容器取根不受加载顺序影响。
type Fiber = { tag: number; memoizedState: unknown; child: Fiber | null; sibling: Fiber | null; stateNode: unknown }
type FiberRoot = { current: Fiber }

// React 的 WorkTag：SuspenseComponent = 13（react-reconciler/src/ReactWorkTags.js）。
const SUSPENSE_COMPONENT_TAG = 13
// createRoot 在容器元素上挂的那个键（react-dom-bindings/src/client/ReactDOMComponentTree.js 的 internalContainerInstanceKey）。
const CONTAINER_KEY_PREFIX = '__reactContainer$'

function currentTree(container: Element): Fiber | null {
  const key = Object.keys(container).find((name) => name.startsWith(CONTAINER_KEY_PREFIX))
  if (!key) return null
  const hostRoot = (container as unknown as Record<string, Fiber | undefined>)[key]
  const fiberRoot = hostRoot?.stateNode as FiberRoot | undefined
  return fiberRoot?.current ?? null
}

/**
 * 实验室根容器里，还在显示 fallback 的 Suspense 边界有几个（0 = 懒加载的部分都到齐了）。
 * 根还没建起来（拿不到 React 的树）返回 null——判据不能把「看不见」当成「到齐了」。
 */
export function pendingSuspenseBoundaryCount(container: Element): number | null {
  const tree = currentTree(container)
  if (!tree) return null
  let pending = 0
  const stack: Fiber[] = [tree]
  while (stack.length > 0) {
    const fiber = stack.pop() as Fiber
    if (fiber.tag === SUSPENSE_COMPONENT_TAG && fiber.memoizedState !== null) pending += 1
    if (fiber.child) stack.push(fiber.child)
    if (fiber.sibling) stack.push(fiber.sibling)
  }
  return pending
}
