/**
 * One opaque identity for every reversible Agent write.  The prefix is part of
 * the contract: `undo` can route without reading the other surface's state.
 */
export const CHANGE_ID_VERSION = "v1" as const
export type ChangeKind = "canvas" | "timeline"

export type ParsedChangeId = Readonly<{
  kind: ChangeKind
  id: string
}>

export function makeChangeId(kind: ChangeKind, id: string): string {
  const value = id.trim()
  if (!value || !/^[A-Za-z0-9._:-]+$/.test(value)) throw new Error("change_id_invalid")
  return `${kind}:${CHANGE_ID_VERSION}:${value}`
}

export function parseChangeId(value: string): ParsedChangeId | null {
  const match = /^(canvas|timeline):v1:([A-Za-z0-9._:-]+)$/.exec(value.trim())
  return match ? { kind: match[1] as ChangeKind, id: match[2] } : null
}
