import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createDefaultGenerationCanvasSnapshot } from '../../src/workbench/generationCanvasV2/store/generationCanvasDefaults'
import {
  createDefaultWorkbenchProjectPayload,
  workbenchProjectPayloadSchema,
  workbenchProjectRecordSchema,
  workbenchProjectSummarySchema,
  type WorkbenchProjectPayload,
} from '../../src/workbench/project/projectRecordSchema'
import {
  createLocalProject,
  listLocalProjects,
  readLocalProject,
  saveLocalProject,
} from '../../src/workbench/library/localProjectStore'
import { createDefaultTimeline } from '../../src/workbench/timeline/timelineMath'
import { createDefaultWorkbenchDocument } from '../../src/workbench/workbenchTypes'

function payloadWithCanvasImage(): WorkbenchProjectPayload {
  const generationCanvas = createDefaultGenerationCanvasSnapshot()
  return {
    workbenchDocument: {
      ...createDefaultWorkbenchDocument(),
      title: 'Script',
      updatedAt: 1_700_000_000_500,
    },
    timeline: createDefaultTimeline(),
    generationCanvas: {
      ...generationCanvas,
      nodes: generationCanvas.nodes.map((node) => (
        node.kind === 'image'
          ? {
              ...node,
              result: {
                id: 'image-result',
                type: 'image',
                url: 'https://cdn.test/thumbnail.png',
                createdAt: 1_700_000_001_000,
              },
              status: 'success',
            }
          : node
      )),
    },
  }
}

describe('workbench project persistence schemas and local project behavior', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000)
    vi.spyOn(Math, 'random').mockReturnValue(0.111111)
  })

  it('accepts the default project payload and rejects incomplete persisted records', () => {
    const payload = createDefaultWorkbenchProjectPayload()

    expect(workbenchProjectPayloadSchema.parse(payload).generationCanvas.nodes).toHaveLength(2)
    expect(workbenchProjectSummarySchema.safeParse({
      id: 'project-1',
      name: 'Project',
      createdAt: 1,
      updatedAt: 2,
    }).success).toBe(true)
    expect(workbenchProjectRecordSchema.safeParse({
      id: 'project-1',
      name: 'Project',
      createdAt: 1,
      updatedAt: 2,
      version: 1,
      payload: { ...payload, generationCanvas: { nodes: [], edges: [] } },
    }).success).toBe(false)
  })

  it('creates, lists, reads, and saves local projects with revision and thumbnail metadata', () => {
    const project = createLocalProject('  Demo Project  ')

    expect(project.name).toBe('Demo Project')
    expect(project.revision).toBe(0)
    expect(project.lastWriteSource).toBe('local')
    expect(listLocalProjects()).toEqual([expect.objectContaining({ id: project.id, name: 'Demo Project' })])

    const saved = saveLocalProject(project.id, payloadWithCanvasImage(), 'Saved Project')
    expect(saved).toEqual(expect.objectContaining({
      id: project.id,
      name: 'Saved Project',
      revision: 1,
      savedAt: 1_700_000_000_000,
      thumbnail: 'https://cdn.test/thumbnail.png',
      thumbnailUrls: ['https://cdn.test/thumbnail.png'],
    }))

    const readBack = readLocalProject(project.id)
    expect(readBack?.payload.workbenchDocument.title).toBe('Script')
    expect(readBack?.payload.generationCanvas.nodes.find((node) => node.kind === 'image')?.result?.url).toBe('https://cdn.test/thumbnail.png')
    expect(listLocalProjects()[0]).toEqual(expect.objectContaining({
      id: project.id,
      revision: 1,
      thumbnail: 'https://cdn.test/thumbnail.png',
    }))
  })

  it('normalizes legacy project records through the same payload contract', () => {
    const project = createLocalProject('Legacy Target')
    const legacyRecord = {
      id: project.id,
      name: 'Legacy Project',
      createdAt: 1_600_000_000_000,
      updatedAt: 1_600_000_010_000,
      workbenchDocument: {
        version: 1,
        title: 'Legacy Doc',
        contentJson: { type: 'doc', content: [] },
        updatedAt: 1_600_000_020_000,
      },
      timeline: {
        version: 1,
        fps: 30,
        scale: 2,
        playheadFrame: 9,
        tracks: [],
      },
      generationCanvas: createDefaultGenerationCanvasSnapshot(),
    }
    localStorage.setItem(`tapcanvas-open-workbench-project-v1:${project.id}`, JSON.stringify(legacyRecord))

    const readBack = readLocalProject(project.id)

    expect(readBack).toEqual(expect.objectContaining({
      id: project.id,
      version: 1,
      payload: expect.objectContaining({
        workbenchDocument: expect.objectContaining({ title: 'Legacy Doc' }),
        timeline: expect.objectContaining({ scale: 2, playheadFrame: 9 }),
      }),
    }))
  })

  it('returns null for empty project ids and throws explicit errors for missing record bodies', () => {
    expect(readLocalProject('')).toBeNull()
    localStorage.setItem('tapcanvas-open-workbench-project-index-v1', JSON.stringify([
      { id: 'orphan', name: 'Orphan', createdAt: 1, updatedAt: 1 },
    ]))

    expect(() => readLocalProject('orphan')).toThrow('本地项目记录缺失：orphan')
    expect(() => saveLocalProject('', createDefaultWorkbenchProjectPayload())).toThrow('projectId is required')
  })
})
