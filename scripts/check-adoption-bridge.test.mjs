import { describe, expect, it } from 'vitest'
import path from 'node:path'

describe('adoption bridge scanner', () => {
  it('normalizes scanner-relative paths to the allowlist separator', () => {
    const root = process.cwd()
    const relative = path.relative(root, path.join(root, 'src', 'workbench', 'timeline', 'addAssetToTimeline.ts'))
    const normalized = relative.replaceAll(path.sep, '/')
    expect(normalized).toBe('src/workbench/timeline/addAssetToTimeline.ts')
  })
})
