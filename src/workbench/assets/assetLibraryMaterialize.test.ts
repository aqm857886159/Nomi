import { describe, expect, it, vi } from 'vitest'
import type { DesktopAssetDto } from '../../desktop/bridge'
import type { ProjectExecutionContext } from '../project/projectCanvasReadSurface'
import type { AssetLibraryDragPayload } from './assetLibraryDrag'
import { materializeAssetLibraryItems, materializeProjectFile, type CopyProjectAsset } from './assetLibraryMaterialize'

const project = {
  binding: { projectId: 'project-a', immutableProjectUuid: 'uuid-a', projectGeneration: 1 },
  signal: new AbortController().signal,
  assertCurrent: () => undefined,
} as unknown as ProjectExecutionContext

function projectFile(projectId: string, relativePath: string, extra: Partial<AssetLibraryDragPayload> = {}): AssetLibraryDragPayload {
  return {
    kind: 'image',
    name: relativePath.split('/').pop() ?? relativePath,
    renderUrl: `nomi-local://asset/${projectId}/${relativePath}`,
    origin: { source: 'project', projectId, relativePath },
    ...extra,
  }
}

function copiedDto(targetProjectId: string, relativePath: string): DesktopAssetDto {
  return {
    id: `${targetProjectId}:${relativePath}`,
    name: relativePath.split('/').pop() ?? relativePath,
    projectId: targetProjectId,
    createdAt: '2026-09-25T00:00:00.000Z',
    updatedAt: '2026-09-25T00:00:00.000Z',
    data: { url: `nomi-local://asset/${targetProjectId}/${relativePath}`, relativePath, contentType: 'image/png' },
  } as unknown as DesktopAssetDto
}

describe('materializeAssetLibraryItems — 素材库落点只写当前项目自己的引用', () => {
  it('当前项目的文件与当前画布的结果原样放行，不复制', async () => {
    const copy = vi.fn<CopyProjectAsset>()
    const own = projectFile('project-a', 'assets/imported/a.png', { dragAnchor: { xRatio: 0.2, yRatio: 0.8 } })
    const canvas: AssetLibraryDragPayload = { kind: 'video', name: 'shot', renderUrl: 'nomi-local://asset/project-a/assets/generated/shot.mp4', origin: { source: 'canvas', nodeId: 'n1' } }
    const out = await materializeAssetLibraryItems([own, canvas], project, copy)
    expect(copy).not.toHaveBeenCalled()
    expect(out).toEqual({ items: [own, canvas], failed: 0 })
  })

  it('别的项目的文件先复制进当前项目，落点拿到的是复制品的地址与来源（锚点保留，源项目的封面不带过来）', async () => {
    const copy = vi.fn<CopyProjectAsset>(async ({ targetProjectId }) => copiedDto(targetProjectId, 'assets/imported/b-city.png'))
    const foreign = projectFile('project-b', 'assets/imported/b-city.png', { dragAnchor: { xRatio: 0.5, yRatio: 0.25 }, thumbUrl: 'nomi-local://asset/project-b/assets/imported/.preview/b-city.jpg' })
    const out = await materializeAssetLibraryItems([foreign], project, copy)
    expect(copy).toHaveBeenCalledWith({ sourceProjectId: 'project-b', targetProjectId: 'project-a', relativePath: 'assets/imported/b-city.png' })
    expect(out.failed).toBe(0)
    expect(out.items).toEqual([{
      kind: 'image',
      name: 'b-city.png',
      renderUrl: 'nomi-local://asset/project-a/assets/imported/b-city.png',
      origin: { source: 'project', projectId: 'project-a', relativePath: 'assets/imported/b-city.png' },
      dragAnchor: { xRatio: 0.5, yRatio: 0.25 },
    }])
    expect(JSON.stringify(out.items)).not.toContain('project-b')
  })

  it('混合一批时顺序不变，只复制别的项目那几张', async () => {
    const copy = vi.fn<CopyProjectAsset>(async ({ targetProjectId, relativePath }) => copiedDto(targetProjectId, relativePath))
    const own = projectFile('project-a', 'assets/imported/a.png')
    const foreign = projectFile('project-b', 'assets/imported/b.png')
    const out = await materializeAssetLibraryItems([foreign, own], project, copy)
    expect(copy).toHaveBeenCalledTimes(1)
    expect(out.items.map((item) => item.renderUrl)).toEqual([
      'nomi-local://asset/project-a/assets/imported/b.png',
      'nomi-local://asset/project-a/assets/imported/a.png',
    ])
  })

  it('复制失败 / 没有复制通道：计入 failed，绝不把别的项目的地址放行', async () => {
    const foreign = projectFile('project-b', 'assets/imported/b.png')
    const failing = vi.fn<CopyProjectAsset>(async () => { throw new Error('Source project not found') })
    expect(await materializeAssetLibraryItems([foreign], project, failing)).toEqual({ items: [], failed: 1 })
    expect(await materializeAssetLibraryItems([foreign], project, null)).toEqual({ items: [], failed: 1 })
  })

  it('复制品若不在当前项目里（宿主返回错项目）也按失败处理', async () => {
    const wrongTarget = vi.fn<CopyProjectAsset>(async () => copiedDto('project-b', 'assets/imported/b.png'))
    const out = await materializeAssetLibraryItems([projectFile('project-b', 'assets/imported/b.png')], project, wrongTarget)
    expect(out).toEqual({ items: [], failed: 1 })
  })
})

// 逐文件的判定只有一处（materializeProjectFile）：素材库拖入画布 / 时间轴、工作流库插入共用。
// 差异⑥（2026-11-21 用户拍板「改，不再多一张」）：本项目的文件原样用，不再复制一份；别的项目的文件复制进来；
// 缺复制通道、复制失败、复制品不在目标项目或没有地址，一律算失败（调用方据此给那句已有的提示）。
describe('materializeProjectFile — 工作流插入与素材库拖入共用的逐文件判定', () => {
  it('本项目的文件原样用，不调复制（工作流在同一个项目里插入不再多一张卡）', async () => {
    const copy = vi.fn<CopyProjectAsset>()
    await expect(materializeProjectFile({ projectId: 'project-a', relativePath: 'assets/a.png' }, 'project-a', copy)).resolves.toEqual({ kind: 'same-project' })
    expect(copy).not.toHaveBeenCalled()
  })

  it('别的项目的文件复制进目标项目，用复制品的地址', async () => {
    const copied = copiedDto('project-a', 'assets/imported/b-2.png')
    const copy = vi.fn<CopyProjectAsset>(async () => copied)
    await expect(materializeProjectFile({ projectId: 'project-b', relativePath: 'assets/imported/b.png' }, 'project-a', copy))
      .resolves.toEqual({ kind: 'copied', asset: copied, url: 'nomi-local://asset/project-a/assets/imported/b-2.png' })
    expect(copy).toHaveBeenCalledWith({ sourceProjectId: 'project-b', targetProjectId: 'project-a', relativePath: 'assets/imported/b.png' })
  })

  it('缺复制通道、复制抛错、复制品不在目标项目、复制品没有地址：都算失败', async () => {
    const source = { projectId: 'project-b', relativePath: 'assets/imported/b.png' }
    const noUrl = { ...copiedDto('project-a', 'assets/imported/b.png'), data: { url: '  ' } } as unknown as DesktopAssetDto
    await expect(materializeProjectFile(source, 'project-a', null)).resolves.toEqual({ kind: 'failed' })
    await expect(materializeProjectFile(source, 'project-a', async () => { throw new Error('denied') })).resolves.toEqual({ kind: 'failed' })
    await expect(materializeProjectFile(source, 'project-a', async () => copiedDto('project-c', 'assets/imported/b.png'))).resolves.toEqual({ kind: 'failed' })
    await expect(materializeProjectFile(source, 'project-a', async () => noUrl)).resolves.toEqual({ kind: 'failed' })
  })
})
