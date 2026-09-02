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
        inputSchema: { required?: string[]; properties?: Record<string, { maximum?: number }> }
        annotations?: { readOnlyHint?: boolean }
      }>
    }).tools
    const names = tools.map((tool) => tool.name)
    expect(names).toEqual([...MCP_TOOL_NAMES])
    expect(names).toHaveLength(MCP_TOOL_NAMES.length)
    expect(tools.find((tool) => tool.name === 'nomi_start_playbook')?.annotations?.readOnlyHint).toBeUndefined()
    for (const name of ['nomi_get_run', 'nomi_subscribe_run', 'nomi_get_artifact']) {
      expect(tools.find((tool) => tool.name === name)?.annotations?.readOnlyHint).toBe(true)
    }
    const subscribe = tools.find((tool) => tool.name === 'nomi_subscribe_run')
    expect(subscribe?.inputSchema.properties?.waitMs?.maximum).toBe(25_000)
    expect(subscribe?.inputSchema.required).toEqual(['projectId', 'runId'])
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
    const playbook = tools.find((tool) => tool.name === 'nomi_start_playbook')?.inputSchema.properties?.playbook

    expect(playbook?.enum).toEqual(listProductionPlaybookNames())
    expect(playbook?.enum).toContain('brand.promo')
    expect(playbook?.description).not.toContain('例如')
    for (const name of listProductionPlaybookNames()) expect(playbook?.description).toContain(name)
  })

  it('keeps the current README count and guide table aligned with the exported catalog', () => {
    const readme = fs.readFileSync(path.join(process.cwd(), 'README.md'), 'utf8')
    const guide = fs.readFileSync(path.join(process.cwd(), 'docs/guide/capability-core-cli-mcp.md'), 'utf8')
    expect(readme).toContain('Thirty-three MCP tools')
    expect(guide).toContain('33 个工具')
    // Keep the public guide aligned with the live catalog so a newly reachable
    // semantic surface cannot be omitted from the user-facing MCP contract.
    for (const name of MCP_TOOL_NAMES.filter((name) => ![
      'nomi_read_artifact', 'nomi_request_script_revision', 'nomi_request_storyboard_revision', 'nomi_review_artifact',
    ].includes(name))) expect(guide).toContain(`\`${name}\``)
  })

  it('keeps initialize clientInfo as an audit label and starts only a draft', async () => {
    const harness = new ProductionHarness()
    await harness.call(1, 'initialize', {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'OpenAI Codex', version: '1.0.0' },
    })
    const response = await harness.call(2, 'tools/call', {
      name: 'nomi_start_playbook',
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
      name: 'nomi_subscribe_run',
      arguments: { projectId: 'project-1', runId: 'run-1', afterCursor: 2, waitMs: 25_000 },
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
      name: 'nomi_get_run',
      arguments: { projectId: 'project-1', runId: 'run-1' },
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
      name: 'nomi_get_artifact',
      arguments: { projectId: 'project-1', runId: 'run-1', artifactId: 'artifact-1' },
    })
    const result = response.result as { content: Array<{ text: string }> }
    expect(result.content[0].text).toContain('storyboard')
    expect(result.content[0].text).toContain('nomi://project/project-1/run/run-1/artifact/artifact-1')
    expect(result.content[0].text).toContain('在 Nomi 打开')
    expect(JSON.stringify(result)).not.toMatch(/providerUrl|\/Users\/|rawPrompt|approval/i)
  })
})
