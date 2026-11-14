// 节点上存着的 `meta.archetype.modeId` 的**唯一读口**（eslint 禁止渲染层别处读这个字段）。
//
// 它不是「这次按哪种方式发」——那由 electron/shared/modelArchetypes/modeForInputs 按这次实际的输入现算，渲染层只经
// archetypeMeta.effectiveArchetypeMode 问。存着的方式只是「图怎么摆」的偏好：人手点过分段的带 `modeChosenBy: 'human'`，
// 老项目和机器写的都算来历不明（unknown）。老项目不迁移、不改盘：旧节点存的方式在这里当偏好读。

export type StoredModePreference = { modeId: string; chosenBy: 'human' | 'unknown' }

/** 只认同一档案（或它的旧 id）存的方式；没存 / 别的档案存的 → null。 */
export function readModePreference(
  archetype: { id: string; legacyIds?: readonly string[] },
  meta: Record<string, unknown> | undefined,
): StoredModePreference | null {
  const stored = readStoredArchetypeMode(meta)
  if (!stored || (stored.archetypeId !== archetype.id && !archetype.legacyIds?.includes(stored.archetypeId))) return null
  return { modeId: stored.modeId, chosenBy: stored.chosenBy }
}

/** 不认档案、原样读出存着的那条（旧工程「当时那个方式」只拿它判哪几张图旧界面看得见，见 referenceList）。 */
export function readStoredArchetypeMode(meta: Record<string, unknown> | undefined): { archetypeId: string; modeId: string; chosenBy: 'human' | 'unknown' } | null {
  const value = meta?.archetype
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const archetypeId = typeof record.id === 'string' ? record.id : ''
  const modeId = typeof record.modeId === 'string' ? record.modeId : ''
  if (!archetypeId || !modeId) return null
  return { archetypeId, modeId, chosenBy: record.modeChosenBy === 'human' ? 'human' : 'unknown' }
}

/**
 * 人手选了一个方式（底栏方式菜单、声音方式栏）——只有这 2 扇门写偏好。
 * 只改方式和来历标记，不动参数：参数按现算出的方式在读的时候收窄（不再切换时写回），删了图就回到原来存的值。
 */
export function withHumanModePreference(meta: Record<string, unknown>, archetypeId: string, modeId: string): Record<string, unknown> {
  const current = meta.archetype && typeof meta.archetype === 'object' ? meta.archetype as Record<string, unknown> : {}
  const sameArchetype = current.id === archetypeId
  return { ...meta, archetype: { ...(sameArchetype ? current : {}), id: archetypeId, modeId, modeChosenBy: 'human' } }
}
