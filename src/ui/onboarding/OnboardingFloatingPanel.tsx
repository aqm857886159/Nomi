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
import { currentWorkbenchFloatingTopOffset } from '../app-shell/windowChrome'
import { NOMI_OVERLAY_Z_INDEX } from '../../design'

const PANEL_WIDTH = 320
const RIGHT_OFFSET = 12

type Props = {
  opened: boolean
  onClose: () => void
}

export function OnboardingFloatingPanel({ opened, onClose }: Props): JSX.Element | null {
  const { t } = useTranslation()
  const panelRef = React.useRef<HTMLDivElement>(null)
  // 渲染时现算，**不能提到模块作用域**：模块常量在 import 求值那一刻定死，
  // 拿不到 window.nomiDesktop.platform 就悄悄回落成 mac 的 64px，Windows 上整张浮卡上移 32px
  // 贴进自绘窗口栏（issue #58 的位移就是这么来的）。offset 依赖运行时输入 → 随输入 derive。
  const topOffset = currentWorkbenchFloatingTopOffset()

  // ESC 关闭
  React.useEffect(() => {
    if (!opened) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [opened, onClose])

  // 点击外部关闭。**capture 阶段监听**：画布节点大量 onPointerDown stopPropagation
  // （如 NodeGenerationComposer），冒泡阶段监听根本收不到 → 用户点画布关不掉面板，
  // 只剩 ESC 一条路（2026-08-07 飞书反馈「不知道怎么退出」根因之一）。capture 先于
  // target/bubble 触发，stopPropagation 挡不住。
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
      if (target.closest(
        '.mantine-Modal-root, .mantine-Modal-overlay, .mantine-Modal-content,' +
        '.mantine-Drawer-root, .mantine-Drawer-overlay,' +
        '.mantine-Popover-dropdown, .mantine-Menu-dropdown, .mantine-Combobox-dropdown, .mantine-Tooltip-tooltip,' +
        '[role="dialog"]'
      )) return
      onClose()
    }
    const id = window.requestAnimationFrame(() => {
      window.addEventListener('mousedown', handler, true)
    })
    return () => {
      window.cancelAnimationFrame(id)
      window.removeEventListener('mousedown', handler, true)
    }
  }, [opened, onClose])

  if (!opened) return null

  return (
    <Portal>
      <div
        ref={panelRef}
        role="dialog"
        aria-label={t('onboardingProviders.drawer.title')}
        data-nomi-right-panel="model"
        // Portal 到 body 会脱离 .workbench-shell 作用域 → 面板内所有 --workbench-* **全部未定义**：
        // 实测 background:var(--workbench-success-soft) 解析成 rgba(0,0,0,0)（透明）、
        // color:var(--workbench-danger) 解析成纯黑而非红 —— 面板里 60+ 处成功/危险配色一直是死的
        // （「已接入」绿框没有底色、错误文字不是红的）。带上 workbench-shell 把 token 作用域接回来，
        // 与 CreationAiPanel / Scene3DFullscreen 同一做法。该 class 只定义变量、不画任何属性，故零布局影响。
        // app-no-drag（连同 `.app-no-drag *` 覆盖全部后代）：Windows 是 frame:false + 自绘窗口栏，
        // 拖拽区靠 -webkit-app-region 命中测试划出来，而命中测试**看几何、不看 DOM 层级**——
        // Portal 到 body 的浮层不是窗口栏的后代，拿不到窗口栏内那条 `.app-drag button` 豁免，
        // 压在拖拽带上的按钮点击就被系统当成拖窗口吃掉（issue #58：× 中心点不动，偏上下才灵）。
        // 定位算对只是让它别压上去，这条才是「压上去也不失灵」的根治：浮层一律退出拖拽区。
        className="workbench-shell app-no-drag"
        style={{
          position: 'fixed',
          top: topOffset,
          right: RIGHT_OFFSET,
          width: PANEL_WIDTH,
          maxHeight: `calc(100vh - ${topOffset + 16}px)`,
          background: 'var(--nomi-paper)',
          borderRadius: 'var(--nomi-radius-lg)',
          boxShadow: 'var(--nomi-shadow-lg)',
          zIndex: NOMI_OVERLAY_Z_INDEX.floatingPanel,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          // 进入动画
          animation: 'nomi-panel-pop 140ms cubic-bezier(.2, .7, .3, 1)',
        }}
      >
        {/* 显式头部：标题 + X 关闭。此前出口只有 ESC 和点外关闭（还被画布 stopPropagation
            吞掉）→ 用户反馈「不知道怎么退出」。无遮罩浮卡的拍板设计不变，只是补显式出口。 */}
        <div
          className="flex items-center justify-between shrink-0 px-3 py-2 border-b border-nomi-line-soft"
        >
          <span className="text-caption font-semibold text-nomi-ink-60">
            {t('onboardingProviders.drawer.title')}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close')}
            className="text-nomi-ink-40 hover:text-nomi-ink text-h2 leading-none px-1"
          >
            ×
          </button>
        </div>
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
