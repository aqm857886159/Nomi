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
    const menus = source('src/workbench/ai/resident/ResidentMenus.tsx')
    expect(resident).toContain("usePromptLibrary(menu === 'prompts')")
    expect(resident).toContain("useUserPrompts(menu === 'prompts')")
    expect(resident).toContain('filterPrompts(promptLibrary.items')
    expect(menus).toContain('const visiblePresets = PROMPT_PRESETS.filter')
    expect(resident).toContain('composeResidentSystemPrompt')
    expect(menus).toContain('promptLibraryId={prompt.id}')
    expect(menus).toContain('data-agent-prompt-library-item={promptLibraryId}')
    expect(resident).not.toContain('desktop.promptLibrary')
  })

  it('keeps resident library and queue controls on the dense 28px token contract', () => {
    const resident = source('src/workbench/ai/ProjectAgentResidentShell.tsx')
    const menus = source('src/workbench/ai/resident/ResidentMenus.tsx')
    const primitives = source('src/workbench/ai/resident/ResidentUiPrimitives.tsx')
    expect(menus).toContain('export function iconControlClass')
    expect(resident).toContain('size-7')
    expect(resident).toContain('min-h-7')
    expect(resident).toContain('data-agent-queue-actions')
    expect(resident).toContain('data-agent-queue-remove="true"')
    expect(primitives).toContain('data-agent-tool-header')
    expect(primitives).toContain('min-h-7')
  })
})
