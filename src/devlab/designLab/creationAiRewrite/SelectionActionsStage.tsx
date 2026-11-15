import React, { type JSX } from 'react'
import { EditorContent } from '@tiptap/react'
import SelectionGeneratePopover from '../../../workbench/creation/SelectionGeneratePopover'
import { useNomiRichTextEditor } from '../../../workbench/common/useNomiRichTextEditor'
import { holdDesignLabReady } from '../labReadyHold'
import { useLabLocale } from '../hostConfig/useLabLocale'

/**
 * 创作区选区浮条「拆成镜头」挪位（样张 B，用户 2026-11-12 拍板）的三个状态。
 *
 * 浮条是**生产组件本体**（`SelectionGeneratePopover`），编辑器是生产的 `useNomiRichTextEditor`；
 * 这里只决定两件宿主给不给：「AI 编辑」入口（`onAiEdit`）和常驻 Agent 的分镜启动器（`launchStoryboard`）。
 * 生产里 `WorkbenchEditor` 两样都接；没有启动器 = 不在创作面（「拆成镜头」灰），没有「AI 编辑」= 编辑器还没挂上改写控制器。
 */
export type SelectionActionsScene = 'ready' | 'storyboard-unavailable' | 'no-ai-edit'

const SENTENCE: Record<'zh-CN' | 'en', string> = {
  'zh-CN': '雨夜的街头，女孩撑着红伞穿过霓虹闪烁的夜市。',
  en: 'A girl walks through the rain-soaked night market holding a red umbrella.',
}

const NOOP = (): void => undefined

export function SelectionActionsStage({ scene, locale }: { scene: SelectionActionsScene; locale: 'zh-CN' | 'en' }): JSX.Element {
  const ready = useLabLocale(locale, `selection-actions:${scene}`)
  const sentence = SENTENCE[locale]
  const content = React.useMemo(() => ({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: sentence }] }],
  }), [sentence])
  const [selection, setSelection] = React.useState({ text: '', version: 0 })
  const onSelectionChange = React.useCallback((text: string) => {
    setSelection((current) => ({ text, version: current.version + 1 }))
  }, [])
  const { editor } = useNomiRichTextEditor({ content, onSelectionChange })

  React.useEffect(() => {
    if (!ready || !editor) return undefined
    const release = holdDesignLabReady(`selection-actions:${scene}`)
    let from = 0
    let to = 0
    editor.state.doc.descendants((node, pos) => {
      if (node.isText && node.text === sentence) {
        from = pos
        to = pos + node.nodeSize
      }
    })
    editor.commands.setTextSelection({ from, to })
    window.requestAnimationFrame(() => window.requestAnimationFrame(release))
    return release
  }, [ready, editor, scene, sentence])

  return (
    <div data-selection-actions={scene} style={{ width: 760, height: 200, position: 'relative' }}>
      <section className="workbench-editor relative w-full h-full grid grid-rows-[minmax(0,1fr)]" data-creation-editor="true">
        <SelectionGeneratePopover
          editor={editor}
          selectedText={selection.text}
          selectionVersion={selection.version}
          launchStoryboard={scene === 'storyboard-unavailable' ? null : NOOP}
          onAiEdit={scene === 'no-ai-edit' ? undefined : NOOP}
        />
        <div className="workbench-editor__scroll min-w-0 min-h-0 overflow-auto pt-[72px] px-8">
          <EditorContent editor={editor} />
        </div>
      </section>
    </div>
  )
}
