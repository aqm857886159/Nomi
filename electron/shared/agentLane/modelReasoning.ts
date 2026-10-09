import { LANE_THINKING_LEVELS, type LaneThinkingLevel } from './laneContracts'

export function isLaneThinkingLevel(value: unknown): value is LaneThinkingLevel {
  return LANE_THINKING_LEVELS.some(level => level === value)
}

/** Read explicit capability declarations, without inferring them from provider names. */
export function modelReasoning(meta: unknown, preferred?: LaneThinkingLevel) {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return undefined
  const raw = meta as Record<string, unknown>
  if (raw.reasoning !== true || !raw.thinkingLevelMap || typeof raw.thinkingLevelMap !== 'object' || Array.isArray(raw.thinkingLevelMap)) return undefined
  const map = raw.thinkingLevelMap as Record<string, unknown>
  const thinkingLevelMap = Object.fromEntries(LANE_THINKING_LEVELS.map(level => [level,
    typeof map[level] === 'string' && map[level] ? map[level] : null])) as Record<LaneThinkingLevel, string | null>
  const levels = LANE_THINKING_LEVELS.filter(level => thinkingLevelMap[level] !== null)
  if (!levels.length) return undefined
  const declared = isLaneThinkingLevel(raw.reasoningEffort) ? raw.reasoningEffort : undefined
  const level = preferred && levels.includes(preferred) ? preferred
    : declared && levels.includes(declared) ? declared : levels[0]!
  return { reasoning: true as const, thinkingLevelMap, levels, thinkingLevel: level }
}
