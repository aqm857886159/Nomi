import { beforeEach, describe, expect, it } from 'vitest'
import { useGenerationCanvasStore } from './generationCanvasStore'

describe('canvas workflow store boundary', () => {
  beforeEach(() => {
    useGenerationCanvasStore.getState().restoreSnapshot({
      nodes: [
        { id: 'source', kind: 'text', title: '提示', position: { x: 40, y: 40 } },
        { id: 'shot', kind: 'image', title: '镜头', position: { x: 300, y: 40 } },
      ],
      edges: [{ id: 'edge', source: 'source', target: 'shot', mode: 'reference' }],
      groups: [],
    })
  })

  it('saves and reuses a selected workflow through one undoable graph write', () => {
    const store = useGenerationCanvasStore.getState()
    store.selectNodes(['source', 'shot'])
    const template = store.saveSelectedAsWorkflowTemplate('基础镜头')!
    expect(useGenerationCanvasStore.getState().readDocumentSnapshot().workflowTemplates).toHaveLength(1)
    const created = useGenerationCanvasStore.getState().instantiateWorkflowTemplate(template.id, { x: 600, y: 120 })
    expect(created).toHaveLength(2)
    expect(useGenerationCanvasStore.getState().nodes).toHaveLength(4)
    useGenerationCanvasStore.getState().undo()
    expect(useGenerationCanvasStore.getState().nodes).toHaveLength(2)
    useGenerationCanvasStore.getState().redo()
    expect(useGenerationCanvasStore.getState().nodes).toHaveLength(4)
  })

  it('copies selected groups and restores them through the same undo boundary', () => {
    useGenerationCanvasStore.getState().restoreSnapshot({
      nodes: [
        { id: 'source', kind: 'text', title: '提示', position: { x: 40, y: 40 } },
        { id: 'shot', kind: 'image', title: '镜头', position: { x: 300, y: 40 } },
      ],
      edges: [{ id: 'edge', source: 'source', target: 'shot', mode: 'reference' }],
      groups: [{
        id: 'source-group', name: '流程组', categoryId: 'shots', nodeIds: ['source', 'shot'],
        frameBounds: { x: 20, y: 20, w: 560, h: 220 }, createdAt: 1, updatedAt: 1,
      }],
    })
    const store = useGenerationCanvasStore.getState()
    store.selectNodes(['source', 'shot'])
    const template = store.saveSelectedAsWorkflowTemplate('带分组流程')!
    expect(template.groups).toHaveLength(1)

    const created = useGenerationCanvasStore.getState().instantiateWorkflowTemplateSnapshot(template, { x: 700, y: 100 })
    expect(created).toHaveLength(2)
    const copiedGroup = useGenerationCanvasStore.getState().groups.find((group) => group.id !== 'source-group')
    expect(copiedGroup?.nodeIds).toHaveLength(2)
    expect(useGenerationCanvasStore.getState().groups).toHaveLength(2)

    useGenerationCanvasStore.getState().undo()
    expect(useGenerationCanvasStore.getState().groups).toHaveLength(1)
    useGenerationCanvasStore.getState().redo()
    expect(useGenerationCanvasStore.getState().groups).toHaveLength(2)
  })

  it('restores the template library and plugin envelope after a close and reopen', () => {
    const store = useGenerationCanvasStore.getState()
    store.selectNodes(['source', 'shot'])
    const template = store.saveSelectedAsWorkflowTemplate('可恢复流程')!
    const persisted = useGenerationCanvasStore.getState().readDocumentSnapshot()

    useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [], edges: [], groups: [], workflowTemplates: [] })
    useGenerationCanvasStore.getState().restoreSnapshot(persisted)

    const restored = useGenerationCanvasStore.getState().readDocumentSnapshot()
    expect(restored.workflowTemplates?.[0]?.id).toBe(template.id)
    expect(restored.workflowTemplates?.[0]?.edges).toHaveLength(1)
    expect(restored.nodes).toEqual(persisted.nodes)
  })

  it('routes a plugin state edit through the same undo and redo boundary', () => {
    useGenerationCanvasStore.getState().restoreSnapshot({
      nodes: [{
        id: 'checkpoint', kind: 'text', title: '检查点', position: { x: 40, y: 40 },
        typeId: 'nomi.workflow/checkpoint',
        pluginState: {
          pluginId: 'nomi.workflow', pluginVersion: '1.0.0', typeId: 'nomi.workflow/checkpoint',
          schemaVersion: 1, state: { checked: false },
        },
      }],
      edges: [],
      groups: [],
    })
    const before = useGenerationCanvasStore.getState().nodes[0].pluginState
    useGenerationCanvasStore.getState().updateNode('checkpoint', {
      pluginState: { ...before!, state: { checked: true } },
    })
    expect(useGenerationCanvasStore.getState().nodes[0].pluginState?.state.checked).toBe(true)
    useGenerationCanvasStore.getState().undo()
    expect(useGenerationCanvasStore.getState().nodes[0].pluginState?.state.checked).toBe(false)
    useGenerationCanvasStore.getState().redo()
    expect(useGenerationCanvasStore.getState().nodes[0].pluginState?.state.checked).toBe(true)
  })

  it('does not allow an unregistered plugin node to bypass the feature gate', () => {
    expect(() => useGenerationCanvasStore.getState().addNode({ kind: 'text', typeId: 'nomi.external/node' })).toThrow('not registered')
  })
})
