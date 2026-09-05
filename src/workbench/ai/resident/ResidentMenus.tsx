import React from 'react'
import {
  IconAperture, IconCheck, IconCircleDashed, IconFilePencil, IconPhoto, IconPencil,
  IconRefresh, IconSearch, IconTextSpellcheck, IconVideo, IconWorldSearch,
} from '@tabler/icons-react'
import { BodyPortal } from '../../../design'
import { cn } from '../../../utils/cn'
import type { LibraryPrompt } from '../../api/promptLibraryApi'
import { promptDisplayTitle, promptSourceLabel } from '../../promptLibrary/promptDisplay'
import { libraryPromptMenuId } from './residentPromptSelection'

export function Popover({ open, onClose, children, role = 'menu', label, className, testId }: { open: boolean; onClose: () => void; children: React.ReactNode; role?: 'menu' | 'dialog'; label: string; className?: string; testId?: string }): JSX.Element | null {
  const ref = React.useRef<HTMLDivElement>(null)
  const anchorRef = React.useRef<HTMLSpanElement>(null)
  const [position, setPosition] = React.useState<{ left: number; bottom: number } | null>(null)
  React.useEffect(() => {
    if (!open) return
    const onPointer = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node)) onClose() }
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    document.addEventListener('pointerdown', onPointer); document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('pointerdown', onPointer); document.removeEventListener('keydown', onKey) }
  }, [onClose, open])
  // Menus attached to the right-side composer controls open toward the dock,
  // preserving the transcript edge in narrow windows. Attachment/reference
  // menus intentionally keep the left anchor because they originate at the
  // composer start. `role=dialog` is reserved for the split Skill preview.
  const alignEnd = role === 'dialog' || ['技能', 'Skill', '提示词', 'Prompt', '模式', 'Mode', '模型', 'Model'].some((token) => label.startsWith(token))
  React.useLayoutEffect(() => {
    if (!open) { setPosition(null); return }
    const updatePosition = () => {
      const anchor = anchorRef.current?.parentElement?.getBoundingClientRect()
      const menu = ref.current?.getBoundingClientRect()
      if (!anchor) return
      const width = menu?.width || 320
      const padding = 12
      const desiredLeft = alignEnd ? anchor.right - width : anchor.left
      const left = Math.min(Math.max(desiredLeft, padding), Math.max(padding, window.innerWidth - width - padding))
      const bottom = Math.max(padding, window.innerHeight - anchor.top + 4)
      setPosition({ left, bottom })
    }
    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => { window.removeEventListener('resize', updatePosition); window.removeEventListener('scroll', updatePosition, true) }
  }, [alignEnd, className, open])
  if (!open) return null
  const menu = <div ref={ref} role={role} aria-label={label} data-agent-menu={label} data-agent-usage-popover={testId === 'usage-popover' ? 'true' : undefined} {...(testId ? { [`data-agent-${testId}`]: 'true' } : {})} style={position ? { left: position.left, bottom: position.bottom } : { left: -10000, bottom: -10000 }} className={cn('fixed z-[60] mb-1 max-h-[min(420px,65vh)] w-[min(320px,calc(100vw-24px))] overflow-y-auto rounded-nomi border border-nomi-line bg-nomi-paper p-1.5 text-body-sm text-nomi-ink shadow-nomi-lg', !position && 'pointer-events-none opacity-0', className)}>{children}</div>
  return <><span ref={anchorRef} className="pointer-events-none absolute inset-0" aria-hidden="true" />{typeof document === 'undefined' ? menu : <BodyPortal>{menu}</BodyPortal>}</>
}

// Commit a primary-pointer action before the outside-click lifecycle can remount
// a hover-preview row; the ref suppresses the follow-up synthetic click while
// preserving keyboard activation through onClick.
export function MenuRow({ children, onClick, onMouseEnter, onFocus, selected, disabled, testId, promptLibraryId, className }: { children: React.ReactNode; onClick?: () => void; onMouseEnter?: () => void; onFocus?: () => void; selected?: boolean; disabled?: boolean; testId?: string; promptLibraryId?: string; className?: string }): JSX.Element {
  const pointerActivated = React.useRef(false)
  return <button type="button" disabled={disabled} data-agent-menu-item={testId} data-agent-prompt-library-item={promptLibraryId} onClick={() => { if (pointerActivated.current) { pointerActivated.current = false; return }; onClick?.() }} onPointerDown={(event) => { event.stopPropagation(); if (event.button === 0 && !disabled) { pointerActivated.current = true; onClick?.() } }} onMouseEnter={onMouseEnter} onFocus={onFocus} className={cn('flex min-h-7 w-full items-center gap-2 rounded-nomi-sm px-2 py-1 text-left text-caption leading-tight transition-[background,color] duration-[var(--nomi-transition-fast)]', selected ? 'bg-nomi-accent-soft text-nomi-accent' : 'hover:bg-nomi-ink-05', disabled && 'cursor-not-allowed opacity-45', className)}>{children}</button>
}

export function iconControlClass(active = false): string {
  return cn('inline-grid size-7 shrink-0 place-items-center rounded-nomi-sm border p-0 transition-[background,border-color,color,transform] duration-[var(--nomi-transition-fast)] motion-reduce:transition-none motion-safe:hover:-translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nomi-accent/40', active ? 'border-nomi-accent bg-nomi-accent-soft text-nomi-accent' : 'border-nomi-line bg-transparent text-nomi-ink-60 hover:bg-nomi-ink-05 hover:text-nomi-ink')
}

export function MenuCopy({ label, hint }: { label: React.ReactNode; hint?: React.ReactNode }): JSX.Element {
  return <span className="min-w-0 flex-1"><span className="block truncate">{label}</span>{hint ? <span className="mt-0.5 block truncate text-micro leading-tight text-nomi-ink-40">{hint}</span> : null}</span>
}

type ResidentPromptMenuProps = {
  t: (key: string, options?: Record<string, unknown>) => string
  promptLibraryItems: readonly LibraryPrompt[]
  userPromptItems: readonly LibraryPrompt[]
  loading: boolean
  error: string | null
  query: string
  selectedLibraryPrompt: LibraryPrompt | null
  activeSkill: { key: string; name: string } | null
  promptModeId: string
  onQueryChange: (query: string) => void
  onSelectPreset: (id: string) => void
  onSelectLibraryPrompt: (prompt: LibraryPrompt) => void
  onReload: () => void
  onClose: () => void
}

/** Compact prompt chooser: built-in round presets plus the canonical library. */
export function ResidentPromptMenu({
  t,
  promptLibraryItems,
  userPromptItems,
  loading,
  error,
  query,
  selectedLibraryPrompt,
  activeSkill,
  promptModeId,
  onQueryChange,
  onSelectPreset,
  onSelectLibraryPrompt,
  onReload,
  onClose,
}: ResidentPromptMenuProps): JSX.Element {
  const rowClass = 'flex min-h-7 w-full items-center gap-2 rounded-nomi-sm px-2 py-1 text-left text-caption leading-tight transition-[background,color] duration-[var(--nomi-transition-fast)] hover:bg-nomi-ink-05'
  const typeLabel = (prompt: LibraryPrompt): string => prompt.promptType === 'video' ? t('agentResident.video') : t('agentResident.image')
  const normalizedQuery = query.trim().toLowerCase()
  const visiblePresets = PROMPT_PRESETS.filter((preset) => {
    if (!normalizedQuery) return true
    return `${t(`agentResident.${preset.labelKey}`)} ${t(`agentResident.${preset.hintKey}`)} ${preset.prompt}`.toLowerCase().includes(normalizedQuery)
  })
  const renderLibraryRow = (prompt: LibraryPrompt): JSX.Element => {
    const selected = selectedLibraryPrompt?.id === prompt.id && selectedLibraryPrompt.origin === prompt.origin
    const menuId = libraryPromptMenuId(prompt)
    return <MenuRow key={`${prompt.origin}:${prompt.id}`} testId={menuId} promptLibraryId={prompt.id} selected={selected} onClick={() => onSelectLibraryPrompt(prompt)} className={rowClass}>
      {prompt.promptType === 'video' ? <IconVideo size={16} className="shrink-0 text-nomi-ink-60" /> : <IconPhoto size={16} className="shrink-0 text-nomi-ink-60" />}
      <MenuCopy label={promptDisplayTitle(prompt)} hint={`${promptSourceLabel(prompt)} · ${typeLabel(prompt)}`} />
      {selected ? <IconCheck size={14} className="shrink-0 text-nomi-accent" /> : null}
    </MenuRow>
  }
  return <Popover open onClose={onClose} label={t('agentResident.prompt')} className="w-[360px] max-w-[calc(100vw-24px)]">
    <label className="mx-1 mb-1 flex h-7 items-center gap-1.5 rounded-nomi-sm border border-nomi-line px-2 text-micro text-nomi-ink-40 focus-within:border-nomi-accent">
      <IconSearch size={14} aria-hidden="true" />
      <input value={query} onChange={(event) => onQueryChange(event.currentTarget.value)} placeholder={t('libraries.prompt.searchPlaceholder')} aria-label={t('libraries.prompt.searchAria')} data-agent-prompt-search="true" className="min-w-0 flex-1 bg-transparent outline-none" />
    </label>
    {visiblePresets.map((preset) => {
      const PresetIcon = preset.icon
      const selected = !activeSkill && !selectedLibraryPrompt && promptModeId === preset.id
      return <MenuRow key={preset.id} selected={selected} testId={preset.id} onClick={() => onSelectPreset(preset.id)} className={rowClass}>
        <PresetIcon size={16} className="shrink-0 text-nomi-ink-60" />
        <MenuCopy label={<>{t(`agentResident.${preset.labelKey}`)}{preset.id !== 'general' ? <span className="ml-1 rounded-pill bg-nomi-ink-05 px-1 text-micro text-nomi-ink-40">{t('agentResident.builtIn')}</span> : null}</>} hint={t(`agentResident.${preset.hintKey}`)} />
        {selected ? <IconCheck size={14} className="shrink-0 text-nomi-accent" /> : null}
      </MenuRow>
    })}
    <div className="my-1 border-t border-nomi-line-soft" />
    <div className="px-2 py-1 text-micro text-nomi-ink-40">{t('libraries.prompt.title')}</div>
    {loading ? <div className="px-2 py-1 text-micro text-nomi-ink-40" role="status">{t('libraries.prompt.fetching')}</div> : null}
    {!loading && promptLibraryItems.length ? promptLibraryItems.map(renderLibraryRow) : null}
    {userPromptItems.length ? <><div className="my-1 border-t border-nomi-line-soft" /><div className="px-2 py-1 text-micro text-nomi-ink-40">{t('libraries.prompt.source.mine')}</div>{userPromptItems.map(renderLibraryRow)}</> : null}
    {!loading && !promptLibraryItems.length && !userPromptItems.length ? <MenuRow disabled testId="library-empty" className={rowClass}><IconPencil size={16} className="shrink-0 text-nomi-ink-40" /><MenuCopy label={error ? t('runtime.promptLibrary.loadFailed') : t('runtime.promptLibrary.empty')} /></MenuRow> : null}
    {error ? <MenuRow testId="library-retry" onClick={onReload} className={rowClass}><IconRefresh size={16} className="shrink-0 text-nomi-ink-60" /><MenuCopy label={t('runtime.promptLibrary.loadFailed')} hint={t('agentResident.retry')} /></MenuRow> : null}
  </Popover>
}

export const PROMPT_PRESETS = [
  { id: 'general', labelKey: 'promptDefault', hintKey: 'promptDefaultHint', icon: IconCircleDashed, prompt: '' },
  { id: 'story', labelKey: 'promptCamera', hintKey: 'promptCameraHint', icon: IconAperture, prompt: '保留人物、机位和动作，只调整光线、景深与前景层次。' },
  { id: 'script', labelKey: 'promptScript', hintKey: 'promptScriptHint', icon: IconFilePencil, prompt: '先指出冲突与节奏问题，再给出尽量保留原意的改写。' },
  { id: 'review', labelKey: 'promptReview', hintKey: 'promptReviewHint', icon: IconTextSpellcheck, prompt: '检查结构、逻辑和表达，逐条说明原因后再修订。' },
  { id: 'assets', labelKey: 'promptAssets', hintKey: 'promptAssetsHint', icon: IconWorldSearch, prompt: '只返回可追溯来源与明确授权状态的候选素材。' },
] as const
