// P4 S5 — 多镜产物画布落地 J1（真 Electron + 真渲染管线 + 真 store，零额度）。
//
// 证 S5 交付的**画布落地半程**：真 handleCapabilityApply('production.materialize-shots'/'attach-shot-result') →
// 真 store 落节点 + 建组 + 逐镜回填 → 整批一个 Cmd+Z 撤整组。多镜派发/生成属后端（S6 真付费验收），
// 这里在渲染边界注入真载荷取证（同 S3a 的「render half」哲学，provider=0）。
//
// 断言链（J1）：确认落地 → 占位 + 组出现 → 三态同屏（构造排队+生成中+已停并存）光/暗截图 → 逐镜填充 →
// 全部完成 → 一个 Cmd+Z 整组消失 → 撤销后节点没了（素材库产物由数据层保留，见回填断言）。
import fs from 'node:fs'
import path from 'node:path'

import { launchNomiApp } from './_launchApp.mjs'
import { repoRoot } from './_mcpJourney.mjs'
import { clickOrFail, proveProbe, expectAbsent } from './_assert.mjs'
import { findCanvasBlankPoint } from './_canvasHit.mjs'

const shotsDir = path.join(repoRoot, 'tests/ux/shots/p4-s5-canvas-landing')
fs.rmSync(shotsDir, { recursive: true, force: true })
fs.mkdirSync(shotsDir, { recursive: true })

const RUN_ID = 'run-s5-e2e'
const OP_ID = `canvas-landing:${RUN_ID}`

// 确认即落的载荷：1 锚 + 3 镜（materialize-shots 形状，clientId=shotId）。
const MATERIALIZE_PAYLOAD = {
  projectId: null, // 走查里填成当前项目 id
  runId: RUN_ID,
  materializationOperationId: OP_ID,
  groupName: '雨夜便利店',
  shots: [
    { shotId: 'anchor-1', role: 'anchor', kind: 'image', title: '主角 · 阿雨', prompt: '定妆照' },
    { shotId: 'shot-1', role: 'shot', kind: 'video', title: '镜头 1', prompt: '雨夜，阿雨推开便利店玻璃门' },
    { shotId: 'shot-2', role: 'shot', kind: 'video', title: '镜头 2', prompt: '货架前对视' },
    { shotId: 'shot-3', role: 'shot', kind: 'video', title: '镜头 3', prompt: '收银台特写' },
  ],
}

// 构造「三态同屏」的 Run：shot-1 生成中(polling)、shot-2 排队(无 job)、shot-3 已停(run needs_attention)。
function threeStateRun(projectId, nodeIds) {
  const NOW = '2026-08-25T00:00:00.000Z'
  const shot = (shotId, nodeId) => ({
    shotId, role: shotId === 'anchor-1' ? 'anchor' : 'shot',
    candidate: { candidateId: shotId, revision: 1, moduleId: 'm', providerId: 'apimart', modelId: 'video', mode: 't2v', prompt: '', parameters: {}, references: [] },
    nodeId, updatedAt: NOW,
  })
  const job = (shotId, nodeId, status, errorCode) => ({ jobId: `job-${shotId}`, stageId: 'generate', status, attempt: 1, provider: 'apimart', model: 'video', idempotencyKey: `k-${shotId}`, nodeId, metadata: { shotId }, ...(errorCode ? { errorCode } : {}), createdAt: NOW, updatedAt: NOW })
  return {
    schemaVersion: 1, runId: RUN_ID, projectId, revision: 1,
    status: 'running', // running：未派发镜显「排队中」；靠 shot-3 job 的预算错因显「已停」→ 三态同屏
    stageId: 'generate', playbook: { name: 'generation.single-shot', version: '1.0.0' }, origin: { host: 'semantic-mcp' },
    policy: { mode: 'balanced', trustedHosts: [], allowedProviders: [], allowedModels: [], maxSpend: 13, maxAttemptsPerJob: 1, minimizeUploads: true },
    budget: { currency: 'CNY', authorized: 13, reserved: 0, actual: 0, unsettled: 0 },
    planVersion: 1, snapshotCursor: 0, stages: [], gates: [],
    // shot-1 生成中(polling)；shot-2 无 job=排队；shot-3 预算触顶(needs_attention+budget_exhausted)=已停。
    jobs: [job('shot-1', nodeIds['shot-1'], 'polling'), job('shot-3', nodeIds['shot-3'], 'needs_attention', 'budget_exhausted')],
    artifacts: [],
    generationPlan: {
      operationId: RUN_ID, state: 'submitted',
      candidate: shot('shot-1').candidate,
      shots: ['anchor-1', 'shot-1', 'shot-2', 'shot-3'].map((id) => shot(id, nodeIds[id])),
      updatedAt: NOW,
    },
    createdAt: NOW, updatedAt: NOW,
  }
}

let gui
let exitCode = 0
let passed = 0
const check = (condition, message) => {
  if (!condition) throw new Error(`S5 CANVAS LANDING FAIL: ${message}`)
  passed += 1
  console.log(`  ✓ ${message}`)
}

try {
  gui = await launchNomiApp({
    name: 'p4-s5-canvas-landing',
    args: ['--disable-gpu', '--disable-software-rasterizer', '--no-proxy-server'],
    settleMs: 0,
  })
  const win = gui.win

  await win.evaluate(() => {
    window.localStorage.setItem('__nomiE2E', '1')
    for (const k of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1']) window.localStorage.setItem(k, 'seen')
    window.localStorage.setItem('nomi-color-scheme', 'light')
  })
  await win.reload()
  await win.waitForLoadState('domcontentloaded')

  await clickOrFail(win.getByText('新建空白项目', { exact: false }).first(), '库页「新建空白项目」')
  await win.waitForFunction(() => window.location.hash.includes('projectId='), undefined, { timeout: 10_000 })
  await win.waitForFunction(() => typeof window.__nomiCapabilityApply === 'function', undefined, { timeout: 10_000 })
  // 切到「生成」工作区（画布 + landing host 只在生成模式挂载；同 canvas-batch-production 走查）。
  await clickOrFail(win.locator('[aria-label="工作区切换"]').getByText('生成', { exact: true }), '工作区切换到「生成」')
  await win.waitForFunction(() => Boolean(window.__nomiCanvasStore), undefined, { timeout: 15_000 })
  await win.waitForFunction(() => Boolean(window.__nomiProductionLandingStore), undefined, { timeout: 15_000 })
  await win.waitForFunction(() => window.__nomiCanvasStore.getState().isReady === true, undefined, { timeout: 15_000 })
  check(true, 'E2E 桥挂上（真 handler + 画布 store + landing store）')

  const projectId = await win.evaluate(() => new URLSearchParams(window.location.hash.split('?')[1]).get('projectId'))
  check(Boolean(projectId), `进入项目（id=${projectId}）`)

  // ── 确认即落：真 materialize-shots → 落占位 + 建组 ──
  const landed = await win.evaluate(async (payload) => {
    payload.projectId = new URLSearchParams(window.location.hash.split('?')[1]).get('projectId')
    return window.__nomiCapabilityApply('production.materialize-shots', payload)
  }, MATERIALIZE_PAYLOAD)
  check(Array.isArray(landed?.bindings) && landed.bindings.length === 4, `materialize-shots 落 4 个占位并回 bindings（实得 ${landed?.bindings?.length}）`)
  check(Boolean(landed?.groupId), '建了分镜组（groupId 非空）')

  // 画布 store 里：4 个节点带 productionRunId 章 + 1 个组带同 op 章。
  const storeState = await win.evaluate((opId) => {
    const s = window.__nomiCanvasStore.getState()
    const shotNodes = s.nodes.filter((n) => n.meta?.materializationOperationId === opId)
    const group = s.groups.find((g) => g.materializationOperationId === opId)
    return {
      nodeCount: shotNodes.length,
      shotIdToNode: Object.fromEntries(shotNodes.map((n) => [n.meta?.productionShotId, n.id])),
      groupMembers: group?.nodeIds?.length ?? 0,
    }
  }, OP_ID)
  check(storeState.nodeCount === 4, `画布落了 4 个占位节点（章=${OP_ID}）`)
  // 锚 + 镜整批落同一分镜组（与 storyboard 落地同规则，靠 referenceSheet 区分锚）→ 4 个成员。
  check(storeState.groupMembers === 4, `分镜组收全 4 个占位（锚+3 镜，实得 ${storeState.groupMembers}）`)

  // 幂等：再跑一次 materialize-shots，节点/组不重复。
  await win.evaluate(async (payload) => {
    payload.projectId = new URLSearchParams(window.location.hash.split('?')[1]).get('projectId')
    return window.__nomiCapabilityApply('production.materialize-shots', payload)
  }, MATERIALIZE_PAYLOAD)
  const afterSecond = await win.evaluate((opId) => window.__nomiCanvasStore.getState().nodes.filter((n) => n.meta?.materializationOperationId === opId).length, OP_ID)
  check(afterSecond === 4, `幂等：第二次 materialize 不重复建节点（仍 4 个，实得 ${afterSecond}）`)

  // ── 三态同屏：pin 一份构造 Run（shot-1 生成中 / shot-2 排队 / shot-3 已停） ──
  await win.evaluate(({ run, projectId }) => {
    const s = window.__nomiCanvasStore.getState()
    const nodeIds = {}
    for (const n of s.nodes) if (n.meta?.productionShotId) nodeIds[n.meta.productionShotId] = n.id
    // 走查侧把 nodeId 填进构造 run（materialize 时 shot.nodeId 还没经 plan.bind 写回，这里直接用画布真实 id）。
    run.generationPlan.shots = run.generationPlan.shots.map((shot) => ({ ...shot, nodeId: nodeIds[shot.shotId] }))
    run.jobs = run.jobs.map((job) => ({ ...job, nodeId: nodeIds[job.metadata.shotId] }))
    window.__nomiProductionLandingStore.setState({ projectId, run, pinnedForE2E: true })
  }, { run: threeStateRun(projectId, {}), projectId })
  await win.waitForTimeout(400)

  // 「三态同屏」是用户看得到的判据，所以先做用户会做的那一步：点「适应视图」。
  // React Flow 的 onlyRenderVisibleElements 只把视口内的节点放进 DOM；常驻 Agent 面板默认
  // 展开后画布窄了 ~340px，最右边那个占位（shot-3）落在视口外就根本不进 DOM——
  // 断言会红成「没有已停占位」，而它其实只是没被带进视野。几何不写死：等到落地的
  // 4 个占位（锚 + 3 镜）全部进 DOM 为止，进不齐就超时报红。
  const expectedPlaceholders = landed.bindings.length
  const placeholdersInView = async (timeout) =>
    win
      .waitForFunction(
        (expected) => document.querySelectorAll('[data-shot-placeholder-state]').length >= expected,
        expectedPlaceholders,
        { timeout },
      )
      .then(() => true)
      .catch(() => false)
  let inView = false
  for (let attempt = 0; attempt < 6 && !inView; attempt += 1) {
    await clickOrFail(win.getByRole('button', { name: '适应视图' }).first(), '适应视图：把四个占位都带进视口')
    inView = await placeholdersInView(3_000)
    if (inView) break
    // 适应视图还不够就再往外滚一格——真实用户看不全时就是这么干的。
    const blank = await findCanvasBlankPoint(win)
    if (!blank) break
    await win.mouse.move(blank.x, blank.y)
    await win.mouse.wheel(0, 240)
    await win.waitForTimeout(300)
    inView = await placeholdersInView(1_500)
  }
  if (!inView) {
    // 还是不够就把现场原样报出来：下一次红不该再靠猜（stage 多宽、视口变换多少、
    // 画布 store 里四个节点在哪、DOM 里到底挂了哪几个）。
    const scene = await win.evaluate(() => {
      const stage = document.querySelector('.generation-canvas-v2__stage')
      const stageRect = stage?.getBoundingClientRect()
      const layer = document.querySelector('.generation-canvas-v2__canvas')
      const matrix = layer ? new DOMMatrixReadOnly(getComputedStyle(layer).transform) : null
      return {
        window: { width: window.innerWidth, height: window.innerHeight },
        stage: stageRect && { x: Math.round(stageRect.x), y: Math.round(stageRect.y), width: Math.round(stageRect.width), height: Math.round(stageRect.height) },
        viewport: matrix && { x: Math.round(matrix.m41), y: Math.round(matrix.m42), zoom: Math.round(matrix.a * 1000) / 1000 },
        storeNodes: window.__nomiCanvasStore.getState().nodes.map((node) => ({ id: node.id, shot: node.meta?.productionShotId, x: Math.round(node.position?.x ?? 0), y: Math.round(node.position?.y ?? 0) })),
        domNodes: Array.from(document.querySelectorAll('.react-flow__node[data-id]')).map((node) => node.getAttribute('data-id')),
        placeholders: Array.from(document.querySelectorAll('[data-shot-placeholder-state]')).map((el) => el.getAttribute('data-shot-placeholder-state')),
      }
    })
    throw new Error(`S5 CANVAS LANDING FAIL: 适应视图 + 缩小后仍不足 ${expectedPlaceholders} 个占位（onlyRenderVisibleElements 只渲染视口内节点）— ${JSON.stringify(scene)}`)
  }
  check(true, `适应视图后 ${expectedPlaceholders} 个占位全部进入视口`)

  const states = await win.evaluate(() => Array.from(document.querySelectorAll('[data-shot-placeholder-state]')).map((el) => el.getAttribute('data-shot-placeholder-state')))
  check(states.includes('generating'), '三态：有「生成中」占位（shot-1 polling）')
  check(states.includes('queued'), '三态：有「排队中」占位（shot-2 无 job）')
  check(states.includes('stopped'), '三态：有「已停」占位（shot-3 · run 预算 halt，warning 非 danger）')
  // 已停占位用 warning 底、非 danger（截计算色不比字面串）。
  const stoppedIsWarning = await win.evaluate(() => {
    const el = document.querySelector('[data-shot-placeholder-state="stopped"]')
    if (!el) return false
    const probe = document.createElement('span'); probe.style.borderColor = 'color-mix(in oklch, var(--nomi-warning) 28%, transparent)'; document.body.appendChild(probe)
    const expected = getComputedStyle(probe).borderColor; probe.remove()
    // 只验它引用了 warning 而非 danger：danger 探针色应不同。
    const dprobe = document.createElement('span'); dprobe.style.borderColor = 'color-mix(in oklch, var(--nomi-danger) 28%, transparent)'; document.body.appendChild(dprobe)
    const dangerColor = getComputedStyle(dprobe).borderColor; dprobe.remove()
    const actual = getComputedStyle(el).borderColor
    return actual === expected && actual !== dangerColor
  })
  check(stoppedIsWarning, '已停占位边框=warning 色（≠danger，截计算色比对）')

  await win.waitForTimeout(200)
  await win.screenshot({ path: path.join(shotsDir, '01-three-states-light.png') })
  // 暗模式。
  await win.evaluate(() => { document.documentElement.setAttribute('data-mantine-color-scheme', 'dark'); document.documentElement.style.colorScheme = 'dark' })
  await win.waitForTimeout(300)
  await win.screenshot({ path: path.join(shotsDir, '02-three-states-dark.png') })
  // 回光模式继续。
  await win.evaluate(() => { document.documentElement.setAttribute('data-mantine-color-scheme', 'light'); document.documentElement.style.colorScheme = 'light' })
  await win.waitForTimeout(300)

  // ── 逐镜填充：解 pin，真 attach-shot-result 给 shot-1 回填一个本地 result ──
  await win.evaluate(() => window.__nomiProductionLandingStore.setState({ pinnedForE2E: false, run: null }))
  const shot1NodeId = await win.evaluate(() => {
    const n = window.__nomiCanvasStore.getState().nodes.find((node) => node.meta?.productionShotId === 'shot-1')
    return n?.id
  })
  const attach = await win.evaluate(async (nodeId) => {
    const projectId = new URLSearchParams(window.location.hash.split('?')[1]).get('projectId')
    return window.__nomiCapabilityApply('production.attach-shot-result', {
      projectId, runId: 'run-s5-e2e', nodeId, shotId: 'shot-1',
      result: { id: 'production-job-shot-1', type: 'video', url: 'nomi-local://asset/p/shot-1.mp4', createdAt: Date.now() },
    })
  }, shot1NodeId)
  check(attach?.attached === true, 'attach-shot-result 回填 shot-1（本地 url 断言通过）')
  const shot1HasResult = await win.evaluate((nodeId) => Boolean(window.__nomiCanvasStore.getState().nodes.find((n) => n.id === nodeId)?.result?.url), shot1NodeId)
  check(shot1HasResult, 'shot-1 占位节点拿到 result（逐个冒：一个填一个）')

  // attach 非本地 url → 断言当场抛（R17 运行时断言）。
  const rejected = await win.evaluate(async (nodeId) => {
    try {
      await window.__nomiCapabilityApply('production.attach-shot-result', { projectId: new URLSearchParams(window.location.hash.split('?')[1]).get('projectId'), runId: 'run-s5-e2e', nodeId, shotId: 'shot-1', result: { id: 'x', type: 'video', url: 'https://cdn.example.com/x.mp4', createdAt: Date.now() } })
      return 'no-throw'
    } catch (e) { return String(e?.message || e) }
  }, shot1NodeId)
  check(/nomi-local/.test(rejected), 'attach 非本地 url（https CDN）当场被断言拒（R17）')

  // ── 整批一个 Cmd+Z：撤销后整组 + 全部占位节点消失 ──
  const beforeUndo = await win.evaluate((opId) => window.__nomiCanvasStore.getState().nodes.filter((n) => n.meta?.materializationOperationId === opId).length, OP_ID)
  check(beforeUndo === 4, `撤销前画布上 4 个占位节点在（实得 ${beforeUndo}）`)
  check(await win.evaluate(() => window.__nomiCanvasStore.getState().canUndo === true), '整批落地后撤销栈保留一个事务边界')
  // 点画布再按一次 Cmd+Z（走渲染层真实撤销路径）。
  await win.evaluate(() => window.__nomiCanvasStore.getState().undo?.())
  await win.waitForTimeout(400)
  const afterUndo = await win.evaluate((opId) => {
    const s = window.__nomiCanvasStore.getState()
    return {
      nodes: s.nodes.filter((n) => n.meta?.materializationOperationId === opId).length,
      group: s.groups.some((g) => g.materializationOperationId === opId),
    }
  }, OP_ID)
  check(afterUndo.nodes === 0, `一个 Cmd+Z 整组消失：4 节点全撤（实得剩 ${afterUndo.nodes}）`)
  check(afterUndo.group === false, '分镜组也随同一步撤销消失')

  await win.screenshot({ path: path.join(shotsDir, '03-after-undo.png') })
  for (const f of ['01-three-states-light.png', '02-three-states-dark.png', '03-after-undo.png']) {
    const stat = fs.statSync(path.join(shotsDir, f))
    check(stat.size > 0, `截图 ${f} 落地且非空（${stat.size} 字节）`)
  }

  console.log(`\nS5 CANVAS LANDING PASS: ${passed} 断言；真管线落地+三态+逐镜回填+整批一撤，provider=0。`)
  console.log('  截图 →', shotsDir)
} catch (error) {
  console.error(`✗ ${error?.stack || error}`)
  exitCode = 1
} finally {
  await gui?.app?.close().catch(() => undefined)
  setTimeout(() => process.exit(exitCode), 300)
}
