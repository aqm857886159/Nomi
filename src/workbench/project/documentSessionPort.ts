// 文稿读写端口的 **owner**（2026-09-17，批次 2 · J 块）。
//
// 它在解决哪个真实摩擦：用户冷启动落在画布、创作页从未挂载，Agent「读一下文稿」却被告知
// `surface_port_stale`（目标陈旧）——目标不是陈旧，是这份能力此前只由创作页那个 TipTap 组件
// 的 useEffect 发布，组件没挂载就等于「能力不存在」。文稿正文本来就住在项目会话 store
// （`workbenchDocuments`），TipTap 只是它的一个视图。所以 owner 住在项目会话层（本目录）：
//
//   · **基线端口**：随项目会话永远在。从 store 派生正文（`generateText` 用和编辑器同一套 schema，
//     所以同一份文档两边算出的正文与 contentHash 逐字相同）；支持 `full` 读、whole-document 的
//     `append` / `replace` 写。需要光标/选区的动作（`selection` 读、`insert`、定位锚）在基线态回
//     **语义正确**的 `capability_unsupported`——「没有」不再说成「过期」。
//   · **增强覆盖**：创作页编辑器挂载时用带选区/锚点的版本 **覆盖**（`overrideDocumentSessionPort`），
//     卸载时退回基线。读方永远拿到一个端口，类型上写不出 `!tools`。
//
// revision 不再是组件私有计数器：它就是文档的 `updatedAt`（store 每次改正文都盖新戳），基线与
// 增强两边读到的是同一个数，一次发送在两种端口之间切换也对得上。
import StarterKit from '@tiptap/starter-kit'
import { generateText, type JSONContent } from '@tiptap/core'
import type { DocumentAnchorRef, PreconditionSet, TargetRef } from '../../../electron/shared/capabilityTargeting'
import { SurfacePortWireError } from '../../../electron/shared/surfacePortBinding'
import { RICH_TEXT_FEATURE_EXTENSIONS } from '../common/useNomiRichTextEditor'
import { markdownToTiptapContent } from '../creation/markdownToTiptap'
import { assertDocumentWritePreconditions, documentContentHash } from '../creation/documentWriteTarget'
import { normalizeWorkbenchContentJson, type WorkbenchDocument } from '../workbenchTypes'
import { useWorkbenchStore } from '../workbenchStore'

export type DocumentWriteOperation = 'insert' | 'replace' | 'append'

export type DocumentSessionState = Readonly<{ revision: number; contentHash: string; anchor: DocumentAnchorRef }>

export type DocumentSessionWriteInput = Readonly<{
  operation: DocumentWriteOperation
  content: string
  target: TargetRef
  preconditions: PreconditionSet
}>

export type DocumentSessionWriteResult = Readonly<{ applied: true; revision: number; contentHash: string }>

/** 当前生效的文稿端口——基线（随项目会话）或增强（创作页编辑器挂载时覆盖）。永远非空。 */
export type DocumentSessionPort = Readonly<{
  readFullText: () => string
  /** 基线态没有选区：抛 `capability_unsupported`，不是返回空串装作「没选」。 */
  readSelectionText: () => string
  readState: () => DocumentSessionState
  applyDocumentWrite: (input: DocumentSessionWriteInput) => DocumentSessionWriteResult
}>

export const WHOLE_DOCUMENT_ANCHOR: DocumentAnchorRef = Object.freeze({ kind: 'whole-document' as const })

// 和 `useNomiRichTextEditor` 里创作编辑器的 schema 一致（Placeholder / 持久选区不改 schema）。
const DOCUMENT_TEXT_EXTENSIONS = [StarterKit, ...RICH_TEXT_FEATURE_EXTENSIONS]

/** 文档正文的唯一派生：和 `editor.getText({ blockSeparator: '\n' }).trim()` 逐字相同。 */
export function workbenchDocumentPlainText(document: Pick<WorkbenchDocument, 'contentJson'> | null | undefined): string {
  const content = normalizeWorkbenchContentJson(document?.contentJson) as JSONContent
  return generateText(content, DOCUMENT_TEXT_EXTENSIONS, { blockSeparator: '\n' }).trim()
}

export function documentSessionState(document: WorkbenchDocument, anchor: DocumentAnchorRef = WHOLE_DOCUMENT_ANCHOR): DocumentSessionState {
  return Object.freeze({ revision: document.updatedAt, contentHash: documentContentHash(workbenchDocumentPlainText(document)), anchor })
}

function unsupported(): never {
  throw new SurfacePortWireError('capability_unsupported')
}

function activeDocument(): WorkbenchDocument {
  const state = useWorkbenchStore.getState()
  const document = state.workbenchDocuments.find((item) => item.id === state.activeDocumentId) ?? state.workbenchDocuments[0]
  if (!document) throw new SurfacePortWireError('surface_port_unavailable')
  return document
}

/**
 * whole-document 写：不需要编辑器，直接改 store 里的 contentJson。
 * `insert` 需要一个位置，整篇文档没有位置——回 `capability_unsupported`，让模型改用 append/replace。
 */
export function applyWholeDocumentWrite(
  document: WorkbenchDocument,
  operation: DocumentWriteOperation,
  content: string,
): WorkbenchDocument {
  if (operation === 'insert') unsupported()
  const nodes = markdownToTiptapContent(content)
  if (!nodes.length) throw new SurfacePortWireError('capability_input_invalid')
  const current = normalizeWorkbenchContentJson(document.contentJson) as { type: 'doc'; content?: unknown[] }
  const contentJson = operation === 'append'
    ? { ...current, content: [...(Array.isArray(current.content) ? current.content : []), ...nodes] }
    : { ...current, content: nodes }
  return { ...document, contentJson, updatedAt: Date.now() }
}

function assertDocumentTarget(target: TargetRef, documentId: string): Extract<TargetRef, { kind: 'document' }> {
  if (target.kind !== 'document' || target.documentId !== documentId) throw new SurfacePortWireError('surface_port_stale')
  return target
}

const baselineDocumentPort: DocumentSessionPort = Object.freeze({
  readFullText: () => workbenchDocumentPlainText(activeDocument()),
  readSelectionText: () => unsupported(),
  readState: () => documentSessionState(activeDocument()),
  applyDocumentWrite: (input) => {
    const document = activeDocument()
    const target = assertDocumentTarget(input.target, document.id)
    // 定位锚（光标/选区/文末哈希）只有编辑器能验；基线态说不出「位置」，只认整篇。
    if (target.anchor.kind !== 'whole-document') unsupported()
    assertDocumentWritePreconditions(input.preconditions.document, documentSessionState(document))
    const next = applyWholeDocumentWrite(document, input.operation, input.content)
    useWorkbenchStore.getState().setWorkbenchDocument(next)
    const settled = documentSessionState(activeDocument())
    return Object.freeze({ applied: true as const, revision: settled.revision, contentHash: settled.contentHash })
  },
})

let overridePort: DocumentSessionPort | null = null

/** 读方唯一入口：增强覆盖在就是它，否则基线。从不返回空。 */
export function getDocumentSessionPort(): DocumentSessionPort {
  return overridePort ?? baselineDocumentPort
}

/** 创作页编辑器挂载时覆盖；返回的函数在卸载时调用，只有仍是自己那份时才退回基线。 */
export function overrideDocumentSessionPort(port: DocumentSessionPort): () => void {
  overridePort = port
  return () => {
    if (overridePort === port) overridePort = null
  }
}

/**
 * 渲染层 surface port 的两个文稿 handler（`registerProjectCanvasReadSurface` 用）。
 * 只剩一个判据：lane/MCP 带来的 documentId 不是当前活动文档 = 真·陈旧（切过项目/切过文档）。
 */
export function readDocumentThroughSessionPort(input: { documentId: string; scope: 'full' | 'selection' }): { text: string } {
  if (useWorkbenchStore.getState().activeDocumentId !== input.documentId) throw new SurfacePortWireError('surface_port_stale')
  const port = getDocumentSessionPort()
  return { text: input.scope === 'full' ? port.readFullText() : port.readSelectionText() }
}

export function writeDocumentThroughSessionPort(input: DocumentSessionWriteInput & {
  documentId: string
  signal: AbortSignal
  assertCurrent: () => void
}): DocumentSessionWriteResult {
  if (useWorkbenchStore.getState().activeDocumentId !== input.documentId) throw new SurfacePortWireError('surface_port_stale')
  if (input.signal.aborted) throw new SurfacePortWireError('capability_cancelled')
  input.assertCurrent()
  return getDocumentSessionPort().applyDocumentWrite({
    operation: input.operation, content: input.content, target: input.target, preconditions: input.preconditions,
  })
}
