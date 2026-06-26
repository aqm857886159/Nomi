/**
 * 引导旅途的打字回放：把一段预置剧本逐字「敲」进真实创作编辑器——不调模型。
 *
 * 走 store 的受控内容通道（setWorkbenchDocument 灌逐字增长的 document），编辑器经它正常的
 * controlled-content sync 渲染出来，是「真的写进编辑器」而非覆盖层障眼法；防回环 guard 在
 * useNomiRichTextEditor 里已处理。零额度、零网络、永不崩。
 */
import type { WorkbenchDocument } from '../workbenchTypes'
import { buildStoryDocument } from '../library/tryNowExamples'

const CHAR_MS = 26
const NEWLINE_MS = 200

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

/**
 * 逐字回放 story 进编辑器。每个 tick 用 buildStoryDocument(前缀) 重建文档并 setDocument，
 * 编辑器随受控内容增长。shouldAbort 返回 true 立即停（用户跳过引导）。
 */
export async function playTypewriter(options: {
  story: string
  title: string
  setDocument: (doc: WorkbenchDocument) => void
  shouldAbort: () => boolean
  charMs?: number
}): Promise<void> {
  const { story, title, setDocument, shouldAbort, charMs = CHAR_MS } = options
  for (let i = 1; i <= story.length; i += 1) {
    if (shouldAbort()) return
    setDocument(buildStoryDocument(story.slice(0, i), title))
    await delay(story[i - 1] === '\n' ? NEWLINE_MS : charMs)
  }
}
