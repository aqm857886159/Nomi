/**
 * 受控富文本编辑器（Tiptap）与它的外部 owner（store）之间「谁写进谁」的唯一裁决。
 *
 * ## 守的不变量
 *
 * **编辑器是自己文本的唯一 owner；外部值只有「真正来自外部」时才写进编辑器。**
 * 编辑器自己刚发出去、又沿着 store → props 回流回来的旧值，永远不许覆盖当前文档。
 *
 * ## 为什么需要一本账，而不是「和上一次发出去的比一下」
 *
 * 2026-09-21：以 0ms 间隔逐键输入「A samurai walks…」变成「Ai waks…」。真机探针：每一次按键，
 * 编辑器文字都先**倒退**一次再恢复（120 键 → 120 次倒退）。链路是：
 *   按键 → onUpdate → store.updateNode → 节点组件因为自己订阅的 store 片段**同步重渲染**，
 *   但它拿到的 `node` 还是 React Flow 投影里上一拍的旧对象（投影在 effect 里才追上）
 *   → 编辑器收到 value = 上一版 → 旧逻辑只和「最后发出去的那一版」比，不相等就当外部变更
 *   → setContent(上一版) 把刚打的字吞掉 → 投影追上后再 setContent(新版) 补回来。
 * 键与键之间隔 40ms 时「吞了又补」来得及，看起来没事；0ms（文字扩展工具、输入法整段上屏、
 * 极快打字）时下一键正好落在吞掉的窗口里，于是丢字。
 *
 * 回流的旧值可以是**任何一版**编辑器发出过、owner 还没追上的中间态，不只是最后一版；
 * 也可以是开始打字**之前**owner 手里那一版（第一键之后的那次旧拍重渲染带的就是它）。
 * 所以这里记一本账：`acknowledged` = owner 最后一次确认过的值，`pending` = 之后发出、未确认的各版：
 *   · 收到的值 == 编辑器当前文本 → owner 追上了，账清空；
 *   · 收到的值在 pending 上 → 是回声（按发出顺序到达），把它及更早的都划掉，不动文档；
 *   · 还有未确认的发出、而收到的是 acknowledged → 旧拍重渲染，不动文档；
 *   · 都不是 → 真正的外部改写（翻译/优化/Agent/撤销/切节点），写进编辑器，账清空。
 *
 * 残余歧义（写进合同）：外部写入者在回流窗口（通常一两帧）之内恰好写回一个账上的旧值，
 * 会被当成回声忽略；编辑器随后的下一次发出会把当前文档写回 owner，不会静默分叉。
 *
 * 值用字符串比较：提示词编辑器传 prompt 串，文档编辑器传 JSON 串——判据与载体无关。
 * 纯函数、无 React；只有编辑器唯一入口 `useNomiTiptapEditor` 用它（调用方只交读写口，碰不到这本账）。
 */
export type ControlledEditorSync = {
  /** 编辑器自己产出了新一版：返回 true 表示要向 owner 回写（内容没变的事务不回写）。 */
  emit: (next: string) => boolean
  /** owner 的值到了：返回 true 表示这是外部改写，调用方要把它写进编辑器。 */
  receive: (value: string) => boolean
  /** 编辑器实例出生（它的文档就是 `value`）：账重新开。 */
  reset: (value: string) => void
}

export function createControlledEditorSync(initial: string): ControlledEditorSync {
  let current = initial
  let acknowledged = initial
  let pending: string[] = []
  return {
    emit(next) {
      if (next === current) return false
      current = next
      // 不设上限：截掉旧账会让晚到的旧回声被误判成外部改写、覆盖文档（正是要防的事）。
      // 账只在 owner 没追上时增长，每一次回流都会把它划短，编辑器卸载时随之释放。
      pending.push(next)
      return true
    },
    receive(value) {
      if (value === current) {
        acknowledged = value
        pending = []
        return false
      }
      const echo = pending.indexOf(value)
      if (echo >= 0) {
        acknowledged = value
        pending = pending.slice(echo + 1)
        return false
      }
      if (pending.length > 0 && value === acknowledged) return false
      current = value
      acknowledged = value
      pending = []
      return true
    },
    reset(value) {
      current = value
      acknowledged = value
      pending = []
    },
  }
}
