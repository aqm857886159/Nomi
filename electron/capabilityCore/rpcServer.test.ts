import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { startRpcServer, type RpcServerHandle } from './rpcServer'
import { ensureToken } from './security'

const tempRoots: string[] = []
let mockedDocumentsRoot = ''
let mockedUserDataRoot = ''
let server: RpcServerHandle | null = null
let token = ''
let openProjectId = ''
// 模拟渲染层在线 + 付费确认应答（测 hybrid 网关：窗口活着但项目没在前台）。
let rendererUp = false
let spendReply: { confirmed?: boolean } = { confirmed: true }
let rendererOps: string[] = []
// 捕获最后一次 runTask 请求,断言 grantId 是否随请求下传(=付费确认是否真路由+铸令牌)。
let lastRunTaskReq: { extras?: Record<string, unknown> } | null = null

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => (name === 'documents' ? mockedDocumentsRoot : mockedUserDataRoot),
    getAppPath: () => process.cwd(),
  },
}))

vi.mock('./rendererBridge', () => ({
  isRendererAvailable: () => rendererUp,
  requestRenderer: async (op: string) => {
    rendererOps.push(op)
    if (op === 'spend.confirm') return spendReply
    // hybrid 网关读写应走盘,绝不该把 canvas.* 转给渲染层——命中即测试失败。
    throw new Error(`hybrid 不应调用渲染层 op: ${op}`)
  },
}))

function makeTempDir(name = 'nomi-rpc-test-'): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), name))
  tempRoots.push(dir)
  return dir
}

async function rpc(method: string, params: Record<string, unknown> = {}, auth = token) {
  const res = await fetch(`http://127.0.0.1:${server!.port}/rpc`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(auth ? { authorization: `Bearer ${auth}` } : {}) },
    body: JSON.stringify({ method, params }),
  })
  return { status: res.status, body: (await res.json()) as { ok: boolean; result?: unknown; error?: string } }
}

beforeEach(async () => {
  mockedDocumentsRoot = makeTempDir('nomi-rpc-documents-')
  mockedUserDataRoot = makeTempDir('nomi-rpc-user-data-')
  delete process.env.NOMI_PROJECTS_DIR
  openProjectId = ''
  rendererUp = false
  spendReply = { confirmed: true }
  rendererOps = []
  lastRunTaskReq = null
  token = ensureToken()
  server = await startRpcServer({
    runTask: async (req) => {
      lastRunTaskReq = req.request as { extras?: Record<string, unknown> }
      return { id: 't', status: 'succeeded', assets: [{ type: 'image', url: 'nomi-local://x' }] }
    },
    isProjectOpen: (id) => Boolean(openProjectId) && id === openProjectId,
  })
})

afterEach(async () => {
  if (server) await server.close()
  server = null
  delete process.env.NOMI_PROJECTS_DIR
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe('capabilityCore/rpcServer', () => {
  it('无 token / 错 token → 401', async () => {
    const noAuth = await rpc('ping', {}, '')
    expect(noAuth.status).toBe(401)
    const badAuth = await rpc('ping', {}, 'deadbeef')
    expect(badAuth.status).toBe(401)
  })

  it('对 token → ping ok', async () => {
    const res = await rpc('ping')
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
  })

  it('全链路：建项目 → 加节点 → 读画布', async () => {
    const created = await rpc('project.create', { name: 'RPC 项目' })
    const projectId = (created.body.result as { id: string }).id
    expect(projectId).toBeTruthy()

    const added = await rpc('canvas.addNodes', { projectId, nodes: [{ kind: 'text', prompt: 'hi' }] })
    expect(added.body.ok).toBe(true)
    const ids = (added.body.result as { ids: string[] }).ids
    expect(ids).toHaveLength(1)

    const read = await rpc('canvas.read', { projectId })
    expect((read.body.result as { nodes: unknown[] }).nodes).toHaveLength(1)
  })

  it('generate 经 RPC 走注入 runTask 落结果', async () => {
    const created = await rpc('project.create', { name: 'gen' })
    const projectId = (created.body.result as { id: string }).id
    const gen = await rpc('generate', { projectId, intent: 'image', prompt: 'cat', vendor: 'v', modelKey: 'm' })
    expect(gen.body.ok).toBe(true)
    expect((gen.body.result as { status: string }).status).toBe('succeeded')
  })

  it('A 模式无渲染层（测试环境）：改打开中的项目 → 降级磁盘网关，照常落盘（不再硬 409）', async () => {
    // 新路由：app 开着 + 项目打开 → 本应走渲染层网关实时应用；测试环境无渲染层可达，
    // 降级到磁盘网关直写盘（isRendererAvailable=false）。证明不再有「打开即拒绝」的死路。
    const created = await rpc('project.create', { name: '打开中的项目' })
    const projectId = (created.body.result as { id: string }).id
    openProjectId = projectId
    const added = await rpc('canvas.addNodes', { projectId, nodes: [{ kind: 'text', prompt: 'live' }] })
    expect(added.status).toBe(200)
    expect(added.body.ok).toBe(true)
    expect((added.body.result as { ids: string[] }).ids).toHaveLength(1)
    const read = await rpc('canvas.read', { projectId })
    expect((read.body.result as { nodes: unknown[] }).nodes).toHaveLength(1)
  })

  it('hybrid：窗口在线但项目没在前台 → 付费确认弹全局卡(经渲染层)，确认后铸令牌随 runTask 下传', async () => {
    // 治根：外部 MCP 生成到「非当前打开的项目」时，旧逻辑走磁盘网关 env 闸 → 秒退未确认(静默黑洞)。
    // 新逻辑：窗口在线 + 项目没在前台 → hybrid 网关 → confirmSpend 走渲染层弹卡。
    rendererUp = true
    spendReply = { confirmed: true }
    const created = await rpc('project.create', { name: '后台项目' })
    const projectId = (created.body.result as { id: string }).id
    // 注意:不设 openProjectId → 该项目不在前台。
    const gen = await rpc('generate', { projectId, intent: 'image', prompt: 'robot', vendor: 'v', modelKey: 'm' })
    expect(gen.body.ok).toBe(true)
    // 付费确认确实经渲染层(全局卡)路由,canvas 读写没走渲染层(hybrid 读写走盘)。
    expect(rendererOps).toContain('spend.confirm')
    expect(rendererOps.filter((op) => op.startsWith('canvas'))).toHaveLength(0)
    // 真人(模拟)确认 → 铸了令牌随请求下传 runTask(主进程硬闸据此核验消费)。
    expect(lastRunTaskReq?.extras?.grantId).toBeTruthy()
  })

  it('安全：付费确认被拒(confirmed:false) → 不铸令牌,请求不带 grantId(runTask 硬闸会拦)', async () => {
    rendererUp = true
    spendReply = { confirmed: false }
    const created = await rpc('project.create', { name: '后台项目-拒绝' })
    const projectId = (created.body.result as { id: string }).id
    await rpc('generate', { projectId, intent: 'image', prompt: 'robot', vendor: 'v', modelKey: 'm' })
    expect(rendererOps).toContain('spend.confirm')
    expect(lastRunTaskReq?.extras?.grantId).toBeUndefined()
  })

  it('未知方法 → 404', async () => {
    const res = await rpc('nope')
    expect(res.status).toBe(404)
  })
})
