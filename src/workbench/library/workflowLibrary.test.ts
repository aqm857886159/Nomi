import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  deleteWorkflowLibraryEntry,
  markWorkflowLibraryEntryUsed,
  readWorkflowLibrary,
  saveWorkflowToLibrary,
  searchWorkflowLibrary,
  updateWorkflowLibraryEntry,
} from './workflowLibrary'
import type { CanvasWorkflowTemplate } from '../generationCanvas/plugins/canvasWorkflowTemplates'

const storage = () => {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    clear: () => values.clear(),
  }
}

const template = (id = 'workflow-1'): CanvasWorkflowTemplate => ({
  id,
  schemaVersion: 1,
  name: '分镜检查',
  createdAt: 1,
  updatedAt: 1,
  nodes: [{
    sourceId: 'source',
    node: { id: 'source', kind: 'text', title: '提示', position: { x: 0, y: 0 } },
    relativePosition: { x: 0, y: 0 },
  }],
  edges: [],
  groups: [],
})

describe('workflow library', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('persists a searchable cross-project entry and supports metadata edits', () => {
    vi.stubGlobal('localStorage', storage())
    const saved = saveWorkflowToLibrary({
      template: template(),
      sourceProjectId: 'project-a',
      sourceProjectName: '短片 A',
      description: '检查分镜连续性',
      tags: ['分镜', '检查', '分镜'],
      now: 10,
    })!
    expect(saved).toMatchObject({ name: '分镜检查', description: '检查分镜连续性', tags: ['分镜', '检查'] })
    expect(searchWorkflowLibrary(readWorkflowLibrary(), { query: '短片 A' })).toHaveLength(1)

    updateWorkflowLibraryEntry(saved.id, { name: '连续性检查', favorite: true }, 20)
    expect(searchWorkflowLibrary(readWorkflowLibrary(), { filter: 'favorites' })[0]?.name).toBe('连续性检查')
    markWorkflowLibraryEntryUsed(saved.id, 30)
    expect(searchWorkflowLibrary(readWorkflowLibrary(), { filter: 'recent' })[0]?.lastUsedAt).toBe(30)
  })

  it('drops malformed persisted entries without affecting valid workflows', () => {
    const target = storage()
    vi.stubGlobal('localStorage', target)
    target.setItem('nomi:workflow-library:v1', JSON.stringify([{ id: 'bad', name: '坏数据' }, {
      id: 'workflow-2', version: 1, name: '有效流程', description: '', tags: [], createdAt: 1, updatedAt: 1,
      template: template('workflow-2'),
    }]))
    expect(readWorkflowLibrary().map((entry) => entry.id)).toEqual(['workflow-2'])
    expect(deleteWorkflowLibraryEntry('workflow-2')).toBe(true)
    expect(readWorkflowLibrary()).toEqual([])
  })

  it('rejects malformed asset references at the template boundary', () => {
    expect(saveWorkflowToLibrary({ template: { ...template('bad-assets'), assets: [{ sourceUrl: 'x' }] } as CanvasWorkflowTemplate })).toBeNull()
    expect(saveWorkflowToLibrary({ template: { ...template('bad-group'), groups: [{ sourceId: 'group', group: {} }] } as CanvasWorkflowTemplate })).toBeNull()
  })
})
