import React from 'react'
import { useTranslation } from 'react-i18next'
import { applyTimelineToolCall } from '../../timeline/agent/timelineToolCall'
import type { TimelineAppliedRecord, TimelinePlanPreviewRecord } from './TimelineEditPlanCard'
import type { TimelineOperation } from './timelineEditPlanModel'

type TimelineCall = { toolCallId: string; toolName: string; args: unknown; anchorMessageId?: string }
type TimelineStep = { toolName: string; effectiveArgs: Record<string, unknown> }

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

export function useTimelineAgentUi() {
  const { t } = useTranslation()
  const [timelinePlanPreviews, setTimelinePlanPreviews] = React.useState<TimelinePlanPreviewRecord[]>([])
  const [timelineApplied, setTimelineApplied] = React.useState<TimelineAppliedRecord | null>(null)

  const capturePreview = React.useCallback((call: TimelineCall, result: unknown) => {
    setTimelinePlanPreviews((current) => [
      ...current.filter((item) => item.toolCallId !== call.toolCallId),
      { ...call, result },
    ])
  }, [])

  const recordOutcome = React.useCallback((steps: TimelineStep[], results: unknown[], anchorMessageId?: string) => {
    const index = steps.findIndex((step) => step.toolName === 'apply_edit_plan' || step.toolName === 'undo_timeline_edit')
    if (index < 0) return
    const step = steps[index]
    const output = recordOf(results[index])
    if (step.toolName === 'undo_timeline_edit') {
      if (output.undone === true) setTimelineApplied((current) => current ? { ...current, status: 'undone' } : current)
      return
    }
    const args = step.effectiveArgs
    const applied = (output.applied === true || output.replayed === true) && typeof output.undoToken === 'string'
    setTimelineApplied({
      planId: typeof output.planId === 'string' ? output.planId : String(args.planId || ''),
      summary: typeof output.summary === 'string' ? output.summary : String(args.summary || ''),
      ...(Array.isArray(args.operations) ? { operations: args.operations.filter((item): item is TimelineOperation => Boolean(item && typeof item === 'object')) } : {}),
      ...(typeof output.undoToken === 'string' ? { undoToken: output.undoToken } : {}),
      expectedRevision: typeof output.revision === 'string'
        ? output.revision
        : typeof output.currentRevision === 'string'
          ? output.currentRevision
          : String(args.baseRevision || ''),
      status: output.ok !== false && applied ? 'applied' : 'failed',
      ...(output.ok !== false && applied ? {} : {
        message: typeof output.message === 'string' ? output.message : typeof output.code === 'string' ? output.code : t('timelineEditor.agent.applyFailedDetail'),
      }),
      ...(anchorMessageId ? { anchorMessageId } : {}),
    })
  }, [t])

  const recordFailure = React.useCallback((args: unknown, message: string, anchorMessageId?: string) => {
    const input = recordOf(args)
    setTimelineApplied({
      planId: String(input.planId || ''),
      summary: String(input.summary || ''),
      ...(Array.isArray(input.operations) ? { operations: input.operations.filter((item): item is TimelineOperation => Boolean(item && typeof item === 'object')) } : {}),
      expectedRevision: String(input.baseRevision || ''),
      status: 'failed',
      message,
      ...(anchorMessageId ? { anchorMessageId } : {}),
    })
  }, [])

  const undo = React.useCallback(async () => {
    const current = timelineApplied
    if (!current || current.status !== 'applied' || !current.undoToken) return
    setTimelineApplied({ ...current, status: 'undoing' })
    try {
      const result = recordOf(await applyTimelineToolCall('undo_timeline_edit', {
        undoToken: current.undoToken,
        expectedRevision: current.expectedRevision,
        reason: 'user_requested',
      }))
      if (result.undone === true) {
        setTimelineApplied({ ...current, status: 'undone' })
      } else {
        setTimelineApplied({ ...current, status: 'failed', message: typeof result.code === 'string' ? result.code : t('timelineEditor.agent.undoFailedDetail') })
      }
    } catch (error: unknown) {
      setTimelineApplied({ ...current, status: 'failed', message: error instanceof Error ? error.message : t('timelineEditor.agent.undoFailedDetail') })
    }
  }, [t, timelineApplied])

  const reset = React.useCallback(() => {
    setTimelinePlanPreviews([])
    setTimelineApplied(null)
  }, [])

  return { timelinePlanPreviews, timelineApplied, capturePreview, recordOutcome, recordFailure, undo, reset }
}
