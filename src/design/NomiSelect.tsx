import React from 'react'
import { useTranslation } from 'react-i18next'
import { Combobox, useCombobox } from '@mantine/core'
import { IconCheck, IconChevronDown } from '@tabler/icons-react'
import { cn } from '../utils/cn'
import { NOMI_OVERLAY_Z_INDEX } from './overlayLayers'
import { NomiIdentityIcon, type NomiIdentityIconSource } from './NomiIdentityIcon'

/**
 * NomiSelect —— 全仓统一的「选择面板」通用组件（规则 1/5：一个来源，别散落原生 <select>）。
 *
 * 为什么不用原生 <select>：原生下拉点开是 OS 框，字体/圆角/阴影/选中态全不受控、长列表大块留白，
 * 跟设计语言割裂。这里基于 Mantine `Combobox`（官方原语，R5：定位/翻向/键盘/点外关闭都由它处理），
 * 只把「选项渲染」换成 token 化的紧凑行：当前值在触发 pill 上，**对勾在选项最右**。
 *
 * 触发形态统一为一个 pill：`[可选小标签] [当前值] [可选徽标] ▾`。所有调用点丢掉自己的
 * label+原生 select，改用本组件 → 视觉一致、以后只改这一个文件。
 */

export type NomiSelectTone = 'accent' | 'muted' | 'danger'

export type NomiSelectOption = {
  value: string
  label: string
  /** Local model-brand or provider-route mark. Never fetches a remote favicon. */
  icon?: NomiIdentityIconSource
  /** 选项右侧附加文字（如价格、模板/通用），在对勾左边。 */
  trailing?: string
  trailingTone?: NomiSelectTone
  /** Compact provider chips rendered at the end of a model row. */
  chips?: Array<{ value: string; label: string; active?: boolean; dimmed?: boolean; disabled?: boolean }>
  disabled?: boolean
  /** 整行减淡（仍可点）——「能选但眼下不建议」，如近期连败的模型沉底后。 */
  dimmed?: boolean
  /** Optional non-selectable section heading shown before this option. */
  sectionLabel?: string
}

export type NomiSelectProps = {
  value: string
  options: NomiSelectOption[]
  onChange: (value: string) => void
  /** Optional click handler for row-end chips; chip clicks do not select the row itself. */
  onChipChange?: (optionValue: string, chipValue: string) => void
  ariaLabel: string
  /** pill 内左侧小灰标签：比例 / 模式 / 画幅… */
  leadingLabel?: string
  /** 无选中值时触发上的占位（如「选择模型」「自动选模型」）。 */
  placeholder?: string
  /** 触发 pill 上、值右侧的小徽标（如模型芯片的「模板 / 通用」）。 */
  triggerBadge?: { text: string; tone?: NomiSelectTone }
  /** sm = 28px 高（默认，画布参数）；xs = 24px（时间轴/紧凑工具条）。 */
  size?: 'sm' | 'xs'
  /** 长值（模型名）截断上限 px。 */
  triggerMaxWidth?: number
  disabled?: boolean
  title?: string
  className?: string
  /** Long/model-file enums use a searchable, wrapping list; short selectors keep their compact layout. */
  searchable?: boolean
  /** Nested floating panels own their portal so outside-click handling and scrolling stay correct. */
  portalTarget?: React.RefObject<HTMLElement | null>
}

const SURFACE_SHADOW = 'var(--workbench-shadow-pop)'
function toneClass(tone: NomiSelectTone | undefined, kind: 'badge' | 'trailing'): string {
  if (tone === 'accent') return 'bg-nomi-accent-soft text-nomi-accent'
  if (tone === 'danger') return 'text-workbench-danger'
  if (kind === 'badge') return 'bg-nomi-ink-10 text-nomi-ink-60'
  return 'text-nomi-ink-40'
}

export function NomiSelect({
  value,
  options,
  onChange,
  onChipChange,
  ariaLabel,
  leadingLabel,
  placeholder,
  triggerBadge,
  size = 'sm',
  triggerMaxWidth,
  disabled,
  title,
  className,
  searchable = false,
  portalTarget,
}: NomiSelectProps): JSX.Element {
  const { t } = useTranslation()
  const [search, setSearch] = React.useState('')
  const combobox = useCombobox({
    onDropdownClose: () => {
      combobox.resetSelectedOption()
      setSearch('')
    },
  })
  const wasOpen = React.useRef(false)
  React.useLayoutEffect(() => {
    // Closing removes the focused search input. Restore only orphaned focus; a clicked field owns its focus.
    // No deferred focusTarget timer: that would steal focus after the user's next click.
    if (searchable && wasOpen.current && !combobox.dropdownOpened && document.activeElement === document.body) {
      combobox.targetRef.current?.focus()
    }
    wasOpen.current = combobox.dropdownOpened
  }, [combobox.dropdownOpened, combobox.targetRef, searchable])
  const selected = options.find((option) => option.value === value)
  const triggerText = selected?.label ?? (value || placeholder || t('common.select'))
  const heightClass = size === 'xs' ? 'h-6' : 'h-7'
  const query = search.trim().toLocaleLowerCase()
  const visibleOptions = searchable && query ? options.filter((option) => option.label.toLocaleLowerCase().includes(query)) : options

  return (
    <Combobox
      store={combobox}
      withinPortal
      keepMounted={!searchable}
      portalProps={{ target: portalTarget?.current ?? undefined }}
      // 宽度内容驱动：默认 Mantine 把下拉宽锁成触发 pill 的宽（如「比例」pill 仅 ~67px），
      // 选项标签（auto/1:1/16:9…）被 truncate 成空 → 看着「点开是空白」。改 max-content 后
      // 下拉跟着最长选项自然撑开；超长模型名由 maxWidth + 选项内 truncate 兜底，不会撑成怪物。
      width="max-content"
      position="bottom-start"
      offset={6}
      zIndex={NOMI_OVERLAY_Z_INDEX.popover}
      middlewares={{ flip: true, shift: true }}
      onOptionSubmit={(val) => {
        onChange(val)
        combobox.closeDropdown()
      }}
      styles={{
        dropdown: {
          padding: 4,
          maxWidth: 280,
          border: '1px solid var(--nomi-line)',
          borderRadius: 'var(--nomi-radius-lg)',
          background: 'var(--nomi-paper)',
          boxShadow: SURFACE_SHADOW,
        },
        option: {
          padding: '0 8px 0 9px',
          minHeight: 30,
          borderRadius: 'var(--nomi-radius-sm)',
          // Mantine Option 是普通块级：minHeight 30 下内容顶在上沿（label/附注/对勾不垂直居中）。
          // 自己 flex 居中；水平布局仍由内层 span 管。
          display: 'flex',
          alignItems: 'center',
        },
      }}
    >
      <Combobox.Target>
        <button
          type="button"
          aria-label={ariaLabel}
          title={title ?? selected?.label ?? (value || undefined)}
          disabled={disabled}
          onClick={() => combobox.toggleDropdown()}
          className={cn(
            'inline-flex min-w-0 items-center gap-1 pl-2.5 pr-2 rounded-pill border border-nomi-line bg-nomi-paper',
            'cursor-pointer disabled:cursor-not-allowed disabled:opacity-50',
            'focus:outline-none focus-visible:border-nomi-accent hover:border-nomi-ink-20',
            heightClass,
            className,
          )}
        >
          {leadingLabel ? (
            <span className="shrink-0 text-micro leading-none text-nomi-ink-40">{leadingLabel}</span>
          ) : null}
          {selected?.icon ? <NomiIdentityIcon icon={selected.icon} /> : null}
          <span
            className="min-w-0 truncate text-caption text-nomi-ink-80"
            style={triggerMaxWidth ? { maxWidth: triggerMaxWidth } : undefined}
          >
            {triggerText}
          </span>
          {triggerBadge ? (
            <span className={cn('shrink-0 text-micro leading-none px-1.5 py-[1px] rounded-pill', toneClass(triggerBadge.tone, 'badge'))}>
              {triggerBadge.text}
            </span>
          ) : null}
          <IconChevronDown size={12} stroke={1.6} className="shrink-0 text-nomi-ink-40 pointer-events-none" aria-hidden />
        </button>
      </Combobox.Target>

      <Combobox.Dropdown data-nomi-select-dropdown>
        {searchable ? (
          <Combobox.Search
            // Focus after the visible search input mounts, including nested-portal reparenting.
            autoFocus
            onKeyDown={(event) => { if (event.key === 'Escape') event.stopPropagation() }}
            value={search}
            onChange={(event) => {
              setSearch(event.currentTarget.value)
              combobox.updateSelectedOptionIndex()
            }}
            aria-label={t('common.searchOptions')}
            placeholder={t('common.searchOptions')}
            classNames={{ input: 'text-caption bg-nomi-paper text-nomi-ink border-nomi-line' }}
          />
        ) : null}
        <Combobox.Options className="max-h-[240px] overflow-auto">
          {visibleOptions.length === 0 ? <Combobox.Empty>{t('common.noMatchingOptions')}</Combobox.Empty> : null}
          {visibleOptions.map((option) => {
            const isSel = option.value === value
            return (
              <React.Fragment key={option.value}>
                {option.sectionLabel ? <div className="px-2 py-1 text-micro font-medium text-nomi-ink-40" role="presentation">{option.sectionLabel}</div> : null}
              <Combobox.Option value={option.value} disabled={option.disabled} active={isSel} title={option.label}>
                {/* dimmed：整行减淡但仍可点（「能选、眼下不建议」）。不用 disabled——那是"点不了"，
                    两种语义别混（近期连败的模型仍允许手动选，是拍板过的原则）。 */}
                <span className={cn('flex min-w-0 items-center gap-2 w-full', option.dimmed ? 'opacity-45' : '')}>
                  {option.icon ? <NomiIdentityIcon icon={option.icon} size="md" /> : null}
                  <span className={cn('min-w-0 text-caption', searchable ? 'whitespace-normal break-all py-1' : 'truncate', isSel ? 'text-nomi-ink font-semibold' : 'text-nomi-ink-80')}>
                    {option.label}
                  </span>
                  {option.trailing ? (
                    // max-w + truncate：trailing 是附注（厂商名/价格），不许反客为主挤压 label
                    //（曾被「即梦会员（本地 CLI）」10 字长名挤乱布局）；悬停 title 看全文。
                    <span
                      title={option.trailing}
                      className={cn('ml-auto shrink-0 max-w-[96px] truncate text-micro leading-none px-1.5 py-[1px] rounded-pill', toneClass(option.trailingTone, 'trailing'))}
                    >
                      {option.trailing}
                    </span>
                  ) : null}
                  {option.chips?.map((chip) => (
                    <button
                      key={chip.value}
                      type="button"
                      disabled={chip.disabled}
                      aria-label={chip.label}
                      aria-pressed={chip.active}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={(event) => {
                        event.preventDefault()
                        event.stopPropagation()
                        onChipChange?.(option.value, chip.value)
                      }}
                      className={cn(
                        'shrink-0 rounded-pill border px-1.5 py-[1px] text-micro leading-none transition-colors',
                        chip.active ? 'border-nomi-accent bg-nomi-accent-soft text-nomi-accent' : 'border-nomi-line text-nomi-ink-40 hover:border-nomi-accent hover:text-nomi-accent',
                        chip.dimmed ? 'opacity-45' : '',
                        chip.disabled ? 'cursor-not-allowed' : 'cursor-pointer',
                      )}
                    >
                      {chip.label}
                    </button>
                  ))}
                  <span className={cn('shrink-0 w-3.5 grid place-items-center', option.trailing ? '' : 'ml-auto', isSel ? '' : 'invisible')} aria-hidden>
                    <IconCheck size={14} stroke={1.6} className="text-nomi-accent" aria-hidden />
                  </span>
                </span>
              </Combobox.Option>
              </React.Fragment>
            )
          })}
        </Combobox.Options>
      </Combobox.Dropdown>
    </Combobox>
  )
}
