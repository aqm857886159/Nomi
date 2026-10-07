/**
 * 嵌在画布里的编辑器（今天只有 3D-BOX 导演台）在提议事务开始前把没落盘的改动先落到节点上。
 *
 * 为什么：编辑器开着时它的 store 才是节点的唯一写者，节点 meta 最多落后一个空闲保存周期。提议事务的撤销基线
 * （每一步的 before 快照）读的是画布节点；不先落盘，撤销一笔 AI 改动会把用户刚做、还没保存的手改一起抹掉。
 * 落盘必须在事务占住画布写口（ownPendingCanvasWrite）之前——占住之后任何外来写入都会让这笔提议作废。
 * 落盘是用户自己的保存（不进提议的撤销范围），没有未保存改动的编辑器什么都不写。
 */
const flushers = new Set<() => void>()

export function registerEmbeddedEditorFlush(flush: () => void): () => void {
  flushers.add(flush)
  return () => { flushers.delete(flush) }
}

export function flushEmbeddedEditors(): void {
  for (const flush of [...flushers]) flush()
}
