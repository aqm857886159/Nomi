/**
 * [INPUT]: 无依赖（纯 DOM）
 * [OUTPUT]: 对外提供 attachWebGLContextRecovery
 * [POS]: director/scene 的 WebGL 上下文丢失恢复（原 V1 scene3dContextRecovery，切换门入籍）：
 *        GPU 重置 / 驱动打嗝 / 多实例抢配额 / 休眠唤醒会丢上下文，浏览器默认不补发 restore；
 *        ① lost 事件必须 preventDefault 才会有 restore；② restore 后手动 invalidate 重绘一帧（demand 模式不会自己画）。
 *        返回解绑函数，画布卸载时调用。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
export function attachWebGLContextRecovery(canvas: HTMLCanvasElement, invalidate: () => void): () => void {
  const handleLost = (event: Event) => {
    event.preventDefault()
  }
  const handleRestored = () => {
    invalidate()
  }
  canvas.addEventListener('webglcontextlost', handleLost, false)
  canvas.addEventListener('webglcontextrestored', handleRestored, false)
  return () => {
    canvas.removeEventListener('webglcontextlost', handleLost, false)
    canvas.removeEventListener('webglcontextrestored', handleRestored, false)
  }
}
