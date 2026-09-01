import {
  projectCanvasRead,
  type CanvasReadResult,
} from '../../../../electron/shared/agentCapabilities/canvasRead'

export const CANVAS_TARGET_STALE = 'canvas_target_stale' as const
const issuedCanvasReadResults = new WeakSet<object>()

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child)
  return Object.freeze(value)
}

function canvasTargetStale(): Error & { code: typeof CANVAS_TARGET_STALE } {
  return Object.assign(new Error(CANVAS_TARGET_STALE), { code: CANVAS_TARGET_STALE })
}

export function captureCanvasReadResult(source: unknown): CanvasReadResult {
  if (source && typeof source === 'object' && issuedCanvasReadResults.has(source)) {
    return source as CanvasReadResult
  }
  const result = deepFreeze(projectCanvasRead(source))
  issuedCanvasReadResults.add(result)
  return result
}

export function assertIssuedCanvasReadResult(
  value: unknown,
): asserts value is CanvasReadResult {
  if (!value || typeof value !== 'object' || !issuedCanvasReadResults.has(value)) {
    throw canvasTargetStale()
  }
}
