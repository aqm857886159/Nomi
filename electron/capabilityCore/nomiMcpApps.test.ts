import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMcpProtocol, type McpTransport } from './mcpProtocol'
import {
  NOMI_LIVE_DRAFT_UI_URI,
  MCP_APP_MIME_TYPE,
  MCP_UI_EXTENSION_ID,
  NOMI_LIVE_DRAFT_WIDGET_HTML,
  buildNomiRunFromProjection,
} from './mcpAppWidget'

// MCP Apps ProductionRun widget serving（扩展 io.modelcontextprotocol/ui，Stable 2026-01-26）：
// - ProductionRun tools 挂 _meta.ui.resourceUri；resources/list 含 ui:// 资源；
//   resources/read 回 text/html;profile=mcp-app 的 widget HTML。
// - 没声明的纯终端客户端会忽略 widget 扩展字段，文本结果仍可用。
// 纯逻辑（注入假 transport），不碰 electron/fs/进程。渲染在真 GUI 宿主里的效果需宿主验（本机无）。

type RpcMessage = { jsonrpc?: string; id?: unknown; method?: string; params?: Record<string, unknown>; result?: unknown; error?: { code?: number; message?: string } }

class AppsHarness {
  readonly invoke = vi.fn(async (method: string, _params: Record<string, unknown>) => {
    if (method === 'skills.list') return { skills: [{ name: 'director.cinematography', directoryName: 'director-cinematography', description: '镜头语言。' }] }
    throw new Error(`意外的 invoke: ${method}`)
  })
  private protocol: ReturnType<typeof createMcpProtocol>
  private queue: RpcMessage[] = []
  private waiters: Array<(msg: RpcMessage) => void> = []

  constructor() {
    const transport: McpTransport = {
      send: (message) => {
        const msg = message as RpcMessage
        const waiter = this.waiters.shift()
        if (waiter) waiter(msg)
        else this.queue.push(msg)
      },
      invoke: this.invoke,
      isAppOpen: () => true,
    }
    this.protocol = createMcpProtocol(transport)
  }

  private next(timeoutMs = 5000): Promise<RpcMessage> {
    const queued = this.queue.shift()
    if (queued) return Promise.resolve(queued)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('等待 MCP 消息超时')), timeoutMs)
      this.waiters.push((msg) => { clearTimeout(timer); resolve(msg) })
    })
  }

  async call(id: number, method: string, params?: Record<string, unknown>): Promise<RpcMessage> {
    this.protocol.handleIncoming({ jsonrpc: '2.0', id, method, params })
    const res = await this.next()
    expect(res.id).toBe(id)
    return res
  }

  /** 声明 UI 扩展的宿主 initialize。 */
  initUi(): Promise<RpcMessage> {
    return this.call(1, 'initialize', {
      protocolVersion: '2026-01-26',
      capabilities: { extensions: { [MCP_UI_EXTENSION_ID]: { mimeTypes: [MCP_APP_MIME_TYPE] } } },
    })
  }
  /** 纯终端客户端 initialize（不声明 UI 扩展）。 */
  initPlain(): Promise<RpcMessage> {
    return this.call(1, 'initialize', { protocolVersion: '2025-11-25', capabilities: {} })
  }
}

let h: AppsHarness | null = null
afterEach(() => { h = null })

describe('nomi-mcp · MCP Apps ProductionRun widget serving', () => {
  it('only ProductionRun tools advertise the live widget; nomi_generate stays retired', async () => {
    h = new AppsHarness()
    await h.initUi()
    const res = await h.call(2, 'tools/list')
    const tools = (res.result as { tools: Array<{ name: string; _meta?: Record<string, unknown> }> }).tools
    expect(tools.some((tool) => tool.name === 'nomi_generate')).toBe(false)
    for (const name of ['nomi_start_playbook', 'nomi_get_run', 'nomi_subscribe_run', 'nomi_get_artifact']) {
      const meta = tools.find((tool) => tool.name === name)?._meta as {
        ui?: { resourceUri?: string }
        'openai/outputTemplate'?: string
      } | undefined
      expect(meta?.ui?.resourceUri).toBe(NOMI_LIVE_DRAFT_UI_URI)
      expect(meta?.['openai/outputTemplate']).toBe(NOMI_LIVE_DRAFT_UI_URI)
    }
    const listProjects = tools.find((t) => t.name === 'nomi_list_projects')
    expect(listProjects?._meta).toBeUndefined()
  })

  // 宿主按 readOnlyHint 决定要不要每次弹确认。标漏会让查询反复确认，标多会静默放行写入。
  it('只读工具标 readOnlyHint，会改/会花钱的一律不标（决定宿主要不要每次问）', async () => {
    h = new AppsHarness()
    await h.initPlain()
    const res = await h.call(2, 'tools/list')
    const tools = (res.result as { tools: Array<{ name: string; annotations?: { readOnlyHint?: boolean } }> }).tools
    const readOnly = tools.filter((t) => t.annotations?.readOnlyHint === true).map((t) => t.name).sort()
    expect(readOnly).toEqual([
      'nomi_export_job',
      'nomi_get_artifact',
      'nomi_get_generation_context',
      'nomi_get_run',
      'nomi_list_models',
      'nomi_list_projects',
      'nomi_media_query',
      'nomi_operation_read',
      'nomi_read_artifact',
      'nomi_read_canvas',
      'nomi_subscribe_run',
      'nomi_timeline_read',
    ])
    expect(tools.some((tool) => tool.name === 'nomi_generate')).toBe(false)
  })

  it('声明 UI 扩展的宿主：resources/list 含 ui:// widget 资源（正确 mimeType）', async () => {
    h = new AppsHarness()
    await h.initUi()
    const res = await h.call(2, 'resources/list')
    const resources = (res.result as { resources: Array<{ uri: string; mimeType: string }> }).resources
    const ui = resources.find((r) => r.uri === NOMI_LIVE_DRAFT_UI_URI)
    expect(ui).toBeTruthy()
    expect(ui?.mimeType).toBe(MCP_APP_MIME_TYPE)
    expect(ui?.mimeType).toBe('text/html;profile=mcp-app')
  })

  it('resources/read ui:// → 回自包含 widget HTML（含握手 + Nomi 标识）', async () => {
    h = new AppsHarness()
    await h.initUi()
    const res = await h.call(2, 'resources/read', { uri: NOMI_LIVE_DRAFT_UI_URI })
    const contents = (res.result as { contents: Array<{ uri: string; mimeType: string; text: string }> }).contents
    expect(contents[0].uri).toBe(NOMI_LIVE_DRAFT_UI_URI)
    expect(contents[0].mimeType).toBe(MCP_APP_MIME_TYPE)
    expect(contents[0].text).toContain('<!DOCTYPE html>')
    expect(contents[0].text).toContain('ui/notifications/tool-result') // 标准宿主注入通道（Claude/参考宿主）
    expect(contents[0].text).toContain('ui/initialize') // 视图↔宿主握手
    expect(contents[0].text).toContain('window.openai') // ChatGPT 桥（双桥并存）
    expect(contents[0].text).toContain('openai:set_globals') // ChatGPT 数据更新事件
    expect(contents[0].text).toContain('Nomi 活生成')
  })

})

// 交付④：签名 asset 预览 URL 必须能过 widget 现有的 safePreviewUrl 校验（run 路复用的那把，形状相同）。
describe('safePreviewUrl 接受签名 asset 预览（交付④ · 形状与 production 相同，不改校验器）', () => {
  it('run 投影里若 preview.url 是签名 asset 链（同 /production-preview?preview= 形状）→ 放行入 widget', () => {
    const run = buildNomiRunFromProjection({
      projectId: 'p1',
      runId: 'r1',
      result: {
        projectId: 'p1', runId: 'r1', status: 'running', playbook: { name: 'x' },
        artifacts: [{ artifactId: 'a1', kind: 'image', status: 'ready', preview: { url: 'http://127.0.0.1:65535/production-preview?preview=SIGNED', expiresAt: '2026-08-08T10:01:00.000Z' } }],
      },
    })
    expect(run.shots?.[0]?.thumbnailUrl).toBe('http://127.0.0.1:65535/production-preview?preview=SIGNED')
  })
})

describe('buildNomiRunFromProjection（纯函数）', () => {
  it('只把安全 nomi-local 预览和 Nomi 深链带入 widget', () => {
    const run = buildNomiRunFromProjection({
      projectId: 'project-1',
      runId: 'run-1',
      result: {
        projectId: 'project-1',
        runId: 'run-1',
        status: 'running',
        playbook: { name: 'brand.promo' },
        artifacts: [{ artifactId: 'a1', kind: 'image', status: 'ready', preview: { url: 'nomi-local://asset/project-1/a.png', expiresAt: '2026-08-08T10:01:00.000Z' } }],
        openInNomi: 'nomi://project/project-1/run/run-1',
      },
    })
    expect(run.kind).toBe('production')
    expect(run.shots?.[0]).toMatchObject({ status: 'success', thumbnailUrl: 'nomi-local://asset/project-1/a.png' })
    expect(run.deepLink).toBe('nomi://project/project-1/run/run-1')
  })

  it('production widget consumes the canonical nomiRun frame and exposes one exact Nomi action', () => {
    expect(NOMI_LIVE_DRAFT_WIDGET_HTML).toContain('sc.nomiRun')
    expect(NOMI_LIVE_DRAFT_WIDGET_HTML).toContain('structuredContent.nomiRun')
    expect(NOMI_LIVE_DRAFT_WIDGET_HTML.match(/>在 Nomi 打开</g)).toHaveLength(1)
    expect(NOMI_LIVE_DRAFT_WIDGET_HTML).not.toContain('>在 Nomi 中打开<')
  })

  it('selects only the newest safe preview instead of rendering every artifact', () => {
    const run = buildNomiRunFromProjection({
      projectId: 'project-1',
      runId: 'run-1',
      result: {
        projectId: 'project-1',
        runId: 'run-1',
        status: 'running',
        artifacts: [
          { artifactId: 'new-without-preview', kind: 'timeline', status: 'ready', createdAt: '2026-08-08T10:03:00.000Z' },
          { artifactId: 'old', kind: 'image', status: 'ready', createdAt: '2026-08-08T10:01:00.000Z', preview: { url: 'http://127.0.0.1:3131/production-preview?preview=old' } },
          { artifactId: 'new', kind: 'video', status: 'adopted', createdAt: '2026-08-08T10:02:00.000Z', preview: { url: 'http://127.0.0.1:3131/production-preview?preview=new' } },
        ],
      },
    })
    expect(run.shots).toHaveLength(1)
    expect(run.shots?.[0]).toMatchObject({ title: 'video', kind: 'video', thumbnailUrl: 'http://127.0.0.1:3131/production-preview?preview=new' })
  })

  it('does not invent running progress for event-only or ready-artifact projections', () => {
    const eventOnly = buildNomiRunFromProjection({
      projectId: 'project-1',
      runId: 'run-1',
      result: { events: [{ cursor: 4, type: 'stage.updated', message: '分镜规划已完成' }], nextCursor: 4 },
    })
    expect(eventOnly.status).toBe('unknown')
    expect(eventOnly.message).toBe('分镜规划已完成')

    const artifact = buildNomiRunFromProjection({
      projectId: 'project-1',
      runId: 'run-1',
      result: {
        artifactId: 'artifact-1',
        kind: 'storyboard',
        status: 'ready',
        preview: { url: 'http://127.0.0.1:3131/production-preview?preview=ready' },
      },
    })
    expect(artifact.status).toBe('available')
    expect(artifact.shots).toHaveLength(1)
  })

  it('shows degraded-provider recovery guidance without adding a retry button', () => {
    const run = buildNomiRunFromProjection({
      projectId: 'project-1',
      runId: 'run-1',
      result: {
        projectId: 'project-1', runId: 'run-1', status: 'needs_attention',
        jobs: [{ jobId: 'job-1', status: 'submission_unknown' }],
      },
    })
    expect(run.recovery).toMatchObject({ profile: 'submit_only', allowAutomaticRetry: false, allowNewAttempt: true })
    expect(run.message).toContain('不会自动重提')
    expect(NOMI_LIVE_DRAFT_WIDGET_HTML).not.toContain('自动重试')
  })
})

describe('buildNomiRunFromProjection · B6 gate 卡映射', () => {
  const base = { projectId: 'p1', runId: 'r1' }
  it('direction waiting gate → kind=direction + 候选/标题/摘要透传', () => {
    const state = buildNomiRunFromProjection({ ...base, result: {
      runId: 'r1', projectId: 'p1', status: 'awaiting_direction',
      gates: [{ gateId: 'gate-direction-v1', scope: 'stage', status: 'waiting', title: '确认创意方向', summary: '选一个再拟分镜', directionCandidates: [
        { key: 'a', title: '方向 A', oneLiner: '一句话 A' },
        { key: 'b', title: '方向 B' },
        { key: 'c', title: '方向 C', oneLiner: '一句话 C' },
      ] }],
    } })
    expect(state.gate).toMatchObject({ gateId: 'gate-direction-v1', kind: 'direction', title: '确认创意方向' })
    expect(state.gate?.candidates).toHaveLength(3)
    expect(state.gate?.candidates?.[1]).toEqual({ key: 'b', title: '方向 B' })
  })
  it('sample / contract / export gate 识别正确；非 waiting 门不产出 gate', () => {
    const sample = buildNomiRunFromProjection({ ...base, result: { runId: 'r1', status: 'running', gates: [{ gateId: 'gate-sample-v1', scope: 'stage', status: 'waiting', title: '样片等你过目' }] } })
    expect(sample.gate?.kind).toBe('sample')
    const contract = buildNomiRunFromProjection({ ...base, result: { runId: 'r1', status: 'awaiting_contract', gates: [{ gateId: 'gate-contract-v1', scope: 'budget_envelope', status: 'waiting' }] } })
    expect(contract.gate?.kind).toBe('contract')
    const exportGate = buildNomiRunFromProjection({ ...base, result: { runId: 'r1', status: 'awaiting_export', gates: [{ gateId: 'gate-export-v1', scope: 'export', status: 'waiting' }] } })
    expect(exportGate.gate?.kind).toBe('export')
    const decided = buildNomiRunFromProjection({ ...base, result: { runId: 'r1', status: 'running', gates: [{ gateId: 'gate-direction-v1', scope: 'stage', status: 'approved', directionCandidates: [{ key: 'a', title: 'A' }] }] } })
    expect(decided.gate).toBeUndefined()
  })
  it('widget HTML 含 gate 容器与卡内决议通道（nomi_decide_gate via tools/call），钱门只读提示在', () => {
    expect(NOMI_LIVE_DRAFT_WIDGET_HTML).toContain('id="gate"')
    expect(NOMI_LIVE_DRAFT_WIDGET_HTML).toContain('nomi_decide_gate')
    expect(NOMI_LIVE_DRAFT_WIDGET_HTML).toContain('批准并继续')
    expect(NOMI_LIVE_DRAFT_WIDGET_HTML).toContain('满意，继续批量')
    expect(NOMI_LIVE_DRAFT_WIDGET_HTML).toContain('金额不做卡内一键批')
  })
})
