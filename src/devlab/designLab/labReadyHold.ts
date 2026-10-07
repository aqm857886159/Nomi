/**
 * 设计实验室就绪旗的**持有登记**。
 *
 * 就绪旗（`window.__designLabReady`）原本只等 React 提交后两帧——对纯 DOM 格子够了；
 * 3D 视口（导演视图）不行：角色模型、动作片段是异步拉的，两帧之后截到的是一块空地。
 * 「再等几秒」是墙钟等待（R18 `check:test-waits` 拦的那一族），所以改成**格子自己说什么时候好**：
 * 渲染时登记一个持有，场景真的落定（角色挂上、动作片段就绪）后释放；就绪旗等全部释放才举。
 * 视觉基线、走查、接触表三处都只等那一面旗，因此这里一处改动三处同时生效。
 */
const holds = new Set<symbol>()

export function holdDesignLabReady(reason: string): () => void {
  const token = Symbol(reason)
  holds.add(token)
  return () => {
    holds.delete(token)
  }
}

export function designLabHoldCount(): number {
  return holds.size
}
