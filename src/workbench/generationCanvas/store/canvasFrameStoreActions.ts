/**
 * 框（Frame）自己的两个写口：画一个空框、改那句灰字说明。
 *
 * 从 canvasGraphActions 拆出来是结构不是行为（R9：那个文件已经顶到 800 行门岗）。
 * 拆的边界选在这里而不是别处：这两个动作是**框**这个概念独有的，其余的组动作
 * （建组/改名/折叠/解散/进出组）框和组共用同一份——共用的那些留在原处，
 * 免得同一件事被劈成两半、以后各长各的。
 */
import { bumpPersistRevision } from './canvasGuards'
import { getHistoryFlags, pushUndoSnapshot } from '../events/canvasUndoJournal'
import { emitCanvasGesture } from '../events/canvasEventEmitter'
import type { CanvasGraphActions, CanvasSliceCreator } from './canvasStoreTypes'

type CanvasFrameStoreActions = Pick<CanvasGraphActions, 'createFrame' | 'setGroupDescription'>

export const createCanvasFrameStoreActions: CanvasSliceCreator<CanvasFrameStoreActions> = (set, get) => ({
  /**
   * 画一个空框。走的就是 `createGroup`——框只有一种，画出来的和 ⌘G 建出来的是同一个 `NodeGroup`，
   * 差别只有「建的那一刻有没有成员」。这里不另开一条建组路径（P1 无并行版）。
   */
  createFrame: (categoryId, bounds, name, nodeIds) => {
    // `nodeIds` = 这一圈**当场圈住**的那些节点（判定在 useCanvasFrameTool，用的是拖进拖出
    // 那同一条中心点判据）。空数组 = 在空地上画的空框，仍然是合法的第一步。
    return get().createGroup(categoryId, name, { frameBounds: bounds, ...(nodeIds?.length ? { nodeIds: [...nodeIds] } : {}) })
  },
  setGroupDescription: (groupId, description) => {
    const next = String(description ?? '').trim()
    const current = get()
    const existing = current.groups.find((group) => group.id === groupId)
    // 说明和名字不同：**可以是空的**，所以「清空」是合法编辑，判重只比值、不拦空串。
    if (!existing || (existing.description ?? '') === next) return
    pushUndoSnapshot(current)
    set((state) => {
      const group = state.groups.find((candidate) => candidate.id === groupId)
      if (!group) return
      if (next) group.description = next
      else delete group.description
      group.updatedAt = Date.now()
      bumpPersistRevision(state)
      Object.assign(state, getHistoryFlags())
    })
    const updated = get().groups.find((candidate) => candidate.id === groupId)
    if (updated) emitCanvasGesture([{ type: 'canvas.group.updated', payload: { group: updated } }])
  },
})
