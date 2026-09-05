import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'

import { listProductionPlaybookNames } from '../productionRun/productionPlaybooks'
import { createMcpProtocol, MCP_TOOL_NAMES, type McpTransport } from './mcpProtocol'

type RpcMessage = {
  jsonrpc?: string
  id?: unknown
  method?: string
  params?: Record<string, unknown>
  result?: unknown
  error?: { code?: number; message?: string }
}

class ProductionHarness {
  readonly invoke = vi.fn(async (method: string, params: Record<string, unknown>) => {
    if (method === 'production.start') {
      return {
        runId: 'run-1', projectId: params.projectId, status: 'draft', stageId: 'brief',
        artifacts: [], openInNomi: 'nomi://project/project-1/run/run-1',
      }
    }
    if (method === 'production.get') {
      return {
        runId: 'run-1', projectId: params.projectId, status: 'running', stageId: 'production',
        jobs: [{ jobId: 'job-1', status: 'polling' }],
        gates: [{ gateId: 'gate-export-v1', scope: 'export', status: 'waiting' }],
        artifacts: [{ artifactId: 'artifact-video-1', kind: 'video', status: 'adopted' }],
        openInNomi: 'nomi://project/project-1/run/run-1',
      }
    }
    if (method === 'production.events') {
      return {
        events: [{ cursor: 4, type: 'stage.updated', message: 'storyboard' }],
        nextCursor: 4,
      }
    }
    if (method === 'production.artifact') {
      return {
        artifactId: params.artifactId, kind: 'storyboard', status: 'ready',
        nomiUri: 'nomi://project/project-1/run/run-1/artifact/artifact-1',
        openInNomi: 'nomi://project/project-1/run/run-1?artifact=artifact-1',
      }
    }
    throw new Error(`unexpected invoke: ${method}`)
  })
  private protocol: ReturnType<typeof createMcpProtocol>
  private queue: RpcMessage[] = []
  private waiters: Array<(message: RpcMessage) => void> = []

  constructor() {
    const transport: McpTransport = {
      send: (message) => {
        const frame = message as RpcMessage
        const waiter = this.waiters.shift()
        if (waiter) waiter(frame)
        else this.queue.push(frame)
      },
      invoke: this.invoke,
      isAppOpen: () => true,
    }
    this.protocol = createMcpProtocol(transport)
  }

  private next(): Promise<RpcMessage> {
    const queued = this.queue.shift()
    if (queued) return Promise.resolve(queued)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('MCP response timed out')), 5_000)
      this.waiters.push((message) => { clearTimeout(timer); resolve(message) })
    })
  }

  async call(id: number, method: string, params?: Record<string, unknown>): Promise<RpcMessage> {
    this.protocol.handleIncoming({ jsonrpc: '2.0', id, method, params })
    const response = await this.next()
    expect(response.id).toBe(id)
    return response
  }
}

describe('production run MCP tools', () => {
  it('exposes the exact catalog contract with truthful read-only annotations', async () => {
    const harness = new ProductionHarness()
    const response = await harness.call(1, 'tools/list')
    const tools = (response.result as {
      tools: Array<{
        name: string
        inputSchema: { required?: string[]; properties?: Record<string, { maximum?: number; enum?: string[] }> }
        annotations?: { readOnlyHint?: boolean }
      }>
    }).tools
    const names = tools.map((tool) => tool.name)
    expect(names).toEqual([...MCP_TOOL_NAMES])
    expect(names).toHaveLength(MCP_TOOL_NAMES.length)
    // 面收敛：nomi_run_start（建 Run）是写，不标 readOnlyHint；所有读并入 nomi_read（整体只读）。
    expect(tools.find((tool) => tool.name === 'nomi_run_start')?.annotations?.readOnlyHint).toBeUndefined()
    expect(tools.find((tool) => tool.name === 'nomi_read')?.annotations?.readOnlyHint).toBe(true)
    // nomi_read 的 run_events 长轮询上限仍 ≤25s；target 是唯一必填（其余由 handler 按 target 断言）。
    const read = tools.find((tool) => tool.name === 'nomi_read')
    expect(read?.inputSchema.properties?.waitMs?.maximum).toBe(25_000)
    expect(read?.inputSchema.required).toEqual(['target'])
    expect(read?.inputSchema.properties?.target?.enum).toContain('run_events')
  })

  // 2026-08-18：描述原先写「制作 playbook，例如 brand.promo」——「例如」暗示还有别的名字可传，
  // 实际只实现了一个，传别的会静默建出永远推不动的坏 Run。schema 层就把可选值钉死在注册表上，
  // 且描述必须由注册表 derive，不容许再手写一份会漂移的名单。
  it('constrains the playbook argument to the implemented registry instead of hinting at more', async () => {
    const harness = new ProductionHarness()
    const response = await harness.call(1, 'tools/list')
    const tools = (response.result as {
      tools: Array<{ name: string; inputSchema: { properties?: Record<string, { enum?: string[]; description?: string }> } }>
    }).tools
    const playbook = tools.find((tool) => tool.name === 'nomi_run_start')?.inputSchema.properties?.playbook

    expect(playbook?.enum).toEqual(listProductionPlaybookNames())
    expect(playbook?.enum).toContain('brand.promo')
    expect(playbook?.description).not.toContain('例如')
    for (const name of listProductionPlaybookNames()) expect(playbook?.description).toContain(name)
  })

  it('keeps the public docs aligned with the exported catalog, including the first doc users read', () => {
    // 面收敛（surface-16-collapse）：拉分支时 42 个塌成 15 个；并线 main +4 M2 编辑工具、并线 M2 canvas/document
    // 语义面 +4（canvas_plan/maintenance · document_read/edit）+ integration_manage = 24。README/guide 计数同步，且每个导出
    // name 在 guide 都有条目——公开契约不许漏面。
    const readme = fs.readFileSync(path.join(process.cwd(), 'README.md'), 'utf8')
    const guide = fs.readFileSync(path.join(process.cwd(), 'docs/guide/capability-core-cli-mcp.md'), 'utf8')
    expect(readme).toContain(`${MCP_TOOL_NAMES.length} MCP tools`)
    expect(guide).toContain(`${MCP_TOOL_NAMES.length} 个工具`)
    // Keep the public guide aligned with the live catalog so a newly reachable
    // semantic surface cannot be omitted from the user-facing MCP contract.
    for (const name of MCP_TOOL_NAMES) expect(guide).toContain(`\`${name}\``)
    // docs/integrate-with-your-agent.md 是用户**第一眼读**的上手文档，此前没有任何断言盯着它：
    // 它一直写着「47 个工具」并点名早已退役的 nomi_canvas_read，而 README 与 guide 都是对的
    //（2026-09-05 外部宿主探针）。这里钉住「它提到的每个工具名都必须还活着」——
    // 数量本身刻意不写在那份文档里，改为指向 tools/list。
    const onboarding = fs.readFileSync(path.join(process.cwd(), 'docs/integrate-with-your-agent.md'), 'utf8')
    const live = new Set<string>(MCP_TOOL_NAMES)
    const mentioned = [...new Set([...onboarding.matchAll(/`(nomi_[a-z0-9_]+)`/g)].map((match) => match[1]))]
    expect(mentioned.filter((name) => !live.has(name))).toEqual([])
  })

  it('keeps initialize clientInfo as an audit label and starts only a draft', async () => {
    const harness = new ProductionHarness()
    await harness.call(1, 'initialize', {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'OpenAI Codex', version: '1.0.0' },
    })
    const response = await harness.call(2, 'tools/call', {
      name: 'nomi_run_start',
      arguments: {
        projectId: 'project-1',
        playbook: 'brand.promo',
        brief: { goal: '介绍 Nomi', durationSeconds: 60, sellingPoints: ['本地保存'] },
      },
    })
    expect(harness.invoke).toHaveBeenCalledWith('production.start', {
      projectId: 'project-1',
      playbook: 'brand.promo',
      playbookVersion: undefined,
      actorId: 'codex',
      brief: { goal: '介绍 Nomi', durationSeconds: 60, sellingPoints: ['本地保存'] },
    })
    const result = response.result as { content: Array<{ text: string }> }
    expect(result.content[0].text).toContain('草稿')
    expect(result.content[0].text).toContain('nomi://project/project-1/run/run-1')
  })

  it('passes a resumable cursor and bounded long-poll duration', async () => {
    const harness = new ProductionHarness()
    const response = await harness.call(3, 'tools/call', {
      name: 'nomi_read',
      arguments: { target: 'run_events', projectId: 'project-1', runId: 'run-1', afterCursor: 2, waitMs: 25_000 },
    })
    expect(harness.invoke).toHaveBeenCalledWith('production.events', {
      projectId: 'project-1', runId: 'run-1', afterCursor: 2, waitMs: 25_000,
    })
    const result = response.result as { content: Array<{ text: string }> }
    expect(result.content[0].text).toContain('cursor 4')
    expect(result.content[0].text).toContain('storyboard')
  })

  it('returns the safe full projection for AI reasoning alongside the compact widget frame', async () => {
    const harness = new ProductionHarness()
    const response = await harness.call(5, 'tools/call', {
      name: 'nomi_read',
      arguments: { target: 'run', projectId: 'project-1', runId: 'run-1' },
    })
    const result = response.result as {
      structuredContent?: {
        nomiRun?: { kind?: string; shots?: unknown[] }
        nomiRunData?: { jobs?: unknown[]; gates?: unknown[]; artifacts?: Array<{ artifactId?: string }> }
      }
    }
    expect(result.structuredContent?.nomiRun).toMatchObject({ kind: 'production' })
    expect(result.structuredContent?.nomiRunData).toMatchObject({
      jobs: [{ jobId: 'job-1', status: 'polling' }],
      gates: [{ gateId: 'gate-export-v1', scope: 'export', status: 'waiting' }],
      artifacts: [{ artifactId: 'artifact-video-1', kind: 'video', status: 'adopted' }],
    })
  })

  it('returns a concise artifact link without approval or paid dispatch', async () => {
    const harness = new ProductionHarness()
    const response = await harness.call(4, 'tools/call', {
      name: 'nomi_read',
      arguments: { target: 'artifact', projectId: 'project-1', runId: 'run-1', artifactId: 'artifact-1' },
    })
    const result = response.result as { content: Array<{ text: string }> }
    expect(result.content[0].text).toContain('storyboard')
    expect(result.content[0].text).toContain('nomi://project/project-1/run/run-1/artifact/artifact-1')
    expect(result.content[0].text).toContain('在 Nomi 打开')
    expect(JSON.stringify(result)).not.toMatch(/providerUrl|\/Users\/|rawPrompt|approval/i)
  })
})
