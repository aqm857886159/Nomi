import type { ToolCallEvent } from '../ai/workbenchAgentRunner'
import { importWorkbenchSkill, getAvailableSkillProviders, skillCapabilityFor, type SkillProviderKind } from '../api/skillApi'
import { isWriteTool, type PendingDocToolCall, type TurnHandle } from './creationToolContracts'

/** Document executor shared by the Creation panel's stream callbacks. The
 * skill importer remains automatic; editor writes still wait for the same card. */
export function createCreationToolHandler(input: {
  turn: TurnHandle
  allowsWrite: boolean
  enqueue: (call: PendingDocToolCall) => void
  skillSaveFailed: () => string
}): (event: ToolCallEvent) => Promise<void> {
  return async (event) => {
    if (!input.turn.canWrite()) {
      await event.confirm({ ok: false, denied: true, message: 'creation turn abandoned' })
      return
    }
    if (event.toolName === 'author_skill') {
      const args = event.args && typeof event.args === 'object' ? event.args as Record<string, unknown> : {}
      // A skill is one file. Everything the model declares lives in the SKILL.md
      // frontmatter, so there is nothing to serialise alongside it.
      const result = await importWorkbenchSkill({
        version: 'nomi-skill-v1', exportedAt: Date.now(),
        dirName: typeof args.dirName === 'string' && args.dirName.trim() ? args.dirName : 'imported-skill',
        files: { 'SKILL.md': typeof args.skillMarkdown === 'string' ? args.skillMarkdown : '' },
      })
      if (!result.ok) {
        await event.confirm({ ok: false, message: result.error ?? input.skillSaveFailed() })
        return
      }
      if (!input.turn.canWrite()) {
        await event.confirm({ ok: false, denied: true, message: 'creation turn ended after skill save' })
        return
      }
      // The main process derives this from the record that actually landed on disk.
      const needed = result.neededProviders ?? []
      const saved = { saved: true, skillName: result.skillName, dirName: result.dirName }
      let capability: { missingProviders: SkillProviderKind[]; satisfied: boolean } | undefined
      try {
        const cap = skillCapabilityFor({ neededProviders: needed }, await getAvailableSkillProviders())
        capability = { missingProviders: cap.missing, satisfied: cap.satisfied }
      } catch { /* The skill was already saved; provider discovery is optional. */ }
      if (!input.turn.canWrite()) {
        await event.confirm({ ok: false, denied: true, message: 'creation turn ended after skill save' })
        return
      }
      await event.confirm({ ok: true, result: { ...saved, ...capability } })
      return
    }
    if (isWriteTool(event.toolName)) {
      if (!input.allowsWrite) {
        await event.confirm({ ok: false, denied: true, message: 'chat-only mode does not write to the document' })
        return
      }
      const args = event.args && typeof event.args === 'object' ? event.args as Record<string, unknown> : {}
      input.enqueue({ toolCallId: event.toolCallId, toolName: event.toolName, content: typeof args.content === 'string' ? args.content : '', confirm: event.confirm })
      return
    }
    await event.confirm({ ok: false, denied: true, message: `unknown tool ${event.toolName}` })
  }
}
