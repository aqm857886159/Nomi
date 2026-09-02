import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

function source(relativePath: string): string {
  return stripComments(fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8'))
}

describe('resident prompt library wiring contract', () => {
  it('uses the canonical prompt-library hooks and projects selections into the send contract', () => {
    const resident = source('src/workbench/ai/ProjectAgentResidentShell.tsx')
    expect(resident).toContain("usePromptLibrary(menu === 'prompts')")
    expect(resident).toContain("useUserPrompts(menu === 'prompts')")
    expect(resident).toContain('filterPrompts(promptLibrary.items')
    expect(resident).toContain('const visiblePresets = PROMPT_PRESETS.filter')
    expect(resident).toContain('composeResidentSystemPrompt')
    expect(resident).toContain('promptLibraryId={prompt.id}')
    expect(resident).toContain('data-agent-prompt-library-item={promptLibraryId}')
    expect(resident).not.toContain('desktop.promptLibrary')
  })

  it('keeps resident library and queue controls on the dense 28px token contract', () => {
    const resident = source('src/workbench/ai/ProjectAgentResidentShell.tsx')
    const primitives = source('src/workbench/ai/resident/ResidentUiPrimitives.tsx')
    expect(resident).toContain('function iconControlClass')
    expect(resident).toContain('size-7')
    expect(resident).toContain('min-h-7')
    expect(primitives).toContain('data-agent-queue-action="edit"')
    expect(primitives).toContain('data-agent-queue-action="cancel"')
    expect(primitives).toContain('size-7')
  })
})
