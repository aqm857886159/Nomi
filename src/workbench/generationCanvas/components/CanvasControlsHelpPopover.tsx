import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { IconKeyboard } from '@tabler/icons-react'
import { AnchoredPopover, Tooltip, TooltipContent, TooltipTrigger, WorkbenchButton } from '../../../design'
import { cn } from '../../../utils/cn'
import { useCanvasGestureScheme } from '../../../utils/canvasGesturePreference'
import { canvasControlsHelpSections } from './canvasControlsHelpModel'

/**
 * 画布左下「键盘」按钮弹出的快捷键帮助。
 *
 * 浮层走 `AnchoredPopover`（Portal 到 body + overlayLayers 的 popover 档 + 视口内翻转/夹边），
 * 不再在导航竖列里原地 `absolute`：那样它被困在竖列的层叠上下文（z-8）里，
 * 底部浮着的 Agent 输入条、批量生成条都比它高，一弹出来就被盖住半截（2026-09-21 真机实拍）。
 * 「谁在最上面」的唯一 owner 是 `design/overlayLayers.ts`，这里只是按规矩去用它。
 *
 * 每行 = 「动作说明（可换行）｜键位（不换行）」两列网格：说明列 `minmax(0,1fr)` 可以折行，
 * 所以任何语言的长说明都只会变高、不会压到右边的键位上（英文界面「Box select」那一行就是被两边
 * 都 `nowrap` 挤出来的重叠）。
 */
export function CanvasControlsHelpPopover({ asRow = false, rowClassName }: { asRow?: boolean; rowClassName?: string } = {}): JSX.Element {
  const { t } = useTranslation()
  const scheme = useCanvasGestureScheme()
  const [open, setOpen] = React.useState(false)
  const anchorRef = React.useRef<HTMLSpanElement>(null)
  const platform = typeof navigator === 'undefined' ? '' : navigator.platform
  const sections = React.useMemo(() => canvasControlsHelpSections(scheme, platform), [platform, scheme])
  const close = React.useCallback(() => {
    setOpen(false)
    anchorRef.current?.querySelector('button')?.focus()
  }, [])

  const label = t('generationCommon.navigation.canvasControls')

  return (
    <div className={asRow ? 'relative block w-full' : 'relative inline-flex'}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span ref={anchorRef} className={asRow ? 'block w-full' : 'inline-flex'}>
            {asRow ? (
              // 收进「⋯」菜单里的一行：同一个帮助浮层，只是触发钮换成带文字的整行。
              <button
                type="button"
                className={rowClassName}
                aria-label={label}
                aria-haspopup="dialog"
                aria-expanded={open}
                onClick={() => setOpen((value) => !value)}
              >
                <IconKeyboard size={16} stroke={1.5} aria-hidden="true" />
                <span>{label}</span>
              </button>
            ) : (
              <WorkbenchButton
                aria-label={label}
                aria-haspopup="dialog"
                aria-expanded={open}
                aria-pressed={open}
                onClick={() => setOpen((value) => !value)}
              >
                <IconKeyboard size={15} stroke={1.8} aria-hidden="true" />
              </WorkbenchButton>
            )}
          </span>
        </TooltipTrigger>
        <TooltipContent side="top">{label}</TooltipContent>
      </Tooltip>
      {open ? (
        <AnchoredPopover anchorRef={anchorRef} align="start" gap={8} onClose={close}>
          <div
            className={cn(
              'w-[min(38rem,calc(100vw-1rem))] max-h-[calc(100vh-1rem)] overflow-y-auto p-3',
              'columns-2 gap-4 border border-nomi-line rounded-nomi',
              'bg-nomi-paper text-nomi-ink shadow-nomi-lg',
            )}
            role="dialog"
            aria-label={t('generationCommon.canvas.controlsHelp.aria')}
            data-canvas-controls-help="true"
          >
            {sections.map((section) => (
              <section key={section.id} className="mb-3 grid break-inside-avoid content-start gap-1.5">
                <h3 className="text-caption font-semibold text-nomi-ink-60">
                  {t(`generationCommon.canvas.controlsHelp.sections.${section.id}`)}
                </h3>
                <div className="grid gap-1">
                  {section.rows.map((row) => (
                    <div
                      key={`${row.shortcutKey}-${row.actionKey}`}
                      className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2"
                      data-canvas-controls-help-row={row.shortcutKey}
                    >
                      <span className="min-w-0 text-caption text-nomi-ink-60">
                        {t(`generationCommon.canvas.controlsHelp.actions.${row.actionKey}`)}
                      </span>
                      <kbd className="justify-self-end rounded-nomi-sm border border-nomi-line bg-nomi-ink-05 px-1.5 py-1 text-caption font-medium leading-none whitespace-nowrap text-nomi-ink">
                        {t(`generationCommon.canvas.controlsHelp.shortcuts.${row.shortcutKey}`, row.shortcutValues)}
                      </kbd>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </AnchoredPopover>
      ) : null}
    </div>
  )
}
