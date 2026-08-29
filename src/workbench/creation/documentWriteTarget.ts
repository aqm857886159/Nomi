import type { DocumentAnchorRef, PreconditionSet } from '../../../electron/shared/capabilityTargeting'
import { SurfacePortWireError } from '../../../electron/shared/surfacePortBinding'

/** The small part of a ProseMirror document needed to validate a frozen anchor. */
export type DocumentTextReader = Readonly<{
  contentSize: number
  textBetween: (from: number, to: number, blockSeparator: string) => string
}>

export type DocumentSelectionSnapshot = Readonly<{
  from: number
  to: number
  empty: boolean
}>

export type DocumentWriteRange = Readonly<{ from: number; to: number }>

export type DocumentStateSnapshot = Readonly<{ revision: number; contentHash: string }>

export function documentContentHash(text: string): string {
  let hash = 2166136261
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`
}

export function captureDocumentAnchor(
  document: DocumentTextReader,
  selection: DocumentSelectionSnapshot,
): DocumentAnchorRef {
  const { from, to, empty } = selection
  if (empty || from === to) {
    return Object.freeze({
      kind: 'cursor',
      position: from,
      beforeHash: documentContentHash(document.textBetween(0, from, '\n')),
      afterHash: documentContentHash(document.textBetween(from, document.contentSize, '\n')),
    })
  }
  return Object.freeze({
    kind: 'range',
    from,
    to,
    selectedTextHash: documentContentHash(document.textBetween(from, to, '\n').trim()),
  })
}

function staleAnchor(): never {
  throw new SurfacePortWireError('surface_port_stale')
}

export function assertDocumentWritePreconditions(
  expected: PreconditionSet['document'] | undefined,
  current: DocumentStateSnapshot,
): void {
  if (
    expected &&
    (expected.revision !== current.revision ||
      (expected.contentHash !== undefined && expected.contentHash !== current.contentHash))
  ) staleAnchor()
}

/**
 * Validate the frozen document anchor against the current document and return
 * the exact transaction range. Current editor selection is intentionally not
 * consulted; a user may move it while an approval is pending.
 */
export function resolveDocumentWriteRange(
  document: DocumentTextReader,
  anchor: DocumentAnchorRef,
  operation: 'insert' | 'replace' | 'append',
): DocumentWriteRange {
  if (anchor.kind === 'whole-document') staleAnchor()

  if (anchor.kind === 'cursor') {
    if (
      !Number.isSafeInteger(anchor.position) ||
      anchor.position < 0 ||
      anchor.position > document.contentSize ||
      documentContentHash(document.textBetween(0, anchor.position, '\n')) !== anchor.beforeHash ||
      documentContentHash(document.textBetween(anchor.position, document.contentSize, '\n')) !== anchor.afterHash
    ) staleAnchor()
    if (operation === 'append') {
      return Object.freeze({ from: document.contentSize, to: document.contentSize })
    }
    return Object.freeze({ from: anchor.position, to: anchor.position })
  }

  if (anchor.kind === 'range') {
    if (
      !Number.isSafeInteger(anchor.from) ||
      !Number.isSafeInteger(anchor.to) ||
      anchor.from < 0 ||
      anchor.to < anchor.from ||
      anchor.to > document.contentSize ||
      documentContentHash(document.textBetween(anchor.from, anchor.to, '\n').trim()) !== anchor.selectedTextHash
    ) staleAnchor()
    if (operation === 'insert' && anchor.from !== anchor.to) staleAnchor()
    if (operation === 'append') {
      return Object.freeze({ from: document.contentSize, to: document.contentSize })
    }
    return Object.freeze({ from: anchor.from, to: anchor.to })
  }

  if (anchor.kind === 'document-end') {
    if (
      documentContentHash(document.textBetween(0, document.contentSize, '\n')) !== anchor.trailingTextHash
    ) staleAnchor()
    return Object.freeze({ from: document.contentSize, to: document.contentSize })
  }

  staleAnchor()
}
