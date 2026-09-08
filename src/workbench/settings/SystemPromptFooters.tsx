// 系统提示词编辑器的两套底部动作。分两个组件而不是一个带 if 的大组件：
// 它们的语义完全不同（内置有默认值可回退，自定义没有默认值只能删），共用一个壳只会
// 让「哪些 props 在哪种情况下有效」变成一笔糊涂账。
import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconRotate, IconTrash } from '@tabler/icons-react'

import { cn } from '../../utils/cn'

const FOOTER_ROW = 'mt-2 flex min-h-8 items-center justify-between gap-3'

const BUTTON_BASE = cn(
  'inline-flex shrink-0 items-center gap-1.5 rounded-nomi-sm border border-nomi-line bg-nomi-paper',
  'px-2.5 py-1.5 text-caption cursor-pointer',
  'transition-colors duration-nomi-fast ease-nomi-fast',
)

/** 内置模式：「已自定义」徽标 +「恢复默认」。 */
export function SystemPromptResetFooter(props: { customized: boolean; onReset: () => void }): JSX.Element {
  const { t } = useTranslation()
  return (
    <div className={FOOTER_ROW}>
      <span className="min-w-0 text-micro text-nomi-ink-60">
        {props.customized ? (
          <span
            data-settings-prompt-customized
            className="inline-flex items-center rounded-full bg-nomi-accent-soft px-2 py-0.5 text-nomi-accent"
          >
            {t('settings.ai.systemPrompt.customized')}
          </span>
        ) : null}
      </span>
      {/* C1（§1.6）：没有覆盖时「恢复默认」无事可做 → 必须 disabled + title 说清为什么。
          禁用的 <button> 自己不触发 title，靠外层 span 兜（既有范式）。 */}
      <span
        title={props.customized ? undefined : t('settings.ai.systemPrompt.resetDisabledReason')}
        style={{ display: 'contents' }}
      >
        <button
          type="button"
          data-settings-prompt-reset
          disabled={!props.customized}
          onClick={props.onReset}
          className={cn(
            BUTTON_BASE,
            'text-nomi-ink hover:bg-nomi-ink-05',
            'disabled:cursor-not-allowed disabled:text-nomi-ink-40',
          )}
        >
          <IconRotate size={14} stroke={1.7} aria-hidden="true" />
          {t('settings.ai.systemPrompt.reset')}
        </button>
      </span>
    </div>
  )
}

/**
 * 自定义提示词：只有「删除」。
 * 这里**没有**「恢复默认」——用户自建的那条没有默认值可回退，摆一个永远禁用的钮
 * 只会让人以为自己漏配了什么（§1.6：控件出现即应有意义）。
 */
export function SystemPromptCustomFooter(props: { onDelete: () => void }): JSX.Element {
  const { t } = useTranslation()
  return (
    <div className={FOOTER_ROW}>
      <span className="min-w-0 text-micro text-nomi-ink-60" />
      <button
        type="button"
        data-settings-prompt-delete
        onClick={props.onDelete}
        className={cn(BUTTON_BASE, 'text-nomi-danger hover:bg-nomi-ink-05')}
      >
        <IconTrash size={14} stroke={1.7} aria-hidden="true" />
        {t('settings.ai.systemPrompt.delete')}
      </button>
    </div>
  )
}
