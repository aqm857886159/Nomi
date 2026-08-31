import React from 'react'
import { cn } from '../../utils/cn'
import { DesignSearchInput, type DesignSearchInputProps } from '../../design'

/**
 * 资源库发现条的布局壳。
 *
 * 每个库仍保留自己的来源/分类控件和主动作；这个组件只统一“筛选在左、搜索占剩余空间、
 * 低频动作在右”的节奏，并在窄侧栏自动换成纵向。它不持有资源数据，也不新增跨库入口。
 */
export type LibraryDiscoveryToolbarProps = {
  query: string
  onQueryChange: (value: string) => void
  placeholder: string
  ariaLabel: string
  leading?: React.ReactNode
  trailing?: React.ReactNode
  compact?: boolean
  className?: string
  searchClassName?: string
  /** Keep the host page's established density when the toolbar replaces a local search row. */
  searchSize?: DesignSearchInputProps['size']
}

export function LibraryDiscoveryToolbar({
  query,
  onQueryChange,
  placeholder,
  ariaLabel,
  leading,
  trailing,
  compact = false,
  className,
  searchClassName,
  searchSize = 'sm',
}: LibraryDiscoveryToolbarProps): JSX.Element {
  return (
    <div
      className={cn(
        'flex min-w-0 gap-2',
        compact ? 'flex-col' : 'items-center flex-wrap',
        className,
      )}
    >
      {leading ? (
        <div className={cn('flex min-w-0 items-center gap-2', compact ? 'flex-wrap' : 'shrink-0')}>
          {leading}
        </div>
      ) : null}
      <DesignSearchInput
        className={cn(
          'min-w-0',
          compact ? 'w-full' : 'flex-1',
          searchClassName,
        )}
        placeholder={placeholder}
        ariaLabel={ariaLabel}
        size={searchSize}
        value={query}
        onChange={onQueryChange}
      />
      {trailing ? (
        <div className={cn('flex min-w-0 items-center gap-2', compact ? 'flex-wrap' : 'shrink-0')}>
          {trailing}
        </div>
      ) : null}
    </div>
  )
}
