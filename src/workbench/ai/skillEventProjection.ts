import type { ProjectAgentItem, ProjectAgentStatus } from '../../../electron/shared/projectAgentContracts'

export type ProjectAgentSkillEvent = Readonly<{
  itemId: string
  name?: string
  status: ProjectAgentStatus
  loaded: boolean
}>

/** Project only canonical Host skill.read items; renderer state cannot invent a load row. */
export function projectAgentSkillEvents(items: readonly ProjectAgentItem[]): ProjectAgentSkillEvent[] {
  return items.flatMap((item) => {
    if (item.kind !== 'tool' || item.capability.id !== 'skill.read') return []
    return [{ itemId: item.itemId, ...(item.skillLoad ? { name: item.skillLoad.name } : {}), status: item.status, loaded: Boolean(item.skillLoad) }]
  })
}
