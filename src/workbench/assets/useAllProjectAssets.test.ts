import { describe, expect, it } from 'vitest'
import type { DesktopAssetDto } from '../../desktop/bridge'
import { assetRefFromDesktopAsset, kindFromDesktopAsset, parseProjectNames } from './useAllProjectAssets'

function desktopAsset(overrides: Partial<DesktopAssetDto> = {}): DesktopAssetDto {
  return {
    id: 'asset-1',
    name: 'portrait.png',
    userId: 'local',
    projectId: 'project-2',
    createdAt: '2026-08-31T00:00:00.000Z',
    updatedAt: '2026-08-31T00:00:00.000Z',
    data: {
      relativePath: 'assets/imported/portrait.png',
      url: 'nomi-local://asset/project-2/assets/imported/portrait.png',
      contentType: 'image/png',
      imageWidth: 800,
      imageHeight: 1200,
    },
    ...overrides,
  }
}

function classificationAsset(name: string, data: Record<string, unknown>): DesktopAssetDto {
  return {
    id: name,
    name,
    userId: 'user',
    projectId: 'project',
    createdAt: '2026-08-30T00:00:00.000Z',
    updatedAt: '2026-08-30T00:00:00.000Z',
    data,
  }
}

describe('useAllProjectAssets display metadata', () => {
  it('keeps the project name outside origin and carries bounded dimensions', () => {
    const ref = assetRefFromDesktopAsset(desktopAsset(), 'Previous film')
    expect(ref).toMatchObject({
      sourceProjectName: 'Previous film',
      dimensions: { width: 800, height: 1200 },
      aspectRatio: 800 / 1200,
      origin: { source: 'project', projectId: 'project-2', relativePath: 'assets/imported/portrait.png' },
    })
    expect(ref?.origin).not.toHaveProperty('projectName')
  })

  it('reads an existing ratio when a DTO has no complete dimension pair', () => {
    const ref = assetRefFromDesktopAsset(desktopAsset({
      data: {
        relativePath: 'assets/generated/clip.mp4',
        contentType: 'video/mp4',
        videoAspectRatio: 16 / 9,
      },
      name: 'clip.mp4',
    }))
    expect(ref?.aspectRatio).toBeCloseTo(16 / 9)
    expect(ref).not.toHaveProperty('dimensions')
  })

  it('parses only non-empty project names', () => {
    const names = parseProjectNames([
      { id: 'p1', name: 'One' },
      { id: 'p2', name: '  ' },
      { id: 'p3' },
      null,
    ])
    expect([...names.entries()]).toEqual([['p1', 'One']])
  })
})

describe('all-project asset classification', () => {
  it('recognizes GLB by declared media type and MIME type', () => {
    expect(kindFromDesktopAsset(classificationAsset('declared.bin', { mediaType: 'model3d' }))).toBe('model3d')
    expect(kindFromDesktopAsset(classificationAsset('typed.bin', { contentType: 'model/gltf-binary' }))).toBe('model3d')
  })

  it('falls back to the GLB extension for older persisted records', () => {
    expect(kindFromDesktopAsset(classificationAsset('legacy.GLB', {}))).toBe('model3d')
  })
})
