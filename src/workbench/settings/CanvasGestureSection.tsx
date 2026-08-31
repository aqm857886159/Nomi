/**
 * 设置 · 通用 · 画布滚轮语义（需求 #832，2026-07-31 用户拍板 / 2026-08-03 补齐）。
 *
 * 为什么是「二选一」而不是定死一个：两拨人的肌肉记忆相反——鼠标党要滚轮=缩放（ComfyUI），
 * 触控板党要双指滑=平移（Figma）。定死任何一个都会让另一拨每天别扭，且没有退路。
 *
 * 芯片行的样式与选中态照抄同页 [[ScreenshotHotkeySection]]，不另发明一套控件（P4/设计一致性）。
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '../../utils/cn'
import {
  setCanvasGestureScheme,
  useCanvasGestureScheme,
  type CanvasGestureScheme,
} from '../generationCanvas/components/canvasGesturePreference'

const OPTIONS: { id: CanvasGestureScheme; labelKey: string; hintKey: string }[] = [
  { id: 'wheel-zoom', labelKey: 'settings.general.canvasGestureZoom', hintKey: 'settings.general.canvasGestureZoomHint' },
  { id: 'modifier-zoom', labelKey: 'settings.general.canvasGesturePan', hintKey: 'settings.general.canvasGesturePanHint' },
]

export function CanvasGestureSection(): JSX.Element {
  const { t } = useTranslation()
  const scheme = useCanvasGestureScheme()
  const active = OPTIONS.find((option) => option.id === scheme) ?? OPTIONS[0]

  return (
    <div className="mt-5 border-t border-nomi-line pt-4">
      <div className="mb-1.5 text-body-sm text-nomi-ink">{t('settings.general.canvasGesture')}</div>
      <div className="mb-3 text-caption leading-relaxed text-nomi-ink-40">{t('settings.general.canvasGestureHint')}</div>

      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={t('settings.general.canvasGesture')}>
        {OPTIONS.map((option) => (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={option.id === scheme}
            data-canvas-gesture-scheme={option.id}
            onClick={() => setCanvasGestureScheme(option.id)}
            className={cn(
              'rounded-nomi-sm border px-2.5 py-1.5 text-caption cursor-pointer',
              'transition-colors duration-[var(--nomi-transition-fast)]',
              option.id === scheme
                ? 'border-nomi-accent bg-nomi-accent-soft text-nomi-accent'
                : 'border-nomi-line bg-nomi-paper text-nomi-ink-60 hover:bg-nomi-ink-05',
            )}
          >
            {t(option.labelKey)}
          </button>
        ))}
      </div>

      {/* 选中档的解释常驻：芯片本身只有「缩放/平移」两个字，说不清⌘+滚轮这类差异 */}
      <div className="mt-2 text-caption leading-relaxed text-nomi-ink-40">{t(active.hintKey)}</div>
    </div>
  )
}
