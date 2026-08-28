import fs from 'node:fs'
import { describe, expect, it, vi } from 'vitest'

import { createDiskGateway, createRendererGateway } from './gateway'

const io = vi.hoisted(() => ({
  readProject: vi.fn(),
  saveProject: vi.fn(),
  requestRenderer: vi.fn(),
}))

vi.mock('../projects/repository', () => ({
  readProject: io.readProject,
  saveProject: io.saveProject,
}))

vi.mock('./rendererBridge', () => ({
  requestRenderer: io.requestRenderer,
}))

const RAW_DOCUMENT = {
  nodes: [{
    id: 'node-a',
    kind: 'image',
    title: 'A',
    prompt: 'prompt',
    position: { x: 1, y: 2 },
    result: { id: 'result-a', url: 'https://provider.invalid/a.png', raw: { taskId: 'private-rmw-data' } },
  }],
  edges: [],
  groups: [],
  selectedNodeIds: ['node-a'],
}

describe('ProjectGateway raw canvas document port', () => {
  it('keeps disk and renderer raw reads for write read-modify-write without becoming canvas.read projection', async () => {
    io.readProject.mockReturnValue({ payload: { generationCanvas: structuredClone(RAW_DOCUMENT) } })
    io.requestRenderer.mockResolvedValue(structuredClone(RAW_DOCUMENT))

    const disk = await createDiskGateway('project-a').readDoc()
    const renderer = await createRendererGateway('project-a').readDoc()

    expect(disk).toEqual(RAW_DOCUMENT)
    expect(renderer).toEqual(RAW_DOCUMENT)
    expect(JSON.stringify(renderer)).toContain('private-rmw-data')
    expect(io.readProject).toHaveBeenCalledWith('project-a')
    expect(io.requestRenderer).toHaveBeenCalledWith(
      'canvas.read-doc',
      { projectId: 'project-a' },
      15_000,
    )
  })

  it('binds only the private renderer RMW op to readDocumentSnapshot', () => {
    const source = fs.readFileSync(
      new URL('../../src/workbench/capability/capabilityApplyHandler.ts', import.meta.url),
      'utf8',
    )

    expect(source).toMatch(/case 'canvas\.read-doc':\s*return useGenerationCanvasStore\.getState\(\)\.readDocumentSnapshot\(\)/)
    expect(source).not.toMatch(/case 'canvas\.read':/)
  })
})
