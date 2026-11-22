import type { NomiEditorOwner } from '../../workbench/common/useNomiRichTextEditor'

/**
 * 设计实验室取景用的 owner：值是夹具里写死的一份，编辑不写回任何地方。
 * 只住在设计实验室（组件测试也从这里拿）：生产宿主交自己 store 的 subscribe / getSnapshot；
 * 编辑器入口文件不提供「拿一份值当 owner」的便捷口——拿渲染时的值包一层交进去，就又是一个拿着旧副本的编辑器。
 */
export function fixedEditorOwner<V>(value: V): NomiEditorOwner<V> {
  return { subscribe: NO_SUBSCRIPTION, getSnapshot: () => value, write: NOOP_WRITE }
}
const NO_SUBSCRIPTION = (): (() => void) => () => undefined
const NOOP_WRITE = (): void => undefined
