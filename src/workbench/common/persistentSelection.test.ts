import { describe, expect, it } from 'vitest'
import { Schema } from '@tiptap/pm/model'
import { EditorState, TextSelection } from '@tiptap/pm/state'
import { Decoration } from '@tiptap/pm/view'
import { createPersistentSelectionPlugin, persistentSelectionPluginKey, PERSISTENT_SELECTION_CLASS } from './persistentSelection'

const schema = new Schema({
  nodes: {
    doc: { content: 'paragraph+' },
    paragraph: { content: 'text*', group: 'block' },
    text: { group: 'inline' },
  },
})

function makeState(text = 'abcdef') {
  const paragraph = schema.nodes.paragraph.create(null, schema.text(text))
  const doc = schema.topNodeType.create(null, paragraph)
  return EditorState.create({ schema, doc, plugins: [createPersistentSelectionPlugin()] })
}

function selectedState(text = 'abcdef') {
  const state = makeState(text)
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, 1, 4)))
}

function decorationsFor(state: EditorState): Decoration[] {
  const plugin = state.plugins[0]
  const source = plugin.props.decorations?.call(plugin, state)
  const decorations: Decoration[] = []
  source?.forEachSet((set) => decorations.push(...set.find()))
  return decorations
}

describe('persistent selection', () => {
  it('keeps a non-empty range and exposes an accent decoration after focus moves away', () => {
    const state = selectedState()
    const pluginState = persistentSelectionPluginKey.getState(state)
    expect(pluginState?.range).toEqual({ from: 1, to: 4 })

    const decorations = decorationsFor(state)
    expect(decorations).toHaveLength(1)
    const attrs = (decorations[0] as unknown as { type: { attrs: { class?: string } } }).type.attrs
    expect(attrs.class).toBe(PERSISTENT_SELECTION_CLASS)
  })

  it('maps the saved range when text is inserted before it', () => {
    const state = selectedState()
    const mapped = state.apply(state.tr.insertText('X', 1))
    expect(persistentSelectionPluginKey.getState(mapped)?.range).toEqual({ from: 2, to: 5 })
  })

  it('clears the decoration when the user collapses the selection', () => {
    const state = selectedState()
    const collapsed = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 4)))
    expect(persistentSelectionPluginKey.getState(collapsed)?.range).toBeNull()
    expect(decorationsFor(collapsed)).toHaveLength(0)
  })

  it('clears the old range when a replacement transaction leaves a cursor', () => {
    const state = selectedState()
    const replaced = state.apply(state.tr.insertText('new', 1, 4))
    expect(replaced.selection.empty).toBe(true)
    expect(persistentSelectionPluginKey.getState(replaced)?.range).toBeNull()
  })
})
