import type { LibraryPrompt } from '../../api/promptLibraryApi'

/** Stable DOM identity for a prompt-library row. The library remains the sole
 * owner of the prompt payload; the resident only projects this id. */
export function libraryPromptMenuId(prompt: Pick<LibraryPrompt, 'id'>): string {
  return `library:${prompt.id}`
}

/** Stable composer identity used for the removable, ephemeral selection chip. */
export function libraryPromptReferenceId(prompt: Pick<LibraryPrompt, 'id'>): string {
  return `prompt:${prompt.id}`
}

/**
 * Compose a library prompt into the caller's existing system contract.
 *
 * A library prompt is user-selected wording, not a new capability or owner,
 * so it is appended to the surface/skill contract and never replaces it.
 */
export function composeResidentSystemPrompt(
  basePrompt: string | undefined,
  selectedPrompt: Pick<LibraryPrompt, 'prompt'> | null,
): string | undefined {
  const parts = [basePrompt?.trim(), selectedPrompt?.prompt.trim()].filter((part): part is string => Boolean(part))
  return parts.length ? parts.join('\n\n') : undefined
}
