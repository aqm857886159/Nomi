import { describe, expect, it } from 'vitest'
import type { DesktopAssetDto } from '../../desktop/bridge'
import { kindFromDesktopAsset } from './useAllProjectAssets'

function desktopAsset(name: string, data: Record<string, unknown>): DesktopAssetDto {
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

describe('all-project asset classification', () => {
  it('recognizes GLB by declared media type and MIME type', () => {
    expect(kindFromDesktopAsset(desktopAsset('declared.bin', { mediaType: 'model3d' }))).toBe('model3d')
    expect(kindFromDesktopAsset(desktopAsset('typed.bin', { contentType: 'model/gltf-binary' }))).toBe('model3d')
  })

  it('falls back to the GLB extension for older persisted records', () => {
    expect(kindFromDesktopAsset(desktopAsset('legacy.GLB', {}))).toBe('model3d')
  })
})
