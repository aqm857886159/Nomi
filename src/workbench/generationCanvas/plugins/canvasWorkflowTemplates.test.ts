import { describe, expect, it } from 'vitest'
import { captureCanvasWorkflowTemplate, instantiateCanvasWorkflowTemplate, rewriteCanvasWorkflowTemplateAssetUrls } from './canvasWorkflowTemplates'
import type { GenerationCanvasEdge, GenerationCanvasNode, NodeGroup } from '../model/generationCanvasTypes'

const node = (id: string, x: number, y: number): GenerationCanvasNode => ({
  id, kind: 'text', title: id, position: { x, y }, size: { width: 200, height: 120 }, pluginState: {
    pluginId: 'nomi.workflow', pluginVersion: '1.0.0', typeId: 'nomi.workflow/checkpoint', schemaVersion: 1, state: { checked: true },
  }, typeId: 'nomi.workflow/checkpoint',
})
const edge = (source: string, target: string): GenerationCanvasEdge => ({ id: `${source}-${target}`, source, target, mode: 'reference' })

describe('canvas workflow templates', () => {
  it('captures only selected nodes/internal edges with relative positions', () => {
    const template = captureCanvasWorkflowTemplate([node('a', 100, 200), node('b', 340, 260), node('c', 700, 200)], [edge('a', 'b'), edge('b', 'c')], ['a', 'b'], '镜头检查', 'template-1', 10)
    expect(template?.name).toBe('镜头检查')
    expect(template?.nodes.map((item) => item.relativePosition)).toEqual([{ x: 0, y: 0 }, { x: 240, y: 60 }])
    expect(template?.edges).toHaveLength(1)
  })

  it('creates fresh identities while preserving plugin state and layout', () => {
    const template = captureCanvasWorkflowTemplate([node('a', 100, 200), node('b', 340, 260)], [edge('a', 'b')], ['a', 'b'], '', 'template-1', 10)!
    let nextId = 0
    const created = instantiateCanvasWorkflowTemplate(template, { x: 50, y: 70 }, () => `new-${++nextId}` as GenerationCanvasNode['kind'], (source, target, index) => `${source}-${target}-${index}`)
    expect(created.nodes.map((item) => item.position)).toEqual([{ x: 50, y: 70 }, { x: 290, y: 130 }])
    expect(created.nodes.map((item) => item.id)).toEqual(['new-1', 'new-2'])
    expect(created.nodes[0].pluginState?.state).toEqual({ checked: true })
    expect(created.edges).toEqual([{ id: 'new-1-new-2-0', source: 'new-1', target: 'new-2', mode: 'reference' }])
  })

  it('captures and restores fully selected groups with relative frame bounds', () => {
    const selectedGroup: NodeGroup = {
      id: 'group-a',
      name: '镜头检查',
      categoryId: 'shots',
      nodeIds: ['a', 'b'],
      frameBounds: { x: 80, y: 180, w: 500, h: 240 },
      collapsed: false,
      createdAt: 1,
      updatedAt: 2,
    }
    const groupedNodes = [
      { ...node('a', 100, 200), groupId: 'group-a' },
      { ...node('b', 340, 260), groupId: 'group-a' },
    ]
    const template = captureCanvasWorkflowTemplate(
      groupedNodes,
      [edge('a', 'b')],
      ['a', 'b'],
      '带分组流程',
      'template-with-group',
      [selectedGroup],
      10,
    )!

    expect(template.groups).toHaveLength(1)
    expect(template.groups?.[0]?.relativeFrameBounds).toEqual({ x: -20, y: -20, w: 500, h: 240 })

    let nextCopyId = 0
    const created = instantiateCanvasWorkflowTemplate(
      template,
      { x: 600, y: 400 },
      (kind) => `copy-${kind}-${++nextCopyId}`,
      (source, target, index) => `${source}-${target}-${index}`,
      () => 'copy-group',
    )
    expect(created.groups).toHaveLength(1)
    expect(created.groups[0]).toMatchObject({
      id: 'copy-group',
      name: '镜头检查',
      nodeIds: ['copy-text-1', 'copy-text-2'],
      frameBounds: { x: 580, y: 380, w: 500, h: 240 },
    })
    expect(created.nodes.map((item) => item.groupId)).toEqual(['copy-group', 'copy-group'])
  })

  it('records local asset references and rewrites only materialized urls', () => {
    const source = {
      ...node('asset-node', 10, 20),
      result: { id: 'result', type: 'image' as const, url: 'nomi-local://asset/source-project/assets/imported/ref.png', createdAt: 1 },
    }
    const template = captureCanvasWorkflowTemplate([source], [], ['asset-node'], '带素材流程', 'asset-template', 10)!
    expect(template.assets).toEqual([{
      sourceUrl: 'nomi-local://asset/source-project/assets/imported/ref.png',
      sourceProjectId: 'source-project',
      relativePath: 'assets/imported/ref.png',
      name: 'ref.png',
    }])
    const rewritten = rewriteCanvasWorkflowTemplateAssetUrls(template, new Map([
      ['nomi-local://asset/source-project/assets/imported/ref.png', 'nomi-local://asset/target-project/assets/generated/ref.png'],
    ]))
    expect(rewritten.nodes[0]?.node.result?.url).toBe('nomi-local://asset/target-project/assets/generated/ref.png')
  })
})
