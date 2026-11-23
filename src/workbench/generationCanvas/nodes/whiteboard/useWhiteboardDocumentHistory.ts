import React from 'react'
import { useStateHistory } from '@mantine/hooks'
import { BoundedCache } from '../../../../../electron/shared/boundedCache'
import type { WhiteboardState } from './whiteboardTypes'

type Document = { state: WhiteboardState }

export function useWhiteboardDocumentHistory(initial: () => Document) {
  const [initialDocument] = React.useState(initial)
  const [snapshots] = React.useState(() =>
    new BoundedCache<number, Document>({ maxEntries: 50, order: 'fifo' }).set(0, initialDocument),
  )
  const revisionRef = React.useRef(0)
  const [revision, history, historyState] = useStateHistory(0)
  const historySet = history.set
  const document = snapshots.get(revision) ?? initialDocument
  const documentRef = React.useRef(document)
  documentRef.current = document
  const storeDocument = React.useCallback((value: Document) => {
    const id = ++revisionRef.current
    snapshots.set(id, value)
    documentRef.current = value
    historySet(id)
  }, [historySet, snapshots])
  return { document, documentRef, history, historyState, revision, snapshots, storeDocument }
}
