import { describe, expect, it } from 'vitest'
import { filterProjectLibraryItems } from './libraryAdapters'
import type { LocalProjectSummary } from './localProjectStore'

const project = (overrides: Partial<LocalProjectSummary>): LocalProjectSummary => ({
  id: 'p',
  name: 'Untitled',
  createdAt: 1,
  updatedAt: 1,
  revision: 1,
  savedAt: 1,
  source: 'native',
  missing: false,
  ...overrides,
})

describe('library adapters', () => {
  it('searches project source metadata without changing the project record', () => {
    const items = [project({ id: 'local', name: 'Storyboard', source: 'native' }), project({ id: 'folder', name: 'Client cut', rootPath: '/Volumes/Client' })]
    expect(filterProjectLibraryItems(items, 'client').map((item) => item.id)).toEqual(['folder'])
    expect(filterProjectLibraryItems(items, '/volumes/client')).toEqual([])
    expect(items[1].name).toBe('Client cut')
  })

})
