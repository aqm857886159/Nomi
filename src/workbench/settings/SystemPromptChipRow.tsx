// 系统提示词的模式选择行：内置 chip → 分隔线 → 自定义 chip → 「＋ 新建」。
//
// 条目**全部 derive 自 listCreationAiModes()**（`modes` 由调用方传入），不手写清单：
// 上一轮的根因就是选择器手写条目，7 个内置模式里 5 个在 UI 上根本不存在
// （提示词写了、设置里能编辑、就是调不起来）。derive 之后新增模式自动出现。
import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconPlus } from '@tabler/icons-react'

import { cn } from '../../utils/cn'
import type { CreationAiMode } from '../creation/creationAiModes'

const CHIP_BASE = cn(
  'rounded-full px-2.5 py-1 text-caption font-medium cursor-pointer',
  'transition-colors duration-nomi-fast ease-nomi-fast',
)

const CHIP_IDLE = 'bg-nomi-ink-05 text-nomi-ink-60 hover:bg-nomi-ink-10'
const CHIP_SELECTED = 'bg-nomi-accent-soft text-nomi-accent'

export function SystemPromptChipRow(props: {
  modes: CreationAiMode[]
  selectedId: string
  onSelect: (modeId: string) => void
  onCreate: () => void
  canCreate: boolean
  createDisabledReason: string
}): JSX.Element {
  const { t } = useTranslation()
  const builtin = props.modes.filter((mode) => !mode.custom)
  const custom = props.modes.filter((mode) => mode.custom)

  const chip = (mode: CreationAiMode): JSX.Element => {
    const selected = mode.id === props.selectedId
    return (
      <button
        key={mode.id}
        type="button"
        data-settings-prompt-mode={mode.id}
        aria-pressed={selected}
        onClick={() => props.onSelect(mode.id)}
        className={cn(CHIP_BASE, selected ? CHIP_SELECTED : CHIP_IDLE, mode.custom && 'max-w-[12rem] truncate')}
      >
        {/* 内置的走 i18n key；自定义的用用户自己起的名字（那是数据，不是可翻译文案）。 */}
        {mode.custom ? mode.label : t(`creationAi.mode.${mode.id}.short` as 'creationAi.mode.general.short')}
      </button>
    )
  }

  return (
    <div className="mb-2 flex flex-wrap items-center gap-1.5" role="group" aria-label={t('settings.ai.systemPrompt.modeGroup')}>
      {builtin.map(chip)}
      {/* 分隔线只在真有自定义条目时出现：一条悬空的竖线在解释不了任何东西时只是噪音。 */}
      {custom.length > 0 ? (
        <span data-settings-prompt-separator aria-hidden="true" className="mx-0.5 h-4 w-px shrink-0 bg-nomi-line" />
      ) : null}
      {custom.map(chip)}
      {/* C1（§1.6）：到条数上限时「＋ 新建」点了也没用 → disabled + title 说清为什么。
          禁用的 <button> 自己不触发 title，靠外层 span 兜（既有范式）。 */}
      <span title={props.canCreate ? undefined : props.createDisabledReason} style={{ display: 'contents' }}>
        <button
          type="button"
          data-settings-prompt-create
          disabled={!props.canCreate}
          onClick={props.onCreate}
          className={cn(
            CHIP_BASE,
            'inline-flex items-center gap-1 border border-dashed border-nomi-line bg-nomi-paper text-nomi-ink-60',
            'hover:bg-nomi-ink-05 disabled:cursor-not-allowed disabled:text-nomi-ink-40',
          )}
        >
          <IconPlus size={12} stroke={2} aria-hidden="true" />
          {t('settings.ai.systemPrompt.create')}
        </button>
      </span>
    </div>
  )
}
