/**
 * 「搬一整块」——把一个框/组连同它装的东西一起挪走。
 *
 * 从 canvasGraphActions 拆出来是结构不是行为（R9：那个文件顶到了 800 行门岗）。
 * 拆的边界选在这一个动作上，因为它自己带着一条别处没有的不变量：
 * **框的位置有两份真相**（用户画的 `frameBounds` 那个矩形 + 成员各自的位置），
 * 而这两份必须在同一次事务里走同样远。写在一起，下一个人才不会只改到其中一半。
 */
import { bumpPersistRevision, shouldEmitCanvasMutation, shouldPersistCanvasMutation } from './canvasGuards'
import { emitCanvasGesture } from '../events/canvasEventEmitter'
import type { CanvasGraphActions, CanvasSliceCreator } from './canvasStoreTypes'

type CanvasGroupMoveActions = Pick<CanvasGraphActions, 'moveGroupNodes'>

export const createCanvasGroupMoveActions: CanvasSliceCreator<CanvasGroupMoveActions> = (set, get) => ({
  moveGroupNodes: (groupId, delta, options) => {
    // 「搬这一块」要搬**两样**：成员的位置，和框自己那个矩形（frameBounds）。
    //
    // 2026-09-06 起 frameBounds 是框位置的真相之一，渲染出来的框 = union(它, 成员矩形) 且
    // **只长不缩**。所以只搬成员、把矩形钉在原地，框不会跟着走——它会被**拉长**：
    // 左上角留在出发地，右下角被跑掉的成员拽走。真机上看着不像 bug，像「框怎么越拖越大」。
    // 另一半同样是它治的：没有成员的空框以前压根拖不动（守卫在 nodeIds.length 上直接返回），
    // 而空框正是「先圈一块地方，再往里放东西」这条路的第一步。
    const shouldEmit = shouldEmitCanvasMutation(options)
    const pre = shouldEmit ? get() : null
    const preGroup = pre?.groups.find((candidate) => candidate.id === groupId)
    const preNodeIds = preGroup?.nodeIds.length ? new Set(preGroup.nodeIds) : null
    const willMoveIds = pre && preGroup && preNodeIds && (delta.x !== 0 || delta.y !== 0)
      ? pre.nodes.filter((node) => preNodeIds.has(node.id) && (node.categoryId || 'shots') === preGroup.categoryId).map((node) => node.id)
      : []
    const willMoveFrame = Boolean(pre && preGroup?.frameBounds && (delta.x !== 0 || delta.y !== 0))
    set((state) => {
      if (delta.x === 0 && delta.y === 0) return
      const group = state.groups.find((candidate) => candidate.id === groupId)
      if (!group) return
      const nodeIds = new Set(group.nodeIds)
      let moved = false
      for (const node of state.nodes) {
        if (!nodeIds.has(node.id) || (node.categoryId || 'shots') !== group.categoryId) continue
        node.position = {
          x: Math.round(node.position.x + delta.x),
          y: Math.round(node.position.y + delta.y),
        }
        moved = true
      }
      if (group.frameBounds) {
        // 这里**不取整**：框的矩形是用户拖出来的，带小数（screenToFlowPosition 的产物），
        // 取整会在第一次搬家时让框整体跳半个像素——而且是只跳一次的那种，最难查。
        // 成员位置本来就是整数、上游发下来的位移也已经是整数（useCanvasSelectionDrag
        // 把余数留在待发账上），所以直接相加就能保证框和它装的东西走了一模一样远。
        group.frameBounds = {
          ...group.frameBounds,
          x: group.frameBounds.x + delta.x,
          y: group.frameBounds.y + delta.y,
        }
        moved = true
      }
      if (!moved) return
      group.updatedAt = Date.now()
      if (shouldPersistCanvasMutation(options)) bumpPersistRevision(state)
    })
    if (shouldEmit && (willMoveIds.length || willMoveFrame)) {
      const post = get()
      const postGroup = post.groups.find((candidate) => candidate.id === groupId)
      emitCanvasGesture([
        ...post.nodes.filter((node) => willMoveIds.includes(node.id)).map((node) => ({ type: 'canvas.node.moved', payload: { nodeId: node.id, position: node.position } })),
        ...(postGroup ? [{ type: 'canvas.group.updated', payload: { group: postGroup } }] : []),
      ])
    }
  },
})
