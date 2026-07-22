import React from 'react'
import { useTranslation } from 'react-i18next'
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

const TYPE_OPTIONS: PromptMediaType[] = ['image', 'video']

// 我的库新建/编辑表单(内联在画廊顶部)。标题选填、提示词必填、图/视频自选。
export function UserPromptComposer({ initial, onSubmit, onCancel }: Props): JSX.Element {
  const { t } = useTranslation()
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
      setError(t('libraries.prompt.composer.required'))
      promptRef.current?.focus()
      return
    }
    setSaving(true)
    setError(null)
    try {
      await onSubmit({ title: title.trim() || undefined, prompt: trimmed, promptType })
    } catch (e) {
      setError(e instanceof Error ? e.message : t('libraries.prompt.composer.saveFailed'))
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
        <b className={cn('text-caption font-semibold text-nomi-ink')}>
          {initial ? t('libraries.prompt.composer.edit') : t('libraries.prompt.composer.create')}
        </b>
        <span className={cn('flex-1')} />
        <div
          className={cn('inline-flex bg-nomi-ink-05 rounded-full p-0.5')}
          role="tablist"
          aria-label={t('libraries.prompt.composer.typeAria')}
        >
          {TYPE_OPTIONS.map((option) => {
            const active = promptType === option
            return (
              <button
                key={option}
                type="button"
                role="tab"
                aria-selected={active}
                className={cn(
                  'px-3 py-0.5 rounded-full text-caption cursor-pointer border-0 bg-transparent',
                  active
                    ? 'bg-nomi-paper text-nomi-ink font-semibold shadow-nomi-sm'
                    : 'text-nomi-ink-60 hover:text-nomi-ink',
                )}
                onClick={() => setPromptType(option)}
              >
                {t(`libraries.prompt.category.${option}` as 'libraries.prompt.category.image')}
              </button>
            )
          })}
        </div>
      </div>

      <input
        className={cn(inputCls, 'mb-2')}
        placeholder={t('libraries.prompt.composer.titlePlaceholder')}
        value={title}
        maxLength={60}
        onChange={(e) => setTitle(e.target.value)}
      />
      <textarea
        ref={promptRef}
        className={cn(inputCls, 'resize-none h-24 leading-relaxed')}
        placeholder={t('libraries.prompt.composer.promptPlaceholder')}
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') void submit()
        }}
      />

      <div className={cn('flex flex-wrap items-center gap-2 mt-2.5')}>
        {error ? <span className={cn('min-w-0 flex-1 text-micro text-nomi-danger')}>{error}</span> : null}
        <span className={cn('min-w-4 flex-1')} />
        <button
          type="button"
          onClick={onCancel}
          className={cn(
            'inline-flex items-center gap-1 h-8 px-3 rounded-full cursor-pointer border-0 bg-transparent text-caption text-nomi-ink-60 hover:text-nomi-ink hover:bg-nomi-ink-05',
          )}
        >
          <IconX size={14} stroke={1.8} />
          {t('libraries.prompt.composer.cancel')}
        </button>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={saving}
          className={cn(
            'inline-flex items-center gap-1.5 h-8 px-3.5 rounded-full cursor-pointer border-0',
            'bg-nomi-accent text-nomi-paper text-caption font-medium hover:opacity-90 disabled:opacity-50',
          )}
        >
          <IconDeviceFloppy size={14} stroke={1.8} />
          {initial ? t('libraries.prompt.composer.save') : t('libraries.prompt.composer.saveToMine')}
        </button>
      </div>
    </div>
  )
}
