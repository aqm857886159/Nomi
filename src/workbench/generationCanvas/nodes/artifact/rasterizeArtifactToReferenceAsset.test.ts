import { describe, expect, it, vi, beforeEach } from 'vitest'
import { rasterizeArtifactToReferenceAsset, type ReferenceAssetDeps } from './rasterizeArtifactToReferenceAsset'
import type { AgentArtifactMeta } from '../../model/artifactMeta'

// 固化为参考图（SVG → PNG → asset 节点）契约。真实路径依赖 canvas + 主进程资产导入
//（importWorkbenchLocalAssetFile），node 单测用 stub deps 锁「数据流与分支语义」；
// canvas 栅格化 + 落盘 + 连线走 GUI 走查（tests/ux/agent-artifact.walk.mjs）。

const store: { calls: unknown[] } = { calls: [] }
vi.mock('../../store/generationCanvasStore', () => ({
  useGenerationCanvasStore: {
    getState: () => ({
      addNode: (input: unknown) => {
        store.calls.push({ op: 'addNode', input })
        return { id: 'asset-1' }
      },
      updateNode: (id: string, patch: unknown) => {
        store.calls.push({ op: 'updateNode', id, patch })
      },
    }),
  },
}))

const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#2f6f8f"/></svg>'
const svgArtifact: AgentArtifactMeta = { fileType: 'svg', url: 'nomi-local://asset/p/assets/generated/composition-guide.svg' }

function makeDeps(overrides: Partial<ReferenceAssetDeps> = {}): ReferenceAssetDeps {
  return {
    readText: vi.fn(async () => svg),
    rasterizeSvgToPngBlob: vi.fn(async () => new Blob(['fake-png'], { type: 'image/png' })),
    uploadFile: vi.fn(async (file) => ({ id: 'asset-uuid', name: file.name, data: { url: `nomi-local://asset/p/assets/generated/${file.name}` } })),
    ...overrides,
  }
}

describe('rasterizeArtifactToReferenceAsset', () => {
  beforeEach(() => { store.calls = [] })

  it('SVG 产物 → 栅格化 → 上传 PNG → 新建 asset 节点 + result.url（可被连线当参考）', async () => {
    const deps = makeDeps()
    const result = await rasterizeArtifactToReferenceAsset(svgArtifact, deps)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.nodeId).toBe('asset-1')
    expect(deps.readText).toHaveBeenCalledWith('nomi-local://asset/p/assets/generated/composition-guide.svg')
    // 上传的是 PNG（文件名带 .png）
    expect(deps.uploadFile).toHaveBeenCalledTimes(1)
    const uploaded = (deps.uploadFile as ReturnType<typeof vi.fn>).mock.calls[0][0] as File
    expect(uploaded.name).toMatch(/\.png$/)
    expect(uploaded.type).toBe('image/png')
    // asset 节点挂 result:{type:image, url:nomi-local} → referenceUrl.ts 的 resultUrl 可读
    const update = store.calls.find((c) => (c as { op: string }).op === 'updateNode') as { patch: { result: { type: string; url: string } } }
    expect(update.patch.result.type).toBe('image')
    expect(update.patch.result.url).toContain('nomi-local://asset/p/assets/generated/')
  })

  it('非 SVG 类型拒绝（v1 仅 SVG 可栅格化）', async () => {
    const deps = makeDeps()
    const result = await rasterizeArtifactToReferenceAsset({ ...svgArtifact, fileType: 'html' }, deps)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain('unsupported-file-type')
    expect(deps.uploadFile).not.toHaveBeenCalled()
  })

  it('读文本失败 → 不落盘、不建节点', async () => {
    const deps = makeDeps({ readText: vi.fn(async () => { throw new Error('404') }) })
    const result = await rasterizeArtifactToReferenceAsset(svgArtifact, deps)
    expect(result.ok).toBe(false)
    expect(deps.uploadFile).not.toHaveBeenCalled()
    expect(store.calls.length).toBe(0)
  })

  it('栅格化失败（SVG 有外部引用/不可渲染）→ 干净失败', async () => {
    const deps = makeDeps({ rasterizeSvgToPngBlob: vi.fn(async () => null) })
    const result = await rasterizeArtifactToReferenceAsset(svgArtifact, deps)
    expect(result.ok).toBe(false)
    expect(deps.uploadFile).not.toHaveBeenCalled()
  })

  it('上传失败 → 不建节点', async () => {
    const deps = makeDeps({ uploadFile: vi.fn(async () => { throw new Error('disk full') }) })
    const result = await rasterizeArtifactToReferenceAsset(svgArtifact, deps)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('disk full')
    expect(store.calls.length).toBe(0)
  })
})
