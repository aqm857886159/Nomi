import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const stripComments = (source: string): string => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const read = (file: string): string => stripComments(readFileSync(resolve(process.cwd(), file), 'utf8'))

describe('Creation workspace script entry', () => {
  it('keeps the script editor as the creation source of truth', () => {
    const source = read('src/workbench/creation/CreationWorkspace.tsx')
    expect(source).toContain('<WorkbenchEditor />')
    expect(source).toContain('data-creation-surface="source"')
    expect(source).not.toContain('setWorkspaceMode(\'storyboard\')')
    expect(source).not.toContain('isEmptyStoryboardPlan')
  })
})
