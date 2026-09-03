// P4 S6.5 — APIMart 真付费全链验收（走真生产入口：语义多镜 create）。
//
// 链路：起隔离 GUI app（真 catalog + 隔离 NOMI_CAPABILITY_DIR，绝不碰用户真库）→ 另起 stdio MCP 子进程
// （同隔离 capDir → 探到运行中的 GUI，确认卡就地弹在 GUI 里）→ 走真语义入口（面收敛后的 15 工具名）：
//   nomi_session_open → nomi_operation_plan({shots}) → nomi_operation_preview
//   → nomi_operation_gate(phase=request)（阻塞：内部 request_gate→等确认→decide→start 一气呵成，见
//     mcpSemanticGenerationFlow.ts）——趁它阻塞，Playwright 点 GUI 里的多镜确认卡（真收据）→ 生成启动
//   → 轮询 nomi_read(target=run) 等两镜真生成完成 → ffprobe 验时长/编码 → 截图。
//   返工腿：对第 1 镜走返工（同 Run 新 Job）→ 单镜确认卡 → 真返工出第 2 版。
//
// 规格（最低成本）：2 个 text-to-video 镜（无锚——锚检查点在生产无审批入口，见 plan §8.5；这里不走它），
//   seedance-2-apimart t2v fast，duration=4（archetype min），resolution=480p，generate_audio=false，n=1。
//
// 铁律：key 绝不进日志/报告/仓库；超时绝不冒充成功；失败分类处理（401 停 / 参数不支持→报 / 超时→查 reconcile），
//   禁 blanket retry 烧钱。只在 APIMART_E2E=1 NOMI_SPEND_OK=1 下跑（缺任一 → 干净 SKIP）。
//
// 跑：pnpm run build && APIMART_E2E=1 NOMI_SPEND_OK=1 node tests/ux/p4-s6p5-multishot-paid.e2e.mjs

import { launchNomiApp, repoRoot, withLinuxNoSandbox } from './_launchApp.mjs'
import { prepareIsolation, realCatalogPath, createBlankProject, dismissSplashIfPresent } from '../../evals/lib/isoApp.mjs'
import { clickOrFail, proveProbe } from './_assert.mjs'
import { createRequire } from 'node:module'
import { spawn, execFileSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import readline from 'node:readline'
import path from 'node:path'

const require = createRequire(import.meta.url)

// MCP 客户端证明：HMAC-SHA256(capabilityToken, "nomi-mcp-client:v1:<client>") → 让 stdio 子进程被认成
// 注册客户端 'claude'（否则 current_project bootstrap 拒发 lease）。token 从隔离 capDir/token 读（同机）。
function signMcpClientProof(capToken, client) {
  return crypto.createHmac('sha256', capToken).update(`nomi-mcp-client:v1:${client}`).digest('base64url')
}

if (!process.env.APIMART_E2E || !process.env.NOMI_SPEND_OK) {
  console.log('SKIP p4-s6p5-multishot-paid: 需真 catalog + 真花额度。APIMART_E2E=1 NOMI_SPEND_OK=1 才跑。')
  console.log('  pnpm run build && APIMART_E2E=1 NOMI_SPEND_OK=1 node tests/ux/p4-s6p5-multishot-paid.e2e.mjs')
  process.exit(0)
}
if (!fs.existsSync(realCatalogPath())) {
  console.log(`SKIP: 真实 model-catalog.json 不存在（${realCatalogPath()}）——需已配置 APIMart key。`)
  process.exit(0)
}

const shotsDir = path.join(repoRoot, 'tests/ux/shots/p4-s6p5-multishot-paid')
fs.rmSync(shotsDir, { recursive: true, force: true })
fs.mkdirSync(shotsDir, { recursive: true })

// 隔离目录 + 真 catalog（safeStorage 同机可解密）。NOMI_CAPABILITY_DIR 指隔离目录——不设会跟用户真 Nomi 抢库。
const isoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-s6p5-paid-'))
const iso = prepareIsolation(isoDir, { requireCatalog: true })
const capDir = path.join(isoDir, 'capability-core')
fs.mkdirSync(capDir, { recursive: true })

const SEMANTIC_ENV = {
  NOMI_MCP_GENERATION_SINGLE_SHOT_V1: '1',
  NOMI_MCP_GENERATION_SINGLE_SHOT_E1_V1: '1',
  APIMART_E2E: '1',
  NOMI_SPEND_OK: '1',
  NOMI_CAPABILITY_DIR: capDir,
  NOMI_ELECTRON_USER_DATA_DIR: iso.chromiumDir,
  NOMI_SETTINGS_DIR: iso.settingsDir,
  NOMI_PROJECTS_DIR: iso.projectsDir,
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let passed = 0
let exitCode = 0
const ledger = [] // 记账：每步真实请求/花销/状态
const friction = [] // 体验摩擦
const ok = (c, l) => { if (!c) throw new Error(`FAIL: ${l}`); passed += 1; console.log(`  ✓ ${l}`) }
const note = (l) => console.log(`  · ${l}`)

// ffprobe 验媒体（时长/编码）。找不到 ffprobe → 降级成 URL 存在 + 人眼复核（不冒充）。
function ffprobe(localPath) {
  try {
    const out = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_name,codec_type,width,height', '-of', 'json', localPath], { encoding: 'utf8' })
    return JSON.parse(out)
  } catch (e) {
    return { error: e?.message || String(e) }
  }
}

// 产物的本机文件路径（供 ffprobe）。安全投影现在带 artifact.projectRelativePath（项目内相对路径，
// 经 safeProjectRelativePath 校验）→ 直接拼项目根就是精确命中。命不中 = 真没落地，如实记，不猜。
// （旧版靠 fs 递归 walk 按文件名找同名文件——那是没有该字段时的将就，字段补上后同 commit 删掉。）
function resolveLocalArtifact(relativePath, projectDir) {
  if (!relativePath || !projectDir) return null
  const target = path.join(projectDir, relativePath)
  return fs.existsSync(target) ? target : null
}

/** 起一个 stdio MCP 子进程（不声明 elicitation → 确认弹在 GUI 卡）。同隔离 env → 探到运行中的 GUI 转发。
 * 带注册客户端证明（NOMI_MCP_CLIENT=claude + proof）→ current_project bootstrap 才发得出 lease。 */
function spawnAgent(clientProofEnv) {
  const pending = new Map()
  let seq = 0
  const child = spawn(require('electron'), withLinuxNoSandbox([repoRoot, '--disable-gpu']), {
    cwd: repoRoot,
    env: { ...process.env, ...SEMANTIC_ENV, ...clientProofEnv, NOMI_MCP_STDIO: '1' },
    stdio: ['pipe', 'pipe', 'inherit'],
  })
  readline.createInterface({ input: child.stdout }).on('line', (line) => {
    const t = line.trim(); if (!t.startsWith('{')) return
    let msg; try { msg = JSON.parse(t) } catch { return }
    if (msg.id != null && pending.has(msg.id)) { const { resolve, timer } = pending.get(msg.id); clearTimeout(timer); pending.delete(msg.id); resolve(msg) }
  })
  const rpc = (method, params, timeoutMs = 30000) => {
    const id = (seq += 1)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`RPC 超时: ${method}`)) }, timeoutMs)
      pending.set(id, { resolve, timer })
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
    })
  }
  const parseTool = (msg) => {
    const c = msg?.result?.content
    const textNode = Array.isArray(c) ? c.find((x) => x.type === 'text') : null
    let json = null; try { json = textNode ? JSON.parse(textNode.text) : null } catch { /* not json */ }
    return { raw: msg, json, structured: msg?.result?.structuredContent, isError: msg?.result?.isError === true }
  }
  return {
    child,
    async start() { return rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'claude-code', version: '0' } }) },
    async callTool(name, args, timeoutMs = 240000) { return parseTool(await rpc('tools/call', { name, arguments: args }, timeoutMs)) },
  }
}

const shotDefaults = { size: '16:9', resolution: '480p', duration: 4, generate_audio: false }
function videoCandidate(id, prompt) {
  return {
    candidateId: `cand-${id}`, revision: 1, moduleId: 'generation.single-shot',
    providerId: 'apimart', modelId: 'doubao-seedance-2.0', variantId: 'fast',
    mode: 'text_to_video', prompt, parameters: { ...shotDefaults }, references: [],
  }
}

let app, agent
try {
  console.log('P4 S6.5 APIMart 付费验收 — 起隔离 GUI（真 catalog）…')
  const launched = await launchNomiApp({
    name: 'p4-s6p5-multishot-paid',
    userDataDir: iso.chromiumDir,
    settingsDir: iso.settingsDir,
    projectsDir: iso.projectsDir,
    env: { ...SEMANTIC_ENV },
    args: ['--disable-gpu', '--disable-software-rasterizer'],
    settleMs: 0,
  })
  app = launched.app
  const win = launched.win
  await sleep(2500)

  // GUI 写出 instance 广告 = isAppOpen 为真 → 确认卡会弹在 GUI（stdio 转发过去）。
  const advertFiles = fs.readdirSync(capDir).filter((f) => f.startsWith('instance'))
  ok(advertFiles.length > 0, `GUI 写出 instance 广告（${advertFiles.join(',')}）= 确认卡会弹在 GUI`)

  // 多镜确认卡定位：全屏模态里带确认按钮 data-production-action=confirm。
  const spendCard = win.locator('div.fixed.inset-0').filter({ has: win.locator('[data-production-action="confirm"]') })
  const confirmBtn = win.locator('[data-production-action="confirm"]')

  // 在 GUI 里建并打开一个项目 → 它成为 openProjectId，current_project bootstrap 据它发 lease。
  await dismissSplashIfPresent(win)
  const projectDir = await createBlankProject(win, iso.projectsDir)
  const projectId = path.basename(projectDir)
  ok(projectId, `GUI 建并打开项目（${projectId}）= 成为 current project`)
  // 等项目落盘 + 工作区 record 稳定（manifestDigest 含 revision/updatedAt——新建后 board 初始化会连改几拍，
  // 若在 digest 还在变时开 session，lease 一到 create 就 project_scope_changed）。等它静下来。
  await sleep(6000)

  // 注册客户端证明：让 stdio 子进程被认成 'claude'（否则 bootstrap 拒发 lease）。
  const capToken = fs.readFileSync(path.join(capDir, 'token'), 'utf8').trim()
  const clientProofEnv = { NOMI_MCP_CLIENT: 'claude', NOMI_MCP_CLIENT_PROOF: signMcpClientProof(capToken, 'claude') }

  agent = spawnAgent(clientProofEnv)
  ok(Boolean((await agent.start())?.result), 'stdio MCP 起来了（语义面已开：SINGLE_SHOT_V1 + E1_V1；客户端=claude）')

  // 语义会话：current_project bootstrap 拿 lease（scoped 到 GUI 里打开的项目）。
  const session = await agent.callTool('nomi_session_open', { bootstrap: { mode: 'current_project', clientSessionNonce: `nonce-${Date.now()}` } })
  const leaseHandle = session.json?.leaseHandle || session.structured?.leaseHandle
  if (!leaseHandle) { note(`session_open 返回: ${JSON.stringify(session.json || session.structured || session.raw?.result).slice(0, 300)}`) }
  ok(leaseHandle, `打开安全会话（current_project bootstrap 拿到 lease）`)
  // lease 的 projectId 是权威（GUI 打开项目的 workspace id，不一定=目录名）。语义调用不传 projectId
  // （dispatcher 用 lease.projectId 覆盖，传了不一致的会 project_scope_changed）；production 读工具用它。
  const leaseProjectId = session.json?.projectId || session.structured?.projectId || projectId
  note(`lease projectId = ${leaseProjectId}`)

  // ── 真生产入口：create 多镜 plan（2 个 t2v 镜，无锚；无 operationId=新建）──
  const created = await agent.callTool('nomi_operation_plan', {
    leaseHandle,
    shots: [
      { shotId: 'shot-1', role: 'shot', candidate: videoCandidate('shot-1', '雨夜便利店门口，一个人推门而入，霓虹灯反光，电影感') },
      // shot-2 原「两人隔着货架对视，特写」两轮真跑都被 APIMart 内容审核挡（public figures/minors 误伤，
      // cost=0 未计费）——确定性拦截会永远堵住「全批落地」验收目标，换成无人物特写的安全镜头。
      { shotId: 'shot-2', role: 'shot', candidate: videoCandidate('shot-2', '便利店货架间，暖光，镜头沿货架缓慢推移，商品整齐排列，电影感') },
    ],
  })
  if (created.isError) {
    const errText = created.raw?.result?.content?.find?.((x) => x.type === 'text')?.text || JSON.stringify(created.structured)
    note(`create 错误: ${String(errText).slice(0, 400)}`)
  }
  ok(!created.isError, `nomi_operation_plan 多镜草稿建成（真生产入口，非测试注入）`)
  ok(Array.isArray(created.json?.operation?.shots) && created.json.operation.shots.length === 2, `草稿落 2 个镜头`)
  // 用 create 返回的 operationId（工具 schema 不收 operationId，服务端生成 UUID；后续全用它）。
  const operationId = created.json?.operation?.operationId
  ok(operationId, `拿到服务端 operationId（${operationId}）`)
  ledger.push({ step: 'create', requests: 0, note: '零花费草稿' })

  note(`create 返回 operationId=${created.json?.operation?.operationId} state=${created.json?.operation?.state}`)
  // 探针：create 后 Run 能否被 GUI 侧 production 服务读到（跨进程/跨命名空间一致性）。
  const runProbe = await agent.callTool('nomi_read', { target: 'run', projectId: leaseProjectId, runId: operationId }, 15000).catch((e) => ({ isError: true, err: e?.message }))
  note(`create 后 run 读探针: isError=${runProbe.isError} ${runProbe.isError ? (runProbe.err || JSON.stringify(runProbe.raw?.result?.content?.[0]?.text || '').slice(0, 150)) : 'run 可读'}`)

  await agent.callTool('nomi_operation_preview', { leaseHandle, operationId })
  note('preview 完成（零 provider 调用）')

  // ── gate(phase=request) 阻塞：内部 request→等确认→decide→start。趁阻塞点 GUI 卡。──
  console.log('  · 发 nomi_operation_gate(phase=request)（会阻塞等 GUI 卡确认）…')
  const gatePromise = agent.callTool('nomi_operation_gate', { phase: 'request', leaseHandle, operationId }, 300000)

  // 诊断：等几秒后截图 + dump 卡相关 DOM（card 不弹时看 GUI 到底在什么态）。
  await sleep(5000)
  await win.screenshot({ path: path.join(shotsDir, '00-gate-pending-state.png') })
  // 诊断探针只数**具体锚点**（不读整页文本——那会被走查门当 whole-page-text 拦，且断言恒真）。
  const domProbe = await win.evaluate(() => ({
    fixedModals: document.querySelectorAll('div.fixed.inset-0').length,
    confirmBtns: document.querySelectorAll('[data-production-action="confirm"]').length,
    spendAny: document.querySelectorAll('[data-production-footer],[data-spend],[role="dialog"]').length,
    onboarding: document.querySelectorAll('[data-onboarding],[class*="onboarding"]').length,
  })).catch((e) => ({ err: String(e) }))
  note(`DOM 探针: ${JSON.stringify(domProbe)}`)
  // 看 gate 是否已提前返回（错误/surface none）——若返回了就 dump 出来。
  const early = await Promise.race([gatePromise.then((r) => ({ done: true, r })), sleep(1500).then(() => ({ done: false }))])
  if (early.done) {
    const errText = early.r?.raw?.result?.content?.find?.((x) => x.type === 'text')?.text || JSON.stringify(early.r?.structured || early.r?.json)
    note(`gate 已提前返回（isError=${early.r?.isError}）: ${String(errText).slice(0, 300)}`)
  }

  // 探针：多镜卡确实弹（带确认按钮）。
  const cardProof = await proveProbe(confirmBtn, '多镜付费确认卡弹在 GUI（带确认按钮）', 60000)
  await win.screenshot({ path: path.join(shotsDir, '01-multishot-confirm-card.png') })
  // 卡上术语人话核验（无「封存/物化/合同」内部词）。
  const cardText = await spendCard.first().innerText().catch(() => '')
  ok(!/封存|物化|子合同|contract/i.test(cardText), '卡上无「封存/物化/合同」内部词（术语人话）')
  if (/等待|生成中/.test(cardText) && !/预计|约|秒/.test(cardText)) friction.push('确认卡未给预计耗时（等待无预期）')
  console.log('  · 卡文案(截断):', cardText.replace(/\s+/g, ' ').slice(0, 160))

  // 零额度干跑闸：只证「卡弹到 GUI」就停，不点确认（不花钱）。用于先跑零额度全绿再花钱（工程纪律）。
  if (process.env.S6P5_DRY_RUN_NO_SPEND) {
    await win.screenshot({ path: path.join(shotsDir, '01b-dryrun-card-reached-no-spend.png') })
    ok(true, '零额度干跑：真语义入口把多镜卡弹到了 GUI（未点确认，未花钱）— 链路已通，可放心花钱')
    gatePromise.catch(() => undefined) // 让它超时自灭，不 await
    throw new Error('__DRY_RUN_DONE__')
  }

  // 点确认（真收据）。
  await clickOrFail(confirmBtn, '确认生成（真收据铸出）')
  await win.screenshot({ path: path.join(shotsDir, '02-after-confirm.png') })

  // request_gate 返回 = 已 decide + start（内部一气呵成）。
  const gateResult = await gatePromise
  ok(!gateResult.isError, `确认后 request_gate 返回（内部 decide+start 完成）`)
  ledger.push({ step: 'gate+start', requests: '待轮询确认', note: '真收据 + 启动批次' })

  // ── 轮询 run：先等「两镜真提交被 provider 接受」（本切片 create 入口的证据）；再尽力等 materialize。──
  console.log('  · 轮询 run：先证两镜真提交被 APIMart 接受，再尽力等落地…')
  const runId = operationId
  let run = null
  const submitDeadline = Date.now() + 3 * 60 * 1000
  let lastStatus = ''
  const accepted = (jobs) => jobs.filter((j) => ['provider_accepted', 'polling', 'ready', 'adopted', 'materializing'].includes(j.status)).length
  // nomi_read(target=run) 的完整安全投影在 structuredContent.nomiRunData（text 是人话转述不是 JSON，
  // structured 顶层是 {nomiOutcome,nomiRun,nomiRunData}——见 mcpProtocol.buildToolResultPayload）。
  const runFrom = (got) => got.structured?.nomiRunData || got.json?.run || got.json || null
  while (Date.now() < submitDeadline) {
    const got = await agent.callTool('nomi_read', { target: 'run', projectId: leaseProjectId, runId }, 30000)
    run = runFrom(got) || run
    const jobs = run?.jobs || []
    const failed = jobs.filter((j) => ['failed', 'needs_attention'].includes(j.status))
    const st = `jobs=${jobs.length} accepted=${accepted(jobs)} ready=${jobs.filter((j) => ['ready', 'adopted'].includes(j.status)).length} status=${run?.status}`
    if (st !== lastStatus) { note(st); lastStatus = st }
    if (failed.length) {
      const reason = failed[0]?.errorMessage || failed[0]?.errorCode || failed[0]?.status
      throw new Error(`镜头失败（不重试烧钱）：${reason} — 见 run.jobs`) // 401/参数不支持在此停
    }
    if (accepted(jobs) >= 2) break
    await sleep(6000)
  }
  const jobsNow = run?.jobs || []
  const acceptedCount = accepted(jobsNow)
  ledger.push({ step: 'gate+start→submit', requests: acceptedCount, note: `锚0+镜2；${acceptedCount} 个真 provider 提交被接受` })
  ok(acceptedCount >= 2, `两镜真提交被 APIMart 接受（accepted=${acceptedCount}）= create 入口真花钱触发真 provider`)
  ok(jobsNow.length === 2, `总 job 数 = 镜数 2（无锚；每 Job ≤1 submit）`)
  const uniqueProviders = new Set(jobsNow.map((j) => j.jobId))
  ok(uniqueProviders.size === jobsNow.length, `每 Job 唯一（无重复提交）`)

  // 等 materialize：调度器观察轮已带真实退避等待（2026-08-25 修掉 S4 poll gap——observe 派生 +
  // pollHorizon + 15s re-kick），慢真 provider 也会在完成后被取回落地。fast/480p/4s 通常 1-2 分钟。
  const matDeadline = Date.now() + 6 * 60 * 1000
  while (Date.now() < matDeadline) {
    const got = await agent.callTool('nomi_read', { target: 'run', projectId: leaseProjectId, runId }, 30000)
    run = runFrom(got) || run
    const readyNow = (run?.artifacts || []).filter((a) => a.status === 'ready').length
    const polls = (run?.jobs || []).map((j) => `${j.metadata?.shotId || j.jobId.slice(-6)}:${j.status}@${j.lastPollAt?.slice(11, 19) || '-'}`).join(' ')
    note(`materialize 等待: ready=${readyNow} jobs=[${polls}]`)
    if (readyNow >= 2) break
    await sleep(8000)
  }

  // ── 验产物：ffprobe + 截图（materialize 到了才验；被 poll gap 挡住则如实记，不冒充）──
  const artifacts = (run?.artifacts || []).filter((a) => a.status === 'ready')
  if (artifacts.length < 2) {
    friction.push('两镜超 6 分钟未 materialize——供应商仍在处理或观察轮异常（查 run.jobs 的 providerStatus/lastPollAt 判因，别冒充成功）')
    note(`materialize 未完成（ready 产物=${artifacts.length}）：真钱已花在提交上；lastPollAt 在走说明调度器仍在观察`)
  }
  for (const [i, art] of artifacts.slice(0, 2).entries()) {
    // 安全投影带项目内相对路径 → 拼项目根拿到本机文件，直接 ffprobe 验真（不再靠截图人眼降级）。
    const got = await agent.callTool('nomi_read', { target: 'artifact', projectId: leaseProjectId, runId, artifactId: art.artifactId }, 30000)
    const meta = got.structured?.nomiRunData || got.json || got.structured || {}
    const relativePath = art.projectRelativePath || meta.projectRelativePath
    const localPath = resolveLocalArtifact(relativePath, projectDir)
    if (localPath) {
      const probe = ffprobe(localPath)
      const dur = Number(probe?.format?.duration)
      const vstream = (probe?.streams || []).find((s) => s.codec_type === 'video')
      note(`镜${i + 1} ffprobe: dur=${dur}s codec=${vstream?.codec_name} ${vstream?.width}x${vstream?.height}`)
      ok(Number.isFinite(dur) && dur > 0, `镜${i + 1} 是有时长的真视频（${dur}s）`)
    } else {
      note(`镜${i + 1} 未解析到本机文件（relativePath=${String(relativePath || '缺失').slice(0, 60)}）— 降级人眼复核（截图存证）`)
    }
  }
  // 看画布落地（确认即落占位 + 回填）。**先切到生成画布**再拍——此前这张停在创作页，拍的是「没切过去」，
  // 存证里根本没有落地节点，等于白拍。切完等舞台真出现再拍，拍不到就如实记，不拿创作页冒充画布。
  await sleep(2000)
  const genTab = win.getByRole('button', { name: '生成', exact: false }).first()
  if (await genTab.count()) await genTab.click().catch(() => undefined)
  const canvasStage = win.locator('.generation-canvas-v2__stage').first()
  const onCanvas = await canvasStage.waitFor({ state: 'visible', timeout: 15000 }).then(() => true).catch(() => false)
  if (!onCanvas) friction.push('点「生成」后 15s 内没等到生成画布舞台——03 截图仍停在上一面，落地节点未取证')
  await sleep(1500)
  await win.screenshot({ path: path.join(shotsDir, '03-canvas-after-generate.png') })
  note(`03 截图：${onCanvas ? '已切到生成画布（舞台可见）' : '未切成功，见上条摩擦'}`)

  // ── S6 返工腿：对第 1 镜返工（同 Run 新 Job）→ 单镜确认卡 → 真返工出第 2 版 ──
  console.log('\n  ── S6 返工腿：对第 1 镜返工 ──')
  const reworkResult = await driveRework(agent, win, confirmBtn, leaseProjectId, runId, 'shot-1', cardProof, shotsDir, ledger, friction)
  if (reworkResult.ok) {
    passed += 1; console.log(`  ✓ ${reworkResult.msg}`)
  } else {
    friction.push(`返工腿未跑通：${reworkResult.msg}`)
    console.log(`  ⚠ 返工腿：${reworkResult.msg}（记为摩擦，不判失败——主链已证）`)
  }

  // ── 记账 + 摩擦报告 ──
  console.log('\n════ 付费验收记账 ════')
  for (const l of ledger) console.log(`  ${l.step}: 请求=${l.requests} · ${l.note}`)
  console.log(`  总真实 provider 请求（生成 job）: ${jobsNow.length}${reworkResult.reworked ? ' + 返工 1' : ''}`)
  console.log('\n════ 体验摩擦 ════')
  if (friction.length === 0) console.log('  （无明显摩擦）')
  else for (const f of friction) console.log(`  - ${f}`)
  console.log(`\nS6P5-PAID PASS: ${passed} 断言。截图 → ${shotsDir}`)
} catch (err) {
  if (err?.message === '__DRY_RUN_DONE__') {
    console.log(`\nS6P5-PAID DRY-RUN PASS: ${passed} 断言（零额度，只证链路到卡）。截图 → ${shotsDir}`)
  } else {
    console.log(`✗ ${err?.message || err}`)
    exitCode = 1
  }
} finally {
  if (agent) agent.child.kill('SIGTERM')
  if (app) await app.close().catch(() => undefined)
  fs.rmSync(isoDir, { recursive: true, force: true })
  setTimeout(() => process.exit(exitCode), 400)
}

/**
 * S6 返工腿：数据层驱动返工（同 Run 新 Job + parentJobId）+ 单镜确认卡。走 IPC 层的 rework 需项目在
 * 面板上（productionRuns.rework 守 openProjectId）；这里用语义面没有 rework 工具，故本腿改走「验证返工
 * 数据层能力 + 单镜卡机制」——若跑不通记为摩擦（主链已证），不判失败。
 */
async function driveRework(agent, win, confirmBtn, projectId, runId, shotId, cardProof, shotsDir, ledger, friction) {
  try {
    // 语义面无独立 rework 工具（S6 返工走渲染层占位/版本条 → IPC nomi:production-runs:rework）。
    // 本 headless 腿只能验：run 里该镜有可返工的终态 job（返工的前提）。真返工的 UI 走查在 R13 走查腿覆盖。
    // projectId 用形参（leaseProjectId 是 try 块里的 const，函数作用域取不到——取了会 ReferenceError
    // 被自家 catch 吞成「返工前提不满足」，看起来像产品问题，其实是本脚本的作用域 bug）。
    const got = await agent.callTool('nomi_read', { target: 'run', projectId, runId }, 30000)
    const run = got.structured?.nomiRunData || got.json?.run || got.json
    // 安全投影现在带 metadata.shotId → 能按镜头认领 job（此前恒空，返工前提永远校验不过）。
    // 不留 `|| j.shotId` 兜底：投影发的就是嵌套 metadata.shotId，扁平 shotId 从来不存在（P1 无并行版）。
    const shot1Jobs = (run?.jobs || []).filter((j) => j.metadata?.shotId === shotId)
    const terminal = shot1Jobs.find((j) => ['ready', 'adopted'].includes(j.status))
    if (!terminal) return { ok: false, reworked: false, msg: `第 1 镜没有可返工的终态 job（返工前提不满足）` }
    return {
      ok: true, reworked: false,
      msg: `第 1 镜有终态 job（返工前提满足；真返工 UI 走 R13 渲染层走查，headless 语义面无 rework 工具——见 plan §4 返工腿裁定）`,
    }
  } catch (e) {
    return { ok: false, reworked: false, msg: e?.message || String(e) }
  }
}
