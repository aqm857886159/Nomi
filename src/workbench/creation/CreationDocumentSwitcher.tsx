// 创作页编辑器工具条最左：当前文稿名 ▾（样张 design/shell-space）。
// 「创作内容」整列住进左栏「文稿」抽屉之后，换文稿不必开抽屉——这里一颗下拉直接切。
// 菜单用 WorkbenchMenu（Radix），写口与抽屉里那棵树同一组 store 动作（setActiveDocumentId / setActiveStoryboardId）。
import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { IconChevronDown, IconFileText, IconMovie, IconPlus } from '@tabler/icons-react'
import { WorkbenchMenu, type WorkbenchMenuNode } from '../../design'
import { cn } from '../../utils/cn'
import { useWorkbenchStore } from '../workbenchStore'

export function CreationDocumentSwitcher(): JSX.Element {
  const { t } = useTranslation()
  const documents = useWorkbenchStore((state) => state.workbenchDocuments)
  const activeDocumentId = useWorkbenchStore((state) => state.activeDocumentId)
  const designsByDocumentId = useWorkbenchStore((state) => state.storyboardDesignsByDocumentId)
  const setActiveDocumentId = useWorkbenchStore((state) => state.setActiveDocumentId)
  const setActiveStoryboardId = useWorkbenchStore((state) => state.setActiveStoryboardId)
  const setWorkspaceMode = useWorkbenchStore((state) => state.setWorkspaceMode)
  const addWorkbenchDocument = useWorkbenchStore((state) => state.addWorkbenchDocument)
  const [open, setOpen] = React.useState(false)
  const [rect, setRect] = React.useState({ left: 0, top: 0, width: 0, height: 0 })
  const triggerRef = React.useRef<HTMLButtonElement | null>(null)
  const active = documents.find((document) => document.id === activeDocumentId) ?? documents[0]
  const title = active?.title || t('runtime.project.untitled')
  const designs = active ? designsByDocumentId[active.id] ?? [] : []
  const items: WorkbenchMenuNode[] = [
    {
      kind: 'radio',
      id: 'documents',
      label: t('shellSpace.docSwitcher.documents'),
      value: active?.id ?? '',
      onValueChange: (id) => {
        setActiveDocumentId(id)
        setActiveStoryboardId(null)
        setWorkspaceMode('creation')
      },
      options: documents.map((document) => ({ id: document.id, value: document.id, label: document.title || t('runtime.project.untitled') })),
    },
    ...(designs.length ? [
      { kind: 'separator' as const, id: 'sep-designs' },
      {
        kind: 'group' as const,
        id: 'designs',
        label: t('shellSpace.docSwitcher.storyboards'),
        items: designs.map((design) => ({
          id: `design:${design.id}`,
          label: design.title || t('storyboardEditor.planCard.defaultTitle'),
          icon: IconMovie,
          onSelect: () => {
            setActiveStoryboardId(design.id, design.documentId)
            setWorkspaceMode('storyboard')
          },
        })),
      },
    ] : []),
    { kind: 'separator', id: 'sep-new' },
    { id: 'new', label: t('shellSpace.docSwitcher.newDocument'), icon: IconPlus, onSelect: () => addWorkbenchDocument() },
  ]
  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={cn(
          'inline-flex h-7 min-w-0 max-w-[220px] shrink-0 items-center gap-1.5 rounded-nomi-sm px-2',
          'bg-transparent text-body-sm font-medium text-nomi-ink hover:bg-nomi-ink-05',
        )}
        aria-label={t('shellSpace.docSwitcher.aria', { title })}
        aria-haspopup="menu"
        aria-expanded={open}
        data-creation-document-switcher
        data-user-content
        onClick={() => {
          const box = triggerRef.current?.getBoundingClientRect()
          if (box) setRect({ left: box.left, top: box.top, width: box.width, height: box.height })
          setOpen((value) => !value)
        }}
      >
        <IconFileText size={15} stroke={1.7} className="shrink-0 text-nomi-ink-60" />
        <span className="min-w-0 truncate">{title}</span>
        <IconChevronDown size={14} stroke={1.8} className="shrink-0 text-nomi-ink-40" />
      </button>
      <WorkbenchMenu open={open} onOpenChange={setOpen} anchorRect={rect} items={items} className="min-w-[220px]" ariaLabel={t('shellSpace.docSwitcher.aria', { title })} />
    </>
  )
}
