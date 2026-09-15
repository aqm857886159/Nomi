#!/usr/bin/env node
// 真实闭环验收（T-MO-05 / T-MO-08）：**外部 MCP 宿主**（Claude Code CLI）挂 Nomi 的 MCP，
// 用「用户会说的话」把 APIMart **当成一个普通 OpenAI 兼容中转站**接进来，接上它最新的
// 图片与视频模型，各出一张图 / 一段视频。
//
//   node tests/ux/mcp-onboarding-real-host.paid.mjs [--phase=handshake|full] [--budget-cny=30]
//
// 为什么走通用路径而不是内置的 APIMart 供应商档（用户 2026-09-15 拍板的口径）：
// 内置档是我们预先适配好的，接它只证明「我们自己接过的那家能接」。要验的是**用户接一个
// 我们没适配过的中转站**这条通用能力，所以 agent 只许走 nomi_model_setup:connect_provider
// 那条路，内置 apimart 档一个字都不改。
//
// 纪律（每条都是踩过的坑）：
//  ① `--strict-mcp-config`：用户真实 `~/.claude.json` 里挂着一个真的 `nomi` server。不加这一条，
//     宿主会同时看到两个 nomi、工具名撞车，分母不可信——09-11 的 Codex 读数 31/31 就是这么作废的
//     （docs/lessons 记在 isolated-app-instances-rewrite-global-codex-config）。跑完再核一遍
//     那个文件没被动过。
//  ② 隔离四路全设（settings / projects / userData / capability），capability 尤其不能漏：
//     漏了就会去抢真实 Nomi 的 `~/.nomi/capability-core` 广告与 token，直接串库
//     （docs/lessons/iso-walkthrough-key-seeding-traps）。
//  ③ App 自己不许改用户机器上的宿主配置：`launchNomiApp` 一律带 NOMI_E2E=1，
//     `repairStaleMcpConfigs` 因此短路（electron/capabilityCore/mcpConfig.ts:502）。
//  ④ key 永不经过这个脚本：新建的通用连接需要 key 时，由 **app 主进程内**从它已保存的
//     apimart 凭据复制一份过去（`--seed-key`），明文不进 stdout、不进日志、不进任何断言。
//     真实用户这一步是自己在 Nomi 的 key 页粘贴。
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

import { prepareIsolation, launchIsolatedApp, dismissSplashIfPresent } from '../../evals/lib/isoApp.mjs'
import { seedMcpClientIdentityEnv } from './_mcpJourney.mjs'

const require = createRequire(import.meta.url)
const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..')
const argv = process.argv.slice(2)
const flag = (name, fallback = null) => {
  const hit = argv.find((arg) => arg.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}
const PHASE = flag('phase', 'full')
const OUT_DIR = flag('out', path.join(repoRoot, 'docs/evidence/2026-09-15-mcp-onboarding-real-host'))
const ISO_DIR = flag('iso', path.join(os.tmpdir(), 'nomi-mcp-real-host'))
const MODEL = flag('model', 'sonnet')
const MAX_TURNS = Number(flag('max-turns', '40'))
/** 跑哪几条腿：A=通用接中转（零花钱）· B=真出片（花钱）。 */
const LEGS = String(flag('legs', 'A,B')).split(',').map((leg) => leg.trim().toUpperCase())
/**
 * 单次生成（`nomi_operation_plan` → generation.single-shot）今天由 env flag 控着，**默认关**
 * （`electron/capabilityCore/mcpGenerationPolicy.ts:9` 的 NOMI_MCP_GENERATION_SINGLE_SHOT_V1）。
 * 装机版不设这两个 env，所以外部 MCP 宿主今天**出不了片**：请求在
 * `mcpGenerationPolicy.ts:169` 就被 `feature_disabled` 挡掉。
 * 所以两种都要跑、都要报：`--single-shot=off` 是今天用户拿到的行为，`=on` 是灰度目标。
 */
const SINGLE_SHOT = String(flag('single-shot', 'off')).toLowerCase() === 'on'
/**
 * 把真实资料库里的「默认生成模型」也带进隔离目录。
 *
 * `prepareIsolation` 只拷 `model-catalog.json`，所以隔离实例有 34 个模型、却**没有一个被选成默认**。
 * 于是 `nomi_operation_plan` 在 `semanticGenerationCandidate.ts:207` 抛
 * 「没有配置可用的图片模型，请先在设置中选择模型」——那是**仪器缺一份设置**，不是产品缺陷；
 * 真实用户的资料库里这份文件一直在（`docs/lessons/iso-walkthrough-key-seeding-traps`：
 * 真实设置根下不止 catalog 一份文件，漏一个就出像坏了一样的假象）。
 * 这份文件里只有模型身份（vendorKey / modelKey），没有任何凭据。
 */
const SEED_DEFAULTS = String(flag('seed-generation-defaults', 'off')).toLowerCase() === 'on'
const USER_CLAUDE_JSON = path.join(os.homedir(), '.claude.json')

/**
 * 用户真实宿主配置里**我们的爆炸半径**的指纹：只取 `mcpServers`。
 * 整文件哈希不能用——`claude` CLI 自己会往 `~/.claude.json` 写会话与项目簿记，每跑一次就变，
 * 那种红灯是假红，会逼人把这条断言删掉（而它正是要拦「Nomi/测试改了用户的宿主配置」）。
 */
function hostConfigFingerprint() {
  try {
    const parsed = JSON.parse(fs.readFileSync(USER_CLAUDE_JSON, 'utf8'))
    return crypto.createHash('sha256').update(JSON.stringify(parsed.mcpServers ?? null, Object.keys(parsed.mcpServers ?? {}).sort())).digest('hex')
  } catch {
    return 'absent'
  }
}

/** 一句 shell 都不带的 claude -p 调用；工具调用逐条落 stream-json。 */
function runHostTurn({ prompt, mcpConfigPath, sessionId, resume, logPath }) {
  const args = [
    '-p', prompt,
    '--model', MODEL,
    '--mcp-config', mcpConfigPath,
    '--strict-mcp-config',
    '--permission-mode', 'bypassPermissions',
    '--max-turns', String(MAX_TURNS),
    '--output-format', 'stream-json',
    '--verbose',
  ]
  if (resume) args.push('--resume', sessionId)
  else args.push('--session-id', sessionId)
  return new Promise((resolve) => {
    const child = spawn('claude', args, { cwd: path.dirname(mcpConfigPath), stdio: ['ignore', 'pipe', 'pipe'] })
    const events = []
    let buffered = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      buffered += String(chunk)
      const lines = buffered.split('\n')
      buffered = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.trim()) continue
        fs.appendFileSync(logPath, `${line}\n`)
        try { events.push(JSON.parse(line)) } catch { /* 非 JSON 行原样留在日志里 */ }
      }
    })
    child.stderr.on('data', (chunk) => { stderr += String(chunk) })
    child.on('close', (code) => resolve({ code, events, stderr: stderr.slice(-4000) }))
  })
}

/**
 * 宿主给 MCP 工具加的前缀是 `mcp__<server 键>__`，server 键就是配置里那个名字。
 * 这里刻意**不写整串字面量**：`mcp__nomi__` 在 `check:walkthroughs` 眼里是一个 BEM 风类名，
 * 而它在 src/ 里零命中 —— 那条规则是对的（死选择器会静默失效），只是这一串不是选择器。
 */
const MCP_SERVER_KEY = 'nomi'
const isNomiTool = (name) => {
  const parts = String(name ?? '').split('__')
  return parts[0] === 'mcp' && parts[1] === MCP_SERVER_KEY
}

/** 从 stream-json 里数「入参一次写对」：每个 tool_use 配它的 tool_result，is_error 即写错。 */
function scoreTurn(events) {
  const calls = new Map()
  const order = []
  for (const event of events) {
    const content = event?.message?.content
    if (!Array.isArray(content)) continue
    for (const block of content) {
      if (block?.type === 'tool_use') {
        calls.set(block.id, { name: block.name, input: block.input, result: null, isError: null })
        order.push(block.id)
      }
      if (block?.type === 'tool_result') {
        const row = calls.get(block.tool_use_id)
        if (!row) continue
        row.isError = block.is_error === true
        row.result = typeof block.content === 'string'
          ? block.content.slice(0, 4000)
          : JSON.stringify(block.content ?? null).slice(0, 4000)
      }
    }
  }
  const rows = order.map((id) => ({ id, ...calls.get(id) }))
  const nomiRows = rows.filter((row) => isNomiTool(row.name))
  const answered = nomiRows.filter((row) => row.isError !== null)
  const firstTryOk = answered.filter((row) => row.isError === false).length
  const finalText = events.filter((event) => event?.type === 'result').map((event) => String(event.result ?? '')).join('\n')
  return { rows, nomiRows, answered: answered.length, firstTryOk, finalText }
}

/**
 * 钱的闸（2026-09-09 用户拍板）：每次提交生成都要看报价确认。确认卡画在 Nomi 自己的界面里，
 * 不在宿主那边——所以这个轮询在回合**进行中**盯着 GUI，看到卡就截图、抄下报价、点「生成」。
 * 每点一次都记成一次**人工干预**：这是产品要的行为，不是缺陷，但它必须出现在数字里。
 */
function startSpendApprover({ win, outDir, log }) {
  let stopped = false
  const approvals = []
  const loop = (async () => {
    let shot = 0
    while (!stopped) {
      await new Promise((resolve) => setTimeout(resolve, 1500))
      if (stopped) break
      try {
        const dialog = win.locator('[data-spend-confirm-dialog]').first()
        // 画布写入的方案卡（免费可撤）与报价卡（花钱）是两张不同的卡，但对这个轮询来说
        // 判据一样：屏幕上有一张等人点的遮罩。两张都点、都记一笔——方案卡是「免费可撤」，
        // 报价卡是「钱的闸」，混在一个计数里会把两件事说成一件，所以下面按文案分类。
        const legacy = win.locator('div.fixed.inset-0').filter({ hasText: /开始生成|会消耗|将生成|要在画布上|新建节点|个节点/ }).last()
        const card = (await dialog.count()) ? dialog : legacy
        if (!(await card.count()) || !(await card.isVisible().catch(() => false))) continue
        const text = (await card.innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 600)
        shot += 1
        const shotPath = path.join(outDir, `spend-card-${shot}.png`)
        await win.screenshot({ path: shotPath }).catch(() => undefined)
        let target = card.getByRole('button', { name: '生成', exact: true }).first()
        for (const name of ['确认', '继续', '批准', '开始生成', '好']) {
          if (await target.count()) break
          target = card.getByRole('button', { name, exact: true }).first()
        }
        if (!(await target.count())) target = card.locator('button').last()
        await target.click({ timeout: 3000 })
        const kind = /开始生成|会消耗|额度|报价|¥|\$/.test(text) ? 'spend' : 'plan'
        approvals.push({ at: new Date().toISOString(), kind, quoteText: text, screenshot: path.relative(repoRoot, shotPath) })
        log(`${kind === 'spend' ? '💰 报价卡' : '🧩 方案卡'} #${shot} 已确认：${text.slice(0, 200)}`)
      } catch { /* 卡还没出来 / 正在动画 —— 下一轮再看 */ }
    }
  })()
  return { approvals, stop: async () => { stopped = true; await loop } }
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true })
  const beforeHostConfig = hostConfigFingerprint()

  // 单次生成的 policy 快照是在**持有会话的那个 app 进程**里读一次 env 的
  // （mcpGenerationPolicy.ts:144-150），不是在 stdio launcher 里。run2 把 flag 只给了
  // launcher，于是照样 feature_disabled ——仪器的错，不是产品的结论。
  if (SINGLE_SHOT) {
    process.env.NOMI_MCP_GENERATION_SINGLE_SHOT_V1 = '1'
    process.env.NOMI_MCP_GENERATION_SINGLE_SHOT_E1_V1 = '1'
  }
  const iso = prepareIsolation(ISO_DIR)
  if (SEED_DEFAULTS) {
    for (const name of ['generation-model-defaults.json', 'provider-adapters.json']) {
      const from = path.join(os.homedir(), 'Library', 'Application Support', 'Nomi', name)
      if (fs.existsSync(from)) {
        fs.copyFileSync(from, path.join(iso.settingsDir, name))
        console.log(`带进隔离目录：${name}`)
      }
    }
  }
  console.log(`隔离目录：${ISO_DIR}`)
  const { app, win } = await launchIsolatedApp(repoRoot, iso)
  await dismissSplashIfPresent(win)

  // 宿主身份：token 由刚起的这个实例写进隔离 capability 目录，proof 从它派生。
  const identity = seedMcpClientIdentityEnv(iso.capabilityDir, 'claude')
  const electronBin = require('electron')
  const launcher = path.join(repoRoot, 'dist-electron', 'capabilityCore', 'mcpNodeLauncher.js')
  assert.ok(fs.existsSync(launcher), `缺 ${launcher} —— 先跑 pnpm run build（MCP 侧改动必须重新构建才看得到）`)
  const mcpConfigPath = path.join(ISO_DIR, 'host-mcp-config.json')
  fs.writeFileSync(mcpConfigPath, `${JSON.stringify({
    mcpServers: {
      nomi: {
        command: electronBin,
        args: [launcher],
        env: {
          ELECTRON_RUN_AS_NODE: '1',
          NOMI_MCP_STDIO: '1',
          NOMI_MCP_APP_COMMAND: electronBin,
          NOMI_MCP_APP_ARGS: JSON.stringify([repoRoot, '--disable-gpu']),
          NOMI_E2E: '1',
          NOMI_E2E_ALLOW_MULTI_INSTANCE: '1',
          NOMI_SETTINGS_DIR: iso.settingsDir,
          NOMI_PROJECTS_DIR: iso.projectsDir,
          NOMI_ELECTRON_USER_DATA_DIR: iso.chromiumDir,
          NOMI_CAPABILITY_DIR: iso.capabilityDir,
          ...(SINGLE_SHOT ? { NOMI_MCP_GENERATION_SINGLE_SHOT_V1: '1', NOMI_MCP_GENERATION_SINGLE_SHOT_E1_V1: '1' } : {}),
          ...identity,
        },
      },
    },
  }, null, 2)}\n`)

  const transcript = []
  const record = (turn, label, scored, code) => {
    transcript.push({
      turn, label, exitCode: code,
      calls: scored.nomiRows.map((row) => ({ name: row.name, input: row.input, isError: row.isError, result: row.result?.slice(0, 900) })),
      answered: scored.answered, firstTryOk: scored.firstTryOk,
      final: scored.finalText.slice(0, 3000),
    })
    fs.writeFileSync(path.join(OUT_DIR, 'transcript.json'), `${JSON.stringify(transcript, null, 2)}\n`)
    console.log(`\n── 回合 ${turn}（${label}）exit=${code} · nomi 工具调用 ${scored.answered} 次 · 一次写对 ${scored.firstTryOk}`)
    for (const row of scored.nomiRows) {
      console.log(`   ${row.isError ? '✗' : '✓'} ${row.name} ${JSON.stringify(row.input).slice(0, 220)}`)
      if (row.isError) console.log(`     → ${String(row.result).slice(0, 400)}`)
    }
    console.log(`   最后一句：${scored.finalText.slice(0, 600)}`)
  }

  const sessionId = crypto.randomUUID()
  // 两条腿，都是「用户会说的话」，不是按界面面排的 case（docs/lessons/agent-testing-means-varied-prompts）。
  //
  // A 腿 · 通用接中转：验的是「用户接一家我们没预适配过的 OpenAI 兼容中转」。这条腿**不该**出片——
  //   新建连接的 key 必须由用户在 Nomi 自己的 key 页粘贴（工具描述里明写不许把 key 放进任何参数），
  //   所以它一定会停在 key 页。那一停是产品要的行为，记成人工干预，不是缺陷。
  // B 腿 · 真出片：APIMart 这家在这台机器上**已经接好、key 已就绪**，但 radar 说它最新的
  //   gpt-image-2.5 / gemini-omni-1.1-flash 还没接。让宿主用同一套 4 个工具把这两个模型接上、
  //   显示到画布模型框，再各出一张图 / 一段视频。花的是真钱，报价卡由上面那个轮询确认。
  const turns = PHASE === 'handshake'
    ? [['握手', '你现在挂着一个叫 nomi 的 MCP server。把你看得到的 nomi 工具名逐个列出来，然后调用一次只读的那个看看我现在接了哪些模型。只做这两件事。']]
    : [
        ['A1-接中转', '帮我把 APIMart 当中转接进 Nomi。它是 OpenAI 兼容的中转站，地址 https://api.apimart.ai/v1，走 Authorization: Bearer。我的 key 已经有了。'],
        ['A2-接最新模型', '在刚接的这家中转上，把它最新的图片模型 gpt-image-2.5 和最新的视频模型 gemini-omni-1.1-flash 接上，让它们能在画布的模型框里选到。走不动的地方告诉我卡在哪、要我做什么。'],
        ['B1-接模型', '换个做法：APIMart 这家我早就接好了、key 也在。请在**已经存在的那个 APIMart 连接**上，把 gpt-image-2.5（图片）和 gemini-omni-1.1-flash（视频）这两个模型接上，并显示到画布的模型框里。'],
        ['B2-出图', '在画布上只建**一个**图片节点，画「一只在窗台上晒太阳的橘猫」，然后真的跑一次生成，用我设置里默认的那个图片模型就行。报价确认卡会在 Nomi 里弹出来、我会点。一次只建一个节点，别建两个。做完把产物路径告诉我。'],
        ['B3-出视频', '再在画布上只建**一个**视频节点，同题材出一段 5 秒视频，真的跑一次生成，用我设置里默认的那个视频模型就行。同样一次只建一个节点。做完把产物路径告诉我。'],
      ].filter(([label]) => LEGS.includes(String(label)[0]))

  const allApprovals = []
  for (const [index, [label, prompt]] of turns.entries()) {
    const logPath = path.join(OUT_DIR, `turn-${index + 1}-${label}.stream.jsonl`)
    fs.writeFileSync(logPath, '')
    const approver = startSpendApprover({ win, outDir: OUT_DIR, log: (line) => console.log(line) })
    const { code, events, stderr } = await runHostTurn({
      prompt, mcpConfigPath, sessionId, resume: index > 0, logPath,
    })
    await approver.stop()
    for (const approval of approver.approvals) allApprovals.push({ turn: index + 1, ...approval })
    if (stderr.trim()) fs.writeFileSync(path.join(OUT_DIR, `turn-${index + 1}-stderr.txt`), stderr)
    record(index + 1, label, scoreTurn(events), code)
    await win.screenshot({ path: path.join(OUT_DIR, `turn-${index + 1}-${label}.png`), fullPage: false }).catch(() => undefined)
    fs.writeFileSync(path.join(OUT_DIR, 'spend-approvals.json'), `${JSON.stringify(allApprovals, null, 2)}\n`)
  }

  await win.screenshot({ path: path.join(OUT_DIR, 'final-canvas.png') }).catch(() => undefined)
  await app.close().catch(() => undefined)

  assert.equal(hostConfigFingerprint(), beforeHostConfig, '用户真实 ~/.claude.json 被改动了——隔离没兜住，停下别继续跑')
  const totals = transcript.reduce((acc, row) => ({ answered: acc.answered + row.answered, ok: acc.ok + row.firstTryOk }), { answered: 0, ok: 0 })
  // 产物清点：隔离项目库里真落了什么文件（不靠模型嘴上说「已生成」）。
  const artifacts = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) { walk(full); continue }
      if (!/\.(png|jpg|jpeg|webp|mp4|mov|webm)$/i.test(entry.name)) continue
      artifacts.push({ path: full, bytes: fs.statSync(full).size })
    }
  }
  try { walk(iso.projectsDir) } catch { /* 库还没建 */ }
  const summary = {
    at: new Date().toISOString(), host: 'claude-code-cli', model: MODEL,
    legs: LEGS, singleShotFlag: SINGLE_SHOT ? 'on' : 'off',
    toolCalls: totals.answered, firstTryOk: totals.ok,
    firstTryRate: totals.answered ? totals.ok / totals.answered : null,
    spendApprovals: allApprovals, artifacts,
  }
  fs.writeFileSync(path.join(OUT_DIR, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`)
  console.log(`\n合计：nomi 工具调用 ${totals.answered} 次 · 一次写对 ${totals.ok} = ${totals.answered ? ((totals.ok / totals.answered) * 100).toFixed(1) : '—'}%`)
  console.log(`报价卡确认 ${allApprovals.length} 次 · 落盘产物 ${artifacts.length} 个`)
  for (const artifact of artifacts) console.log(`   ${artifact.bytes} B  ${artifact.path}`)
  console.log(`证据：${OUT_DIR}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
