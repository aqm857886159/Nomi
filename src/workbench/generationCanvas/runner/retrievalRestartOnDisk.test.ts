// V-1213 第 2 节：五种取回异常都要「真落盘 → 新进程读回 → 加载归一 → 原因与阶段还在、仍是可找回 → 重新取回只查不交」。
//
// 走的是生产那几段，不是手拼的 JSON：
//   存盘投影 readCurrentWorkbenchProjectPayload（项目文件里画布那一份就是它）
//   → 主进程的 writeWorkspaceManifest 真写进一个临时项目目录
//   → **另起一个 node 进程**用主进程的 readWorkspaceManifest 把盘上那份读回来（进程边界在磁盘上）
//   → 清空画布与队列后，用加载入口 restoreWorkbenchProjectPayload（内含 normalizeStoreSnapshot）装回
//   → 「重新取回」只走查询、不铸付费令牌。
// 没覆盖到的（如实写在这里，交真 App 验收）：渲染进程本身的冷启动（这里是同一个测试进程清空 store 再装回），
// 以及快照之后事件日志尾巴的重放（load-tail）——那一段只收口 running / queued，不碰 recoverable。
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runGenerationNodesBatch } from './generationRunController'
import { useGenerationQueueStore } from './generationQueueStore'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { setCanvasEventSinkForTests } from '../events/canvasEventEmitter'
import { __resetCanvasUndoJournalForTests } from '../events/canvasUndoJournal'
import { resetModelHealthMemory } from './modelHealthMemory'
import { recoverNodeResult } from './recoverTaskActions'
import { withProjectAction } from '../../project/projectCanvasReadSurface'
import { fetchWorkbenchTaskResultByVendor, mintSpendGrant } from '../../api/taskApi'
import { createProjectSessionTestHarness, TEST_PROJECT_UUID, type ProjectSessionTestHarness } from '../../project/projectSessionTestHarness'
import { readCurrentWorkbenchProjectPayload, restoreWorkbenchProjectPayload } from '../../project/workbenchProjectSession'
import type { WorkbenchProjectPayload } from '../../project/projectRecordSchema'
import type { ProjectBinding } from '../../../../electron/shared/projectBinding'
import { matchNomiErrorCode, RETRIEVAL_UNAVAILABLE_MESSAGE } from '../../../../electron/shared/nomiErrorCodes'
import { writeWorkspaceManifest } from '../../../../electron/workspace/workspaceManifest'

vi.mock('../../api/taskApi', () => ({
  mintSpendGrant: vi.fn(async () => 'grant-test'),
  fetchWorkbenchTaskResultByVendor: vi.fn(),
  pollCanvasShotRun: vi.fn(async () => null),
}))

const PROJECT_ID = 'project-test'
const tsxCli = path.resolve(__dirname, '../../../../node_modules/tsx/dist/cli.mjs')
const manifestModule = pathToFileURL(path.resolve(__dirname, '../../../../electron/workspace/workspaceManifest.ts')).href

/** 另起一个 node 进程，用主进程的读入口把盘上的项目文件读回来；只回画布所在的 payload。 */
function readPayloadInNewProcess(root: string): WorkbenchProjectPayload {
  const reader = path.join(root, 'read-manifest.mts')
  fs.writeFileSync(reader, `import { readWorkspaceManifest } from ${JSON.stringify(manifestModule)};\n`
    + 'process.stdout.write("\\nPAYLOAD " + JSON.stringify(readWorkspaceManifest(process.argv[2])?.payload ?? null) + "\\n");\n')
  const child = spawnSync(process.execPath, [tsxCli, reader, root], { encoding: 'utf8', timeout: 60_000 })
  const line = child.stdout.split('\n').find((candidate) => candidate.startsWith('PAYLOAD '))
  if (child.status !== 0 || !line) throw new Error(`读回进程失败（exit ${child.status}）：${child.stderr.slice(0, 400)}`)
  return JSON.parse(line.slice('PAYLOAD '.length)) as WorkbenchProjectPayload
}

let projectSession: ProjectSessionTestHarness
let projectTarget: ProjectBinding
const roots: string[] = []
beforeEach(async () => {
  projectSession = createProjectSessionTestHarness()
  projectTarget = await projectSession.open(PROJECT_ID)
  useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [], edges: [], selectedNodeIds: [], groups: [] })
  useGenerationQueueStore.setState({ entries: [], batches: {} })
  __resetCanvasUndoJournalForTests()
  setCanvasEventSinkForTests(() => {})
  resetModelHealthMemory()
})
afterEach(() => {
  projectSession.dispose()
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe.skipIf(!fs.existsSync(tsxCli))('每种取回异常：真落盘、新进程读回后原因、阶段、可找回都还在（V-1213）', () => {
  it.each([
    ['上游说成了却没地址', 'retrieval-parse', 'NOMI_ERR::retrieval-parse:: 取回卡在「读结果」这一步：上游说任务已完成，但响应里没找到结果地址。（上游原话：{"status":"completed"}）'],
    ['状态词认不出、等够宽限', 'retrieval-parse', 'NOMI_ERR::retrieval-parse:: 取回卡在「读结果」这一步：上游返回了认不出的任务状态「marinating」（连续查询 4 次、持续 160 秒）。'],
    ['查询连续失败', 'retrieval-query', 'NOMI_ERR::retrieval-query:: 取回卡在「查询任务」这一步：Provider request failed (HTTP 503) at relay GET x: 当前分组 default 下对于模型  无可用渠道'],
    ['下载这一步没成', 'retrieval-download', 'NOMI_ERR::retrieval-download:: 取回卡在「下载结果」这一步：Remote asset fetch failed (HTTP 403)'],
    ['等待超时', 'retrieval-timeout', 'NOMI_ERR::retrieval-timeout:: 取回卡在「等待结果」这一步：等到上限还没有结果（任务号 task-5）。'],
    ['这一次问不了', 'retrieval-unavailable', RETRIEVAL_UNAVAILABLE_MESSAGE],
  ])('%s', async (_name, code, message) => {
    const id = useGenerationCanvasStore.getState().addNode({ kind: 'image', prompt: '镜头 5', meta: { modelVendor: 'apimart', modelKey: 'MiniMax-H3' } }).id
    await runGenerationNodesBatch([id], { target: projectTarget,
      assetUploadConsent: 'not-needed',
      retry: { maxAttempts: 1 },
      executor: async (node) => {
        useGenerationCanvasStore.getState().setNodeProgress(node.id, { phase: 'still-generating', taskId: 'task-paid-restart' })
        throw new Error(message)
      },
    }).catch(() => undefined)

    // 存盘：生产的存盘投影 → 主进程写项目文件。
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-retrieval-restart-'))
    roots.push(root)
    writeWorkspaceManifest(root, { id: PROJECT_ID, name: 'restart', version: 2, createdAt: 1, updatedAt: 1, savedAt: 1, revision: 0,
      immutableProjectUuid: TEST_PROJECT_UUID, projectGeneration: 1, payload: readCurrentWorkbenchProjectPayload() } as never)

    // 重启：内存全清，盘上那份由新进程读回，再经加载入口装回。
    useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [], edges: [], selectedNodeIds: [], groups: [] })
    useGenerationQueueStore.setState({ entries: [], batches: {} })
    restoreWorkbenchProjectPayload(readPayloadInNewProcess(root), PROJECT_ID)

    const reloaded = useGenerationCanvasStore.getState().nodes.find((n) => n.id === id)
    expect(reloaded?.status).toBe('recoverable')
    expect(reloaded?.error).toBe(message)
    expect(reloaded?.runs?.[0]).toMatchObject({ taskId: 'task-paid-restart', error: message })
    expect(matchNomiErrorCode(reloaded?.error ?? '')).toBe(code)
    // 重启后点「重新取回」仍可达：只查不交，不铸付费令牌。
    vi.mocked(fetchWorkbenchTaskResultByVendor).mockResolvedValue({ result: { id: 'task-paid-restart', status: 'succeeded', kind: 'text_to_image', assets: [{ url: 'https://cdn.example.com/after-restart.png', type: 'image' }] } } as never)
    vi.mocked(mintSpendGrant).mockClear()
    await withProjectAction((project) => recoverNodeResult(id, project))
    expect(useGenerationCanvasStore.getState().nodes.find((n) => n.id === id)?.status).toBe('success')
    expect(vi.mocked(mintSpendGrant)).not.toHaveBeenCalled()
  }, 60_000)
})
