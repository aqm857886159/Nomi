import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { createPortal } from 'react-dom'
import { IconX } from '@tabler/icons-react'
import { DecisionBar, NomiLogoMark } from '../../../design'
import { addUserPrompt, type PromptMediaType, type PromptReferenceImage } from '../../api/promptLibraryApi'
import { notify } from '../../../ui/notificationPolicy'
import type { TranslationKey } from '../../../i18n/translationKey'
import { cn } from '../../../utils/cn'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { getGenerationNodeExecutionKind } from '../model/generationNodeKinds'

type SelectionToolbarState = {
  text: string
  nodeId: string
  left: number
  top: number
}

// 提示词只此一家（素材面收敛 2026-07-22）：画布选中文字直存主提示词库，类型收敛 image|video。
// label 在渲染处翻译；存整键（理由见 i18n/translationKey.ts）。
const PROMPT_TYPE_OPTIONS = [
  { id: 'image', labelKey: 'generationCommon.savePrompt.imageType' },
  { id: 'video', labelKey: 'generationCommon.savePrompt.videoType' },
] as const satisfies readonly { id: PromptMediaType; labelKey: TranslationKey }[]

type DraftState = {
  text: string
  promptType: PromptMediaType
  referenceImages: PromptReferenceImage[]
}

type Props = {
  nodes: readonly GenerationCanvasNode[]
  disabled?: boolean
}

function elementFromSelectionNode(node: Node | null): Element | null {
  if (!node) return null
  return node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement
}

function rectFromSelection(selection: Selection): DOMRect | null {
  if (selection.rangeCount === 0) return null
  const range = selection.getRangeAt(0)
  const rect = range.getBoundingClientRect()
  if (rect.width > 0 || rect.height > 0) return rect
  const first = range.getClientRects()[0]
  return first ?? null
}

function promptTypeFromNode(node: GenerationCanvasNode | null): PromptMediaType {
  return node && getGenerationNodeExecutionKind(node.kind) === 'video' ? 'video' : 'image'
}

function referenceImagesFromNode(node: GenerationCanvasNode | null): DraftState['referenceImages'] {
  if (!node?.result?.url) return []
  const executionKind = getGenerationNodeExecutionKind(node.kind)
  if (executionKind !== 'image' && executionKind !== 'video') return []
  return [{
    url: node.result.thumbnailUrl || node.result.url,
    title: node.title,
    sourceUrl: node.result.providerUrl,
  }]
}

export function SelectionPromptSaveController({ nodes, disabled = false }: Props): JSX.Element | null {
  const { t } = useTranslation()
  const nodeById = React.useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes])
  const [toolbar, setToolbar] = React.useState<SelectionToolbarState | null>(null)
  const [saveError, setSaveError] = React.useState('')
  const [draft, setDraft] = React.useState<DraftState | null>(null)
  const draftRevision = React.useRef(0)
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    if (disabled) return undefined
    const updateFromSelection = (): void => {
      if (draft) return
      const selection = window.getSelection()
      const text = selection?.toString().trim() ?? ''
      if (!selection || selection.isCollapsed || !text) {
        setToolbar(null)
        return
      }
      const element = elementFromSelectionNode(selection.anchorNode)
      if (!element || element.closest('[data-selection-prompt-ui="true"]')) {
        setToolbar(null)
        return
      }
      const nodeElement = element.closest<HTMLElement>('.generation-canvas-v2-node[data-node-id]')
      const nodeId = nodeElement?.dataset.nodeId ?? ''
      const node = nodeId ? nodeById.get(nodeId) ?? null : null
      const executionKind = node ? getGenerationNodeExecutionKind(node.kind) : undefined
      if (executionKind !== 'text' && executionKind !== 'image' && executionKind !== 'video') {
        setToolbar(null)
        return
      }
      const rect = rectFromSelection(selection)
      if (!rect) {
        setToolbar(null)
        return
      }
      setToolbar({
        text,
        nodeId,
        left: rect.left + rect.width / 2,
        top: Math.max(8, rect.top - 42),
      })
    }
    const scheduleUpdate = (): void => {
      window.setTimeout(updateFromSelection, 0)
    }
    document.addEventListener('pointerup', scheduleUpdate, true)
    document.addEventListener('keyup', scheduleUpdate, true)
    document.addEventListener('selectionchange', scheduleUpdate)
    return () => {
      document.removeEventListener('pointerup', scheduleUpdate, true)
      document.removeEventListener('keyup', scheduleUpdate, true)
      document.removeEventListener('selectionchange', scheduleUpdate)
    }
  }, [disabled, draft, nodeById])

  const openDraft = React.useCallback(() => {
    draftRevision.current += 1
    setSaving(false)
    setSaveError('')
    if (!toolbar) return
    const node = nodeById.get(toolbar.nodeId) ?? null
    setDraft({
      text: toolbar.text,
      promptType: promptTypeFromNode(node),
      referenceImages: referenceImagesFromNode(node),
    })
  }, [nodeById, toolbar])

  const closeDraft = React.useCallback(() => {
    if (saving) return
    draftRevision.current += 1
    setSaving(false)
    setDraft(null)
  }, [saving])

  const saveDraft = React.useCallback(() => {
    const text = draft?.text.trim()
    if (!draft || !text || saving) return
    const revision = draftRevision.current
    setSaving(true)
    setSaveError('')
    void addUserPrompt({
      title: text.slice(0, 24),
      prompt: text,
      promptType: draft.promptType,
      tags: ['画布选中'],
      referenceImages: draft.referenceImages,
    })
      .then(() => {
        if (draftRevision.current !== revision) return
        setDraft(null)
        setToolbar(null)
        window.getSelection()?.removeAllRanges()
      })
      .catch((error) => {
        if (draftRevision.current !== revision) return
        notify({ identity: `selection-prompt:${revision}`, reason: 'save-failed', message: t('generationCommon.savePrompt.saveFailed', { message: error instanceof Error ? error.message : String(error) }), type: 'error', level: 'inline', present: setSaveError })
      })
      .finally(() => { if (draftRevision.current === revision) setSaving(false) })
  }, [draft, saving, t])

  if (typeof document === 'undefined') return null

  return createPortal(
    <>
      {toolbar && !draft ? (
        <button
          type="button"
          data-selection-prompt-ui="true"
          className={cn(
            'fixed z-[100] inline-flex h-9 -translate-x-1/2 items-center gap-2 rounded-full border border-nomi-line px-3',
            'bg-nomi-paper text-nomi-ink shadow-nomi-lg cursor-pointer',
            'transition-[background,color,transform] duration-nomi-fast ease-nomi-fast hover:-translate-y-0.5 hover:text-nomi-accent',
          )}
          style={{ left: toolbar.left, top: toolbar.top }}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={openDraft}
        >
          <NomiLogoMark size={18} />
          <span className="text-caption font-semibold">{t('generationCommon.savePrompt.title')}</span>
        </button>
      ) : null}
      {draft ? (
        <div
          data-selection-prompt-ui="true"
          className="fixed inset-0 z-[101] grid place-items-center bg-black/20"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) closeDraft()
          }}
        >
          <section
            className="flex max-h-[min(680px,calc(100vh-48px))] w-[min(560px,calc(100vw-40px))] flex-col overflow-hidden rounded-nomi border border-nomi-line bg-nomi-paper shadow-nomi-lg"
            aria-label={t('generationCommon.savePrompt.title')}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <header className="flex h-14 shrink-0 items-center justify-between border-b border-nomi-line-soft px-5">
              <div className="flex items-center gap-2.5 text-body font-semibold text-nomi-ink">
                <NomiLogoMark size={22} />
                {t('generationCommon.savePrompt.title')}
              </div>
              <button type="button" className="grid size-8 place-items-center rounded-nomi-sm border-0 bg-transparent text-nomi-ink-40 hover:bg-nomi-ink-05 hover:text-nomi-ink" onClick={closeDraft} disabled={saving}>
                <IconX size={17} stroke={1.8} aria-hidden />
              </button>
            </header>
            <div className="grid min-h-0 gap-4 overflow-y-auto p-5">
              {draft.referenceImages.length > 0 ? (
                <div className="relative overflow-hidden rounded-nomi-sm bg-nomi-bg">
                  <img src={draft.referenceImages[0].url} alt="" className="block aspect-video max-h-56 w-full object-cover" />
                  <button
                    type="button"
                    className="absolute right-2 top-2 grid size-7 place-items-center rounded-full border-0 bg-black/55 text-white hover:bg-black/70"
                    aria-label={t('generationCommon.savePrompt.removeReference')}
                    disabled={saving}
                    onClick={() => setDraft((current) => current ? { ...current, referenceImages: [] } : current)}
                  >
                    <IconX size={14} stroke={2} aria-hidden />
                  </button>
                </div>
              ) : null}
              <label className="grid gap-1.5">
                <span className="text-caption font-medium text-nomi-ink-60">{t('generationCommon.savePrompt.type')}</span>
                <select
                  className="h-11 rounded-nomi-sm border border-nomi-line bg-nomi-bg px-3 text-body-sm text-nomi-ink outline-none"
                  value={draft.promptType}
                  disabled={saving}
                  onChange={(event) =>
                    setDraft((current) => current ? { ...current, promptType: event.target.value === 'video' ? 'video' : 'image' } : current)
                  }
                >
                  {PROMPT_TYPE_OPTIONS.map((option) => (
                    <option key={option.id} value={option.id}>{t(option.labelKey)}</option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1.5">
                <span className="text-caption font-medium text-nomi-ink-60">{t('generationCommon.savePrompt.selectedText')}</span>
                <textarea
                  className="h-44 min-h-44 resize-none overflow-y-auto rounded-nomi-sm border border-nomi-line bg-nomi-bg p-3 text-body leading-7 text-nomi-ink outline-none"
                  value={draft.text}
                  disabled={saving}
                  onChange={(event) => setDraft((current) => current ? { ...current, text: event.target.value } : current)}
                />
              </label>
              {saveError ? <p role="status" className="m-0 text-caption text-nomi-danger">{saveError}</p> : null}
              <DecisionBar
                className="pt-1"
                size="md"
                cancelLabel={t('generationCommon.savePrompt.cancel')}
                onCancel={closeDraft}
                cancelDisabled={saving}
                primaryLabel={t('generationCommon.savePrompt.save')}
                onPrimary={saveDraft}
                primaryDisabled={saving || !draft.text.trim()}
              />
            </div>
          </section>
        </div>
      ) : null}
    </>,
    document.body,
  )
}
