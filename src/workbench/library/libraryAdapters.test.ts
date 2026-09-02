import { describe, expect, it } from 'vitest'
import { filterProjectLibraryItems, filterSkillLibraryItems } from './libraryAdapters'
import type { LocalProjectSummary } from './localProjectStore'
import type { SkillListItemDto } from '../api/skillApi'

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

const skill = (overrides: Partial<SkillListItemDto>): SkillListItemDto => ({
  directoryName: 'skill',
  name: 'skill',
  label: 'Skill',
  description: 'A reusable method',
  author: null,
  stageLabels: [],
  isPlaybook: false,
  neededProviders: ['text'],
  manifestError: null,
  origin: 'user',
  packageVersion: '1',
  contentHash: 'hash',
  ...overrides,
})

describe('library adapters', () => {
  it('searches project source metadata without changing the project record', () => {
    const items = [project({ id: 'local', name: 'Storyboard', source: 'native' }), project({ id: 'folder', name: 'Client cut', rootPath: '/Volumes/Client' })]
    expect(filterProjectLibraryItems(items, 'client').map((item) => item.id)).toEqual(['folder'])
    expect(filterProjectLibraryItems(items, '/volumes/client')).toEqual([])
    expect(items[1].name).toBe('Client cut')
  })

  it('combines scope, playbook category and declared provider search for skills', () => {
    const items = [
      skill({ directoryName: 'playbook', label: 'Storyboard playbook', isPlaybook: true, neededProviders: ['text', 'image'] }),
      skill({ directoryName: 'assistant', label: 'Copy assistant', isPlaybook: false }),
      skill({ directoryName: 'builtin', label: 'Built in', origin: 'builtin' }),
    ]
    expect(filterSkillLibraryItems(items, { source: 'mine', category: 'playbook', query: 'image' }).map((item) => item.directoryName)).toEqual(['playbook'])
    expect(filterSkillLibraryItems(items, { source: 'mine', category: 'playbook', query: '图像' }).map((item) => item.directoryName)).toEqual(['playbook'])
    expect(filterSkillLibraryItems(items, { source: 'builtin', category: 'all', query: '' }).map((item) => item.directoryName)).toEqual(['builtin'])
  })
})
