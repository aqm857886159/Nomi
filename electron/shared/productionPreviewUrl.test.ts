import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { assetUrlForProductionPreview } from './productionPreviewUrl'
import { createArtifactProjection } from '../productionRun/artifactProjection'
import { localAssetUrl } from '../assets/assetPaths'

describe('assetUrlForProductionPreview', () => {
  it('artifactProjection 签出来的那条链 → 同一个文件的素材库地址（两边格式对齐，逐字相同）', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-preview-url-'))
    const rel = 'assets/generated/materialized/镜头 58-abc.mp4'
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
    fs.writeFileSync(path.join(root, rel), 'mp4')
    try {
      const projected = createArtifactProjection({
        projectRoot: root, run: { projectId: 'project-1', runId: 'op-1' }, secret: 's',
        artifact: { artifactId: 'asset-1', stageId: 'generate', kind: 'video', status: 'ready', version: 1, projectRelativePath: rel, createdAt: '2026-09-25T00:00:00.000Z' },
      })
      expect(assetUrlForProductionPreview(projected.preview!.nomiUrl)).toBe(localAssetUrl('project-1', rel))
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('认不出的地址 / 带穿越段的地址 → null（原样保留，不放宽）', () => {
    expect(assetUrlForProductionPreview('nomi-local://asset/p/a.mp4')).toBeNull()
    expect(assetUrlForProductionPreview('https://cdn.example/a.mp4')).toBeNull()
    expect(assetUrlForProductionPreview(undefined)).toBeNull()
    expect(assetUrlForProductionPreview('nomi-local://production-preview/p/r/a/%2E%2E/secret.txt?preview=t')).toBeNull()
    expect(assetUrlForProductionPreview('nomi-local://production-preview/p/r/a?preview=t')).toBeNull()
  })
})
