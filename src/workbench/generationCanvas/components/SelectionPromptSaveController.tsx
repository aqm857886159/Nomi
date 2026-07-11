import React from 'react'
import { createPortal } from 'react-dom'
import { IconX } from '@tabler/icons-react'
import { NomiLogoMark } from '../../../design'
import { getDesktopActiveProjectId } from '../../../desktop/activeProject'
import {
  BROWSER_ASSET_LIBRARY_UPDATED_EVENT,
  readBrowserPromptCategories,
  saveBrowserPromptCard,
  type SaveBrowserPromptCardInput,
} from '../../../ui/browser/assets/browserAssetLibraryStorage'
import { toast } from '../../../ui/toast'
import { cn } from '../../../utils/cn'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { getGenerationNodeExecutionKind } from '../model/generationNodeKinds'

type SelectionToolbarState = {
  text: string
  nodeId: string
  left: number
  top: number
}

type DraftState = {
  text: string
  promptType: SaveBrowserPromptCardInput['promptType']
  referenceImages: NonNullable<SaveBrowserPromptCardInput['referenceImages']>
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

function promptTypeFromNode(node: GenerationCanvasNode | null): SaveBrowserPromptCardInput['promptType'] {
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
  const nodeById = React.useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes])
  const [toolbar, setToolbar] = React.useState<SelectionToolbarState | null>(null)
  const [draft, setDraft] = React.useState<DraftState | null>(null)
  const [promptCategories, setPromptCategories] = React.useState(() => readBrowserPromptCategories(getDesktopActiveProjectId()))

  React.useEffect(() => {
    const refresh = (): void => setPromptCategories(readBrowserPromptCategories(getDesktopActiveProjectId()))
    window.addEventListener(BROWSER_ASSET_LIBRARY_UPDATED_EVENT, refresh)
    return () => window.removeEventListener(BROWSER_ASSET_LIBRARY_UPDATED_EVENT, refresh)
  }, [])

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
    if (!toolbar) return
    const node = nodeById.get(toolbar.nodeId) ?? null
    setPromptCategories(readBrowserPromptCategories(getDesktopActiveProjectId()))
    setDraft({
      text: toolbar.text,
      promptType: promptTypeFromNode(node),
      referenceImages: referenceImagesFromNode(node),
    })
  }, [nodeById, toolbar])

  const closeDraft = React.useCallback(() => {
    setDraft(null)
  }, [])

  const saveDraft = React.useCallback(() => {
    if (!draft?.text.trim()) return
    const saved = saveBrowserPromptCard({
      projectId: getDesktopActiveProjectId(),
      prompt: draft.text,
      promptType: draft.promptType,
      referenceImages: draft.referenceImages,
    })
    if (saved) {
      toast('已保存到素材盒提示词库', 'success')
      setDraft(null)
      setToolbar(null)
      window.getSelection()?.removeAllRanges()
    }
  }, [draft])

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
            'transition-[background,color,transform] duration-[var(--nomi-transition-fast)] hover:-translate-y-0.5 hover:text-nomi-accent',
          )}
          style={{ left: toolbar.left, top: toolbar.top }}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={openDraft}
        >
          <NomiLogoMark size={18} />
          <span className="text-caption font-semibold">保存提示词</span>
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
            aria-label="保存提示词"
            onPointerDown={(event) => event.stopPropagation()}
          >
            <header className="flex h-14 shrink-0 items-center justify-between border-b border-nomi-line-soft px-5">
              <div className="flex items-center gap-2.5 text-body font-semibold text-nomi-ink">
                <NomiLogoMark size={22} />
                保存提示词
              </div>
              <button type="button" className="grid size-8 place-items-center rounded-nomi-sm border-0 bg-transparent text-nomi-ink-45 hover:bg-nomi-ink-05 hover:text-nomi-ink" onClick={closeDraft}>
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
                    aria-label="移除参考图"
                    onClick={() => setDraft((current) => current ? { ...current, referenceImages: [] } : current)}
                  >
                    <IconX size={14} stroke={2} aria-hidden />
                  </button>
                </div>
              ) : null}
              <label className="grid gap-1.5">
                <span className="text-caption font-medium text-nomi-ink-60">提示词类型</span>
                <select
                  className="h-11 rounded-nomi-sm border border-nomi-line bg-nomi-bg px-3 text-body-sm text-nomi-ink outline-none"
                  value={draft.promptType}
                  onChange={(event) =>
                    setDraft((current) => current ? { ...current, promptType: event.target.value } : current)
                  }
                >
                  {promptCategories.map((category) => (
                    <option key={category.id} value={category.id}>{category.label}</option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1.5">
                <span className="text-caption font-medium text-nomi-ink-60">选中文字</span>
                <textarea
                  className="h-44 min-h-44 resize-none overflow-y-auto rounded-nomi-sm border border-nomi-line bg-nomi-bg p-3 text-body leading-7 text-nomi-ink outline-none"
                  value={draft.text}
                  onChange={(event) => setDraft((current) => current ? { ...current, text: event.target.value } : current)}
                />
              </label>
              <div className="flex items-center justify-end gap-3 pt-1">
                <button type="button" className="h-10 rounded-nomi-sm border border-nomi-line bg-transparent px-4 text-body-sm text-nomi-ink-60 hover:bg-nomi-ink-05" onClick={closeDraft}>
                  取消
                </button>
                <button type="button" className="h-10 rounded-nomi-sm border-0 bg-nomi-ink px-5 text-body-sm font-semibold text-nomi-paper hover:bg-nomi-accent" onClick={saveDraft}>
                  保存
                </button>
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </>,
    document.body,
  )
}
