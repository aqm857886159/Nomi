import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  createArtifactProjection,
  loadOrCreateArtifactPreviewSecret,
  verifyArtifactPreviewHandle,
} from './artifactProjection'
import type { ProductionArtifact, ProductionRun } from './productionRunTypes'

const roots: string[] = []

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-artifact-projection-'))
  roots.push(root)
  fs.mkdirSync(path.join(root, 'assets'), { recursive: true })
  fs.writeFileSync(path.join(root, 'assets', 'frame.png'), 'preview-bytes')
  const artifact: ProductionArtifact = {
    artifactId: 'artifact-1',
    stageId: 'storyboard',
    kind: 'image',
    status: 'ready',
    projectRelativePath: 'assets/frame.png',
    createdAt: '2026-08-08T10:00:00.000Z',
  }
  const run = {
    runId: 'run-1',
    projectId: 'project-1',
    artifacts: [artifact],
  } as ProductionRun
  return { root, run, artifact }
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe('production artifact projection', () => {
  it('returns safe metadata, a scoped expiring preview, and no local path/provider URL', () => {
    const { root, run, artifact } = fixture()
    const projection = createArtifactProjection({
      projectRoot: root,
      run,
      artifact,
      secret: 'test-preview-secret',
      nowMs: Date.parse('2026-08-08T10:00:00.000Z'),
      ttlMs: 60_000,
    })

    expect(projection).toMatchObject({
      projectId: 'project-1',
      runId: 'run-1',
      artifactId: 'artifact-1',
      kind: 'image',
      status: 'ready',
      openInNomi: 'nomi://project/project-1/run/run-1?artifact=artifact-1',
      nomiUri: 'nomi://project/project-1/run/run-1/artifact/artifact-1',
    })
    expect(projection.preview?.url).toMatch(/^nomi-local:\/\/production-preview\/project-1\/run-1\/artifact-1\/assets\/frame\.png\?preview=/)
    expect(projection.preview?.nomiUrl).toBe(projection.preview?.url)
    expect(projection.preview?.expiresAt).toBe('2026-08-08T10:01:00.000Z')
    expect(JSON.stringify(projection)).not.toContain(root)
    expect(JSON.stringify(projection)).not.toMatch(/providerUrl|https?:\/\//)

    expect(verifyArtifactPreviewHandle({
      token: projection.preview!.token,
      secret: 'test-preview-secret',
      nowMs: Date.parse('2026-08-08T10:00:30.000Z'),
      expected: { projectId: 'project-1', runId: 'run-1', artifactId: 'artifact-1' },
    })).toMatchObject({ relativePath: 'assets/frame.png' })
    expect(() => verifyArtifactPreviewHandle({
      token: projection.preview!.token,
      secret: 'test-preview-secret',
      nowMs: Date.parse('2026-08-08T10:01:00.001Z'),
    })).toThrow(/expired/i)
  })

  it('scopes identical artifact ids to their project and run', () => {
    const { root, run, artifact } = fixture()
    const one = createArtifactProjection({ projectRoot: root, run, artifact, secret: 'secret', nowMs: 10 })
    const two = createArtifactProjection({ projectRoot: root, run: { ...run, runId: 'run-2' }, artifact, secret: 'secret', nowMs: 10 })
    expect(one.nomiUri).not.toBe(two.nomiUri)
    expect(two.nomiUri).toBe('nomi://project/project-1/run/run-2/artifact/artifact-1')
  })

  it.each([
    '../outside.png',
    'assets/../../outside.png',
    'assets/%2e%2e/outside.png',
    '/tmp/outside.png',
    'https://provider.example/private.png',
  ])('rejects unsafe artifact path %s', (unsafePath) => {
    const { root, run, artifact } = fixture()
    expect(() => createArtifactProjection({
      projectRoot: root,
      run,
      artifact: { ...artifact, projectRelativePath: unsafePath },
      secret: 'test-preview-secret',
      nowMs: 1,
    })).toThrow(/path|relative|provider|project/i)
  })

  it('rejects a forged token scope', () => {
    const { root, run, artifact } = fixture()
    const projection = createArtifactProjection({ projectRoot: root, run, artifact, secret: 'secret-a', nowMs: 10 })
    expect(() => verifyArtifactPreviewHandle({
      token: projection.preview!.token,
      secret: 'secret-a',
      nowMs: 11,
      expected: { projectId: 'project-2', runId: 'run-1', artifactId: 'artifact-1' },
    })).toThrow(/scope/i)
    expect(() => verifyArtifactPreviewHandle({ token: projection.preview!.token, secret: 'secret-b', nowMs: 11 }))
      .toThrow(/signature/i)
  })

  it('persists a random profile secret instead of deriving it from the public path', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-artifact-secret-'))
    roots.push(root)
    const firstPath = path.join(root, 'profile-a', 'artifact-preview.key')
    const secondPath = path.join(root, 'profile-b', 'artifact-preview.key')
    const first = loadOrCreateArtifactPreviewSecret(firstPath)
    expect(loadOrCreateArtifactPreviewSecret(firstPath)).toBe(first)
    expect(loadOrCreateArtifactPreviewSecret(secondPath)).not.toBe(first)
    expect(first).toMatch(/^[a-f0-9]{64}$/)
  })
})
