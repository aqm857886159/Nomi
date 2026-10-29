import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { useGenerationCanvasStore, __resetGenerationCanvasHistoryForTests } from '../store/generationCanvasStore'
import { createProjectCanvasReadSurfaceCoordinator, registerProjectCanvasReadSurfaceCoordinator } from '../../project/projectCanvasReadSurface'
import type { CanvasReadSurfaceBridge } from '../../../../electron/shared/surfacePortBinding'
import { AssetImportError } from '../../../../electron/shared/contracts/assetImportResult'

// 「素材选择器里上传当这张卡的输入」——左环「给它加输入」和生成框参考行「+」共用 addUploadedInput。
// 2026-10-09 对抗评审 B1 定的语义：上传途中**用户**把选择器关掉 → 已导入的留成素材卡、不连线；选择器一直开到完成 → 接上，
// 「导入 + 连线」一步撤销。
// 2026-10-27 回归：这里原来把 shouldConnect 写死成 true / false，导入也是桩（连 addNode 都传了 select: false）——
// 「导入建卡把选中切到新卡 → 随选中挂载的生成框卸载」这件事在测试里根本不发生，生成框拿「自己还挂着」当信号就一直没被拦住。
// 现在：走真导入链（importLocalFilesToGenerationCanvas → importLocalMediaFilesToGenerationCanvas：建卡默认选中新卡、落盘回执写回卡上），
// 只桩掉落盘那一下、由测试放行，「上传途中」是真的途中；取消信号是活的——只在用户关选择器那一下翻转，完成时才读。
// 生成框宿主随选中卸载的那一段（真组件、真宿主）在 tests/ux/composer-upload-connect.test.mjs。
const disk = vi.hoisted(() => ({ writes: [] as Array<{ finish: (asset: unknown) => void; fail: (error: unknown) => void }> }))
vi.mock('../../api/assetUploadApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/assetUploadApi')>()),
  importWorkbenchLocalAssetFile: () => new Promise((finish, fail) => { disk.writes.push({ finish, fail }) }),
}))

const { addUploadedInput } = await import('./nodeInputActions')
const store = () => useGenerationCanvasStore.getState()
const TARGET = {
  id: 'target', kind: 'image', title: 'target', position: { x: 600, y: 0 }, categoryId: 'shots', status: 'idle', prompt: '',
  meta: { modelKey: 'gpt-image-2-image-to-image', modelVendor: 'apimart', archetype: { id: 'gpt-image-2', modeId: 't2i' } },
} as GenerationCanvasNode
const OTHER = { id: 'other', kind: 'image', title: 'other', position: { x: 1200, y: 0 }, categoryId: 'shots', status: 'idle', prompt: '' } as GenerationCanvasNode
const hosted = { id: 'asset-1', name: 'a', userId: 'local', createdAt: '', updatedAt: '', data: { url: 'nomi-local://asset/project-a/a.png' } }
const smallImage = () => new File([new Uint8Array(1024)], 'a.png', { type: 'image/png', lastModified: 1 })
// 落盘失败时小图会退化成 data-url 落在卡上（算成功）；超过那条线的才留成可「重试导入」的错误卡。
const largeImage = () => new File([new Uint8Array(600 * 1024)], 'big.png', { type: 'image/png', lastModified: 1 })
const targetMode = () => (store().nodes.find((node) => node.id === 'target')?.meta as { archetype?: { modeId?: string } } | undefined)?.archetype?.modeId

/** 入口取消信号的真实形状：用户关掉选择器那一下翻转；addUploadedInput 在上传完成时才读它。 */
function pickerSession() {
  let closedByUser = false
  return { closeByUser: () => { closedByUser = true }, shouldConnect: () => !closedByUser }
}

/** 开始上传，停在落盘那一下：卡已建好（被导入选中）、正在拷文件。 */
async function startUpload(file: File) {
  const session = pickerSession()
  const done = addUploadedInput('target', file, { shouldConnect: session.shouldConnect })
  await vi.waitFor(() => expect(disk.writes).toHaveLength(1))
  const cards = store().nodes.filter((node) => node.kind === 'asset')
  expect(cards).toHaveLength(1)
  return { done, session, cardId: cards[0].id, write: disk.writes[0] }
}

let unregister: () => void = () => undefined
beforeEach(async () => {
  disk.writes = []
  const coordinator = createProjectCanvasReadSurfaceCoordinator({
    createSurfaceInstanceId: () => 'window',
    getSurfaceBridge: () => ({
      suspend: async () => ({ suspension: {} }), release: async () => ({ released: true }),
      commitCanvasRead: async ({ projectId }: { projectId: string }) => ({ binding: { binding: {
        projectId, immutableProjectUuid: '11111111-1111-4111-8111-111111111111', projectGeneration: 1,
      } } }),
    } as unknown as CanvasReadSurfaceBridge),
  })
  unregister = registerProjectCanvasReadSurfaceCoordinator(coordinator)
  await coordinator.beginHydration().commitCanvasRead('project-a')
  __resetGenerationCanvasHistoryForTests()
  store().restoreSnapshot({ nodes: [TARGET, OTHER], edges: [], groups: [] })
  store().selectNodes(['target'])
})
afterEach(() => unregister())

describe('addUploadedInput', () => {
  it('picker open until the upload finishes → wired in, selection returns to the card the user was on, one Ctrl+Z undoes import + edge', async () => {
    const upload = await startUpload(smallImage())
    // 真导入链：建卡默认选中新卡——画布里的生成框就是被这一下卸掉的。
    expect(store().selectedNodeIds).toEqual([upload.cardId])
    upload.write.finish(hosted)
    await upload.done
    expect(store().edges).toMatchObject([{ source: upload.cardId, target: 'target' }])
    expect(targetMode()).not.toBe('t2i')
    expect(store().selectedNodeIds).toEqual(['target'])
    store().undo()
    expect(store().nodes.map((node) => node.id)).toEqual(['target', 'other'])
    expect(store().edges).toEqual([])
    expect(targetMode()).toBe('t2i')
  })

  it('user closes the picker mid-upload → the imported card stays, no edge, selection is not handed back', async () => {
    const upload = await startUpload(smallImage())
    upload.session.closeByUser()
    upload.write.finish(hosted)
    await upload.done
    expect(store().nodes.find((node) => node.id === upload.cardId)?.status).toBe('success')
    expect(store().edges).toEqual([])
    expect(store().selectedNodeIds).toEqual([upload.cardId])
  })

  it('upload failed (the card stays as a retryable error card) → not wired in, selection stays on that card', async () => {
    const upload = await startUpload(largeImage())
    upload.write.fail(new AssetImportError({ code: 'capability_execution_failed', reason: 'import-failed' }))
    await upload.done
    expect(store().nodes.find((node) => node.id === upload.cardId)?.status).toBe('error')
    expect(store().edges).toEqual([])
    expect(store().selectedNodeIds).toEqual([upload.cardId])
  })

  it('user selects another card mid-upload → still wired in, selection stays where the user put it', async () => {
    const upload = await startUpload(smallImage())
    store().selectNode('other')
    upload.write.finish(hosted)
    await upload.done
    expect(store().edges).toMatchObject([{ source: upload.cardId, target: 'target' }])
    expect(store().selectedNodeIds).toEqual(['other'])
  })

  it('target deleted mid-upload → nothing to wire, no error, selection is not handed to the deleted card', async () => {
    const upload = await startUpload(smallImage())
    store().deleteNode('target')
    upload.write.finish(hosted)
    await expect(upload.done).resolves.toBeUndefined()
    expect(store().edges).toEqual([])
    expect(store().selectedNodeIds).toEqual([upload.cardId])
  })
})
