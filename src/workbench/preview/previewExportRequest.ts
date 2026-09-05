/**
 * 顶栏「导出 MP4」→ 预览播放器的事件桥（合同 §2.2）。
 *
 * 导出的实现（ffmpeg 参数、进度、取消）住在 TimelinePreview 里，它拿着 stage 尺寸与播放器句柄；
 * 按钮却按合同固定在应用顶栏。中间只借一个事件名解耦，两边都从这里取，杜绝字符串各写一遍。
 */
export const PREVIEW_EXPORT_EVENT = 'nomi-preview-export'

export function requestPreviewExport(): void {
  window.dispatchEvent(new Event(PREVIEW_EXPORT_EVENT))
}
