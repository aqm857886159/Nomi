import { beforeEach, expect, it, vi } from 'vitest'
import { confirmAndRunNode, regenerateNodeInPlace } from './generationRunController'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
const calls = vi.hoisted(() => ({ confirm: vi.fn(), mint: vi.fn(), current: true }))
vi.mock('../../project/projectCanvasReadSurface', () => ({ withProjectAction: (fn: (value: unknown) => unknown) => fn({ binding: { projectId: 'p' }, assertCurrent() {} }), isProjectExecutionContextCurrent: () => true }))
vi.mock('../../api/taskApi', () => ({ mintSpendGrant: calls.mint }))
vi.mock('../spend/spendConfirm', async original => ({ ...await original<typeof import('../spend/spendConfirm')>(), confirmGenerationSpend: calls.confirm }))
vi.mock('./assetUploadConsent', async original => ({ ...await original<typeof import('./assetUploadConsent')>(), resolveAssetUploadConsent: async () => ({allowed:true, needsConfirmation:false}) }))
beforeEach(() => {
  calls.current = true; calls.mint.mockReset().mockResolvedValue('grant'); calls.confirm.mockReset().mockImplementation(async () => { calls.current=false; return true })
  // 确认之后、交之前要再核一次作者那一侧（分镜方案）还是不是他确认的那一份。画布再也不铸令牌（发动机收敛第一刀），
  // 确认与第一次交之间已经没有别的异步空档；这里本地 ComfyUI 与要花钱的节点走的是同一段控制器代码。
  useGenerationCanvasStore.getState().restoreSnapshot({nodes:[{id:'node',kind:'image',title:'Image',position:{x:0,y:0},prompt:'old',meta:{modelKey:'workflow',modelVendor:'comfyui-local',vendor:'comfyui-local'}}],edges:[],groups:[],selectedNodeIds:[]})
})
const assertCurrent = async () => { if (!calls.current) throw new Error('storyboard_content_conflict') }
it.each(['single','regenerate'])('rejects changed author target after human confirmation on %s', async kind => {
  const action = kind==='single' ? () => confirmAndRunNode('node',{initiator:'user',assertCurrent,assertAuthorCurrent:assertCurrent})
    : () => regenerateNodeInPlace('node',{initiator:'user',assertCurrent,assertAuthorCurrent:assertCurrent})
  await action().catch(() => {})
  expect(calls.confirm).toHaveBeenCalledOnce()
  expect(calls.mint).not.toHaveBeenCalled()
})
