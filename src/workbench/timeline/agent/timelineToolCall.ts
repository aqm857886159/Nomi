import { applyExportToolCall } from './exportToolCall'
import { applyMediaToolCall } from './mediaToolCall'

export type TimelineToolCallName =
  | 'get_media'
  | 'inspect_media'
  | 'search_media'
  | 'inspect_source_range'
  | 'read_waveform'
  | 'export_timeline'
  | 'inspect_export_job'
  | 'verify_render'
  | 'cancel_export_job'

/** Phase 4 legacy boundary for media and export tools only. Timeline read/write is Host-owned. */
export async function applyTimelineToolCall(toolName: string, args: unknown): Promise<unknown> {
  if (['export_timeline', 'inspect_export_job', 'verify_render', 'cancel_export_job'].includes(toolName)) {
    return applyExportToolCall(toolName, args)
  }
  if (['get_media', 'inspect_media', 'search_media', 'inspect_source_range', 'read_waveform'].includes(toolName)) {
    return applyMediaToolCall(toolName, args)
  }
  return null
}
