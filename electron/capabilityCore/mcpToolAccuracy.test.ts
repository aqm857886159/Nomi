// **R30 · 对外 MCP profile 的一次写对率与回合成功率**（方案 §3.1 验收表最后一列：
// 「MCP profile 同一套剧本经 `tools/call` 跑，数字与 internal 相等」）。
//
// 内部那条已经有了（`tests/agent-runtime/lane-tool-accuracy.test.mts`，阶段 2：8/8）。
// 这里跑的是**同一批畸形**，走真正的 `tools/call`（stdio 协议层 → 校验 → build → dispatch），
// 因为「两个 profile 同源」这句话的真正判据不是两份 schema 长得像，而是**同一个模型犯同一个错时，
// 两边的下场一样**。
//
// 为什么这个数以前必然不相等：容忍钩子（`prepareArguments`）是描述符上的声明，但阶段 5a 之前
// 对外那条路一次也没跑过它——`mcpProtocol.ts` 直接拿模型给的原始参数去撞
// `additionalProperties:false`。于是同一个模型、同一句话，从 Nomi 自己的 Agent 打进来成功，
// 从 Claude Code 打进来失败，而两边读的说明书还宣称是同一份。
//
// **带阳性对照**：同一批畸形也喂给一个「摘掉容忍钩子」的对照臂。少了它，一个恒等于 8/8 的
// 数字和真的做对了长得一模一样。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    getName: () => 'Nomi',
    getPath: (name: string) => path.join(os.tmpdir(), `nomi-mcp-accuracy-${name}`),
  },
}))

import { PROJECT_ROOT_ENV, getWorkspaceRepositoryDeps } from '../runtimePaths'
import { SETTINGS_ROOT_ENV } from '../settings/settingsRoot'
import { createWorkspaceProject } from '../workspace/workspaceRepository'
import { ensureWorkspaceProjectIdentity } from '../workspace/workspaceProjectIdentity'
import { CAPABILITY_DIR_ENV, ensureToken, signMcpClient } from './security'
import { createMcpConnectionContext } from './mcpConnectionContext'
import { createMcpGenerationPolicy } from './mcpGenerationPolicy'
import { createProductionProjectSessionRuntime } from './projectSessionRuntime'
import { createMcpProtocol, type McpTransport } from './mcpProtocol'
import { dispatch } from './dispatcher'
import { createDiskGateway } from './gateway'
import { MCP_TOOL_RESOLVER } from './mcpToolCatalog'
import { validateToolArguments } from './mcpArgValidation'

const PROJECT_ID = 'mcp-accuracy-project'
const APPENDED = 'The lights went out.'
const tempDirs: string[] = []
const previousEnvironment = {
  capability: process.env[CAPABILITY_DIR_ENV],
  projects: process.env[PROJECT_ROOT_ENV],
  settings: process.env[SETTINGS_ROOT_ENV],
}

type Frame = {
  id?: number | string
  method?: string
  result?: {
    isError?: boolean
    content?: Array<{ type?: string; text?: string }>
    structuredContent?: Record<string, unknown>
  }
}

/**
 * 八条首调 = `lane-tool-accuracy.test.mts` 的同一批，按 MCP profile 表达。
 *
 * 两处**必然**不同，因为它们正是 profile 声明的差异，不是换了一套剧本：
 *   · 每条都带 `leaseHandle`（对外面的首字段），内部面没有这个概念；
 *   · 「给不收参数的工具塞一个兄弟工具的参数」在对外面是 `nomi_document_read` 收下
 *     `scope`（判别字段，本来就该填），所以那三条改喂**真正多余**的字段——
 *     `path` / `operation` / 整包 JSON 文本，容忍钩子该把它们安静地丢掉。
 */
const FIRST_CALLS: ReadonlyArray<{
  label: string
  tool: string
  args: (leaseHandle: string) => unknown
}> = [
  {
    label: 'well-formed',
    tool: 'nomi_document_edit',
    args: (leaseHandle) => ({ leaseHandle, where: 'end', content: APPENDED }),
  },
  {
    label: 'whole-argument object serialized as a JSON string',
    tool: 'nomi_document_edit',
    args: (leaseHandle) => JSON.stringify({ leaseHandle, where: 'end', content: APPENDED }),
  },
  {
    label: 'field named `text` instead of `content`',
    tool: 'nomi_document_edit',
    args: (leaseHandle) => ({ leaseHandle, where: 'end', text: APPENDED }),
  },
  {
    label: 'field named `body` instead of `content`',
    tool: 'nomi_document_edit',
    args: (leaseHandle) => ({ leaseHandle, where: 'end', body: APPENDED }),
  },
  {
    label: 'content split into an array of strings',
    tool: 'nomi_document_edit',
    args: (leaseHandle) => ({ leaseHandle, where: 'end', content: ['The lights ', 'went out.'] }),
  },
  {
    label: 'no-argument read handed an unrelated hint',
    tool: 'nomi_document_read',
    args: (leaseHandle) => ({ leaseHandle, scope: 'full', path: 'draft.md' }),
  },
  {
    label: 'no-argument read handed a sibling tool’s argument',
    tool: 'nomi_document_read',
    args: (leaseHandle) => ({ leaseHandle, scope: 'full', where: 'end' }),
  },
  {
    label: 'no-argument read handed the whole object as a JSON string',
    tool: 'nomi_document_read',
    args: (leaseHandle) => JSON.stringify({ leaseHandle, scope: 'full' }),
  },
]

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}

async function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-mcp-accuracy-'))
  tempDirs.push(root)
  process.env[CAPABILITY_DIR_ENV] = path.join(root, 'capability')
  process.env[PROJECT_ROOT_ENV] = path.join(root, 'projects')
  process.env[SETTINGS_ROOT_ENV] = path.join(root, 'settings')

  const deps = getWorkspaceRepositoryDeps()
  const projectRoot = path.join(deps.defaultProjectsRoot, 'fixture')
  createWorkspaceProject({
    rootPath: projectRoot,
    record: {
      id: PROJECT_ID,
      name: 'MCP tool accuracy fixture',
      payload: {
        generationCanvas: {
          nodes: [{ id: 'node-a', kind: 'text', title: 'Initial text', prompt: '原始节点' }],
          edges: [], groups: [], selectedNodeIds: [],
        },
        workbenchDocuments: [{
          id: 'doc-1',
          version: 1,
          title: '一次写对率夹具',
          contentJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '初稿' }] }] },
          updatedAt: 1,
        }],
        activeDocumentId: 'doc-1',
      },
    },
  }, deps)

  const identity = await ensureWorkspaceProjectIdentity(projectRoot)
  // **一个夹具一个冻结的 selection 对象**：运行时把这个对象本身当授权凭据（同一份
  // 值每次新 freeze 一遍会被判成 `project_binding_stale`）。踩过一次，留在这里。
  const committedSelection = Object.freeze({
    projectId: identity.projectId,
    immutableProjectUuid: identity.immutableProjectUuid,
    projectGeneration: identity.projectGeneration,
    canonicalRootDigest: identity.canonicalRootDigest,
  })
  ensureToken()
  const connection = createMcpConnectionContext({
    client: 'codex',
    proof: signMcpClient('codex'),
    randomSecret: () => 'S'.repeat(43),
  })
  const generationPolicy = createMcpGenerationPolicy({ env: {} })
  const runtime = createProductionProjectSessionRuntime({
    generationPolicy,
    getOpenProjectSelection: () => committedSelection,
    isServerAllowlisted: () => false,
  })
  return { connection, generationPolicy, runtime }
}

/**
 * 对照臂：**同一批参数，不过容忍钩子，直接撞广播 schema**。
 *
 * 这正是阶段 5a 之前 `mcpProtocol.ts` 对每一次 `tools/call` 做的事（拿模型给的原始参数
 * 去过 `validateToolArguments`），所以它不是一个虚构的坏臂，是**这条路上周的真实行为**。
 * 用的还是同一个 resolver、同一份广播出去的 schema——两臂之差只可能是钩子买来的。
 *
 * （不用 `vi.spyOn` 摘钩子：目录里的工具是冻结对象，`Object.freeze` 让属性不可重定义——
 * 那是好事，不是障碍：它意味着没人能在运行期把一个工具的容忍悄悄换掉。）
 */
function measureWithoutTolerance(leaseHandle: string): number {
  let firstCallHits = 0
  for (const attempt of FIRST_CALLS) {
    const tool = MCP_TOOL_RESOLVER.resolve(attempt.tool)
    if (!tool) throw new Error(`missing MCP tool ${attempt.tool}`)
    const raw = attempt.args(leaseHandle)
    if (validateToolArguments(tool.name, tool.inputSchema, raw === undefined ? {} : raw) === null) {
      firstCallHits += 1
    }
  }
  return firstCallHits
}

function makeClient(context: Parameters<typeof dispatch>[2]) {
  const waiters: Array<(frame: Frame) => void> = []
  const frames: Frame[] = []
  const send = (frame: unknown) => {
    const message = frame as Frame
    // 文稿写入要人点头（`document.write` 走 elicitation）。这里一律同意——本测量量的是
    // **参数写没写对**，不是审批策略；把审批留在默认「不同意」上，5 条写入会全部记成失败，
    // 而失败原因与 schema 一个字关系都没有。
    if (message.method === 'elicitation/create') {
      protocol.handleIncoming({ jsonrpc: '2.0', id: message.id, result: { action: 'accept', content: { confirm: true } } })
      return
    }
    const waiter = waiters.shift()
    if (waiter) waiter(message)
    else frames.push(message)
  }
  const protocol = createMcpProtocol({
    send,
    invoke: (async (method: string, params: Record<string, unknown>) =>
      dispatch(method, params, context)) as McpTransport['invoke'],
    isAppOpen: () => false,
  })
  async function call(id: number, name: string, args: unknown): Promise<Frame> {
    const response = new Promise<Frame>((resolve) => waiters.push(resolve))
    protocol.handleIncoming({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } })
    return response
  }
  async function initialize(): Promise<Frame> {
    const response = new Promise<Frame>((resolve) => waiters.push(resolve))
    protocol.handleIncoming({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-11-25', capabilities: { elicitation: {} }, clientInfo: { name: 'R30 accuracy' } },
    })
    return response
  }
  return { call, initialize, protocol }
}

interface Measurement { firstCallHits: number; turnsFinished: number; total: number }

/** 文稿里出现了几次那句话。回合成功按**增量**判，不按「里面有没有」判——文稿是累加的。 */
function occurrences(text: string): number {
  return text.split(APPENDED).length - 1
}

async function measure(): Promise<Measurement & { controlFirstCallHits: number }> {
  const fixture = await makeFixture()
  const client = makeClient({
    runTask: vi.fn(),
    makeGateway: (projectId: string) => createDiskGateway(projectId),
    productionRuns: {},
    generationPolicy: fixture.generationPolicy,
    origin: { host: 'codex' as const },
    projectSession: { authority: fixture.runtime.authority, connection: fixture.connection },
  } as never)
  await client.initialize()

  const opened = await client.call(2, 'nomi_session_open', { bootstrap: { mode: 'current_project' } })
  if (opened.result?.isError) throw new Error(`session open failed: ${JSON.stringify(opened.result)}`)
  const leaseHandle = (JSON.parse(
    opened.result?.content?.find((item) => item.type === 'text')?.text || '{}',
  ) as { leaseHandle?: string }).leaseHandle
  if (!leaseHandle) throw new Error(`session open returned no lease: ${JSON.stringify(opened)}`)

  const readDocument = async (id: number): Promise<string> => {
    const frame = await client.call(id, 'nomi_document_read', { leaseHandle, scope: 'full' })
    return String((frame.result?.structuredContent as { text?: unknown } | undefined)?.text ?? '')
  }

  let firstCallHits = 0
  let turnsFinished = 0
  for (const [index, attempt] of FIRST_CALLS.entries()) {
    const before = await readDocument(100 + index)
    const first = await client.call(10 + index, attempt.tool, attempt.args(leaseHandle as string))
    const succeeded = first.result?.isError !== true
    if (succeeded) firstCallHits += 1
    else console.log(`[R30·mcp] first-call miss: ${attempt.label} → ${JSON.stringify(first.result?.content?.[0]).slice(0, 200)}`)

    // 回合成功 = 这一步的领域效果**真的发生了**。少了后半句，一个「没报错但什么也没做」
    // 的调用也会被记成成功——那正是 #547 里最难发现的一族。
    const after = await readDocument(200 + index)
    const applied = attempt.tool === 'nomi_document_edit'
      ? occurrences(after) === occurrences(before) + 1
      : after.includes('初稿')
    if (succeeded && applied) turnsFinished += 1
  }

  const controlFirstCallHits = measureWithoutTolerance(leaseHandle as string)
  client.protocol.dispose()
  return { firstCallHits, turnsFinished, total: FIRST_CALLS.length, controlFirstCallHits }
}

describe('R30 · MCP profile 的一次写对率与回合成功率', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    restoreEnvironment(CAPABILITY_DIR_ENV, previousEnvironment.capability)
    restoreEnvironment(PROJECT_ROOT_ENV, previousEnvironment.projects)
    restoreEnvironment(SETTINGS_ROOT_ENV, previousEnvironment.settings)
    while (tempDirs.length > 0) fs.rmSync(tempDirs.pop() as string, { recursive: true, force: true })
  })

  it('同一批 #547 畸形经 tools/call 跑：数字与 internal 相等，且对照臂明显更差', async () => {
    const measured = await measure()

    // 数字打进日志，PR 正文直接引用它，不用谁去心算。
    console.log(`[R30·mcp] first-call accuracy  with tolerance: ${measured.firstCallHits}/${measured.total}`
      + `  ·  control (raw args vs broadcast schema): ${measured.controlFirstCallHits}/${measured.total}`)
    console.log(`[R30·mcp] turn success rate    with tolerance: ${measured.turnsFinished}/${measured.total}`)

    // ① 与 internal 相等（阶段 2 的 loopback 数字是 8/8，见 PR #591 正文）。
    expect(measured.firstCallHits).toBe(measured.total)
    expect(measured.turnsFinished).toBe(measured.total)

    // ② 阳性对照必须明显更差。它要是也接近满分，说明这批畸形根本没打到点上，
    //    上面那个漂亮的数字就什么都不证明。
    expect(measured.controlFirstCallHits).toBeLessThan(measured.firstCallHits)
    expect(measured.controlFirstCallHits).toBeLessThanOrEqual(1)
  })

  it('容忍是捏合，不是放松 schema：真正缺 content 的写入仍然失败', async () => {
    const fixture = await makeFixture()
    const client = makeClient({
      runTask: vi.fn(),
      makeGateway: (projectId: string) => createDiskGateway(projectId),
      productionRuns: {},
      generationPolicy: fixture.generationPolicy,
      origin: { host: 'codex' as const },
      projectSession: { authority: fixture.runtime.authority, connection: fixture.connection },
    } as never)
    await client.initialize()
    const opened = await client.call(2, 'nomi_session_open', { bootstrap: { mode: 'current_project' } })
    const leaseHandle = (JSON.parse(
      opened.result?.content?.find((item) => item.type === 'text')?.text || '{}',
    ) as { leaseHandle?: string }).leaseHandle as string

    const empty = await client.call(3, 'nomi_document_edit', { leaseHandle, where: 'end', unrelated: 1 })
    expect(empty.result?.isError).toBe(true)
    expect((empty.result?.structuredContent as { nomiOutcome?: { errorCode?: string } } | undefined)
      ?.nomiOutcome?.errorCode).toBe('capability_input_invalid')
    client.protocol.dispose()
  })
})
