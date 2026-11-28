import type { ExportProgressStatus } from '../export/exportApi'
import { computeTimelineDuration } from '../timeline/timelineMath'
import type { TimelineState } from '../timeline/timelineTypes'
import React from 'react'

/**
 * 顶栏「导出 MP4」↔ 预览播放器之间的**唯一**通路（合同 §2.2）。
 *
 * 导出的实现（ffmpeg 参数、进度、中止句柄）住在 TimelinePreview 里，它拿着 stage 尺寸与播放器句柄；
 * 按钮却按合同固定在应用顶栏。这里同时承担两个方向，两边都从这里取，杜绝字符串各写一遍：
 * - 下行：顶栏点一下 → 发起导出（`requestPreviewExport`）；导出中再点同一颗胶囊 → 发起取消（`requestPreviewExportCancel`）。
 * - 上行：预览的导出阶段/进度/取消收尾态 → 顶栏（`publishPreviewExportState` / `usePreviewExportState`）。
 */
export const PREVIEW_EXPORT_EVENT = 'nomi-preview-export'
export const PREVIEW_EXPORT_CANCEL_EVENT = 'nomi-preview-export-cancel'

export function canExportPreviewTimeline(timeline: Pick<TimelineState, 'tracks' | 'textClips'>): boolean {
  return computeTimelineDuration(timeline) > 0
}

/**
 * 从导出契约 derive，只并上 UI 局部的 idle/error 两个标志——
 * 不再维护第二份四态联合（语义词表：canonical owner 是 exportApi 的 ExportProgressStatus）。
 */
export type PreviewExportStatus = ExportProgressStatus | 'idle' | 'error'

export type PreviewExportState = {
  readonly status: PreviewExportStatus
  /** 0–1。`exportTimelineToMp4` 的 onProgress.ratio 原样透传。 */
  readonly progress: number
  /** 已点击取消、正在等主进程终止编码子进程与清理半成品：短暂禁用按钮防连点重入。 */
  readonly cancelling?: boolean
}

export const PREVIEW_EXPORT_IDLE: PreviewExportState = { status: 'idle', progress: 0, cancelling: false }

/** 忙 = 这三个阶段。判据只此一处，顶栏与预览共用（此前只有 TimelinePreview 私有一份）。 */
export function isPreviewExportBusy(status: PreviewExportStatus): boolean {
  return status === 'preparing' || status === 'recording' || status === 'converting'
}

/**
 * 阶段 → i18n key。顶栏的忙态说明与预览的进度文案读同一张表，
 * 免得「转码中」在两个地方各写一遍、日后只改一边。
 */
const PREVIEW_EXPORT_STAGE_KEYS = {
  preparing: 'timelinePreview.exportStage.preparing',
  recording: 'timelinePreview.exportStage.recording',
  converting: 'timelinePreview.exportStage.converting',
} as const

export function previewExportStageKey(
  status: PreviewExportStatus,
): (typeof PREVIEW_EXPORT_STAGE_KEYS)[keyof typeof PREVIEW_EXPORT_STAGE_KEYS] | null {
  return isPreviewExportBusy(status)
    ? PREVIEW_EXPORT_STAGE_KEYS[status as keyof typeof PREVIEW_EXPORT_STAGE_KEYS]
    : null
}

let previewExportState: PreviewExportState = PREVIEW_EXPORT_IDLE
const listeners = new Set<() => void>()

function subscribePreviewExportState(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getPreviewExportState(): PreviewExportState {
  return previewExportState
}

export function publishPreviewExportState(next: PreviewExportState): void {
  if (
    next.status === previewExportState.status
    && next.progress === previewExportState.progress
    && Boolean(next.cancelling) === Boolean(previewExportState.cancelling)
  ) {
    return
  }
  previewExportState = next
  for (const listener of [...listeners]) listener()
}

/** 测试与「离开预览页」用：把上行状态清回 idle。 */
export function resetPreviewExportState(): void {
  publishPreviewExportState(PREVIEW_EXPORT_IDLE)
}

export function usePreviewExportState(): PreviewExportState {
  return React.useSyncExternalStore(subscribePreviewExportState, getPreviewExportState, getPreviewExportState)
}

export function registerPreviewExportCancelHandler(handler: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const listener = () => {
    handler()
  }
  window.addEventListener(PREVIEW_EXPORT_CANCEL_EVENT, listener)
  return () => {
    window.removeEventListener(PREVIEW_EXPORT_CANCEL_EVENT, listener)
  }
}

export function requestPreviewExport(): void {
  window.dispatchEvent(new Event(PREVIEW_EXPORT_EVENT))
}

export function requestPreviewExportCancel(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event(PREVIEW_EXPORT_CANCEL_EVENT))
}
