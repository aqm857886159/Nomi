import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { normalizePayload } from './projectNormalize'
import { createDefaultWorkbenchProjectPayload } from './projectRecordSchema'

const retiredMapKey = ['storyboard', 'Plans'].join('')
const retiredSingleKey = ['storyboard', 'Plan'].join('')
const retiredCommitKey = ['storyboard', 'Plan', 'Committed'].join('')

describe('storyboard projection invariant', () => {
  it('keeps retired state names out of the renderer source', () => {
    const sourceRoot = resolve(process.cwd(), 'src/workbench')
    const files = ['workbenchDocumentSlice.ts', 'project/projectNormalize.ts', 'project/workbenchProjectSession.ts', 'project/projectRecordSchema.ts']
    for (const file of files) {
      const source = readFileSync(resolve(sourceRoot, file), 'utf8')
      expect(source).not.toContain(retiredMapKey)
      expect(source).not.toMatch(new RegExp(`(?:^|[.{])\\s*${retiredSingleKey}\\s*:`))
      expect(source).not.toMatch(new RegExp(`(?:^|[.{])\\s*${retiredCommitKey}\\s*:`))
    }
  })

  it('migrates legacy input once and emits only the owner', () => {
    const base = createDefaultWorkbenchProjectPayload()
    const documentId = base.activeDocumentId!
    const plan = { title: 'legacy', anchors: [], shots: [] }
    const normalized = normalizePayload({ ...base, [retiredMapKey]: { [documentId]: { plan, committed: false } } }) as Record<string, unknown>
    expect(normalized.storyboardDesignsByDocumentId).toBeTruthy()
    expect(Object.prototype.hasOwnProperty.call(normalized, retiredMapKey)).toBe(false)
    expect(Object.prototype.hasOwnProperty.call(normalized, retiredSingleKey)).toBe(false)
    expect(Object.prototype.hasOwnProperty.call(normalized, retiredCommitKey)).toBe(false)
  })
})
