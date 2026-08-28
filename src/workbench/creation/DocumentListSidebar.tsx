import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconFileText, IconPlus, IconTrash } from '@tabler/icons-react'
import { confirmDialog } from '../../design'
import { cn } from '../../utils/cn'
import { useWorkbenchStore } from '../workbenchStore'

/**
 * 创作页左侧「原稿列表」侧栏（P2 多文档）。
 * 原稿 = 文档；列表支持新建 / 切换 / 双击改名 / 删除。复用 CategoryItem 的视觉范式
 * （图标 + 标题 + 选中态 accent-soft），但内容是 workbenchDocuments 集合。
 */
export default function DocumentListSidebar(): JSX.Element {
  const { t } = useTranslation()
  const documents = useWorkbenchStore((state) => state.workbenchDocuments)
  const activeDocumentId = useWorkbenchStore((state) => state.activeDocumentId)
  const setActiveDocumentId = useWorkbenchStore((state) => state.setActiveDocumentId)
  const addWorkbenchDocument = useWorkbenchStore((state) => state.addWorkbenchDocument)
  const deleteWorkbenchDocument = useWorkbenchStore((state) => state.deleteWorkbenchDocument)
  const renameWorkbenchDocument = useWorkbenchStore((state) => state.renameWorkbenchDocument)
  const [editingId, setEditingId] = React.useState<string | null>(null)
  const settledRef = React.useRef(false)

  React.useEffect(() => {
    if (editingId) settledRef.current = false
  }, [editingId])

  const onDelete = React.useCallback(
    async (id: string, title: string) => {
      const confirmed = await confirmDialog({
        title: t('creationAi.documentList.deleteTitle'),
        message: t('creationAi.documentList.deleteMessage', { title }),
        confirmLabel: t('creationAi.documentList.deleteConfirm'),
        danger: true,
      })
      if (confirmed) deleteWorkbenchDocument(id)
    },
    [deleteWorkbenchDocument, t],
  )

  const onCommitName = React.useCallback(
    (id: string, value: string) => {
      renameWorkbenchDocument(id, value)
      setEditingId(null)
    },
    [renameWorkbenchDocument],
  )

  return (
    <aside
      className="flex h-full w-[200px] shrink-0 flex-col border-r border-nomi-line-soft bg-nomi-bg"
      aria-label={t('creationAi.documentList.aria')}
    >
      <div className="px-2 pb-1 pt-3 text-micro font-medium uppercase tracking-wide text-nomi-ink-40">
        {t('creationAi.documentList.count', { count: documents.length })}
      </div>
      <div className="flex-1 overflow-y-auto px-1.5 pb-2">
        {documents.length === 0 ? (
          <div className="px-2 py-3 text-caption text-nomi-ink-40">{t('creationAi.documentList.empty')}</div>
        ) : (
          documents.map((doc) => {
            const active = doc.id === activeDocumentId
            if (editingId === doc.id) {
              return (
                <div
                  key={doc.id}
                  className="flex w-full items-center gap-2 rounded-nomi-sm border border-nomi-accent/30 bg-nomi-accent/10 px-2 py-1.5"
                >
                  <IconFileText size={16} stroke={1.5} className="shrink-0 text-nomi-ink-40" aria-hidden />
                  <input
                    autoFocus
                    defaultValue={doc.title}
                    aria-label={t('creationAi.documentList.renameAria')}
                    onFocus={(event) => event.currentTarget.select()}
                    onClick={(event) => event.stopPropagation()}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        settledRef.current = true
                        onCommitName(doc.id, event.currentTarget.value)
                      } else if (event.key === 'Escape') {
                        settledRef.current = true
                        setEditingId(null)
                      }
                    }}
                    onBlur={(event) => {
                      if (!settledRef.current) {
                        settledRef.current = true
                        onCommitName(doc.id, event.currentTarget.value)
                      }
                    }}
                    className="min-w-0 flex-1 border-b border-nomi-accent/50 bg-transparent text-caption text-nomi-ink outline-none"
                  />
                </div>
              )
            }
            return (
              <div
                key={doc.id}
                className={cn(
                  'group flex w-full items-center gap-2 rounded-nomi-sm px-2 py-1.5 transition-colors',
                  active ? 'bg-nomi-accent-soft text-nomi-accent' : 'text-nomi-ink-80 hover:bg-nomi-ink-05',
                )}
              >
                <button
                  type="button"
                  onClick={() => setActiveDocumentId(doc.id)}
                  onDoubleClick={() => setEditingId(doc.id)}
                  className={cn(
                    'flex min-w-0 flex-1 items-center gap-2 text-left text-caption leading-tight',
                    'bg-transparent border-0 p-0 cursor-pointer',
                    active ? 'text-nomi-accent' : 'text-nomi-ink-80',
                  )}
                  data-document-id={doc.id}
                  data-active={active ? 'true' : 'false'}
                >
                  <IconFileText size={16} stroke={1.5} className="shrink-0" aria-hidden />
                  <span className="truncate">{doc.title || t('runtime.project.untitled')}</span>
                </button>
                {active ? (
                  <button
                    type="button"
                    onClick={() => void onDelete(doc.id, doc.title || t('runtime.project.untitled'))}
                    aria-label={t('creationAi.documentList.delete')}
                    title={t('creationAi.documentList.delete')}
                    className="shrink-0 rounded-nomi-sm p-0.5 text-nomi-ink-40 opacity-0 transition-opacity group-hover:opacity-100 hover:text-workbench-danger"
                  >
                    <IconTrash size={14} stroke={1.5} aria-hidden />
                  </button>
                ) : null}
              </div>
            )
          })
        )}
      </div>
      <button
        type="button"
        onClick={addWorkbenchDocument}
        aria-label={t('creationAi.documentList.newDocumentAria')}
        className="mx-2 mb-2 flex items-center gap-2 rounded-nomi-sm border border-dashed border-nomi-ink-20 px-2 py-1.5 text-caption text-nomi-ink-60 transition-colors hover:border-nomi-ink-40 hover:text-nomi-ink"
      >
        <IconPlus size={14} stroke={1.5} aria-hidden />
        {t('creationAi.documentList.newDocument')}
      </button>
    </aside>
  )
}
