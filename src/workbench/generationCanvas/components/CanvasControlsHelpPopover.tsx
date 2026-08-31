import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconKeyboard } from '@tabler/icons-react'
import { Tooltip, TooltipContent, TooltipTrigger, WorkbenchButton } from '../../../design'
import { cn } from '../../../utils/cn'
import { useCanvasGestureScheme } from './canvasGesturePreference'
import { canvasControlsHelpSections } from './canvasControlsHelpModel'

export function CanvasControlsHelpPopover(): JSX.Element {
  const { t } = useTranslation()
  const scheme = useCanvasGestureScheme()
  const [open, setOpen] = React.useState(false)
  const rootRef = React.useRef<HTMLDivElement>(null)
  const platform = typeof navigator === 'undefined' ? '' : navigator.platform
  const sections = React.useMemo(() => canvasControlsHelpSections(scheme, platform), [platform, scheme])

  React.useEffect(() => {
    if (!open) return undefined
    const handlePointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setOpen(false)
      rootRef.current?.querySelector('button')?.focus()
    }
    document.addEventListener('pointerdown', handlePointerDown, true)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  const label = t('generationCommon.navigation.canvasControls')

  return (
    <div ref={rootRef} className="relative inline-flex">
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex">
            <WorkbenchButton
              aria-label={label}
              aria-haspopup="dialog"
              aria-expanded={open}
              aria-pressed={open}
              onClick={() => setOpen((value) => !value)}
            >
              <IconKeyboard size={15} stroke={1.8} aria-hidden="true" />
            </WorkbenchButton>
          </span>
        </TooltipTrigger>
        <TooltipContent side="top">{label}</TooltipContent>
      </Tooltip>
      {open ? (
        <div
          className={cn(
            // 居中显示在触发按钮上方——left-0 向右会越视口右缘、right-0 向左被左栏遮；
            // 居中不走极端，不依赖窗口宽度。
            'absolute bottom-[calc(100%+8px)] left-1/2 -translate-x-1/2 z-[12] w-[30rem] p-3',
            'grid grid-cols-2 gap-3 border border-nomi-line rounded-nomi',
            'bg-nomi-paper text-nomi-ink shadow-nomi-lg',
          )}
          role="dialog"
          aria-label={t('generationCommon.canvas.controlsHelp.aria')}
          onPointerDown={(event) => event.stopPropagation()}
        >
          {sections.map((section) => (
            <section key={section.id} className="grid content-start gap-1.5">
              <h3 className="text-caption font-semibold text-nomi-ink-60">
                {t(`generationCommon.canvas.controlsHelp.sections.${section.id}`)}
              </h3>
              <div className="grid gap-1">
                {section.rows.map((row) => (
                  <div key={`${row.shortcutKey}-${row.actionKey}`} className="flex items-center justify-between gap-2">
                    <span className="text-caption whitespace-nowrap text-nomi-ink-60">
                      {t(`generationCommon.canvas.controlsHelp.actions.${row.actionKey}`)}
                    </span>
                    <kbd className="shrink-0 rounded-nomi-sm border border-nomi-line bg-nomi-ink-05 px-1.5 py-1 text-caption font-medium leading-none whitespace-nowrap text-nomi-ink">
                      {t(`generationCommon.canvas.controlsHelp.shortcuts.${row.shortcutKey}`, row.shortcutValues)}
                    </kbd>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : null}
    </div>
  )
}
