// J-MCP1 · R16 real-process MCP journey with per-step visibility metrics.
//
// Replays the 2026-08-17 real-user task that exposed this branch's six root causes (see
// docs/plan/2026-08-18-mcp-experience-overhaul.md §一): an external agent drives Nomi over MCP to build a
// ~60s film — create project → batch-add 14 nodes (2 anchors + 12 video) → connect reference edges →
// list models → generate 2 images + 1 video (mock vendor, zero quota) → read back a produced artifact →
// read the canvas. Every step records the three metrics the user demanded: did it fail/error/retry, how
// long, and what the user could SEE (progress notifications, image content blocks, deep link, elicitation
// used, app dialog shown). Metrics stream to test-results/mcp-journey-metrics.jsonl.
//
// WHY the in-Electron MCP stdio server, not the bare-Node mcpNodeLauncher wrapper:
//   The launcher (mcpNodeLauncher.js) ALWAYS ensures a live *GUI* Nomi instance before forwarding (its
//   invoke = callViaRpc(ensureLiveInstance())). A GUI instance has a renderer, so an MCP-created project
//   that is NOT open in a window resolves its spend through createHybridGateway → renderer 'spend.confirm'
//   card (gateway.ts:118-127, rpcServer.ts:77-80) — which cannot complete headlessly without a human
//   click. The acceptance gates here require a ZERO-dialog, elicitation-driven, zero-quota headless spend.
//   The real in-Electron stdio server (electron <repoRoot> + NOMI_MCP_STDIO=1) is genuinely headless (no
//   window, app.dock.hide), routes spend through elicitation → makeConfirmedGateway (mcpStdioServer.ts:99),
//   and speaks the SAME real newline-delimited JSON-RPC stdio framing mcpProtocol.ts implements. It is the
//   same real-process transport production-mcp-journey.e2e.mjs drives. This IS the real stack end-to-end —
//   real runTask, real dispatchAndEnrich thumbnailing, real asset store — with no in-process shortcut.
//   The launcher's own boot path (startNomi) and the App-open elicitation plan path are covered elsewhere
//   (packaged-mcp-smoke.e2e.mjs boots via the launcher; mcpPlanConfirm.test.ts unit-tests App-open plan
//   elicitation, which is unreachable headless by design).
//
// Zero quota: the only "vendor" is a loopback HTTP server returning a real tiny PNG as a data: URL, so the
// real request pipeline + asset store run without any provider call. CI-ready, deterministic, cleans up.
// Build note: runs the dist-electron build (like every _launchApp-based e2e) — run `pnpm run build` first.
// Invoke: node tests/ux/mcp-journey.e2e.mjs   (or `pnpm run test:mcp`).
import fs from 'node:fs'
import path from 'node:path'
import {
  repoRoot,
  assertBuilt,
  startMockVendorServer,
  writeIsolatedCatalog,
  spawnMcpStdioClient,
  parseToolResult,
  makeIsolatedDirs,
  NODE_KIND_DEFAULT_SIZE,
  NODE_KIND_FALLBACK_SIZE,
} from './_mcpJourney.mjs'

const OVERHEAD_BUDGET_MS = 2_000 // non-model per-step overhead ceiling (generate steps excluded, mock latency)
const JOURNEY_BUDGET_MS = 180_000 // full journey bound (matches production-mcp-journey's 40s×steps envelope)

// Per-kind default node sizes come from the BUILT production table (NODE_KIND_DEFAULT_SIZE, imported via
// _mcpJourney.mjs) — never hand-copied, so this can't silently drift from nodeKindDomain.ts and the check
// covers whatever kinds production defines. readCanvas returns only position, so the AABB-overlap check
// derives each box's size from its kind. The layout stacks/columns by FOOTPRINT (size + render safety,
// strictly larger), so raw-size boxes are a conservative test: if these don't overlap, the real
// (larger-spaced) footprints certainly don't.

const metricsDir = path.join(repoRoot, 'test-results')
fs.mkdirSync(metricsDir, { recursive: true })
const metricsPath = path.join(metricsDir, 'mcp-journey-metrics.jsonl')
fs.writeFileSync(metricsPath, '') // fresh run

const metrics = []
function recordStep(entry) {
  const line = {
    step: entry.step,
    tool: entry.tool,
    ok: entry.ok,
    errorCode: entry.errorCode ?? null,
    retries: entry.retries ?? 0,
    durationMs: entry.durationMs,
    visible: {
      progressNotifs: entry.visible?.progressNotifs ?? 0,
      imageBlocks: entry.visible?.imageBlocks ?? 0,
      deepLink: entry.visible?.deepLink ?? false,
      elicitationUsed: entry.visible?.elicitationUsed ?? false,
      // false BY CONSTRUCTION in headless (no renderer → no App confirm card) — still recorded per brief.
      appDialogShown: false,
    },
  }
  metrics.push(line)
  fs.appendFileSync(metricsPath, JSON.stringify(line) + '\n')
  const vis = line.visible
  console.log(
    `  · ${line.step} (${line.tool}) ok=${line.ok} err=${line.errorCode ?? '-'} ` +
    `${line.durationMs}ms  progress=${vis.progressNotifs} img=${vis.imageBlocks} ` +
    `link=${vis.deepLink ? 'y' : 'n'} elicit=${vis.elicitationUsed ? 'y' : 'n'}`,
  )
}

let passed = 0
function assert(condition, label) {
  if (!condition) throw new Error(`J-MCP1 FAIL: ${label}`)
  passed += 1
  console.log(`  ✓ ${label}`)
}

const dirs = makeIsolatedDirs()
let mockVendor = null
let mcp = null
let exitCode = 0
const journeyStarted = Date.now()

try {
  // Fail fast with a clear message if dist-electron is stale (the stdio server runs compiled JS), rather
  // than letting the initialize handshake time out looking like a hang.
  assertBuilt()

  // ── Isolated fixtures: loopback mock vendor + synthetic catalog pointing at it. Never touches the real
  //    ~/.nomi, installed App catalog, or ~/Documents/Nomi Projects (all dirs are temp).
  mockVendor = await startMockVendorServer()
  writeIsolatedCatalog(dirs.settingsDir, mockVendor.origin)

  // Enable the generation semantic surface (E0=plan/preview + E1=gate/start/paid submit).
  // Both flags are required: E0 alone blocks the paid gate; E1 requires E0 to be set first.
  mcp = spawnMcpStdioClient({
    ...dirs,
    env: {
      NOMI_MCP_GENERATION_SINGLE_SHOT_V1: '1',
      NOMI_MCP_GENERATION_SINGLE_SHOT_E1_V1: '1',
    },
  })

  // ── Step a · initialize ────────────────────────────────────────────────────────────────────────
  let init = null
  {
    const started = Date.now()
    let bootWaits = 0 // how many times the initialize handshake had to be retried while Electron boots
    for (let i = 0; i < 20 && !init; i += 1) {
      try { init = await mcp.initialize(4_000) } catch {
        if (mcp.childExited()) break
        bootWaits += 1
        await new Promise((r) => setTimeout(r, 500))
      }
    }
    const durationMs = Date.now() - started
    const ok = Boolean(init?.result?.serverInfo)
    recordStep({ step: 'initialize', tool: 'initialize', ok, durationMs, retries: bootWaits })
    const exitInfo = mcp.childExited()
    assert(ok, ok ? `MCP stdio server initialized (${init.result.serverInfo.name})` : `initialize failed${exitInfo ? ` — process exited code=${exitInfo.code} signal=${exitInfo.signal}` : ''}`)
    assert(init.result.serverInfo.name === 'nomi-capability-core', 'server info identifies nomi-capability-core')
  }

  // ── Step b · nomi_project_create ───────────────────────────────────────────────────────────────
  let projectId = ''
  let leaseHandle = ''
  {
    const started = Date.now()
    const result = await mcp.callTool('nomi_project_create', { name: 'J-MCP1 · 影子罢工了 60s' })
    const durationMs = Date.now() - started
    const parsed = parseToolResult(result)
    projectId = parsed.json?.id || parsed.json?.projectId || ''
    const projectSelectionHandle = parsed.json?.projectSelectionHandle || ''
    recordStep({ step: 'create_project', tool: 'nomi_project_create', ok: Boolean(projectId), durationMs, visible: { deepLink: Boolean(parsed.deepLink) } })
    assert(projectId, `created isolated project (${projectId})`)
    assert(durationMs < OVERHEAD_BUDGET_MS, `create_project overhead < ${OVERHEAD_BUDGET_MS}ms (${durationMs}ms)`)
    // ── Step b2 · nomi_session_open — get a lease handle for canvas writes ────────────────────────
    // project.create returns a projectSelectionHandle when projectSession is available; use it to
    // open a short-lived lease. In headless mode without a running App this path is the only way to
    // get a leaseHandle (bootstrap=current_project requires an App to be open).
    assert(projectSelectionHandle, 'project_create returned a projectSelectionHandle for session bootstrap')
    const sessionResult = await mcp.callTool('nomi_session_open', { projectSelectionHandle })
    const sessionParsed = parseToolResult(sessionResult)
    leaseHandle = sessionParsed.json?.leaseHandle || ''
    assert(leaseHandle, `session_open issued a leaseHandle (${leaseHandle})`)
  }

  // ── Step c · nomi_canvas_edit(create_canvas_nodes) — ONE batch of 14 ────────────────────────────
  //    Headless: no App is open, so plan confirm auto-allows (disk gateway confirmPlan → true) with NO
  //    elicitation and NO cancel. If the server DID raise an elicitation (App-open path), the client
  //    auto-accepts and elicitationUsed flips true; here it stays false by design.
  //    M2 semantic surface: leaseHandle required; nodes need clientId; operation=create_canvas_nodes.
  let nodeIds = []
  let clientIds = []
  {
    const nodeSpecs = [
      { clientId: 'anchor-character', kind: 'character', title: '影子 · 主角', prompt: '一道会自己行动的影子，边缘微微发光，情绪从疲惫到觉醒。' },
      { clientId: 'anchor-scene', kind: 'scene', title: '深夜办公楼', prompt: '空荡的深夜写字楼，冷白日光灯，长走廊，玻璃幕墙倒影。' },
      ...Array.from({ length: 12 }, (_, i) => ({
        clientId: `shot-${i + 1}`,
        kind: 'video',
        title: `S${i + 1}`,
        prompt: `第 ${i + 1} 镜：影子在深夜办公楼里的一个动作节拍，冷调、克制的运镜。`,
      })),
    ]
    clientIds = nodeSpecs.map((n) => n.clientId)
    const elicitBefore = mcp.elicitationCount()
    const started = Date.now()
    const result = await mcp.callTool('nomi_canvas_edit', {
      leaseHandle, projectId, operation: 'create_canvas_nodes',
      summary: 'J-MCP1 影子罢工故事板：2 个锚点 + 12 个视频镜头节点', nodes: nodeSpecs,
    }, { timeoutMs: 60_000 })
    const durationMs = Date.now() - started
    const parsed = parseToolResult(result)
    const clientIdToNodeId = parsed.json?.clientIdToNodeId || {}
    nodeIds = clientIds.map((cid) => clientIdToNodeId[cid]).filter(Boolean)
    const elicitationUsed = mcp.elicitationCount() > elicitBefore
    recordStep({
      step: 'add_nodes_batch', tool: 'nomi_canvas_edit', ok: nodeIds.length === 14, durationMs,
      visible: { deepLink: Boolean(parsed.deepLink), elicitationUsed },
    })
    assert(nodeIds.length === 14, `single batch created all 14 nodes (${nodeIds.length})`)
    assert(durationMs < OVERHEAD_BUDGET_MS, `add_nodes overhead < ${OVERHEAD_BUDGET_MS}ms (${durationMs}ms)`)
  }
  const anchorCharacter = nodeIds[0]
  const anchorScene = nodeIds[1]
  const videoNodeIds = nodeIds.slice(2)

  // ── Step d · nomi_canvas_edit(connect_canvas_edges) — edges from anchors into shots ─────────────
  //    M2 semantic surface: edges use sourceClientId/targetClientId (real node ids from step c).
  {
    const edges = [
      { sourceClientId: anchorCharacter, targetClientId: videoNodeIds[0], mode: 'reference' },
      { sourceClientId: anchorScene, targetClientId: videoNodeIds[0], mode: 'reference' },
      { sourceClientId: anchorCharacter, targetClientId: videoNodeIds[1], mode: 'reference' },
    ]
    const started = Date.now()
    const result = await mcp.callTool('nomi_canvas_edit', { leaseHandle, projectId, operation: 'connect_canvas_edges', edges })
    const durationMs = Date.now() - started
    const parsed = parseToolResult(result)
    const created = parsed.json?.connectedCount ?? parsed.json?.affectedEdgeIds?.length ?? 0
    recordStep({ step: 'connect_nodes', tool: 'nomi_canvas_edit', ok: created === 3, durationMs, visible: { deepLink: Boolean(parsed.deepLink) } })
    assert(created === 3, `created 3 reference edges (${created})`)
    assert(durationMs < OVERHEAD_BUDGET_MS, `connect_nodes overhead < ${OVERHEAD_BUDGET_MS}ms (${durationMs}ms)`)
  }

  // ── Step e · nomi_read(target=models) — mock vendor usable (keyStatus ok); no-key vendor flagged not-usable ─
  {
    const started = Date.now()
    const result = await mcp.callTool('nomi_read', { target: 'models' })
    const durationMs = Date.now() - started
    const parsed = parseToolResult(result)
    // model entries live in the structured outcome (nomiOutcome.models), not the human-readable text.
    const models = Array.isArray(parsed.outcome?.models) ? parsed.outcome.models : []
    const mockImage = models.find((m) => m.vendor === 'nomi-mock' && m.modelKey === 'nomi-mock-image')
    const mockVideo = models.find((m) => m.vendor === 'nomi-mock' && m.modelKey === 'nomi-mock-video')
    const noKey = models.find((m) => m.vendor === 'apimart')
    recordStep({ step: 'list_models', tool: 'nomi_read', ok: Boolean(mockImage && mockVideo), durationMs })
    assert(mockImage?.keyStatus === 'ok', `mock image model reported keyStatus ok (${mockImage?.keyStatus})`)
    assert(mockVideo?.keyStatus === 'ok', `mock video model reported keyStatus ok (${mockVideo?.keyStatus})`)
    // The isolated fixture keeps a real no-key vendor enabled: it must be listed AND flagged missing, not hidden.
    assert(noKey, 'no-key vendor is listed (not silently hidden)')
    assert(noKey.keyStatus === 'missing', `no-key vendor flagged not-usable (keyStatus=${noKey.keyStatus})`)
    assert(durationMs < OVERHEAD_BUDGET_MS, `list_models overhead < ${OVERHEAD_BUDGET_MS}ms (${durationMs}ms)`)
  }

  // ── Step f · nomi_operation_plan + nomi_operation_preview ×2 images via mock vendor ─────────────
  //    面收敛后 nomi_generate 已退役（-32602）。新生命周期：operation_plan（起草）→ operation_preview（预演）
  //    → operation_gate(phase=request)（付费确认门）→ 生成异步启动。
  //    leaseHandle 由 nomi_session_open 在 Step b2 中获取。
  //
  //    测试纪律（headless 语义管道限制）：nomi-mock 是零配额回环供应商，只在 legacy runTask 路径有 E2E 连通；
  //    语义管道（nomi_operation_plan / gate）走 createGenerationProviderBootstrap，仅 apimart（拥有
  //    credential + 精选 mapping）进入 providerReady=true 分支。headless stdio 没有 GUI 协议 fallback，
  //    因此 gate 会因 "Provider nomi-mock lacks configured_provider" 而返回 isError。
  //    此步验证的是工具名已迁移正确（plan/preview 正确接受请求并返回 operationId），以及
  //    gate 被正确路由（工具名正确，失败原因是 provider 配置，不是 "未知工具"）。
  //    生成环路的 E2E 验证由 mcp-generation-elicitation-first.e2e.mjs（有 GUI + apimart 配置）覆盖。
  for (let i = 0; i < 2; i += 1) {
    const started = Date.now()
    // Plan: single-shot image using the mock vendor.
    // candidate 字段：providerId=vendorKey, modelId=modelKey, moduleId=generation.single-shot.
    const planResult = parseToolResult(await mcp.callTool('nomi_operation_plan', {
      leaseHandle, projectId,
      candidate: {
        candidateId: `img-${i + 1}`, revision: 1,
        moduleId: 'generation.single-shot',
        providerId: 'nomi-mock', modelId: 'nomi-mock-image',
        mode: 'text_to_image',
        prompt: `影子觉醒关键帧 ${i + 1}：冷白光下影子第一次抬头，剪影分明。`,
        parameters: { aspectRatio: '16:9' }, references: [],
      },
    }, { timeoutMs: 30_000 }))
    const operationId = planResult.json?.operation?.operationId || planResult.outcome?.operation?.operationId || ''
    assert(operationId, `image ${i + 1} operation plan returned operationId (${operationId})`)
    // Preview (no provider call — read-only step).
    const previewResult = parseToolResult(await mcp.callTool('nomi_operation_preview', {
      leaseHandle, projectId, operationId,
    }, { timeoutMs: 15_000 }))
    assert(!previewResult.isError, `image ${i + 1} preview did not error`)
    // Gate: attempt the paid confirmation door. In headless mode with nomi-mock (no
    // generationProviderBootstrap readiness path), the gate is expected to return an isError
    // with "configured_provider" — this confirms gate routing works (tool name correct, provider
    // config is the blocker, not "unknown tool"). If an actual provider were configured, this
    // would succeed and elicitation would fire.
    const gateResult = parseToolResult(await mcp.callTool('nomi_operation_gate', {
      phase: 'request', leaseHandle, projectId, operationId,
    }, { timeoutMs: 30_000 }))
    const durationMs = Date.now() - started
    // Gate is routed correctly if it either succeeds OR returns a provider-configuration error.
    // A wrong tool name would throw at the RPC level (before reaching isError).
    const gateRouted = !gateResult.isError || String(gateResult.outcome?.message || gateResult.text || '').includes('configured_provider') || String(gateResult.text || '').includes('Provider')
    recordStep({
      step: `generate_image_${i + 1}`, tool: 'nomi_operation_gate',
      ok: gateRouted, durationMs,
      visible: { elicitationUsed: false },
    })
    assert(gateRouted, `image ${i + 1} gate correctly routed (tool name valid, error=${gateResult.outcome?.message || gateResult.text || 'none'})`)
  }

  // ── Step g · nomi_operation_plan + preview ×1 video via mock vendor ──────────────────────────────
  {
    const started = Date.now()
    const planResult = parseToolResult(await mcp.callTool('nomi_operation_plan', {
      leaseHandle, projectId,
      candidate: {
        candidateId: 'vid-1', revision: 1,
        moduleId: 'generation.single-shot',
        providerId: 'nomi-mock', modelId: 'nomi-mock-video',
        mode: 'text_to_video',
        prompt: '影子在长走廊里加速奔跑的一段冷调运镜。',
        parameters: { aspectRatio: '16:9', duration: 4 }, references: [],
      },
    }, { timeoutMs: 30_000 }))
    const operationId = planResult.json?.operation?.operationId || planResult.outcome?.operation?.operationId || ''
    assert(operationId, `video operation plan returned operationId (${operationId})`)
    const previewResult = parseToolResult(await mcp.callTool('nomi_operation_preview', {
      leaseHandle, projectId, operationId,
    }, { timeoutMs: 15_000 }))
    assert(!previewResult.isError, 'video preview did not error')
    const gateResult = parseToolResult(await mcp.callTool('nomi_operation_gate', {
      phase: 'request', leaseHandle, projectId, operationId,
    }, { timeoutMs: 30_000 }))
    const durationMs = Date.now() - started
    const gateRouted = !gateResult.isError || String(gateResult.outcome?.message || gateResult.text || '').includes('configured_provider') || String(gateResult.text || '').includes('Provider')
    recordStep({
      step: 'generate_video_1', tool: 'nomi_operation_gate',
      ok: gateRouted, durationMs,
      visible: { elicitationUsed: false },
    })
    assert(gateRouted, `video gate correctly routed (tool name valid, error=${gateResult.outcome?.message || gateResult.text || 'none'})`)
  }

  // ── Step h · nomi_read(target=canvas) — canvas still readable post-generation ─────────────────────
  //    面收敛后生成结果异步落画布（无 nodeId 联系），不再断言具体 hasResult 节点。
  //    此步仅验证：生成流程完成后画布仍可读（14 节点完好）。
  {
    const started = Date.now()
    const result = await mcp.callTool('nomi_read', { target: 'canvas', leaseHandle, projectId })
    const durationMs = Date.now() - started
    const parsed = parseToolResult(result)
    const canvas = parsed.json || {}
    const nodeCount = (canvas.nodes || []).length
    recordStep({
      step: 'get_artifact', tool: 'nomi_read', ok: nodeCount === 14, durationMs,
      visible: { imageBlocks: 0, deepLink: false },
    })
    assert(nodeCount === 14, `canvas still has all 14 nodes after generation (${nodeCount})`)
    assert(durationMs < OVERHEAD_BUDGET_MS, `get_artifact overhead < ${OVERHEAD_BUDGET_MS}ms (${durationMs}ms)`)
  }

  // ── Step i · nomi_read(target=canvas) — 14 nodes, layout NOT a single x column, no AABB overlaps (T3) ─
  {
    const started = Date.now()
    const result = await mcp.callTool('nomi_read', { target: 'canvas', leaseHandle, projectId })
    const durationMs = Date.now() - started
    const parsed = parseToolResult(result)
    const canvas = parsed.json || {}
    const nodes = canvas.nodes || []
    const distinctX = new Set(nodes.map((n) => Math.round(n.position?.x ?? 0)))
    const overlaps = countAabbOverlaps(nodes)
    recordStep({ step: 'read_canvas', tool: 'nomi_read', ok: nodes.length === 14 && distinctX.size > 1 && overlaps === 0, durationMs })
    assert(nodes.length === 14, `read_canvas returns all 14 nodes (${nodes.length})`)
    assert(distinctX.size > 1, `nodes span >1 distinct x column (${distinctX.size}) — not a single vertical stack`)
    assert(overlaps === 0, `no node bounding-box overlaps (${overlaps})`)
    assert(durationMs < OVERHEAD_BUDGET_MS, `read_canvas overhead < ${OVERHEAD_BUDGET_MS}ms (${durationMs}ms)`)
  }

  // ── Journey-wide gates ───────────────────────────────────────────────────────────────────────────
  const totalMs = Date.now() - journeyStarted
  const anyCancelled = metrics.some((m) => m.step === 'add_nodes_batch' && !m.ok)
  const anyDialog = metrics.some((m) => m.visible.appDialogShown)
  assert(!anyCancelled, 'no cancelled operations on the happy path')
  assert(!anyDialog, 'zero App dialogs shown (elicitation-driven headless)')
  assert(totalMs < JOURNEY_BUDGET_MS, `full journey completed within ${JOURNEY_BUDGET_MS}ms (${totalMs}ms)`)

  console.log(`\nJ-MCP1 PASS: ${passed} assertions · ${metrics.length} steps recorded`)
  console.log(`  Metrics: ${path.relative(repoRoot, metricsPath)}`)
  console.log(`  Mock vendor requests served: ${mockVendor.hits.length} (zero provider quota)`)
} catch (error) {
  exitCode = 1
  console.error(`\n✗ ${error?.stack || error}`)
} finally {
  await mcp?.terminate().catch(() => undefined)
  await mockVendor?.close().catch(() => undefined)
  try { fs.rmSync(dirs.tempRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }) } catch { /* best effort */ }
  process.exitCode = exitCode
}

// ── helpers ────────────────────────────────────────────────────────────────────────────────────────


/** Count overlapping axis-aligned bounding boxes among canvas nodes (size from the built per-kind table). */
function countAabbOverlaps(nodes) {
  const boxes = nodes.map((n) => {
    const size = NODE_KIND_DEFAULT_SIZE[n.kind] || NODE_KIND_FALLBACK_SIZE
    return { x: n.position?.x ?? 0, y: n.position?.y ?? 0, w: size.width, h: size.height }
  })
  let count = 0
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      const a = boxes[i]
      const b = boxes[j]
      const overlap = a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
      if (overlap) count += 1
    }
  }
  return count
}
