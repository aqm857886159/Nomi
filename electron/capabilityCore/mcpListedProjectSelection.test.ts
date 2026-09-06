// 外部宿主必须能**续接已有项目**（2026-09-05 探针 c-1，头号阻断）。
//
// 修复前：projectSelectionHandle 全仓只在 dispatcher 的 `project.create` 分支签发一次。
// 另一条路 bootstrap:{mode:'current_project'} 解析的是「正在运行的 GUI 当前打开的项目」，
// 没开 GUI 就是 project_selection_denied。而 nomi_read(target=projects) 只返回 {id,name,updatedAt}。
// 后果：没开 Nomi 的外部宿主只能在本次连接里自己新建的项目上干活，进程一重启就失忆，
// 用户在 App 里已经建好的项目一个也接不上 —— 24 个工具里 14 个是租约门控的。
//
// 这条测试走完整链路：建项目 → **换一个新的 server 实例**（模拟宿主重连）→ 读项目列表拿 handle
// → nomi_session_open → 拿到真实租约与写作用域。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { McpConnectionContext } from './mcpConnectionContext'
import { createMcpGenerationPolicy } from './mcpGenerationPolicy'
import { createProjectLeaseAuthority } from './projectLease'
import { createProjectLeaseStore } from './projectLeaseStore'
import { createProjectSessionAuthority } from './projectSessionAuthority'

const workspace: Array<{ id: string; name: string; updatedAt: number }> = []

vi.mock('./core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./core')>()
  return {
    ...actual,
    listAllProjects: () => workspace.map((project) => ({ ...project })),
    createNamedProject: (name?: string) => {
      const record = { id: `project-${workspace.length + 1}`, name: name ?? 'untitled', updatedAt: 0 }
      workspace.push(record)
      return { id: record.id, name: record.name }
    },
  }
})

const { dispatch } = await import('./dispatcher')

const tempDirs: string[] = []
const connection: McpConnectionContext = Object.freeze({
  authenticatedClient: 'codex',
  principal: 'mcp:codex',
  sessionId: 'mcp-session:listed-project',
  connectionNonce: 'connection-listed-project',
})

/** 一个「server 实例」：租约存储是新的，签名密钥是机器上持久化的那把（与生产一致）。 */
function makeServerInstance() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-listed-project-'))
  tempDirs.push(dir)
  const generationPolicy = createMcpGenerationPolicy({ env: {}, checkpoints: {} })
  const leaseAuthority = createProjectLeaseAuthority({
    macKey: 'listed-project-authority-key',
    store: createProjectLeaseStore({ filePath: path.join(dir, 'leases.json'), macKey: 'listed-project-store-key' }),
    verifyProjectIdentity: async (projectId: string) => ({
      projectId,
      immutableProjectUuid: `uuid-${projectId}`,
      projectGeneration: 1,
      canonicalRootDigest: `root-${projectId}`,
    }),
  })
  const authority = createProjectSessionAuthority({
    leaseAuthority,
    generationPolicy,
    resolveProjectSelection: async ({ projectHint }) => ({
      projectId: projectHint as string,
      immutableProjectUuid: `uuid-${projectHint}`,
      projectGeneration: 1,
      canonicalRootDigest: `root-${projectHint}`,
      manifestDigest: `manifest-${projectHint}`,
    }),
  })
  return {
    authority,
    ctx: {
      runTask: vi.fn(),
      makeGateway: vi.fn(),
      productionRuns: {},
      generationPolicy,
      projectSession: { authority, connection },
    },
  }
}

beforeEach(() => {
  workspace.length = 0
})
afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('nomi_read(target=projects) hands out usable project selection handles', () => {
  it('lets a reconnected host open a session on a project it did not create', async () => {
    const first = makeServerInstance()
    const created = await dispatch('project.create', { name: '咖啡广告' }, first.ctx as never) as { id: string }
    expect(created.id).toBe('project-1')

    // 宿主断开重连：新的 server 实例、新的租约存储，只剩「机器上那把签名密钥」是共享的。
    const reconnected = makeServerInstance()
    const listed = await dispatch('project.list', {}, reconnected.ctx as never) as {
      projects: Array<{ id: string; projectSelectionHandle?: string }>
    }
    const row = listed.projects.find((project) => project.id === created.id)
    expect(row?.projectSelectionHandle, '每个项目行都要带可用的 selection handle').toBeTypeOf('string')

    const opened = await dispatch('nomi_session_open', {
      projectSelectionHandle: row?.projectSelectionHandle,
    }, reconnected.ctx as never) as { projectId: string; leaseHandle: string; effectiveScope: readonly string[] }

    expect(opened.projectId).toBe(created.id)
    expect(opened.leaseHandle).toBeTypeOf('string')
    // 租约门控的工具（画布写/文档写…）由此可达 —— 这正是修复前过不去的那一步。
    expect(opened.effectiveScope).toEqual(expect.arrayContaining(['canvas:write', 'document:write']))
  })

  it('never drops the whole listing when one project cannot prove its identity', async () => {
    const server = makeServerInstance()
    await dispatch('project.create', { name: 'ok' }, server.ctx as never)
    workspace.push({ id: 'project-broken', name: 'moved away', updatedAt: 0 })

    const real = server.authority.issueProjectSelection.bind(server.authority)
    vi.spyOn(server.authority, 'issueProjectSelection').mockImplementation(async (source, projectId, ctxConnection) =>
      projectId === 'project-broken'
        ? Promise.reject(new Error('The authorized project root is unavailable'))
        : real(source, projectId, ctxConnection))

    const listed = await dispatch('project.list', {}, server.ctx as never) as {
      projects: Array<{ id: string; projectSelectionHandle?: string }>
    }
    expect(listed.projects.map((project) => project.id)).toEqual(['project-1', 'project-broken'])
    expect(listed.projects[0]?.projectSelectionHandle).toBeTypeOf('string')
    expect(listed.projects[1]?.projectSelectionHandle).toBeUndefined()
  })
})
