import React from 'react'
import { useTranslation } from 'react-i18next'
import { Extension } from '@tiptap/core'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Plugin } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { WorkbenchButton } from '../../../design'
import { cn } from '../../../utils/cn'
import { diffPromptSegments, type PromptDiffSegment } from '../../generationCanvas/nodes/promptDiff'

function promptContent(text: string): { type: 'doc'; content: Array<{ type: 'paragraph'; content: Array<{ type: 'text'; text: string }> }> } {
  return { type: 'doc', content: [{ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] }] }
}

function createDiffExtension(segmentsRef: React.MutableRefObject<PromptDiffSegment[]>): Extension {
  return Extension.create({
    name: 'storyboardPromptDiff',
    addProseMirrorPlugins() {
      return [new Plugin({
        props: {
          decorations: (state) => {
            let position = 1
            const decorations = segmentsRef.current.flatMap((segment) => {
              const from = position
              position += segment.text.length
              if (segment.kind === 'keep' || from === position) return []
              const className = segment.kind === 'removed'
                ? 'text-nomi-ink-40 line-through decoration-nomi-ink-40'
                : 'bg-nomi-accent-soft text-nomi-ink-80'
              return [Decoration.inline(from, position, { class: className })]
            })
            return DecorationSet.create(state.doc, decorations)
          },
        },
      })]
    },
  })
}

export default function StoryboardPromptDiff({
  original,
  proposed,
  onApprove,
  onDiscard,
  onContinueEdit,
}: {
  original: string
  proposed: string
  onApprove: () => void
  onDiscard: () => void
  onContinueEdit: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const segments = React.useMemo(() => diffPromptSegments(original, proposed), [original, proposed])
  const segmentsRef = React.useRef(segments)
  segmentsRef.current = segments
  const editor = useEditor({
    extensions: [StarterKit, createDiffExtension(segmentsRef)],
    content: promptContent(segments.map((segment) => segment.text).join('')),
    editable: false,
  })
  const contentKey = segments.map((segment) => `${segment.kind}:${segment.text}`).join('\u0000')
  React.useEffect(() => {
    if (!editor || editor.isDestroyed) return
    editor.commands.setContent(promptContent(segments.map((segment) => segment.text).join('')), { emitUpdate: false })
  }, [contentKey, editor, segments])

  return (
    <div className="flex flex-col gap-2 rounded-nomi-sm border border-nomi-accent-soft bg-nomi-paper px-2.5 py-2" data-storyboard-prompt-diff="true">
      <EditorContent editor={editor} className={cn('text-body-sm leading-normal text-nomi-ink-80', '[&_.ProseMirror]:outline-none [&_.ProseMirror]:whitespace-pre-wrap')} />
      <div className="flex flex-wrap items-center justify-end gap-1.5">
        <WorkbenchButton variant="primary" size="sm" onClick={onApprove} data-storyboard-diff-action="accept">
          {t('storyboardEditor.patchPreview.accept')}
        </WorkbenchButton>
        <WorkbenchButton variant="default" size="sm" onClick={onDiscard} data-storyboard-diff-action="discard">
          {t('storyboardEditor.patchPreview.discard')}
        </WorkbenchButton>
        <WorkbenchButton variant="default" size="sm" onClick={onContinueEdit} data-storyboard-diff-action="continue-edit">
          {t('storyboardEditor.patchPreview.continueEdit')}
        </WorkbenchButton>
      </div>
    </div>
  )
}
