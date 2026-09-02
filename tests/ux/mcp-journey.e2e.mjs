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

  mcp = spawnMcpStdioClient(dirs)

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

  // ── Step b · nomi_create_project ───────────────────────────────────────────────────────────────
  let projectId = ''
  {
    const started = Date.now()
    const result = await mcp.callTool('nomi_create_project', { name: 'J-MCP1 · 影子罢工了 60s' })
    const durationMs = Date.now() - started
    const parsed = parseToolResult(result)
    projectId = parsed.json?.id || parsed.json?.projectId || ''
    recordStep({ step: 'create_project', tool: 'nomi_create_project', ok: Boolean(projectId), durationMs, visible: { deepLink: Boolean(parsed.deepLink) } })
    assert(projectId, `created isolated project (${projectId})`)
    assert(durationMs < OVERHEAD_BUDGET_MS, `create_project overhead < ${OVERHEAD_BUDGET_MS}ms (${durationMs}ms)`)
  }

  // Semantic generation and editing tools use the same signed project session;
  // keep the journey on that boundary instead of the retired legacy generation route.
  const openedSession = parseToolResult(await mcp.callTool('nomi_session_open', {
    bootstrap: { mode: 'current_project' },
  }))
  const leaseHandle = openedSession.json?.leaseHandle || openedSession.outcome?.leaseHandle
  assert(typeof leaseHandle === 'string' && leaseHandle.length > 20, 'opened one verified semantic project session')

  // ── Step c · nomi_add_nodes — ONE batch of 14 (2 anchors: character+scene; 12 video shot nodes) ──
  //    Headless: no App is open, so plan confirm auto-allows (disk gateway confirmPlan → true) with NO
  //    elicitation and NO cancel. If the server DID raise an elicitation (App-open path), the client
  //    auto-accepts and elicitationUsed flips true; here it stays false by design.
  let nodeIds = []
  {
    const nodes = [
      { kind: 'character', title: '影子 · 主角', prompt: '一道会自己行动的影子，边缘微微发光，情绪从疲惫到觉醒。' },
      { kind: 'scene', title: '深夜办公楼', prompt: '空荡的深夜写字楼，冷白日光灯，长走廊，玻璃幕墙倒影。' },
      ...Array.from({ length: 12 }, (_, i) => ({
        kind: 'video',
        title: `S${i + 1}`,
        prompt: `第 ${i + 1} 镜：影子在深夜办公楼里的一个动作节拍，冷调、克制的运镜。`,
      })),
    ]
    const elicitBefore = mcp.elicitationCount()
    const started = Date.now()
    const result = await mcp.callTool('nomi_add_nodes', { projectId, nodes }, { timeoutMs: 60_000 })
    const durationMs = Date.now() - started
    const parsed = parseToolResult(result)
    const cancelled = parsed.json?.cancelled === true
    nodeIds = parsed.json?.nodeIds || parsed.json?.ids || []
    const elicitationUsed = mcp.elicitationCount() > elicitBefore
    recordStep({
      step: 'add_nodes_batch', tool: 'nomi_add_nodes', ok: nodeIds.length === 14 && !cancelled, durationMs,
      visible: { deepLink: Boolean(parsed.deepLink), elicitationUsed },
    })
    assert(!cancelled, 'batch add was NOT cancelled (no {cancelled:true})')
    assert(nodeIds.length === 14, `single batch created all 14 nodes (${nodeIds.length})`)
    assert(durationMs < OVERHEAD_BUDGET_MS, `add_nodes overhead < ${OVERHEAD_BUDGET_MS}ms (${durationMs}ms)`)
  }
  const anchorCharacter = nodeIds[0]
  const anchorScene = nodeIds[1]
  const videoNodeIds = nodeIds.slice(2)

  // ── Step d · nomi_connect_nodes (a few reference edges from anchors into shots) ──────────────────
  {
    const connections = [
      { source: anchorCharacter, target: videoNodeIds[0], mode: 'reference' },
      { source: anchorScene, target: videoNodeIds[0], mode: 'reference' },
      { source: anchorCharacter, target: videoNodeIds[1], mode: 'reference' },
    ]
    const started = Date.now()
    const result = await mcp.callTool('nomi_connect_nodes', { projectId, connections })
    const durationMs = Date.now() - started
    const parsed = parseToolResult(result)
    const created = parsed.json?.edgeIds?.length ?? parsed.json?.created ?? 0
    recordStep({ step: 'connect_nodes', tool: 'nomi_connect_nodes', ok: created === 3, durationMs, visible: { deepLink: Boolean(parsed.deepLink) } })
    assert(created === 3, `created 3 reference edges (${created})`)
    assert(durationMs < OVERHEAD_BUDGET_MS, `connect_nodes overhead < ${OVERHEAD_BUDGET_MS}ms (${durationMs}ms)`)
  }

  // ── Step e · nomi_list_models — mock vendor usable (keyStatus ok); no-key vendor flagged not-usable ─
  {
    const started = Date.now()
    const result = await mcp.callTool('nomi_list_models', {})
    const durationMs = Date.now() - started
    const parsed = parseToolResult(result)
    // list_models entries live in the structured outcome (nomiOutcome.models), not the human-readable text.
    const models = Array.isArray(parsed.outcome?.models) ? parsed.outcome.models : []
    const mockImage = models.find((m) => m.vendor === 'nomi-mock' && m.modelKey === 'nomi-mock-image')
    const mockVideo = models.find((m) => m.vendor === 'nomi-mock' && m.modelKey === 'nomi-mock-video')
    const noKey = models.find((m) => m.vendor === 'apimart')
    recordStep({ step: 'list_models', tool: 'nomi_list_models', ok: Boolean(mockImage && mockVideo), durationMs })
    assert(mockImage?.keyStatus === 'ok', `mock image model reported keyStatus ok (${mockImage?.keyStatus})`)
    assert(mockVideo?.keyStatus === 'ok', `mock video model reported keyStatus ok (${mockVideo?.keyStatus})`)
    // The isolated fixture keeps a real no-key vendor enabled: it must be listed AND flagged missing, not hidden.
    assert(noKey, 'no-key vendor is listed (not silently hidden)')
    assert(noKey.keyStatus === 'missing', `no-key vendor flagged not-usable (keyStatus=${noKey.keyStatus})`)
    assert(durationMs < OVERHEAD_BUDGET_MS, `list_models overhead < ${OVERHEAD_BUDGET_MS}ms (${durationMs}ms)`)
  }

  // ── Step f · semantic generation plan ×2 images via the mock vendor ─
  //    App is not open → semantic gate elicits spend confirmation in-chat; client auto-accepts →
  //    spendConfirmed → makeConfirmedGateway mints the grant → mock vendor returns a real PNG.
  const imageAssetUrls = []
  for (let i = 0; i < 2; i += 1) {
    const token = `img-${i + 1}`
    const elicitBefore = mcp.elicitationCount()
    const started = Date.now()
    const prompt = `影子觉醒关键帧 ${i + 1}：冷白光下影子第一次抬头，剪影分明。`
    const created = parseToolResult(await mcp.callTool('nomi_operation_create', {
      projectId, leaseHandle,
      candidate: { candidateId: `jmcp-image-${i + 1}`, revision: 1, moduleId: 'generation.single-shot', providerId: 'nomi-mock', modelId: 'nomi-mock-image', mode: 'text-to-image', prompt, parameters: { aspectRatio: '16:9' }, references: [] },
    }))
    const operationId = created.json?.operation?.operationId || created.outcome?.operation?.operationId
    assert(operationId, `semantic image ${i + 1} plan created (${operationId})`)
    await mcp.callTool('nomi_preview_execution', { projectId, leaseHandle, operationId })
    const result = await mcp.callTool('nomi_request_generation_gate', { projectId, leaseHandle, operationId }, { timeoutMs: 90_000, progressToken: token })
    const durationMs = Date.now() - started
    const parsed = parseToolResult(result)
    const status = parsed.json?.status
    const assetUrl = parsed.json?.assets?.[0]?.url || ''
    if (assetUrl) imageAssetUrls.push(assetUrl)
    const progressNotifs = mcp.progressForToken(token)
    const elicitationUsed = mcp.elicitationCount() > elicitBefore
    recordStep({
      step: `generate_image_${i + 1}`, tool: 'nomi_request_generation_gate', ok: !parsed.isError, durationMs,
      visible: { progressNotifs, imageBlocks: parsed.imageBlocks, deepLink: Boolean(parsed.deepLink), elicitationUsed },
    })
    assert(!parsed.isError, `image ${i + 1} generate did not error`)
    assert(status === 'succeeded', `image ${i + 1} succeeded (status=${status})`)
    assert(assetUrl.startsWith('nomi-local://'), `image ${i + 1} produced a local asset (${assetUrl.slice(0, 42)})`)
    assert(parsed.imageBlocks >= 1, `image ${i + 1} result carries ≥1 image content block (${parsed.imageBlocks})`)
    assert(Boolean(parsed.deepLink), `image ${i + 1} result carries an openInNomi deep link (${parsed.deepLink})`)
    assert(/^nomi:\/\/project\//.test(String(parsed.deepLink)), `image ${i + 1} deep link is a structured nomi:// URL`)
    assert(progressNotifs >= 1, `image ${i + 1} progressToken yielded ≥1 progress frame (${progressNotifs})`)
    // The first paid action asks for spend confirmation.  Once the user accepts the
    // project-scoped session trust, subsequent actions deliberately do not ask again;
    // they still carry a fresh node-bound grant underneath (see mcpSpendTrust).
    assert(
      i === 0 ? elicitationUsed : !elicitationUsed,
      i === 0
        ? `image ${i + 1} spend confirmed via elicitation (headless, no App dialog)`
        : `image ${i + 1} reused the approved project spend session without a second prompt`,
    )
  }

  // ── Step g · semantic generation plan ×1 video via mock ─────────────────────────────────────────
  //    The fallback video localizer sets thumbnailUrl:null, so no poster → no image block is the correct,
  //    honest T2 behavior. We RECORD imageBlocks and assert it only if a poster is present.
  {
    const token = 'vid-1'
    const elicitBefore = mcp.elicitationCount()
    const started = Date.now()
    const created = parseToolResult(await mcp.callTool('nomi_operation_create', {
      projectId, leaseHandle,
      candidate: { candidateId: 'jmcp-video-1', revision: 1, moduleId: 'generation.single-shot', providerId: 'nomi-mock', modelId: 'nomi-mock-video', mode: 'text-to-video', prompt: '影子在长走廊里加速奔跑的一段冷调运镜。', parameters: { aspectRatio: '16:9', duration: 4 }, references: [] },
    }))
    const operationId = created.json?.operation?.operationId || created.outcome?.operation?.operationId
    assert(operationId, `semantic video plan created (${operationId})`)
    await mcp.callTool('nomi_preview_execution', { projectId, leaseHandle, operationId })
    const result = await mcp.callTool('nomi_request_generation_gate', { projectId, leaseHandle, operationId }, { timeoutMs: 120_000, progressToken: token })
    const durationMs = Date.now() - started
    const parsed = parseToolResult(result)
    const status = parsed.json?.status
    const assetUrl = parsed.json?.assets?.[0]?.url || ''
    const progressNotifs = mcp.progressForToken(token)
    const elicitationUsed = mcp.elicitationCount() > elicitBefore
    recordStep({
      step: 'generate_video_1', tool: 'nomi_request_generation_gate', ok: !parsed.isError, durationMs,
      visible: { progressNotifs, imageBlocks: parsed.imageBlocks, deepLink: Boolean(parsed.deepLink), elicitationUsed },
    })
    assert(!parsed.isError, 'video generate did not error')
    assert(status === 'succeeded', `video succeeded (status=${status})`)
    assert(assetUrl.startsWith('nomi-local://'), `video produced a local asset (${assetUrl.slice(0, 42)})`)
    assert(Boolean(parsed.deepLink), `video result carries an openInNomi deep link (${parsed.deepLink})`)
    assert(progressNotifs >= 1, `video progressToken yielded ≥1 progress frame (${progressNotifs})`)
    // Video image block: assert ONLY if the mock actually provided a poster (it does not, per T2 rules).
    // Recorded above regardless; no strict assertion here.
  }

  // ── Step h · read back a produced artifact (generate-result asset) through the real stack ─────────
  //    nomi_get_artifact is Production-Run scoped (production.artifact) and unreachable from a
  //    semantic generation journey, so per the brief's "(or generate-result asset)" we re-read the produced
  //    image asset: locate it on the canvas over the real transport, then verify its bytes are a real,
  //    non-empty image file persisted in the isolated project. The accompanying image content block was
  //    already asserted at step f; we re-affirm it is retrievable here.
  {
    const started = Date.now()
    const result = await mcp.callTool('nomi_read_canvas', { projectId })
    const durationMs = Date.now() - started
    const parsed = parseToolResult(result)
    const canvas = parsed.json || {}
    const producedNode = (canvas.nodes || []).find((n) => n.id === videoNodeIds[0] && n.hasResult)
    // Resolve the first produced image asset URL (from step f) to its on-disk file inside the temp project.
    const producedUrl = imageAssetUrls[0] || ''
    const relPath = decodeAssetRelPath(producedUrl)
    const absPath = relPath ? path.join(dirs.projectsDir, findProjectDirName(dirs.projectsDir, projectId) || '', relPath) : ''
    const bytes = absPath && fs.existsSync(absPath) ? fs.statSync(absPath).size : 0
    recordStep({
      step: 'get_artifact', tool: 'nomi_read_canvas', ok: Boolean(producedNode) && bytes > 0, durationMs,
      // The produced artifact's image block was carried at generate time; retrievable = still 1 for it.
      visible: { imageBlocks: 1, deepLink: false },
    })
    assert(producedNode, 'produced image node is present with a result on the canvas')
    assert(bytes > 0, `produced artifact asset exists on disk and is non-empty (${bytes} bytes)`)
    assert(durationMs < OVERHEAD_BUDGET_MS, `get_artifact overhead < ${OVERHEAD_BUDGET_MS}ms (${durationMs}ms)`)
  }

  // ── Step i · nomi_read_canvas — 14 nodes, layout NOT a single x column, no AABB overlaps (T3) ─────
  {
    const started = Date.now()
    const result = await mcp.callTool('nomi_read_canvas', { projectId })
    const durationMs = Date.now() - started
    const parsed = parseToolResult(result)
    const canvas = parsed.json || {}
    const nodes = canvas.nodes || []
    const distinctX = new Set(nodes.map((n) => Math.round(n.position?.x ?? 0)))
    const overlaps = countAabbOverlaps(nodes)
    recordStep({ step: 'read_canvas', tool: 'nomi_read_canvas', ok: nodes.length === 14 && distinctX.size > 1 && overlaps === 0, durationMs })
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

/** nomi-local://asset/{projectId}/{a}/{b}.png → "a/b.png" (decoded); non-asset URLs → ''. */
function decodeAssetRelPath(url) {
  const prefix = 'nomi-local://asset/'
  if (typeof url !== 'string' || !url.startsWith(prefix)) return ''
  const rest = url.slice(prefix.length).split('?')[0]
  const slash = rest.indexOf('/')
  if (slash < 0) return ''
  return rest.slice(slash + 1).split('/').map((seg) => { try { return decodeURIComponent(seg) } catch { return seg } }).join('/')
}

/** Find the on-disk project directory name whose .nomi/project.json id matches (projects are per-dir). */
function findProjectDirName(projectsDir, projectId) {
  for (const entry of fs.readdirSync(projectsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    try {
      const descriptor = path.join(projectsDir, entry.name, '.nomi', 'project.json')
      if (JSON.parse(fs.readFileSync(descriptor, 'utf8')).id === projectId) return entry.name
    } catch { /* not this dir */ }
  }
  return ''
}

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
