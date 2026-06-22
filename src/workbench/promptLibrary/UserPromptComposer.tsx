import React from 'react'
import { IconX, IconDeviceFloppy } from '@tabler/icons-react'
import { cn } from '../../utils/cn'
import type { LibraryPrompt, PromptMediaType } from '../api/promptLibraryApi'
import type { UserPromptDraft } from './useUserPrompts'

type Props = {
  /** 传入则为编辑态(预填),否则新建态。 */
  initial?: LibraryPrompt | null
  onSubmit: (draft: UserPromptDraft) => Promise<void>
  onCancel: () => void
}

const TYPE_OPTIONS: { value: PromptMediaType; label: string }[] = [
  { value: 'image', label: '图片' },
  { value: 'video', label: '视频' },
]

// 我的库新建/编辑表单(内联在画廊顶部)。标题选填、提示词必填、图/视频自选。
export function UserPromptComposer({ initial, onSubmit, onCancel }: Props): JSX.Element {
  const [title, setTitle] = React.useState(initial?.title ?? '')
  const [prompt, setPrompt] = React.useState(initial?.prompt ?? '')
  const [promptType, setPromptType] = React.useState<PromptMediaType>(initial?.promptType ?? 'image')
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const promptRef = React.useRef<HTMLTextAreaElement>(null)

  React.useEffect(() => {
    promptRef.current?.focus()
  }, [])

  const submit = async () => {
    const trimmed = prompt.trim()
    if (!trimmed) {
      setError('提示词不能为空')
      promptRef.current?.focus()
      return
    }
    setSaving(true)
    setError(null)
    try {
      await onSubmit({ title: title.trim() || undefined, prompt: trimmed, promptType })
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败')
      setSaving(false)
    }
  }

  const inputCls = cn(
    'w-full bg-nomi-paper border border-nomi-line rounded-nomi px-3 py-2 text-body-sm text-nomi-ink',
    'placeholder:text-nomi-ink-40 focus:outline-none focus:border-nomi-accent',
  )

  return (
    <div className={cn('mb-3 p-3.5 rounded-nomi-lg border border-nomi-line bg-nomi-ink-02')}>
      <div className={cn('flex items-center gap-2 mb-2.5')}>
        <b className={cn('text-caption font-semibold text-nomi-ink')}>{initial ? '编辑提示词' : '新建提示词'}</b>
        <span className={cn('flex-1')} />
        <div className={cn('inline-flex bg-nomi-ink-05 rounded-full p-0.5')} role="tablist" aria-label="提示词类型">
          {TYPE_OPTIONS.map((option) => {
            const active = promptType === option.value
            return (
              <button
                key={option.value}
                type="button"
                role="tab"
                aria-selected={active}
                className={cn(
                  'px-3 py-0.5 rounded-full text-caption cursor-pointer border-0 bg-transparent',
                  active ? 'bg-nomi-paper text-nomi-ink font-semibold shadow-nomi-sm' : 'text-nomi-ink-60 hover:text-nomi-ink',
                )}
                onClick={() => setPromptType(option.value)}
              >
                {option.label}
              </button>
            )
          })}
        </div>
      </div>

      <input
        className={cn(inputCls, 'mb-2')}
        placeholder="标题（选填，如「黄昏剪影」）"
        value={title}
        maxLength={60}
        onChange={(e) => setTitle(e.target.value)}
      />
      <textarea
        ref={promptRef}
        className={cn(inputCls, 'resize-none h-24 leading-relaxed')}
        placeholder="把验证过好用的提示词粘进来…"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') void submit()
        }}
      />

      <div className={cn('flex items-center gap-2 mt-2.5')}>
        {error ? <span className={cn('text-micro text-nomi-danger')}>{error}</span> : null}
        <span className={cn('flex-1')} />
        <button
          type="button"
          onClick={onCancel}
          className={cn('inline-flex items-center gap-1 h-8 px-3 rounded-full cursor-pointer border-0 bg-transparent text-caption text-nomi-ink-60 hover:text-nomi-ink hover:bg-nomi-ink-05')}
        >
          <IconX size={14} stroke={1.8} />取消
        </button>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={saving}
          className={cn('inline-flex items-center gap-1.5 h-8 px-3.5 rounded-full cursor-pointer border-0', 'bg-nomi-accent text-nomi-paper text-caption font-medium hover:opacity-90 disabled:opacity-50')}
        >
          <IconDeviceFloppy size={14} stroke={1.8} />{initial ? '保存' : '存进我的库'}
        </button>
      </div>
    </div>
  )
}
