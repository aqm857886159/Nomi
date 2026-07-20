/**
 * 模型设置悬浮卡片。
 *
 * 用户反馈：之前的全屏右抽屉 (420px) + 背景 dim → "大幅度遮挡"。
 * 改成：右上角浮卡，320px 宽，按内容自适应高度（max-height 70vh），
 * 无背景遮罩；点外部 / Escape 关闭。
 *
 * Workspace 在悬浮卡片打开时仍然可见 + 可操作（不 dim）。
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { Portal } from '@mantine/core'
import { OnboardingDrawer } from './OnboardingDrawer'

const PANEL_WIDTH = 320
const TOP_OFFSET = 64 // 留出 AppBar (56px) + 一点空隙
const RIGHT_OFFSET = 12

type Props = {
  opened: boolean
  onClose: () => void
}

export function OnboardingFloatingPanel({ opened, onClose }: Props): JSX.Element | null {
  const { t } = useTranslation()
  const panelRef = React.useRef<HTMLDivElement>(null)

  // ESC 关闭
  React.useEffect(() => {
    if (!opened) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [opened, onClose])

  // 点击外部关闭
  React.useEffect(() => {
    if (!opened) return
    const handler = (e: MouseEvent) => {
      if (!panelRef.current) return
      const target = e.target as Element | null
      if (!target) return
      // 点击在面板内 → 不关
      if (panelRef.current.contains(target)) return
      // 点击在 Mantine 浮层内（Modal / Drawer / Popover / Menu）→ 不关
      // 这些组件用独立 Portal，渲染在 body 顶层，不在面板里
      if (
        target.closest(
          '.mantine-Modal-root, .mantine-Modal-overlay, .mantine-Modal-content,' +
            '.mantine-Drawer-root, .mantine-Drawer-overlay,' +
            '.mantine-Popover-dropdown, .mantine-Menu-dropdown, .mantine-Tooltip-tooltip,' +
            '[role="dialog"]',
        )
      )
        return
      onClose()
    }
    const id = window.requestAnimationFrame(() => {
      window.addEventListener('mousedown', handler)
    })
    return () => {
      window.cancelAnimationFrame(id)
      window.removeEventListener('mousedown', handler)
    }
  }, [opened, onClose])

  if (!opened) return null

  return (
    <Portal>
      <div
        ref={panelRef}
        role="dialog"
        aria-label={t('studio.modelSetupPanel')}
        style={{
          position: 'fixed',
          top: TOP_OFFSET,
          right: RIGHT_OFFSET,
          width: PANEL_WIDTH,
          maxHeight: `calc(100vh - ${TOP_OFFSET + 16}px)`,
          background: 'var(--nomi-paper)',
          borderRadius: 'var(--nomi-radius-lg)',
          boxShadow: 'var(--nomi-shadow-lg)',
          zIndex: 4000,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          // 进入动画
          animation: 'nomi-panel-pop 140ms cubic-bezier(.2, .7, .3, 1)',
        }}
      >
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
          <OnboardingDrawer />
        </div>
        <style>{`
          @keyframes nomi-panel-pop {
            from { opacity: 0; transform: translateY(-4px) scale(0.985); }
            to   { opacity: 1; transform: translateY(0) scale(1); }
          }
        `}</style>
      </div>
    </Portal>
  )
}
