import React from 'react'

/**
 * 出片产物卡片（P0-4/P3-14 → 任务优先重构 2026-07-22）：渲染中 → 完成（带去向）。
 * 原「出片面板」（三产物一个入口）已删（P1）：三产物改由任务 CTA 直达——
 * 构图图=「使用这张构图」、动作=录 take、运镜=「生成参考视频」；首尾帧在整运镜区、
 * 视口截图在视图身份 chip 旁。状态由宿主 useScene3DExportActions 盯 take 节点推进。
 */
export function Scene3DExportingCard({ card, onGoCanvas, onReplayTake, onDismiss }: {
  card: import('./useScene3DFullscreenActions').Scene3DExportCard | null
  /** 回画布查看：关编辑器（宿主已排好 fit + 高亮新节点） */
  onGoCanvas: () => void
  /** 原位重播刚录的 take（不把用户赶回画布，审计 §6.3）——仅 video 完成态出现 */
  onReplayTake?: () => void
  onDismiss: () => void
}): JSX.Element | null {
  if (!card) return null
  return (
    <div className="fixed bottom-6 right-6 z-[59] flex max-w-[480px] items-center gap-3 rounded-nomi border border-[var(--nomi-line-soft)] bg-[var(--workbench-surface-solid)] px-4 py-3 shadow-workbench-pop">
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
          {card.kind === 'video' && onReplayTake ? (
            <button
              type="button"
              onClick={onReplayTake}
              className="shrink-0 rounded-nomi-sm border border-[var(--nomi-line-soft)] bg-[var(--nomi-paper)] px-2.5 py-1.5 text-caption text-[var(--workbench-ink)] hover:bg-[var(--nomi-ink-05)]"
            >
              原位重播
            </button>
          ) : null}
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
