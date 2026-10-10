import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { IconChevronDown, IconCheck, IconLayoutDashboard } from '@tabler/icons-react'
import { WorkbenchButton } from '../../design'
import { cn } from '../../utils/cn'
import type { EditingPanelPreset, EditingPanelVisibility } from './panelLayout'
import { useWorkbenchStore } from '../workbenchStore'

// 顶栏「布局」菜单（合同 §2.1）：五块面板开关 + 四个预设 + 恢复默认。
// 住在应用顶栏而不是 Nomi 面板头——Nomi 面板头按合同只留徽标 / 额度 / 历史 / 收起。

const PRESETS: Array<Exclude<EditingPanelPreset, 'custom'>> = ['default', 'focus', 'result', 'portrait']
const PRESET_KEYS = {
  default: 'timelinePreview.previewLayout.presets.default',
  focus: 'timelinePreview.previewLayout.presets.focus',
  result: 'timelinePreview.previewLayout.presets.result',
  portrait: 'timelinePreview.previewLayout.presets.portrait',
} as const
const PANEL_KEYS = {
  source: 'timelinePreview.previewLayout.panels.source',
  inspector: 'timelinePreview.previewLayout.panels.inspector',
  assistant: 'timelinePreview.previewLayout.panels.assistant',
} as const

export default function EditingLayoutMenu(): JSX.Element {
  const { t } = useTranslation()
  const layout = useWorkbenchStore((state) => state.editingPanelLayout)
  const toggle = useWorkbenchStore((state) => state.toggleEditingPanel)
  const setPreset = useWorkbenchStore((state) => state.setEditingPanelPreset)
  const reset = useWorkbenchStore((state) => state.resetEditingPanelLayout)
  const [open, setOpen] = React.useState(false)
  const rootRef = React.useRef<HTMLDivElement | null>(null)

  React.useEffect(() => {
    if (!open) return undefined
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const panels = Object.keys(PANEL_KEYS) as Array<keyof EditingPanelVisibility>

  return (
    <div className="relative" ref={rootRef}>
      <WorkbenchButton
        className={cn(
          'app-no-drag',
          'inline-flex h-7 items-center gap-1 px-1.5',
          'rounded-nomi-sm border-0 bg-transparent font-inherit text-body-sm text-nomi-ink-60',
          'transition-[background,color] duration-nomi-fast ease-nomi-fast',
          'hover:bg-nomi-ink-05 hover:text-nomi-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-nomi-accent',
          open && 'bg-nomi-ink-10 text-nomi-ink',
        )}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('timelinePreview.previewLayout.title')}
        onClick={() => setOpen(!open)}
      >
        <IconLayoutDashboard size={18} stroke={1.5} />
        <span className="max-[1440px]:hidden">{t('timelinePreview.previewLayout.title')}</span>
        <IconChevronDown size={12} stroke={1.5} />
      </WorkbenchButton>
      {open ? (
        <div
          className={cn(
            'absolute right-0 top-full z-[130] mt-1 w-56 p-2',
            'rounded-nomi border border-[var(--workbench-border)] bg-[var(--nomi-paper)]',
            'shadow-[var(--workbench-shadow-pop)]',
          )}
          role="menu"
          aria-label={t('timelinePreview.previewLayout.title')}
        >
          <div className="mb-1 px-2 text-micro font-semibold text-[var(--workbench-muted)]">
            {t('timelinePreview.previewLayout.panelsTitle')}
          </div>
          {panels.map((panel) => (
            <button
              key={panel}
              type="button"
              role="menuitemcheckbox"
              aria-checked={layout.visibility[panel]}
              className={cn(
                'flex w-full cursor-pointer items-center justify-between gap-2 rounded-nomi-sm border-0 bg-transparent',
                'px-2 py-1 text-left text-caption text-[var(--workbench-ink)] hover:bg-[var(--workbench-hover)]',
              )}
              onClick={() => toggle(panel)}
            >
              <span>{t(PANEL_KEYS[panel])}</span>
              {layout.visibility[panel] ? <IconCheck size={14} className="text-[var(--workbench-accent)]" /> : null}
            </button>
          ))}
          <div className="my-2 border-t border-[var(--workbench-border)]" />
          <div className="mb-1 px-2 text-micro font-semibold text-[var(--workbench-muted)]">
            {t('timelinePreview.previewLayout.presetsTitle')}
          </div>
          {/* 选一个预设 / 恢复默认就是一次性动作，选完关菜单；上面的面板开关是多选，保持打开。 */}
          {PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              role="menuitemradio"
              aria-checked={layout.preset === preset}
              className={cn(
                'flex w-full cursor-pointer items-center justify-between gap-2 rounded-nomi-sm border-0 bg-transparent',
                'px-2 py-1 text-left text-caption text-[var(--workbench-ink)] hover:bg-[var(--workbench-hover)]',
                layout.preset === preset && 'bg-[var(--workbench-accent-soft)]',
              )}
              onClick={() => { setPreset(preset); setOpen(false) }}
            >
              <span>{t(PRESET_KEYS[preset])}</span>
              {layout.preset === preset ? <IconCheck size={14} className="text-[var(--workbench-accent)]" /> : null}
            </button>
          ))}
          <button
            type="button"
            role="menuitem"
            className={cn(
              'mt-1 block w-full cursor-pointer rounded-nomi-sm border-0 bg-transparent px-2 py-1',
              'text-left text-caption text-[var(--workbench-accent)] hover:bg-[var(--workbench-hover)]',
            )}
            onClick={() => { reset(); setOpen(false) }}
          >
            {t('timelinePreview.previewLayout.reset')}
          </button>
        </div>
      ) : null}
    </div>
  )
}
