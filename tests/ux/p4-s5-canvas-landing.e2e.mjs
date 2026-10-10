// P4 S5 — 多镜产物画布落地 J1（真 Electron + 真渲染管线 + 真 store，零额度）。
//
// 证 S5 交付的**画布落地半程**：真 handleCapabilityApply('production.materialize-shots'/'attach-shot-result') →
// 真 store 落节点 + 建组 + 逐镜回填 → 整批一个 Cmd+Z 撤整组。多镜派发/生成属后端（S6 真付费验收），
// 这里在渲染边界注入真载荷取证（同 S3a 的「render half」哲学，provider=0）。
//
// 断言链（J1）：确认落地 → 占位 + 组出现 → 在跑的批次（排队中 + 生成中 + 还没生成同屏）光/暗截图 →
// 同一批停下（已停，warning 非 danger）→ 逐镜填充 → 全部完成 → 一个 Cmd+Z 整组消失 → 撤销后节点没了
// （素材库产物由数据层保留，见回填断言）。
//
// 2026-09-30：「已停」只读 Run 停下那一刻记下的原因（#934：run.stop），不再从某个 job 的错因码猜；「排队中」只给
// 批过、有任务、还没派出去的镜（没点就不叫排队中）。所以「排队中」和「已停」不会同时出现在同一批上——停着的批次里
// 没有排队的镜。这里按产品真实会出现的两个画面分两步取证，而不是拼一个产品里不存在的 Run。
//
// 2026-09-25：「生成中」不再是一块占位——它写进节点自己的运行记录（materialize-shots 带 generation），
// 由普通生成那张等待画面画；结果回填也走同一条 materialize-shots（专用的 attach-shot-result 已删）。
// 占位只剩制作专属的「排队中 / 已停」。
import fs from 'node:fs'
import path from 'node:path'

import { launchNomiApp } from './_launchApp.mjs'
import { repoRoot } from './_mcpJourney.mjs'
import { DEFAULT_TIMEOUT_MS, clickOrFail, expect, proveProbe, expectAbsent } from './_assert.mjs'
import { findCanvasBlankPoint } from './_canvasHit.mjs'
import { canvasFitViewButton, newProjectEntry } from './_shell.mjs'

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
  planName: '雨夜便利店',
  shots: [
    { shotId: 'anchor-1', role: 'anchor', kind: 'image', title: '主角 · 阿雨', prompt: '定妆照' },
    { shotId: 'shot-1', role: 'shot', kind: 'video', title: '镜头 1', prompt: '雨夜，阿雨推开便利店玻璃门' },
    { shotId: 'shot-2', role: 'shot', kind: 'video', title: '镜头 2', prompt: '货架前对视' },
    { shotId: 'shot-3', role: 'shot', kind: 'video', title: '镜头 3', prompt: '收银台特写' },
  ],
}

// 构造一批在跑 / 停下的 Run：参考卡与 shot-2 批过、还没派出去（authorized）；shot-1 生成中（polling）；shot-3 从没被批过（无 job）。
// running → 参考卡、shot-2「排队中」，shot-3「还没生成」；stopped（按生命周期 owner 的写法记下 run.stop）→ 批过的那两镜「已停」。
function landedRun(projectId, nodeIds, { stopped = false } = {}) {
  const NOW = '2026-08-25T00:00:00.000Z'
  const shot = (shotId, nodeId) => ({
    shotId, role: shotId === 'anchor-1' ? 'anchor' : 'shot',
    candidate: { candidateId: shotId, revision: 1, moduleId: 'm', providerId: 'apimart', modelId: 'video', mode: 't2v', prompt: '', parameters: {}, references: [] },
    nodeId, updatedAt: NOW,
  })
  const job = (shotId, nodeId, status) => ({ jobId: `job-${shotId}`, stageId: 'generate', status, attempt: 1, provider: 'apimart', model: 'video', idempotencyKey: `k-${shotId}`, nodeId, metadata: { shotId }, createdAt: NOW, updatedAt: NOW })
  return {
    schemaVersion: 1, runId: RUN_ID, projectId, revision: 1,
    // 停下的原因只有一个来处：Run 停下那一刻记下的 stop（同意过期 = needs_attention + consent_expired）。
    status: stopped ? 'needs_attention' : 'running',
    ...(stopped ? { stop: { reason: 'consent_expired', at: NOW } } : {}),
    stageId: 'generate', playbook: { name: 'generation.single-shot', version: '1.0.0' }, origin: { host: 'semantic-mcp' },
    policy: { trustedHosts: [], allowedProviders: [], allowedModels: [], maxSpend: 13, maxAttemptsPerJob: 1, minimizeUploads: true },
    budget: { currency: 'CNY', authorized: 13, reserved: 0, actual: 0, unsettled: 0 },
    planVersion: 1, snapshotCursor: 0, stages: [], gates: [],
    jobs: [job('anchor-1', nodeIds['anchor-1'], 'authorized'), job('shot-1', nodeIds['shot-1'], 'polling'), job('shot-2', nodeIds['shot-2'], 'authorized')],
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

  await clickOrFail(newProjectEntry(win), '库页「新建空白项目」')
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

  // ── 在跑的批次：pin 一份构造 Run（参考卡 / shot-2 排队、shot-1 生成中、shot-3 还没生成） ──
  const pinRun = (run) => win.evaluate(({ run, projectId }) => {
    const s = window.__nomiCanvasStore.getState()
    const nodeIds = {}
    for (const n of s.nodes) if (n.meta?.productionShotId) nodeIds[n.meta.productionShotId] = n.id
    // 走查侧把 nodeId 填进构造 run（materialize 时 shot.nodeId 还没经 plan.bind 写回，这里直接用画布真实 id）。
    run.generationPlan.shots = run.generationPlan.shots.map((shot) => ({ ...shot, nodeId: nodeIds[shot.shotId] }))
    run.jobs = run.jobs.map((job) => ({ ...job, nodeId: nodeIds[job.metadata.shotId] }))
    window.__nomiProductionLandingStore.setState({ projectId, runs: { [run.runId]: run }, pinnedForE2E: true })
  }, { run, projectId })
  await pinRun(landedRun(projectId, {}))
  // shot-1 在生成：主进程的落地投影把「生成中」写进节点自己的运行记录（真 handler，只动已有节点）。
  await win.evaluate(async (payload) => {
    payload.projectId = new URLSearchParams(window.location.hash.split('?')[1]).get('projectId')
    return window.__nomiCapabilityApply('production.materialize-shots', {
      ...payload, existingOnly: true,
      shots: payload.shots.map((shot) => shot.shotId === 'shot-1'
        ? { ...shot, generation: { state: 'running', runRecordId: 'production-job-shot-1', startedAt: Date.now() } }
        : shot),
    })
  }, MATERIALIZE_PAYLOAD)
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
        (expected) => document.querySelectorAll('[data-shot-placeholder-state], [data-generating-placement="surface"]').length >= expected,
        expectedPlaceholders,
        { timeout },
      )
      .then(() => true)
      .catch(() => false)
  let inView = false
  for (let attempt = 0; attempt < 6 && !inView; attempt += 1) {
    await clickOrFail(canvasFitViewButton(win), '适应视图：把四个占位都带进视口')
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

  const placeholderStates = () => win.evaluate(() => Object.fromEntries(Array.from(document.querySelectorAll('[data-shot-placeholder-state]'))
    .map((el) => [window.__nomiCanvasStore.getState().nodes.find((node) => node.id === el.getAttribute('data-production-shot-node'))?.meta?.productionShotId, el.getAttribute('data-shot-placeholder-state')])))
  const states = await placeholderStates()
  check(!Object.values(states).includes('generating'), '「生成中」不再是一块制作专属占位（第二套画法已删）')
  const shot1Waiting = await win.evaluate(() => {
    const id = window.__nomiCanvasStore.getState().nodes.find((node) => node.meta?.productionShotId === 'shot-1')?.id
    const el = id ? document.querySelector(`[data-node-id="${id}"]`) : null
    return Boolean(el?.querySelector('[data-generating-placement="surface"]')) && el?.getAttribute('data-status') === 'running'
  })
  check(shot1Waiting, '三态：shot-1 生成中 = 节点自己 running + 普通生成那张等待画面')
  check(states['shot-2'] === 'queued' && states['anchor-1'] === 'queued', `在跑：批过、还没派出去的参考卡与 shot-2「排队中」（实得 ${JSON.stringify(states)}）`)
  check(states['shot-3'] === 'not_generated', `在跑：从没被批过的 shot-3「还没生成」，不说排队（实得 ${states['shot-3']}）`)
  const notGeneratedCopy = await win.evaluate(() => document.querySelector('[data-shot-placeholder-state="not_generated"]')?.textContent?.trim() ?? '')
  check(notGeneratedCopy === '还没生成', `「还没生成」小标文案（实得「${notGeneratedCopy}」）`)

  await win.waitForTimeout(200)
  await win.screenshot({ path: path.join(shotsDir, '01-three-states-light.png') })
  // 暗模式。
  await win.evaluate(() => { document.documentElement.setAttribute('data-mantine-color-scheme', 'dark'); document.documentElement.style.colorScheme = 'dark' })
  await win.waitForTimeout(300)
  await win.screenshot({ path: path.join(shotsDir, '02-three-states-dark.png') })
  // 回光模式继续。
  await win.evaluate(() => { document.documentElement.setAttribute('data-mantine-color-scheme', 'light'); document.documentElement.style.colorScheme = 'light' })
  await win.waitForTimeout(300)

  // ── 同一批停下（同意过期，按生命周期 owner 的写法记下原因）：批过、没派出去的镜「已停」；从没被批过的 shot-3 仍是「还没生成」 ──
  await pinRun(landedRun(projectId, {}, { stopped: true }))
  await expect.poll(async () => (await placeholderStates())['shot-2'], { message: '停下：shot-2 的小标换成「已停」', timeout: DEFAULT_TIMEOUT_MS }).toBe('stopped')
  const stoppedStates = await placeholderStates()
  check(stoppedStates['shot-2'] === 'stopped' && stoppedStates['anchor-1'] === 'stopped', `停下：批过的参考卡与 shot-2「已停」（实得 ${JSON.stringify(stoppedStates)}）`)
  check(stoppedStates['shot-3'] === 'not_generated', `停下：从没被批过的 shot-3 不是「已停」、不挂续拍钮（实得 ${stoppedStates['shot-3']}）`)
  const stopReason = await win.evaluate(() => document.querySelector('[data-shot-placeholder-state="stopped"] [data-shot-stop-reason]')?.getAttribute('data-shot-stop-reason'))
  check(stopReason === 'consent_expired', `已停的原因照 Run 记下的说（实得 ${stopReason}）`)
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
  await win.screenshot({ path: path.join(shotsDir, '01b-stopped-light.png') })

  // ── 逐镜填充：解 pin，真 materialize-shots 给 shot-1 回填一个本地 result ──
  await win.evaluate(() => window.__nomiProductionLandingStore.setState({ pinnedForE2E: false, runs: {} }))
  const shot1NodeId = await win.evaluate(() => {
    const n = window.__nomiCanvasStore.getState().nodes.find((node) => node.meta?.productionShotId === 'shot-1')
    return n?.id
  })
  const attach = await win.evaluate(async (payload) => {
    payload.projectId = new URLSearchParams(window.location.hash.split('?')[1]).get('projectId')
    return window.__nomiCapabilityApply('production.materialize-shots', {
      ...payload, existingOnly: true,
      shots: payload.shots.filter((shot) => shot.shotId === 'shot-1').map((shot) => ({
        ...shot, result: { id: 'production-job-shot-1', type: 'video', url: 'nomi-local://asset/p/shot-1.mp4', createdAt: Date.now() },
      })),
    })
  }, MATERIALIZE_PAYLOAD)
  check(attach?.bindings?.some((binding) => binding.nodeId === shot1NodeId), 'materialize-shots 回填 shot-1（本地 url 断言通过）')
  const shot1HasResult = await win.evaluate((nodeId) => Boolean(window.__nomiCanvasStore.getState().nodes.find((n) => n.id === nodeId)?.result?.url), shot1NodeId)
  check(shot1HasResult, 'shot-1 占位节点拿到 result（逐个冒：一个填一个）')

  // 回填非本地 url → 断言当场抛（R17 运行时断言）。
  const rejected = await win.evaluate(async (payload) => {
    try {
      await window.__nomiCapabilityApply('production.materialize-shots', {
        ...payload, projectId: new URLSearchParams(window.location.hash.split('?')[1]).get('projectId'), existingOnly: true,
        shots: payload.shots.filter((shot) => shot.shotId === 'shot-1').map((shot) => ({ ...shot, result: { id: 'x', type: 'video', url: 'https://cdn.example.com/x.mp4', createdAt: Date.now() } })),
      })
      return 'no-throw'
    } catch (e) { return String(e?.message || e) }
  }, MATERIALIZE_PAYLOAD)
  check(/nomi-local/.test(rejected), '回填非本地 url（https CDN）当场被断言拒（R17）')

  // ── 整批一个 Cmd+Z：撤销后分镜组 + 没出片的占位节点消失，已回填结果的那一镜留下 ──
  const beforeUndo = await win.evaluate((opId) => window.__nomiCanvasStore.getState().nodes.filter((n) => n.meta?.materializationOperationId === opId).length, OP_ID)
  check(beforeUndo === 4, `撤销前画布上 4 个占位节点在（实得 ${beforeUndo}）`)
  check(await win.evaluate(() => window.__nomiCanvasStore.getState().canUndo === true), '整批落地后撤销栈保留一个事务边界')
  // 点画布再按一次 Cmd+Z（走渲染层真实撤销路径）。
  await win.evaluate(() => window.__nomiCanvasStore.getState().undo?.())
  await win.waitForTimeout(400)
  const afterUndo = await win.evaluate((opId) => {
    const s = window.__nomiCanvasStore.getState()
    return {
      nodes: s.nodes.filter((n) => n.meta?.materializationOperationId === opId)
        .map((n) => ({ id: n.id, resultUrl: n.result?.url || '', groupId: n.groupId || '' })),
      group: s.groups.some((g) => g.materializationOperationId === opId),
    }
  }, OP_ID)
  // 一个 Cmd+Z 撤整批：没出片的 3 个占位节点和分镜组全撤；已回填结果的 shot-1 是付费落地，撤销不拿走它
  // （协调会话 10-07 定 B，docs/plan/2026-10-07-undo-keeps-landed-results.md）——它留下、摘掉被撤分组的标记。
  check(afterUndo.nodes.length === 1 && afterUndo.nodes[0].id === shot1NodeId,
    `一个 Cmd+Z 撤整批：只剩已回填结果的 shot-1（实得剩 ${JSON.stringify(afterUndo.nodes.map((n) => n.id))}）`)
  check(afterUndo.nodes[0]?.resultUrl === 'nomi-local://asset/p/shot-1.mp4', '留下的 shot-1 结果原样在（撤销不拿走付费落地）')
  check(afterUndo.nodes[0]?.groupId === '', '留下的 shot-1 不再挂在被撤掉的分镜组上')
  check(afterUndo.group === false, '分镜组也随同一步撤销消失')

  await win.screenshot({ path: path.join(shotsDir, '03-after-undo.png') })
  for (const f of ['01-three-states-light.png', '02-three-states-dark.png', '01b-stopped-light.png', '03-after-undo.png']) {
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
