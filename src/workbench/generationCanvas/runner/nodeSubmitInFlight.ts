/**
 * 这个窗口发出去、主进程还没回话的画布生成请求（按节点 id 记）——**只是给装载收敛的一个提示，不管钱**。
 *
 * 它是**进程寿命**的，不归项目会话管：切到项目库再切回来，项目会话里的东西都被释放、画布从磁盘重新装载，
 * 可那一笔请求还在等主进程回话。装载时的收敛（canvasSnapshotNormalizer.convergeStuckMidFlightNode）把「存盘时在跑、
 * 又没有任务号」的节点当成上一个进程留下的幽灵转圈、收成空闲——对重启是对的，对切项目是错的：节点会显示空闲、
 * 被「生成全部」算进去（S1-5 同类，2026-10-03）。所以收敛先问这里：这一笔还在路上，就照旧显示生成中。
 *
 * 写口：渲染层的两个提交口在 await 主进程前登记、回话后注销——付费画布生成 `submitCanvasShotRun` 与
 * 不进 Run 的那条 `runWorkbenchTaskByVendor`（文本、本地 ComfyUI、附属付费口），都在 taskApi。
 *
 * 花不花钱、能不能再交不由它决定：付费画布生成的「同一节点在途时再来一笔就拒」在主进程画布付费口的准入里
 * （appIntegrationCanvasShot 的 assertNodeIdle：进程内在途 + 盘上「没收尾」标记，重启后照样拒），
 * 那份 Run 才是真相；这里只管窗口里的节点别把一笔还在路上的生成显示成空闲。
 */
const inFlight = new Map<string, number>()

/** 登记一笔在途请求；返回注销函数（只生效一次）。没有节点 id 的请求不登记。 */
export function trackNodeSubmit(nodeId: string | undefined): () => void {
  const id = String(nodeId || '').trim()
  if (!id) return () => undefined
  inFlight.set(id, (inFlight.get(id) ?? 0) + 1)
  let released = false
  return () => {
    if (released) return
    released = true
    const left = (inFlight.get(id) ?? 1) - 1
    if (left > 0) inFlight.set(id, left)
    else inFlight.delete(id)
  }
}

/** 这个节点此刻有没有一笔这个窗口发出、主进程还没回话的生成请求。 */
export function isNodeSubmitInFlight(nodeId: string | undefined): boolean {
  const id = String(nodeId || '').trim()
  return Boolean(id) && inFlight.has(id)
}
