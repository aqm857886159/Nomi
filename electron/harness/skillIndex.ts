import { discoverSkillRecordsFromRoots, getSkillDiscoveryRoots } from '../skills/skillStore.js'

export type NomiSkillIndexEntry = Readonly<{
  name: string
  description: string
}>

const DEFAULT_SKILL_INDEX_LIMIT = 24
const SKILL_DESCRIPTION_LIMIT = 180

function compactDescription(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (normalized.length <= SKILL_DESCRIPTION_LIMIT) return normalized
  return `${normalized.slice(0, SKILL_DESCRIPTION_LIMIT - 1).trimEnd()}…`
}

function skillIndexOrder(left: NomiSkillIndexEntry, right: NomiSkillIndexEntry): number {
  return left.name.localeCompare(right.name, 'en', { sensitivity: 'base' })
    || left.description.localeCompare(right.description)
}

export function listNomiSkillIndexEntries(): NomiSkillIndexEntry[] {
  try {
    return discoverSkillRecordsFromRoots(getSkillDiscoveryRoots()).records.map((skill) => ({
      name: skill.name,
      description: skill.description,
    }))
  } catch {
    return []
  }
}

/** Keep the model-facing catalog bounded and deterministic at the host boundary. */
export function formatNomiSkillIndex(
  skills: readonly NomiSkillIndexEntry[],
  options: { limit?: number } = {},
): string {
  if (skills.length === 0) return 'Nomi Skill catalog: no skills are currently available.'
  const requestedLimit = options.limit ?? DEFAULT_SKILL_INDEX_LIMIT
  const limit = Number.isFinite(requestedLimit)
    ? Math.max(1, Math.min(Math.floor(requestedLimit), skills.length))
    : DEFAULT_SKILL_INDEX_LIMIT
  const ordered = [...skills].sort(skillIndexOrder)
  const visible = ordered.slice(0, limit)
  const overflow = ordered.slice(limit)
  const rows = visible.map((skill) => `- ${skill.name}: ${compactDescription(skill.description || 'No description provided.')}`)
  return [
    `Nomi Skill catalog (showing ${visible.length} of ${ordered.length}; metadata only; call load_skill with the exact name to load one body):`,
    ...rows,
    ...(overflow.length > 0
      ? [`More skill names are available: ${overflow.map((skill) => skill.name).join(', ')}.`]
      : []),
  ].join('\n')
}
