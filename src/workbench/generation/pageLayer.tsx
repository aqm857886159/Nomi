/**
 * [INPUT]: 依赖 react、react-dom 的 createPortal、../../utils/cn、./pageLayerContext 的 useGenerationPageLayerState
 * [OUTPUT]: 对外提供 GenerationPageLayer（页内全屏层的唯一挂法）
 * [POS]: 生成页「页内全屏层」的挂载点合同（2026-10-29 导演台收进生成页，方向检查 docs/plan/2026-10-29-director-layer-in-page.direction-check.md）。
 *        导演台 / 全景查看器这类铺满「画布那一格」的编辑器 / 查看器是**页面里的一块**，不是盖住整窗的模态：
 *          · 版面归 GenerationWorkspace 的网格——层只写 `absolute inset-0`，右边让不让停靠栏、顶栏和左栏在哪，网格已经给了，
 *            层里不许再读 Agent 形态或自己算偏移；
 *          · 可见性归 GenerationWorkspace 算出的 `active`（生成页是不是当前页 && 画布视图，见 pageLayerContext.ts）——藏着时层 display:none，
 *            层里藏着时该停的事（全局键盘监听、3D 渲染循环、暗色锁）读 useGenerationPageLayerActive，不读 workspaceMode；
 *          · 层级 z-[40]：在画布内浮件（≤30）之上、Agent 小球 / 浮窗层（z-[60]）之下，所以 Agent 不管停靠、浮窗还是小球都不被盖。
 *        灯箱类三处旧例（NodeMediaPreviewDialog / NodeShotCutPanel / ScreenshotCropOverlay）按 class 名找同一个格子、行为是盖住 Agent 的模态，
 *        不走这里；pageLayerCensus.test.ts 把它们登记为「存量只减不增」，body 上的全屏层则必须登记归属。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import React from 'react'
import { createPortal } from 'react-dom'
import { cn } from '../../utils/cn'
import { useGenerationPageLayerState } from './pageLayerContext'

/**
 * 把 children 挂进生成页画布那一格，铺满它。页内全屏层的**唯一**挂法——不要再 `createPortal(…, document.body)`。
 * 层本身 `absolute inset-0`：矩形就是页格矩形；藏着时 display:none（层里的 3D 画布量到 0×0，回来由它自己的 ResizeObserver 接上）。
 * 挂载点还没挂上（host 为空）时什么也不渲染。
 */
export function GenerationPageLayer({ children }: { children: React.ReactNode }): React.ReactPortal | null {
  const { host, active } = useGenerationPageLayerState()
  if (!host) return null
  return createPortal(
    <div className={cn('absolute inset-0 z-[40]', !active && 'hidden')} data-generation-page-layer data-page-layer-active={active ? 'true' : 'false'}>
      {children}
    </div>,
    host,
  )
}
