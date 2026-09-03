/**
 * Surface 端口的**文档**两条 handler（读全文/选区、按锚点写入）。
 *
 * 从 `NomiStudioApp.tsx` 抽出来：那个壳只应该负责「把各条 handler 接到端口上」，
 * 不该顺带承载每条 handler 的取数规则（R9 分层；该文件已在巨壳白名单里）。
 * 画布/时间线/资产那几条仍在壳里就地组装——它们只是转调既有执行器，没有自己的取数规则。
 */
import { SurfacePortWireError } from '../../../electron/shared/surfacePortBinding'
import { useWorkbenchStore } from '../workbenchStore'
import { docToPlainText } from '../generationCanvas/runner/textActions'
import type { TiptapDocJson } from '../generationCanvas/model/generationCanvasTypes'

/**
 * 读文档正文。
 *
 * 编辑器是正文的**活视图**，不是正文的唯一真相源——正文持久化在 `workbenchDocuments[].contentJson`。
 * 分镜页/生成页不挂载 `WorkbenchEditor`，此前这里一律判 stale，Agent 于是把「读不到」讲成
 * 「当前创作区文稿为空」（2026-09-03 真实付费闭环走查实测）。**能力的可用性不该绑在某个 UI
 * 组件的挂载生命周期上。**
 *
 * 选区是编辑器**独有**的状态：没有编辑器就没有选区，那种情况仍判 stale，不拿全文冒充选区。
 */
export function readDocumentSurface({ documentId, scope }: { documentId: string; scope: string }): { text: string } {
  const store = useWorkbenchStore.getState()
  if (store.activeDocumentId !== documentId) throw new SurfacePortWireError('surface_port_stale')
  const tools = store.creationDocumentTools
  if (tools) return { text: scope === 'full' ? tools.readFullText() : tools.readSelectionText() }
  if (scope === 'full') {
    const document = store.workbenchDocuments.find((item) => item.id === documentId)
    if (document) return { text: docToPlainText(document.contentJson as TiptapDocJson | undefined) }
  }
  throw new SurfacePortWireError('surface_port_stale')
}

/** 写文档：必须有挂载中的编辑器桥——写要落在真实的 ProseMirror 位置上，持久 JSON 没有锚点语义。 */
export function writeDocumentSurface({
  documentId, operation, content, target, preconditions, signal, assertCurrent,
}: {
  documentId: string
  operation: 'insert' | 'replace' | 'append'
  content: string
  target: unknown
  preconditions: unknown
  signal: AbortSignal
  assertCurrent: () => void
}) {
  const store = useWorkbenchStore.getState()
  const tools = store.creationDocumentTools
  if (!tools || store.activeDocumentId !== documentId) throw new SurfacePortWireError('surface_port_stale')
  if (signal.aborted) throw new SurfacePortWireError('capability_cancelled')
  assertCurrent()
  return tools.applyDocumentWrite({
    operation,
    content,
    target: target as never,
    preconditions: preconditions as never,
  })
}
