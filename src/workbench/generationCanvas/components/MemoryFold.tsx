import React from 'react'
import { IconBrain, IconChevronDown, IconPin, IconPinFilled, IconX } from '@tabler/icons-react'
import { cn } from '../../../utils/cn'
import {
  fetchProjectMemoryFacts,
  removeProjectMemoryFact,
  updateProjectMemoryFact,
  type MemoryFactView,
} from '../agent/projectMemoryClient'

const KIND_LABEL: Record<MemoryFactView['kind'], string> = {
  character: '设定',
  style: '风格',
  brand: '品牌',
  preference: '偏好',
  constraint: '约束',
}

/**
 * 记忆卡折叠条(harness S9):默认一行「AI 记得 N 条 ⌄」(N=0 整条不渲染,M1)。
 * 点开列出事实:pin(注入优先)/双击改文本(纠正→origin:user,自动提炼永不覆盖)/删(留墓碑)。
 * 极简折叠条形态;refreshKey 由面板在每轮对话后递增触发重取。
 */
export function MemoryFold({ refreshKey }: { refreshKey: number }): JSX.Element | null {
  const [open, setOpen] = React.useState(false)
  const [facts, setFacts] = React.useState<MemoryFactView[]>([])
  const [editingId, setEditingId] = React.useState<string | null>(null)
  const [draft, setDraft] = React.useState('')

  // 重取时机:挂载+每轮对话后(refreshKey)+每次展开(锁/解锁等画布动作不经对话,展开时要新鲜)。
  React.useEffect(() => {
    let alive = true
    void fetchProjectMemoryFacts().then((next) => {
      if (alive) setFacts(next)
    })
    return () => {
      alive = false
    }
  }, [refreshKey, open])

  if (facts.length === 0) return null

  const commitEdit = async (fact: MemoryFactView) => {
    setEditingId(null)
    const text = draft.trim()
    if (!text || text === fact.text) return
    setFacts(await updateProjectMemoryFact(fact.id, { text }))
  }

  return (
    <div className={cn('border-b border-nomi-line-soft bg-nomi-paper')} data-memory-fold='true'>
      <button
        type='button'
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'flex w-full items-center gap-1 px-3 py-1',
          'text-micro text-nomi-ink-40 hover:text-nomi-ink-60 cursor-pointer',
        )}
        aria-expanded={open}
        aria-label='项目记忆'
      >
        <IconBrain size={13} stroke={1.8} />
        AI 记得 {facts.length} 条
        <IconChevronDown size={11} className={cn('ml-0.5 transition-transform', open && 'rotate-180')} />
      </button>
      {open ? (
        <ul className={cn('flex flex-col gap-1 px-3 pb-2 list-none p-0 m-0')}>
          {facts.map((fact) => (
            <li key={fact.id} className={cn('flex items-start gap-1 group')}>
              <span className={cn('shrink-0 mt-px text-micro text-nomi-ink-40')}>{KIND_LABEL[fact.kind] || fact.kind}</span>
              {editingId === fact.id ? (
                <input
                  className={cn(
                    'flex-1 min-w-0 h-6 px-1 rounded-nomi-sm border border-nomi-line bg-nomi-paper',
                    'text-micro text-nomi-ink outline-none focus:border-nomi-accent',
                  )}
                  value={draft}
                  autoFocus
                  onChange={(event) => setDraft(event.target.value)}
                  onBlur={() => void commitEdit(fact)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void commitEdit(fact)
                    if (event.key === 'Escape') setEditingId(null)
                  }}
                />
              ) : (
                <span
                  className={cn('flex-1 min-w-0 text-micro text-nomi-ink-80 cursor-text', fact.origin === 'user' && 'text-nomi-ink')}
                  title='双击修改(改后 AI 不再自动覆盖这条)'
                  onDoubleClick={() => {
                    setEditingId(fact.id)
                    setDraft(fact.text)
                  }}
                >
                  {fact.text}
                </span>
              )}
              <button
                type='button'
                className={cn(
                  'shrink-0 inline-grid place-items-center w-5 h-5 border-0 bg-transparent p-0 cursor-pointer',
                  fact.pinned ? 'text-nomi-accent' : 'text-nomi-ink-30 opacity-0 group-hover:opacity-100 hover:text-nomi-ink-60',
                )}
                aria-label={fact.pinned ? '取消置顶' : '置顶(优先注入)'}
                onClick={async () => setFacts(await updateProjectMemoryFact(fact.id, { pinned: !fact.pinned }))}
              >
                {fact.pinned ? <IconPinFilled size={12} /> : <IconPin size={12} stroke={1.8} />}
              </button>
              <button
                type='button'
                className={cn(
                  'shrink-0 inline-grid place-items-center w-5 h-5 border-0 bg-transparent p-0 cursor-pointer',
                  'text-nomi-ink-30 opacity-0 group-hover:opacity-100 hover:text-nomi-ink-60',
                )}
                aria-label='删除这条记忆'
                onClick={async () => setFacts(await removeProjectMemoryFact(fact.id))}
              >
                <IconX size={12} stroke={1.8} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
