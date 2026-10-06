/**
 * [INPUT]: 依赖 ./model/directorStore 的 DirectorStore、./model/directorTypes
 * [OUTPUT]: 对外提供 createDirectorNodeSync：编辑器 store ↔ 画布节点 meta 的同步账（谁写过什么、有没有没落盘的改动、节点被外部改了要不要重载）
 * [POS]: 3D-BOX「一个写者、一本历史」的编辑器那一侧（方案 §7 第 2 条）。编辑器开着时 store 是唯一写者，节点 meta 是它的持久化：
 *        ① 自己写出去的每一份都记住（`persist`），节点 meta 回来的还是它 → 不是外部改动；
 *        ② 节点 meta 换成了别的（Agent 撤销一笔 stage_shot = 补偿把整份 meta 放回去）→ 编辑器当场重载那一份（`adoptNodeProject`），
 *           不留旧画面，也不会在退出 / 自动保存时把旧工程写回去盖掉撤销；
 *        ③ 提议事务 / Agent 撤销开始前先把没落盘的改动落盘（`saveNow`，经 embeddedEditorFlush 登记），撤销基线里有它们。
 *        纯逻辑、零 React，DirectorEditor 只做接线。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { DirectorStore } from './model/directorStore'
import type { DirectorProject } from './model/directorTypes'

export type DirectorNodeSync = Readonly<{
  /** 编辑器自己的一次落盘（自动保存 / 退出 / 外部写口回写）：记下写出去的对象与当时 store 的工程。 */
  persist: (project: DirectorProject) => void
  /** store 里有没有还没落盘的改动。 */
  isDirty: () => boolean
  /** 有没落盘的改动就立刻落盘；没有就什么都不写。 */
  saveNow: () => void
  /** 节点 meta 上的工程变了：是自己写的 → 忽略；是外部写的 → 重载进 store，返回 true。 */
  adoptNodeProject: (raw: unknown) => boolean
}>

export function createDirectorNodeSync(input: Readonly<{
  store: DirectorStore
  defaultSceneName: string
  initialRaw: unknown
  write: (project: DirectorProject) => void
}>): DirectorNodeSync {
  let lastWritten: unknown = input.initialRaw
  let savedProject = input.store.getState().project
  const persist = (project: DirectorProject) => {
    lastWritten = project
    savedProject = input.store.getState().project
    input.write(project)
  }
  const isDirty = () => input.store.getState().project !== savedProject
  return {
    persist,
    isDirty,
    saveNow: () => {
      if (isDirty()) persist(input.store.getState().exportProject())
    },
    adoptNodeProject: (raw) => {
      if (raw === lastWritten) return false
      input.store.getState().loadProject(raw, input.defaultSceneName, { keepView: true })
      lastWritten = raw
      savedProject = input.store.getState().project
      return true
    },
  }
}
