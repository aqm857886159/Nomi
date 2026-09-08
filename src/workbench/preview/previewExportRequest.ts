import type { ExportProgressStatus } from '../export/exportApi'
import React from 'react'

/**
 * 顶栏「导出 MP4」↔ 预览播放器之间的**唯一**通路（合同 §2.2）。
 *
 * 导出的实现（ffmpeg 参数、进度）住在 TimelinePreview 里，它拿着 stage 尺寸与播放器句柄；
 * 按钮却按合同固定在应用顶栏。这里同时承担两个方向，两边都从这里取，杜绝字符串各写一遍：
 * - 下行：顶栏点一下 → 事件 → 预览开跑（`requestPreviewExport`）。
 * - 上行：预览的导出阶段/进度 → 顶栏（`publishPreviewExportState` / `usePreviewExportState`）。
 *
 * 上行这半边是 2026-09-07 补的：此前顶栏拿不到忙态，按钮既不禁用也不解释，
 * 第二次点击被 `TimelinePreview` 里的 `if (exportBusy) return` **静默吞掉**
 * ——正是设计系统 §1.6 C1 那条规则举的原型（「界面承诺可点、实际什么都不做」）的同构复发。
 * 修法刻意是「把既有事件桥扩成双向」而不是另起一条状态通路（P1：不留并行版）。
 */
export const PREVIEW_EXPORT_EVENT = 'nomi-preview-export'

/**
 * 从导出契约 derive，只并上 UI 局部的 idle/error 两个标志——
 * 不再维护第二份四态联合（语义词表：canonical owner 是 exportApi 的 ExportProgressStatus）。
 */
export type PreviewExportStatus = ExportProgressStatus | 'idle' | 'error'

export type PreviewExportState = {
  readonly status: PreviewExportStatus
  /** 0–1。`exportTimelineToMp4` 的 onProgress.ratio 原样透传。 */
  readonly progress: number
}

export const PREVIEW_EXPORT_IDLE: PreviewExportState = { status: 'idle', progress: 0 }

/** 忙 = 这三个阶段。判据只此一处，顶栏与预览共用（此前只有 TimelinePreview 私有一份）。 */
export function isPreviewExportBusy(status: PreviewExportStatus): boolean {
  return status === 'preparing' || status === 'recording' || status === 'converting'
}

/**
 * 阶段 → i18n key。顶栏的禁用原因与预览的进度文案读同一张表，
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

function getPreviewExportState(): PreviewExportState {
  return previewExportState
}

export function publishPreviewExportState(next: PreviewExportState): void {
  if (next.status === previewExportState.status && next.progress === previewExportState.progress) return
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

export function requestPreviewExport(): void {
  window.dispatchEvent(new Event(PREVIEW_EXPORT_EVENT))
}
