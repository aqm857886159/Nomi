import React from 'react'

/**
 * 复制进剪贴板的**唯一写口**（`navigator.clipboard.writeText` 全仓只在这个文件里出现一次）。
 *
 * 2026-09-11 用户实测反馈：助手输出上 hover 出来的那枚复制 icon「点了没反应」。
 * 点是点到了，字也进了剪贴板——只是没有任何一帧告诉用户这件事发生过。
 *
 * 根因不是漏写一句提示，而是**复制这件事没有主人**：15 个调用点各自直接调
 * `navigator.clipboard.writeText`，于是「成功了要不要说一声」由每个调用点现场决定——
 * 有的弹 toast、有的改图标、有的写一行状态、有的 `.catch(() => undefined)` 把成败一起吞掉，
 * 还有的（`promptLibrary/PromptPreviewOverlay`）不等 promise 就先说"已复制"，失败时照样说。
 * 一件事有 15 份规矩，等于没有规矩；漏掉的那几处不是手滑，是结构允许它漏。
 *
 * 所以写口收成一份，反馈形状也收成一份：
 * · `copyToClipboard` —— **不抛**，回 true/false。调用点拿到的是"成了没有"，
 *   而不是一个可以顺手 `.catch(() => {})` 掉的异常。想装没看见得显式写 `void`。
 * · `useClipboardCopy` —— 那个"改图标 1.5 秒"的状态机，一份实现（R28：能收进一处的别复制 15 份）。
 *
 * 门岗在 `clipboard.test.ts`：全仓除本文件外再出现 `clipboard.writeText` 就红。
 */

/** 「已复制」这枚回执待多久。够看见、短到不挡下一个动作。 */
export const COPIED_FEEDBACK_MS = 1500

/**
 * 写剪贴板。**永不抛**：回 `true` = 真的写进去了，`false` = 没有（无权限 / 非安全上下文 /
 * 无 `navigator.clipboard`）。空串也算没写——没有内容可复制时说"已复制"就是骗人。
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (!text) return false
  try {
    const clipboard = navigator.clipboard
    if (!clipboard) return false
    await clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

export type ClipboardCopyState = 'idle' | 'copied' | 'failed'

export type ClipboardCopy = {
  /** 当前回执态；`COPIED_FEEDBACK_MS` 后自己回 idle。 */
  state: ClipboardCopyState
  copied: boolean
  failed: boolean
  /** 复制并亮回执；回 `copyToClipboard` 的结果，调用方要接着做别的事可以据它判。 */
  copy: (text: string) => Promise<boolean>
  /** 立刻收掉回执——换了上下文（对话框重开、换了要复制的东西）时用，别让上一次的话留在新场景里。 */
  reset: () => void
}

/** 复制按钮那套「点一下 → 变对勾 → 自己退回去」的状态机，全仓共用这一份。 */
export function useClipboardCopy(): ClipboardCopy {
  const [state, setState] = React.useState<ClipboardCopyState>('idle')
  const timer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  // 卸载后还在跑的计时器会对着已经不存在的组件 setState；离场时收掉。
  React.useEffect(() => () => { if (timer.current !== undefined) clearTimeout(timer.current) }, [])
  const copy = React.useCallback(async (text: string): Promise<boolean> => {
    const ok = await copyToClipboard(text)
    setState(ok ? 'copied' : 'failed')
    if (timer.current !== undefined) clearTimeout(timer.current)
    timer.current = setTimeout(() => { setState('idle'); timer.current = undefined }, COPIED_FEEDBACK_MS)
    return ok
  }, [])
  const reset = React.useCallback(() => {
    if (timer.current !== undefined) { clearTimeout(timer.current); timer.current = undefined }
    setState('idle')
  }, [])
  return { state, copied: state === 'copied', failed: state === 'failed', copy, reset }
}
