import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('Creation workspace script entry', () => {
  it('keeps the script editor as the creation source of truth', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/workbench/creation/CreationWorkspace.tsx'), 'utf8')
    expect(source).toContain('<WorkbenchEditor />')
    expect(source).toContain('data-creation-surface="source"')
    expect(source).not.toContain('setWorkspaceMode(\'storyboard\')')
    expect(source).not.toContain('isEmptyStoryboardPlan')
  })
})
