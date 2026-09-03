import { useSyncExternalStore } from 'react'

export type StoryboardPatchPreview = Readonly<{
  id: string
  args: Readonly<Record<string, unknown>>
  onApprove: () => void
  onDiscard: () => void
}>

let currentPreview: StoryboardPatchPreview | null = null
const listeners = new Set<() => void>()

function emit(): void {
  listeners.forEach((listener) => listener())
}

export function publishStoryboardPatchPreview(preview: StoryboardPatchPreview): void {
  currentPreview = preview
  emit()
}

export function clearStoryboardPatchPreview(id?: string): void {
  if (id && currentPreview?.id !== id) return
  currentPreview = null
  emit()
}

export function useStoryboardPatchPreview(): StoryboardPatchPreview | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => currentPreview,
    () => null,
  )
}

function recordOf(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function selectedShot(select: unknown, shotIndex: number): boolean {
  const selector = recordOf(select)
  if (selector?.kind === 'all') return true
  return selector?.kind === 'indexes' && Array.isArray(selector.indexes)
    ? selector.indexes.includes(shotIndex)
    : false
}

/** Derive the prompt-only part of the pending patch for one visible row. */
export function storyboardPatchPromptForShot(args: Readonly<Record<string, unknown>>, shotIndex: number, original: string): string | null {
  if (!selectedShot(args.select, shotIndex)) return null
  const patch = recordOf(args.patch)
  if (!patch) return null
  if (typeof patch.prompt === 'string') return patch.prompt
  if (typeof patch.promptAppend === 'string') return `${original}${original ? '，' : ''}${patch.promptAppend}`
  return null
}
