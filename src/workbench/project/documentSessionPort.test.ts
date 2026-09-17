// 文稿端口 owner（项目会话层）的验收判据 1–5、7（J 块任务书 §2）。
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SurfacePortWireError } from '../../../electron/shared/surfacePortBinding'
import { useWorkbenchStore } from '../workbenchStore'
import { createDefaultWorkbenchDocument, type WorkbenchDocument } from '../workbenchTypes'
import { releaseWorkbenchProjectRuntimeState } from './releaseWorkbenchProjectSession'
import {
  documentSessionState,
  getDocumentSessionPort,
  overrideDocumentSessionPort,
  readDocumentThroughSessionPort,
  workbenchDocumentPlainText,
  writeDocumentThroughSessionPort,
  type DocumentSessionPort,
} from './documentSessionPort'

const repoRoot = path.resolve(__dirname, '../../..')

function paragraphs(...lines: string[]): unknown {
  return { type: 'doc', content: lines.map((text) => ({ type: 'paragraph', content: [{ type: 'text', text }] })) }
}

function seed(...lines: string[]): WorkbenchDocument {
  const document = { ...createDefaultWorkbenchDocument(), contentJson: paragraphs(...lines), updatedAt: 1000 }
  useWorkbenchStore.setState({ workbenchDocuments: [document], activeDocumentId: document.id })
  return document
}

function live(id: string): WorkbenchDocument {
  return useWorkbenchStore.getState().workbenchDocuments.find((item) => item.id === id)!
}

const guard = { signal: new AbortController().signal, assertCurrent: () => {} }
let restore: (() => void) | null = null
afterEach(() => { restore?.(); restore = null })

describe('document session port — baseline (creation page never mounted)', () => {
  it('①  reads the full text straight from the project session store', () => {
    const document = seed('旧书店的信。', '第二镜。')
    expect(readDocumentThroughSessionPort({ documentId: document.id, scope: 'full' }))
      .toEqual({ text: '旧书店的信。\n第二镜。' })
  })

  it('②  appends and replaces the whole document in the store, reporting the new revision', () => {
    const document = seed('第一句。')
    const state = documentSessionState(document)
    const appended = writeDocumentThroughSessionPort({
      documentId: document.id, operation: 'append', content: '加一句。', ...guard,
      target: { kind: 'document', documentId: document.id, anchor: { kind: 'whole-document' } },
      preconditions: { document: { revision: state.revision, contentHash: state.contentHash } },
    })
    expect(workbenchDocumentPlainText(live(document.id))).toBe('第一句。\n加一句。')
    expect(appended).toEqual({ applied: true, revision: live(document.id).updatedAt, contentHash: documentSessionState(live(document.id)).contentHash })
    expect(appended.revision).toBeGreaterThanOrEqual(state.revision)

    const replaced = writeDocumentThroughSessionPort({
      documentId: document.id, operation: 'replace', content: '整篇换掉。', ...guard,
      target: { kind: 'document', documentId: document.id, anchor: { kind: 'whole-document' } },
      preconditions: { document: { revision: appended.revision, contentHash: appended.contentHash } },
    })
    expect(workbenchDocumentPlainText(live(document.id))).toBe('整篇换掉。')
    expect(replaced.applied).toBe(true)
  })

  it('③  says capability_unsupported (not stale) for selection reads, cursor inserts and positional anchors', () => {
    const document = seed('第一句。')
    const state = documentSessionState(document)
    const codeOf = (run: () => unknown) => {
      try { run() } catch (error) { return (error as SurfacePortWireError).code }
      return 'no-error'
    }
    expect(codeOf(() => readDocumentThroughSessionPort({ documentId: document.id, scope: 'selection' }))).toBe('capability_unsupported')
    expect(codeOf(() => writeDocumentThroughSessionPort({
      documentId: document.id, operation: 'insert', content: 'x', ...guard,
      target: { kind: 'document', documentId: document.id, anchor: { kind: 'whole-document' } },
      preconditions: { document: { revision: state.revision, contentHash: state.contentHash } },
    }))).toBe('capability_unsupported')
    expect(codeOf(() => writeDocumentThroughSessionPort({
      documentId: document.id, operation: 'append', content: 'x', ...guard,
      target: { kind: 'document', documentId: document.id, anchor: { kind: 'cursor', position: 1, beforeHash: 'a', afterHash: 'b' } },
      preconditions: { document: { revision: state.revision, contentHash: state.contentHash } },
    }))).toBe('capability_unsupported')
    expect(workbenchDocumentPlainText(live(document.id))).toBe('第一句。')
  })

  it('④  an editor override is used while present and the port falls back to the baseline, never null, after it goes', () => {
    const document = seed('第一句。')
    const enhanced: DocumentSessionPort = {
      readFullText: () => 'editor text',
      readSelectionText: () => '选中的字',
      readState: () => ({ revision: 7, contentHash: 'fnv1a-editor', anchor: { kind: 'cursor', position: 0, beforeHash: 'a', afterHash: 'b' } }),
      applyDocumentWrite: () => ({ applied: true, revision: 8, contentHash: 'fnv1a-next' }),
    }
    restore = overrideDocumentSessionPort(enhanced)
    expect(getDocumentSessionPort()).toBe(enhanced)
    expect(readDocumentThroughSessionPort({ documentId: document.id, scope: 'selection' })).toEqual({ text: '选中的字' })
    expect(getDocumentSessionPort().readState().anchor.kind).toBe('cursor')
    restore()
    restore = null
    expect(getDocumentSessionPort()).not.toBe(enhanced)
    expect(getDocumentSessionPort().readState().anchor).toEqual({ kind: 'whole-document' })
    expect(readDocumentThroughSessionPort({ documentId: document.id, scope: 'full' })).toEqual({ text: '第一句。' })
  })

  it('⑤  a documentId from a previous project is the one true stale: surface_port_stale', () => {
    const before = seed('上个项目的文稿。')
    releaseWorkbenchProjectRuntimeState()
    const after = seed('这个项目的文稿。')
    expect(() => readDocumentThroughSessionPort({ documentId: before.id, scope: 'full' })).toThrow(new SurfacePortWireError('surface_port_stale'))
    expect(() => writeDocumentThroughSessionPort({
      documentId: before.id, operation: 'append', content: 'x', ...guard,
      target: { kind: 'document', documentId: before.id, anchor: { kind: 'whole-document' } }, preconditions: {},
    })).toThrow(new SurfacePortWireError('surface_port_stale'))
    // 前提过期（文稿在发送后被改过）也是真·陈旧。
    expect(() => writeDocumentThroughSessionPort({
      documentId: after.id, operation: 'append', content: 'x', ...guard,
      target: { kind: 'document', documentId: after.id, anchor: { kind: 'whole-document' } },
      preconditions: { document: { revision: 1, contentHash: 'fnv1a-old' } },
    })).toThrow(new SurfacePortWireError('surface_port_stale'))
  })

  it('project release leaves a live baseline over the empty document (no null field to trip over)', () => {
    seed('要被释放的文稿。')
    releaseWorkbenchProjectRuntimeState()
    const port = getDocumentSessionPort()
    expect(port.readFullText()).toBe('')
    expect(port.readState().anchor).toEqual({ kind: 'whole-document' })
  })
})

// ⑦  其余 surface_port_stale 抛出点（真·binding 比对）一处不动——数字钉住，改了要么是有意、要么是误伤。
describe('surface_port_stale sites outside the document owner stay as they are', () => {
  it.each([
    ['electron/capabilityCore/canvasReadSurfaceRegistry.ts', 17],
    ['electron/capabilityCore/canvasReadCapturedSnapshotRegistry.ts', 15],
    ['electron/capabilityCore/canvasReadSurfacePort.ts', 1],
    ['electron/capabilityCore/canvasReadTransportAdapters.ts', 2],
    ['src/workbench/project/projectCanvasReadSurface.ts', 8],
    ['src/workbench/capability/canonicalCanvasPlanPatch.ts', 1],
    ['src/workbench/capability/capabilityApplyHandler.ts', 1],
    ['src/workbench/creation/documentWriteTarget.ts', 1],
    // 文稿 owner 自己：只剩「documentId 不是当前活动文档」与「锚/前提过期」这两种真·陈旧。
    ['src/workbench/project/documentSessionPort.ts', 4],
    ['src/workbench/NomiStudioApp.tsx', 0],
  ])('%s mentions surface_port_stale exactly %i times', (file, count) => {
    const source = fs.readFileSync(path.join(repoRoot, file), 'utf8')
    expect(source.split('surface_port_stale').length - 1).toBe(count)
  })
})
