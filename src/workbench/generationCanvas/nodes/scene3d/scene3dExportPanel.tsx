import React from 'react'
import { IconPhoto, IconVideo, IconX, IconPlayerPlay } from '@tabler/icons-react'
import type { Scene3DState } from './scene3dTypes'
import { isCameraMoveReady } from './scene3dPlayback'

/**
 * 出片面板（P0-2）：3D 场景的"产物出口"。
 *
 * 设计定案（docs/plan/2026-07-20-scene3d-ux-overhaul.md §4.3）：
 * 三种产物一个入口——参考视频 / 截图 / 首尾帧。
 * "参考视频"标"推荐"——这是用户最常要的产物。
 * 没整运镜时，"参考视频"灰掉 + 提示"先整运镜"。
 */

export type Scene3DExportPanelProps = {
  open: boolean
  onClose: () => void
  state: Scene3DState
  onExportReferenceVideo: () => void
  onScreenshotViewport: () => void
  onScreenshotCamera: () => void
  onExportKeyFrames: () => void
  hasCamera: boolean
}

/**
 * P0-4/P3-14：出片产物卡片。渲染中 → 完成（带去向：画布节点/下游镜头）三态，
 * 状态由宿主 useScene3DExportActions 盯 take 节点 meta.cameraMoveVideo 推进。
 */
export function Scene3DExportingCard({ card, onGoCanvas, onDismiss }: {
  card: import('./useScene3DFullscreenActions').Scene3DExportCard | null
  /** 回画布查看：关编辑器（宿主已排好 fit + 高亮新节点） */
  onGoCanvas: () => void
  onDismiss: () => void
}): JSX.Element | null {
  if (!card) return null
  return (
    <div className="fixed bottom-6 right-6 z-[59] flex max-w-[440px] items-center gap-3 rounded-nomi border border-[var(--nomi-line-soft)] bg-[var(--workbench-surface-solid)] px-4 py-3 shadow-workbench-pop">
      {card.phase === 'done' ? (
        <>
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-caption font-medium text-[var(--workbench-ink)]">
              {card.kind === 'screenshot' ? '✅ 截图已生成' : '✅ 参考视频已生成'}
            </span>
            <span className="text-micro text-[var(--workbench-muted)]">
              {card.kind === 'screenshot'
                ? '已建画布图片节点（在编辑器后面的画布上）'
                : card.fedDownstream ? '已建画布节点 · 已自动喂给下游镜头' : '已建画布节点（没接下游镜头，先留档可复用）'}
            </span>
          </div>
          <button
            type="button"
            onClick={onGoCanvas}
            className="shrink-0 rounded-nomi-sm bg-[var(--nomi-ink)] px-2.5 py-1.5 text-caption font-medium text-[var(--nomi-paper)] transition-opacity hover:opacity-90"
          >
            回画布查看
          </button>
          <button
            type="button"
            onClick={onDismiss}
            className="shrink-0 text-caption text-[var(--workbench-muted)] hover:text-[var(--workbench-ink)]"
          >
            知道了
          </button>
        </>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <div className="size-2 animate-pulse rounded-full bg-[var(--nomi-accent)]" />
            <span className="text-caption font-medium text-[var(--workbench-ink)]">
              {card.phase === 'slow' ? '参考视频渲染较慢…' : '参考视频生成中…'}
            </span>
          </div>
          <span className="text-caption text-[var(--workbench-muted)]">
            {card.phase === 'slow' ? '可先回画布，渲染在后台继续' : '完成后这里会提示去向'}
          </span>
          <button
            type="button"
            onClick={onDismiss}
            className="ml-2 text-caption text-[var(--workbench-muted)] hover:text-[var(--workbench-ink)]"
          >
            知道了
          </button>
        </>
      )}
    </div>
  )
}

export default function Scene3DExportPanel({
  open,
  onClose,
  state,
  onExportReferenceVideo,
  onScreenshotViewport,
  onScreenshotCamera,
  onExportKeyFrames,
  hasCamera,
}: Scene3DExportPanelProps): JSX.Element | null {
  if (!open) return null

  const moveReady = isCameraMoveReady(state)
  const trajectoryCount = state.trajectories.filter((t) => t.points.length >= 2).length
  const bindingCount = state.trajectoryBindings.length

  return (
    <>
      {/* 背景遮罩 */}
      <div
        className="fixed inset-0 z-[60] bg-[var(--nomi-scrim)]"
        onClick={onClose}
        aria-hidden
      />
      {/* 出片面板（右侧滑出） */}
      <aside
        className="fixed right-0 top-0 z-[61] flex h-full w-[360px] flex-col overflow-hidden border-l border-[var(--nomi-line-soft)] bg-[var(--workbench-surface-solid)] shadow-workbench-pop"
        role="dialog"
        aria-label="出片"
      >
        {/* 头部 */}
        <header className="flex min-h-[52px] shrink-0 items-center gap-2 border-b border-[var(--workbench-border)] px-4">
          <span className="text-body font-medium text-[var(--workbench-ink)]">出片</span>
          <span className="text-caption text-[var(--workbench-muted)]">— 选你要拿什么产物</span>
          <button
            type="button"
            className="ml-auto grid size-8 place-items-center rounded-nomi-sm text-[var(--workbench-muted)] hover:bg-[var(--nomi-ink-05)] hover:text-[var(--workbench-ink)]"
            onClick={onClose}
            title="关闭"
          >
            <IconX size={16} />
          </button>
        </header>

        {/* 内容 */}
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
          {/* 参考视频（推荐） */}
          <button
            type="button"
            disabled={!moveReady}
            onClick={onExportReferenceVideo}
            className="group flex flex-col gap-2 rounded-nomi border border-[var(--nomi-line-soft)] bg-[var(--nomi-paper)] p-4 text-left transition-colors hover:border-[var(--nomi-ink-30)] hover:bg-[var(--nomi-ink-05)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <div className="flex items-center gap-2">
              <IconVideo size={20} className="text-[var(--nomi-ink)]" />
              <span className="text-body-sm font-medium text-[var(--workbench-ink)]">参考视频</span>
              <span className="ml-auto rounded-full bg-[var(--nomi-ink)] px-2 py-0.5 text-micro font-medium text-[var(--nomi-paper)]">
                推荐
              </span>
            </div>
            <p className="text-caption text-[var(--workbench-muted)]">
              沿运镜渲染 mp4，自动喂给下游镜头
            </p>
            {!moveReady ? (
              <p className="text-caption text-[var(--workbench-danger)]">
                {trajectoryCount === 0
                  ? '先整运镜（轨迹/预设/录 take）才能出参考视频'
                  : bindingCount === 0
                    ? '轨迹要先绑定相机才能出参考视频'
                    : '运镜未就绪'}
              </p>
            ) : (
              <p className="text-caption text-[var(--workbench-muted)]">
                ✓ 运镜就绪（{trajectoryCount} 条轨迹 · {bindingCount} 个绑定）
              </p>
            )}
          </button>

          {/* 截图 */}
          <div className="flex flex-col gap-2 rounded-nomi border border-[var(--nomi-line-soft)] bg-[var(--nomi-paper)] p-4">
            <div className="flex items-center gap-2">
              <IconPhoto size={20} className="text-[var(--nomi-ink)]" />
              <span className="text-body-sm font-medium text-[var(--workbench-ink)]">截图</span>
            </div>
            <p className="text-caption text-[var(--workbench-muted)]">当前视口 or 相机取景</p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onScreenshotViewport}
                className="flex-1 rounded-nomi-sm border border-[var(--nomi-line-soft)] bg-[var(--nomi-ink-05)] px-3 py-1.5 text-caption text-[var(--workbench-ink)] hover:bg-[var(--nomi-ink-10)]"
              >
                视口截图
              </button>
              <button
                type="button"
                onClick={onScreenshotCamera}
                disabled={!hasCamera}
                className="flex-1 rounded-nomi-sm border border-[var(--nomi-line-soft)] bg-[var(--nomi-ink-05)] px-3 py-1.5 text-caption text-[var(--workbench-ink)] hover:bg-[var(--nomi-ink-10)] disabled:cursor-not-allowed disabled:opacity-50"
                title={hasCamera ? '相机取景截图' : '先加个相机'}
              >
                相机截图
              </button>
            </div>
          </div>

          {/* 首尾帧 */}
          <button
            type="button"
            disabled={!moveReady || !hasCamera}
            onClick={onExportKeyFrames}
            className="group flex flex-col gap-2 rounded-nomi border border-[var(--nomi-line-soft)] bg-[var(--nomi-paper)] p-4 text-left transition-colors hover:border-[var(--nomi-ink-30)] hover:bg-[var(--nomi-ink-05)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <div className="flex items-center gap-2">
              <IconPhoto size={20} className="text-[var(--nomi-ink)]" />
              <span className="text-body-sm font-medium text-[var(--workbench-ink)]">首尾帧</span>
            </div>
            <p className="text-caption text-[var(--workbench-muted)]">
              运镜起点+终点各截一张，可作首尾帧参考
            </p>
            {(!moveReady || !hasCamera) && (
              <p className="text-caption text-[var(--workbench-danger)]">
                需要有相机 + 运镜才能导出首尾帧
              </p>
            )}
          </button>

          {/* 底部提示 */}
          <div className="mt-auto rounded-nomi bg-[var(--nomi-ink-05)] p-3 text-caption text-[var(--workbench-muted)]">
            <div className="flex items-center gap-1.5">
              <IconPlayerPlay size={12} />
              <span>产物会自动进画布 + 喂给下游镜头</span>
            </div>
          </div>
        </div>
      </aside>
    </>
  )
}
