import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

import {
  createProductionRunE2eRenderer,
  isProductionRunE2eFixtureEnabled,
} from './productionRunE2eFixture'

const require = createRequire(import.meta.url)

describe('production Run E2E fixture', () => {
  it('requires both explicit E2E flags and refuses packaged builds', () => {
    expect(isProductionRunE2eFixtureEnabled({}, false)).toBe(false)
    expect(isProductionRunE2eFixtureEnabled({ NOMI_E2E: '1' }, false)).toBe(false)
    expect(isProductionRunE2eFixtureEnabled({ NOMI_E2E_PRODUCTION_FIXTURE: '1' }, false)).toBe(false)
    expect(isProductionRunE2eFixtureEnabled({ NOMI_E2E: '1', NOMI_E2E_PRODUCTION_FIXTURE: '1' }, true)).toBe(false)
    expect(isProductionRunE2eFixtureEnabled({ NOMI_E2E: '1', NOMI_E2E_PRODUCTION_FIXTURE: '1' }, false)).toBe(true)
  })

  it('materializes a playable local clip and a valid MP4 export without a provider', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-production-fixture-'))
    const renderer = createProductionRunE2eRenderer({ projectRootResolver: () => root })
    const plan = await renderer('production.plan-storyboard', {
      projectId: 'project-fixture', runId: 'run-fixture', brief: { goal: 'Truthful Nomi promo' },
    }, 1_000) as { plan?: { shots?: unknown[] } }
    expect(plan.plan?.shots).toHaveLength(8)

    const generatedResults = await Promise.all(Array.from({ length: 8 }, (_, index) => renderer('production.generate-node', {
      projectId: 'project-fixture', runId: 'run-fixture', jobId: `job:run-fixture:shot-${index + 1}`, nodeId: `shot-${index + 1}`,
    }, 30_000) as Promise<{ assets?: Array<{ url?: string; thumbnailUrl?: string }> }>))
    const generated = generatedResults[0]
    expect(generated.assets?.[0]?.url).toBe('nomi-local://asset/project-fixture/assets/generated/fixture-run-fixture-shot-1.mp4')
    expect(generated.assets?.[0]?.thumbnailUrl).toBe('nomi-local://asset/project-fixture/assets/generated/fixture-run-fixture-shot-1.jpg')

    const arrangement = await renderer('production.arrange', { projectId: 'project-fixture', runId: 'run-fixture' }, 30_000) as {
      timelineContract?: { durationFrames?: number; clips?: unknown[]; subtitles?: unknown[]; transitions?: unknown[] }
    }
    expect(arrangement.timelineContract).toMatchObject({ durationFrames: 900 })
    expect(arrangement.timelineContract?.clips).toHaveLength(8)
    expect(arrangement.timelineContract?.subtitles).toHaveLength(8)
    expect(arrangement.timelineContract?.transitions).toHaveLength(3)
    const exported = await renderer('production.export', {
      projectId: 'project-fixture', runId: 'run-fixture', outputName: 'nomi-run-fixture.mp4',
    }, 30_000) as { relativePath?: string }
    const exportPath = path.join(root, exported.relativePath || '')
    expect(fs.statSync(exportPath).size).toBeGreaterThan(1_000)

    const ffprobe = (require('@ffprobe-installer/ffprobe') as { path: string }).path
    const probe = JSON.parse(execFileSync(ffprobe, [
      '-v', 'error', '-show_entries', 'format=duration:stream=codec_type,codec_name', '-of', 'json', exportPath,
    ], { encoding: 'utf8' })) as { format?: { duration?: string }; streams?: Array<{ codec_type?: string; codec_name?: string }> }
    expect(Number(probe.format?.duration)).toBeGreaterThan(29)
    expect(probe.streams?.some((stream) => stream.codec_type === 'video' && stream.codec_name === 'h264')).toBe(true)
    expect(probe.streams?.some((stream) => stream.codec_type === 'audio' && stream.codec_name === 'aac')).toBe(true)
  }, 30_000)

  it('builds a semantic export manifest from durable run artifacts after renderer restart', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-production-semantic-fixture-'))
    const projectId = 'project-semantic-fixture'
    const runId = 'run-semantic-fixture'
    const writer = createProductionRunE2eRenderer({ projectRootResolver: () => root })
    const generated = await writer('production.generate-node', {
      projectId,
      runId,
      jobId: `job:${runId}:shot-1`,
      nodeId: 'shot-1',
    }, 30_000) as { assets?: Array<{ url?: string }> }
    const relativePath = generated.assets?.[0]?.url?.split('/').slice(4).map(decodeURIComponent).join('/')
    expect(relativePath).toBe('assets/generated/fixture-run-semantic-fixture-shot-1.mp4')

    // The fresh renderer below has an empty in-memory writer map.  Only the
    // durable ProductionRun snapshot is allowed to identify export inputs.
    const runDir = path.join(root, '.nomi', 'runs', runId)
    fs.mkdirSync(runDir, { recursive: true })
    fs.writeFileSync(path.join(runDir, 'run.json'), JSON.stringify({
      schemaVersion: 11,
      snapshotCursor: 3,
      run: {
        projectId,
        runId,
        jobs: [{ jobId: `job:${runId}:shot-1`, stageId: 'generate', status: 'adopted' }],
        artifacts: [{
          artifactId: 'artifact-shot-1',
          stageId: 'generate',
          jobId: `job:${runId}:shot-1`,
          kind: 'video',
          status: 'adopted',
          projectRelativePath: relativePath,
        }, {
          artifactId: 'artifact-escape',
          stageId: 'generate',
          kind: 'video',
          status: 'adopted',
          projectRelativePath: '../outside.mp4',
        }],
      },
    }), 'utf8')

    const restarted = createProductionRunE2eRenderer({ projectRootResolver: () => root })
    const exported = await restarted('production.export', {
      projectId,
      runId,
      outputName: 'semantic-fixture.mp4',
    }, 30_000) as { manifest?: {
      timeline?: { tracks?: Array<{ clips?: Array<{ assetId?: string }> }> }
      assets?: Record<string, { url?: string }>
    } }
    expect(exported.manifest?.timeline?.tracks?.[0]?.clips).toHaveLength(1)
    expect(Object.keys(exported.manifest?.assets || {})).toEqual(['semantic-asset-1'])
    expect(exported.manifest?.assets?.['semantic-asset-1']?.url).toContain('assets/generated/fixture-run-semantic-fixture-shot-1.mp4')
  }, 30_000)

  it('derives semantic arrangement count and duration from the adopted shot set', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-production-semantic-arrange-'))
    const projectId = 'project-semantic-arrange'
    const runId = 'run-semantic-arrange'
    const runDir = path.join(root, '.nomi', 'runs', runId)
    fs.mkdirSync(runDir, { recursive: true })
    fs.writeFileSync(path.join(runDir, 'run.json'), JSON.stringify({
      schemaVersion: 11,
      run: {
        projectId,
        runId,
        generationPlan: {
          shots: [
            { shotId: 'shot-a', nodeId: 'node-a', candidate: { parameters: { duration: 15 } } },
            { shotId: 'shot-b', nodeId: 'node-b', candidate: { parameters: { duration: 15 } } },
          ],
        },
      },
    }), 'utf8')

    const renderer = createProductionRunE2eRenderer({ projectRootResolver: () => root })
    const arrangement = await renderer('production.arrange', {
      projectId,
      runId,
      shotNodeIds: ['node-a', 'node-b'],
    }, 30_000) as {
      arranged?: number
      total?: number
      timelineContract?: { fps?: number; durationFrames?: number; clips?: Array<{ shotId?: string; startFrame?: number; endFrame?: number }> }
    }
    expect(arrangement.arranged).toBe(2)
    expect(arrangement.total).toBe(2)
    expect(arrangement.timelineContract).toMatchObject({ fps: 30, durationFrames: 900 })
    expect(arrangement.timelineContract?.clips).toEqual([
      { shotId: 'shot-a', startFrame: 0, endFrame: 450 },
      { shotId: 'shot-b', startFrame: 450, endFrame: 900 },
    ])
  })

  it('fails closed when a semantic arrange request contains no adopted shots', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-production-semantic-arrange-empty-'))
    const renderer = createProductionRunE2eRenderer({ projectRootResolver: () => root })
    await expect(renderer('production.arrange', {
      projectId: 'project-semantic-arrange-empty',
      runId: 'run-semantic-arrange-empty',
      shotNodeIds: [],
    }, 30_000)).rejects.toThrow(/requires at least one shot/)
  })
})
