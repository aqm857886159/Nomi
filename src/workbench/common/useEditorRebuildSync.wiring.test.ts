import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { getSchema } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { EditorState, type Transaction } from '@tiptap/pm/state'
import type { Editor, JSONContent } from '@tiptap/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createControlledEditorSync } from './controlledEditorSync'
import { useEditorRebuildSync } from './useEditorRebuildSync'
import { contentToPrompt, promptToContent } from '../assets/promptEditorContent'
import PromptEditor from '../assets/PromptEditor'
import { useNomiRichTextEditor } from './useNomiRichTextEditor'

const schema = getSchema([StarterKit])
type TestEditor = ReturnType<typeof makeEditor>
let currentEditor: TestEditor | null = null
let rebuild = false

function makeEditor(content: JSONContent = promptToContent('')) {
  let state = EditorState.create({ schema, doc: schema.nodeFromJSON(content) })
  const setContent = (next: JSONContent) => { state = state.apply(state.tr.replaceWith(0, state.doc.content.size, schema.nodeFromJSON(next).content)) }
  return {
    get state() { return state },
    getJSON: () => state.doc.toJSON(),
    view: { dispatch: (tr: Transaction) => { state = state.apply(tr) } },
    commands: { setContent },
    isDestroyed: false,
    isEditable: true,
    setEditable: () => undefined,
  }
}

vi.mock('@tiptap/react', () => ({
  EditorContent: () => null,
  useEditor: (options: { content?: JSONContent }) => {
    if (!currentEditor || rebuild) {
      currentEditor = makeEditor(options.content)
      rebuild = false
    }
    return currentEditor
  },
}))

function browserContainer(): HTMLElement {
  const document = {
    nodeType: 9,
    documentElement: { namespaceURI: 'http://www.w3.org/1999/xhtml' },
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    defaultView: null as unknown,
    activeElement: null as unknown,
  }
  class FakeHTMLElement {}
  class FakeHTMLIFrameElement extends FakeHTMLElement {}
  const window = { document, addEventListener: () => undefined, removeEventListener: () => undefined, HTMLElement: FakeHTMLElement, HTMLIFrameElement: FakeHTMLIFrameElement }
  document.defaultView = window
  const container = {
    nodeType: 1, nodeName: 'DIV', tagName: 'DIV',
    namespaceURI: 'http://www.w3.org/1999/xhtml', ownerDocument: document,
    addEventListener: () => undefined, removeEventListener: () => undefined, firstChild: null,
  } as unknown as HTMLElement
  document.activeElement = container
  vi.stubGlobal('window', window)
  vi.stubGlobal('document', document)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  return container
}

describe('编辑器重建接线：第一次绘制前文档就是 owner 当前值', () => {
  let root: Root
  beforeEach(() => {
    currentEditor = null
    rebuild = false
    root = createRoot(browserContainer())
  })
  afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals() })

  it('共享钩子先灌入新实例，再用灌入后的文档重开账', async () => {
    const sync = createControlledEditorSync('')
    const reset = vi.spyOn(sync, 'reset')
    let editor = makeEditor()
    let owner = ''
    const Harness = () => {
      useEditorRebuildSync(editor as unknown as Editor, sync, {
        serialize: (current) => contentToPrompt(current.getJSON()),
        hydrate: (current) => { (current as unknown as TestEditor).commands.setContent(promptToContent(owner)) },
      })
      return null
    }
    await act(async () => root.render(React.createElement(Harness)))
    owner = '海边的白色灯塔'
    sync.emit(owner)
    editor = makeEditor()
    await act(async () => root.render(React.createElement(Harness)))
    expect(contentToPrompt(editor.getJSON())).toBe(owner)
    expect(reset).toHaveBeenLastCalledWith(owner)
  })

  it('PromptEditor：owner 从空变有字后，重建的新实例在 layout effect 后已有字', async () => {
    let value = ''
    let beforePaint = ''
    const Harness = () => {
      React.useLayoutEffect(() => { beforePaint = contentToPrompt(currentEditor!.getJSON()) })
      return React.createElement(PromptEditor, { value, onChange: () => undefined, placeholder: '提示词' })
    }
    await act(async () => root.render(React.createElement(Harness)))
    value = '海边的白色灯塔'
    await act(async () => root.render(React.createElement(Harness)))
    rebuild = true
    await act(async () => root.render(React.createElement(Harness)))
    expect(beforePaint).toBe(value)
  })

  it('富文本内核：占位字触发重建时，新实例从当前 content 创建', async () => {
    let content = promptToContent('')
    let placeholder = '原占位字'
    let beforePaint = ''
    const Harness = () => {
      const { editor } = useNomiRichTextEditor({ content, placeholder })
      React.useLayoutEffect(() => { beforePaint = contentToPrompt(editor!.getJSON()) })
      return null
    }
    await act(async () => root.render(React.createElement(Harness)))
    content = promptToContent('海边的白色灯塔')
    await act(async () => root.render(React.createElement(Harness)))
    placeholder = '新占位字'
    rebuild = true
    await act(async () => root.render(React.createElement(Harness)))
    expect(beforePaint).toBe('海边的白色灯塔')
  })
})
