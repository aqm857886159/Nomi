import { describe, expect, it } from 'vitest'

import { SurfacePortWireError } from '../../../electron/shared/surfacePortBinding'
import {
  assertDocumentWritePreconditions,
  buildDocumentTurnAdmission,
  captureDocumentAnchor,
  documentContentHash,
  resolveDocumentWriteRange,
  type DocumentTextReader,
} from './documentWriteTarget'

function documentOf(text: string): DocumentTextReader {
  return {
    contentSize: text.length,
    textBetween: (from, to) => text.slice(from, to),
  }
}

describe('document write frozen targets', () => {
  it('admits a write turn only with its frozen anchor and document preconditions', () => {
    const anchor = captureDocumentAnchor(documentOf('before|after'), { from: 6, to: 6, empty: true })

    expect(buildDocumentTurnAdmission('document-a', {
      revision: 4,
      contentHash: 'content-a',
      anchor,
    }, true)).toEqual({
      target: { kind: 'document', documentId: 'document-a', anchor },
      preconditions: { document: { revision: 4, contentHash: 'content-a' } },
    })
  })

  it.each([
    ['missing state', undefined],
    ['whole-document placeholder', { revision: 4, contentHash: 'content-a', anchor: { kind: 'whole-document' as const } }],
  ] as const)('rejects a write turn with %s before enqueue', (_label, state) => {
    expect(() => buildDocumentTurnAdmission('document-a', state, true)).toThrowError(
      expect.objectContaining<Partial<SurfacePortWireError>>({ code: 'surface_port_stale' }),
    )
  })

  it('keeps whole-document available as a read-only turn scope', () => {
    expect(buildDocumentTurnAdmission('document-a', undefined, false)).toEqual({
      target: { kind: 'document', documentId: 'document-a', anchor: { kind: 'whole-document' } },
    })
  })

  it.each([
    ['revision', { revision: 4, contentHash: 'same' }, { revision: 3, contentHash: 'same' }],
    ['content hash', { revision: 3, contentHash: 'changed' }, { revision: 3, contentHash: 'same' }],
  ] as const)('rejects stale document %s preconditions before mutation', (_label, expected, current) => {
    expect(() => assertDocumentWritePreconditions(expected, current)).toThrowError(
      expect.objectContaining<Partial<SurfacePortWireError>>({ code: 'surface_port_stale' }),
    )
  })

  it('captures cursor neighbors and resolves the original position after selection moves', () => {
    const document = documentOf('before|after')
    const anchor = captureDocumentAnchor(document, { from: 6, to: 6, empty: true })

    expect(anchor).toEqual({
      kind: 'cursor',
      position: 6,
      beforeHash: documentContentHash('before'),
      afterHash: documentContentHash('|after'),
    })
    expect(resolveDocumentWriteRange(document, anchor, 'insert')).toEqual({ from: 6, to: 6 })
    expect(resolveDocumentWriteRange(document, anchor, 'append')).toEqual({ from: document.contentSize, to: document.contentSize })
  })

  it('resolves a frozen range independently from the live editor selection', () => {
    const document = documentOf('alpha selected omega')
    const anchor = captureDocumentAnchor(document, { from: 6, to: 14, empty: false })

    expect(resolveDocumentWriteRange(document, anchor, 'replace')).toEqual({ from: 6, to: 14 })
  })

  it.each([
    ['cursor neighbor', { kind: 'cursor' as const, position: 6, beforeHash: documentContentHash('before'), afterHash: documentContentHash('changed') }],
    ['range text', { kind: 'range' as const, from: 6, to: 14, selectedTextHash: documentContentHash('other') }],
    ['document end', { kind: 'document-end' as const, trailingTextHash: documentContentHash('other') }],
  ] as const)('rejects a stale %s anchor before mutation', (_label, anchor) => {
    expect(() => resolveDocumentWriteRange(documentOf('before|after'), anchor, 'replace')).toThrowError(
      expect.objectContaining<Partial<SurfacePortWireError>>({ code: 'surface_port_stale' }),
    )
  })

  it('rejects a whole-document write target because it has no frozen mutation anchor', () => {
    expect(() => resolveDocumentWriteRange(documentOf('text'), { kind: 'whole-document' }, 'insert')).toThrowError(
      expect.objectContaining<Partial<SurfacePortWireError>>({ code: 'surface_port_stale' }),
    )
  })
})
