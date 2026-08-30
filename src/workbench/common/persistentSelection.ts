import { Extension } from '@tiptap/core'
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

export const PERSISTENT_SELECTION_CLASS = 'nomi-persistent-selection'

export type PersistentSelectionRange = { from: number; to: number }
export type PersistentSelectionState = { range: PersistentSelectionRange | null }

export const persistentSelectionPluginKey = new PluginKey<PersistentSelectionState>('nomiPersistentSelection')

function rangeFromSelection(state: Pick<EditorState, 'selection'>): PersistentSelectionRange | null {
  const { from, to, empty } = state.selection
  if (empty || from >= to) return null
  return { from, to }
}

function mapRange(range: PersistentSelectionRange, transaction: Transaction): PersistentSelectionRange | null {
  const from = transaction.mapping.mapResult(range.from, 1)
  const to = transaction.mapping.mapResult(range.to, -1)
  if (from.pos >= to.pos || (from.deleted && to.deleted)) return null
  return { from: from.pos, to: to.pos }
}

export function createPersistentSelectionPlugin(): Plugin<PersistentSelectionState> {
  return new Plugin<PersistentSelectionState>({
    key: persistentSelectionPluginKey,
    state: {
      init: (_config, state) => ({ range: rangeFromSelection(state) }),
      apply: (transaction, previous) => {
        // A newly collapsed selection is an explicit user choice and ends the
        // saved range. Blur does not create a transaction, so it leaves the
        // previous range intact for the assistant hand-off.
        if (transaction.selectionSet) return { range: rangeFromSelection(transaction) }
        if (!transaction.docChanged || !previous.range) return previous
        return { range: mapRange(previous.range, transaction) }
      },
    },
    props: {
      decorations: (state) => {
        const range = persistentSelectionPluginKey.getState(state)?.range
        if (!range || range.from >= range.to) return DecorationSet.empty
        return DecorationSet.create(state.doc, [
          Decoration.inline(range.from, range.to, { class: PERSISTENT_SELECTION_CLASS }),
        ])
      },
    },
  })
}

/** Creation-only extension. Canvas text nodes intentionally do not opt in. */
export const PersistentSelectionExtension = Extension.create({
  name: 'persistentSelection',
  addProseMirrorPlugins() {
    return [createPersistentSelectionPlugin()]
  },
})
