#!/usr/bin/env node
// 真实模型跑分：把**生产工具面逐字节**摆在三种真实司机面前，量「第一跳选对没、参数写对没」。
//
//   node scripts/tool-face-bank/run.mjs --driver deepseek|codex|claude [--limit N] [--out FILE]
//
// R30 的判据（docs/plan/2026-09-11-mcp-onboarding-tool-face-impl.md §6）：
//   · 入参一次写对率 ≥90%（旧面实测 62%）
//   · 回合成功 ≥8/9
//   · 人工干预 0
//
// 纪律：
//   · key 只从 ~/.nomi-secrets.env source 进 env，绝不落盘、绝不回显（见 redact()）。
//   · 工具定义来自 dump-tools.ts，不手抄——否则量的不是生产工具面。
//   · 每个 case 独立进程、独立探针日志，互不串场。
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { envelopeFor, worldFor } from './envelope.mjs'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..')
const BANK = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/fixtures/tool-selection/2026-09-11-onboarding-bank.json'), 'utf8'))

const argv = process.argv.slice(2)
const arg = (name, fallback = null) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : fallback }
const DRIVER = arg('driver')
const LIMIT = Number(arg('limit', '0')) || 0
const OUT = arg('out')
const MAX_TURNS = Number(arg('max-turns', '6')) || 6
// 阳性对照臂：把**旧的 6-action 面**摆在同一批司机面前，同一把尺子量。
// 没有阳性对照的绿灯不作数（docs/lessons/race-repro-needs-positive-control）：
// 新面 100% 只有在旧面同尺读数落回 60–65% 时才说明是工具面的功劳。
const ARM = arg('arm', 'new')
if (!['new', 'legacy'].includes(ARM)) { console.error('--arm must be new | legacy'); process.exit(2) }
const LEGACY = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/fixtures/tool-selection/2026-09-11-legacy-6action-face.json'), 'utf8'))
if (!['deepseek', 'codex', 'claude'].includes(DRIVER)) { console.error('--driver must be deepseek | codex | claude'); process.exit(2) }

// ── 工具定义：从生产代码 dump，不手抄 ────────────────────────────────────────────
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-toolface-'))
const toolsPath = path.join(work, 'tools.json')
let TOOLS
if (ARM === 'legacy') {
  // 旧面的两个工具定义从 origin/main **原样取出**（本分支已删除它们），不手抄。
  const legacyPath = arg('legacy-tools', '/tmp/ot-legacy-tools.json')
  if (!fs.existsSync(legacyPath)) { console.error(`legacy arm needs the old tool dump at ${legacyPath} (see scripts/tool-face-bank/dump-legacy.sh)`); process.exit(1) }
  TOOLS = JSON.parse(fs.readFileSync(legacyPath, 'utf8'))
  fs.writeFileSync(toolsPath, JSON.stringify(TOOLS))
} else {
  const dumped = spawnSync('pnpm', ['exec', 'tsx', 'scripts/tool-face-bank/dump-tools.ts'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
  if (dumped.status !== 0) { console.error('dump-tools failed:', dumped.stderr?.slice(0, 2000)); process.exit(1) }
  fs.writeFileSync(toolsPath, dumped.stdout)
  TOOLS = JSON.parse(dumped.stdout)
}

// 逐字相同的前言：A/B 里任何措辞差都会变成服从度差而不是工具面差
// （docs/lessons/prompt-ab-gating-question-confounds-arms）。
const PREAMBLE = 'You are connected to Nomi, a local-first video creation workbench, through its MCP tools. Help the user with what they ask, using the tools. Do not ask the user for confirmation before calling a read-only tool.'

function redact(text) {
  let out = String(text ?? '')
  for (const secret of SECRETS) if (secret && secret.length > 8) out = out.split(secret).join('«redacted»')
  return out
}

// ── key：只进 env，绝不落盘 ──────────────────────────────────────────────────────
const SECRETS = []
function loadSecrets() {
  const file = path.join(os.homedir(), '.nomi-secrets.env')
  if (!fs.existsSync(file)) return {}
  const env = {}
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line)
    if (!m) continue
    let value = m[2].trim().replace(/^["']|["']$/g, '')
    env[m[1]] = value
    if (/KEY|TOKEN|SECRET/.test(m[1]) && value) SECRETS.push(value)
  }
  return env
}
const SECRET_ENV = loadSecrets()

// ── 司机 ────────────────────────────────────────────────────────────────────────
/** 返回 { calls: [{tool, args}], raw } —— calls 按发生顺序。 */
function runCase(testCase, index) {
  const logPath = path.join(work, `probe-${index}.jsonl`)
  fs.writeFileSync(logPath, '')
  const probe = path.join(ROOT, 'scripts/tool-face-bank/probe-server.mjs')
  let res

  if (DRIVER === 'claude') {
    const mcp = JSON.stringify({ mcpServers: { probe: { command: 'node', args: [probe, toolsPath, logPath, testCase.state] } } })
    const allowed = TOOLS.map((t) => `mcp__probe__${t.name}`)
    res = spawnSync('claude', ['-p', `${PREAMBLE}\n\n${testCase.utterance}`,
      '--mcp-config', mcp, '--allowedTools', ...allowed, '--max-turns', '6'],
      { cwd: work, encoding: 'utf8', timeout: 180000, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 32 * 1024 * 1024 })
  } else if (DRIVER === 'codex') {
    res = spawnSync('codex', ['exec', '--skip-git-repo-check', '--sandbox', 'read-only',
      '-c', 'approval_policy="never"',
      '-c', 'mcp_servers.probe.command="node"',
      '-c', `mcp_servers.probe.args=${JSON.stringify([probe, toolsPath, logPath, testCase.state])}`,
      `${PREAMBLE}\n\n${testCase.utterance}`],
      { cwd: work, encoding: 'utf8', timeout: 240000, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 32 * 1024 * 1024 })
  } else {
    res = runDeepseek(testCase, logPath)
  }

  const calls = fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
  return { calls, raw: redact(`${res.stdout ?? ''}\n${res.stderr ?? ''}`).slice(-4000), status: res.status, timedOut: Boolean(res.error) }
}

/**
 * DeepSeek：OpenAI 兼容 tool calling，**多回合**。
 *
 * 单回合是量不出东西的：`nomi_list_models` 的描述明说「before every other call here」，
 * 所以模型第一跳几乎一定是读。只发一次请求就收工，等于把「读完再动手」记成「没做对」——
 * 那是 harness 自己的 bug 被洗成产品结论（docs/lessons/harness-catch-launders-bugs-into-verdicts）。
 * 所以这里把工具结果喂回去，让它跑完整条链，和 MCP 那两臂看到的世界一致（共用 envelopeFor）。
 */
function runDeepseek(testCase, logPath) {
  const key = SECRET_ENV.DEEPSEEK_API_KEY || process.env.DEEPSEEK_API_KEY
  if (!key) return { status: 1, stdout: '', stderr: 'no DeepSeek key in ~/.nomi-secrets.env' }
  const tools = TOOLS.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.inputSchema } }))
  const world = worldFor(testCase.state)
  const messages = [{ role: 'system', content: PREAMBLE }, { role: 'user', content: testCase.utterance }]
  let hops = 0
  const usage = []
  for (let turn = 0; turn < MAX_TURNS; turn += 1) {
    const body = { model: SECRET_ENV.DEEPSEEK_MODEL || 'deepseek-chat', messages, tools, tool_choice: 'auto' }
    const res = spawnSync('curl', ['-sS', '-X', 'POST', 'https://api.deepseek.com/chat/completions',
      '-H', 'Content-Type: application/json', '-H', `Authorization: Bearer ${key}`,
      '--max-time', '120', '-d', '@-'],
      { input: JSON.stringify(body), encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
    let parsed
    try { parsed = JSON.parse(res.stdout) } catch { return { status: 1, stdout: JSON.stringify({ usage }), stderr: redact(res.stdout || res.stderr).slice(0, 800) } }
    if (parsed?.error) return { status: 1, stdout: JSON.stringify({ usage }), stderr: redact(JSON.stringify(parsed.error)).slice(0, 800) }
    const message = parsed?.choices?.[0]?.message
    if (parsed?.usage) usage.push(parsed.usage)
    const toolCalls = message?.tool_calls ?? []
    if (!toolCalls.length) return { status: 0, stdout: JSON.stringify({ finish: parsed?.choices?.[0]?.finish_reason, hops, usage, final: String(message?.content ?? '').slice(0, 800) }), stderr: '' }
    messages.push(message)
    for (const call of toolCalls) {
      let args = {}
      let unparsable = false
      try { args = JSON.parse(call.function?.arguments || '{}') } catch { args = {}; unparsable = true }
      hops += 1
      fs.appendFileSync(logPath, `${JSON.stringify({ tool: call.function?.name, args, ...(unparsable ? { unparsableArguments: true } : {}) })}\n`)
      const known = TOOLS.some((t) => t.name === call.function?.name)
      const payload = known && !unparsable ? envelopeFor(call.function.name, args, hops, world)
        : { ok: false, code: unparsable ? 'arguments_not_json' : 'unknown_tool', useInstead: TOOLS.map((t) => t.name), needs: [], evidence: {} }
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(payload) })
    }
  }
  return { status: 0, stdout: JSON.stringify({ finish: 'max_turns', hops, usage }), stderr: '' }
}

// ── 打分 ────────────────────────────────────────────────────────────────────────
const toolByName = new Map(TOOLS.map((t) => [t.name, t]))
const FORBIDDEN = BANK.globalMustNotAppearInArgs ?? []

/** 这个 case 在当前臂上「第一跳应该是什么」。旧面用 newCallToLegacyHops 折算。 */
function expectedFirstFor(testCase) {
  if (ARM === 'new') return testCase.expectedFirstCall
  const hops = LEGACY.newCallToLegacyHops[testCase.expectedFirstCall]
  if (!Array.isArray(hops) || !hops.length) return null
  const hop = hops[0]
  return hop.action ? `${hop.tool}:${hop.action}` : hop.tool
}

/** 旧面的「一次写对」按**运行时**必填算——模型看得到的只有 advertisedRequired（几乎总是只有 action），
 *  真正会抛的是 runtimeRequired。这条缝正是 62% 的来源，也是这一臂要复现的东西。 */
function legacyArgsVerdict(call) {
  const spec = LEGACY.tools[call.tool]
  if (!spec) return { ok: false, why: 'unknown tool' }
  const action = typeof call.args?.action === 'string' ? call.args.action : null
  const actionSpec = action ? spec.actions?.[action] : spec.actions?.integration
  if (!actionSpec) return { ok: false, why: `unknown action ${action ?? '(none)'}` }
  const missing = (actionSpec.runtimeRequired ?? []).filter((k) => call.args?.[k] === undefined)
  if (missing.length) return { ok: false, why: `missing runtime-required: ${missing.join(', ')}` }
  // mustCompute 字段（版本号这类）即使给了也几乎必错：模型无从算起。
  const computed = Object.entries(actionSpec.classes ?? {}).filter(([k, cls]) => cls === 'mustCompute' && call.args?.[k] !== undefined)
  if (computed.length) return { ok: false, why: `guessed host-computed field(s): ${computed.map(([k]) => k).join(', ')}` }
  return { ok: true, why: '' }
}

function callId(call) {
  const action = typeof call.args?.action === 'string' ? call.args.action : null
  return action ? `${call.tool}:${action}` : call.tool
}

/** 参数一次写对 = 过 schema 的 required + 类型，且没碰禁用字段。 */
function argsVerdict(call) {
  const tool = toolByName.get(call.tool)
  if (!tool) return { ok: false, why: 'unknown tool' }
  const schema = tool.inputSchema ?? {}
  const props = schema.properties ?? {}
  const args = call.args ?? {}
  const forbidden = Object.keys(args).filter((k) => FORBIDDEN.includes(k))
  if (forbidden.length) return { ok: false, why: `forbidden field(s): ${forbidden.join(', ')}` }
  const unknown = Object.keys(args).filter((k) => !(k in props))
  if (unknown.length) return { ok: false, why: `invented field(s): ${unknown.join(', ')}` }
  const missing = (schema.required ?? []).filter((k) => args[k] === undefined)
  if (missing.length) return { ok: false, why: `missing required: ${missing.join(', ')}` }
  for (const [k, v] of Object.entries(args)) {
    const spec = props[k]
    if (!spec) continue
    if (spec.enum && !spec.enum.includes(v)) return { ok: false, why: `${k}="${v}" not in enum` }
    if (spec.type === 'string' && typeof v !== 'string') return { ok: false, why: `${k} should be string` }
    if (spec.type === 'array' && !Array.isArray(v)) return { ok: false, why: `${k} should be array` }
  }
  return { ok: true, why: '' }
}

const cases = LIMIT ? BANK.cases.slice(0, LIMIT) : BANK.cases
const results = []
let totalCalls = 0, okCalls = 0, firstCallRight = 0, firstCallRightLenient = 0, noCall = 0

for (const [index, testCase] of cases.entries()) {
  process.stderr.write(`[${index + 1}/${cases.length}] ${testCase.id} … `)
  const { calls, raw, timedOut } = runCase(testCase, index)
  const first = calls[0] ?? null
  const expectedFirst = expectedFirstFor(testCase)
  const firstOk = Boolean(first) && callId(first) === expectedFirst
  if (firstOk) firstCallRight += 1
  if (!first) noCall += 1
  // 宽松读数：允许先读一眼再动手。`nomi_list_models` 的描述**明说**「before every other call here」，
  // 所以模型拿它开场是在照描述做事，不是走错。严格读数照 expectedFirstCall 记，两个数都报，
  // 差值本身就是「声明怎么说」和「题库怎么期望」之间的缝。
  const afterReads = calls.filter((c) => c.tool !== 'nomi_list_models' && c.tool !== 'nomi_read')
  const firstAfterRead = afterReads[0] ?? null
  const leadOk = expectedFirst === 'nomi_list_models' || expectedFirst === 'nomi_read:integration'
    ? firstOk
    : Boolean(firstAfterRead) && callId(firstAfterRead) === expectedFirst
  if (leadOk) firstCallRightLenient += 1
  const verdicts = calls.map((c) => ({ call: callId(c), ...(ARM === 'legacy' ? legacyArgsVerdict(c) : argsVerdict(c)) }))
  totalCalls += verdicts.length
  okCalls += verdicts.filter((v) => v.ok).length
  results.push({ id: testCase.id, utterance: testCase.utterance, expectedFirstCall: expectedFirst,
    actualFirstCall: first ? callId(first) : null, firstCallCorrect: firstOk,
    firstCallCorrectIgnoringLeadingReads: leadOk,
    actualCallChain: calls.map(callId), calls: verdicts, timedOut,
    ...(first ? {} : { rawTail: raw.slice(-600) }) })
  process.stderr.write(`${firstOk ? 'first-call ✓' : `first-call ✗ (${first ? callId(first) : 'no call'})`}  args ${verdicts.filter((v) => v.ok).length}/${verdicts.length}\n`)
}

const summary = {
  driver: DRIVER, arm: ARM, at: new Date().toISOString(), bank: BANK.version ?? null,
  cases: cases.length,
  firstCallCorrect: firstCallRight,
  firstCallCorrectRate: Number((firstCallRight / cases.length).toFixed(3)),
  firstCallCorrectIgnoringLeadingReads: firstCallRightLenient,
  firstCallCorrectIgnoringLeadingReadsRate: Number((firstCallRightLenient / cases.length).toFixed(3)),
  casesWithNoToolCall: noCall,
  totalCalls, argsFirstTryOk: okCalls,
  firstTryArgumentRate: totalCalls ? Number((okCalls / totalCalls).toFixed(3)) : null,
  targets: BANK.targets,
}
console.log(JSON.stringify({ summary, results }, null, 2))
process.stderr.write(`\n=== ${DRIVER} · arm=${ARM} ===\nfirst-call (strict) ${firstCallRight}/${cases.length} (${(summary.firstCallCorrectRate * 100).toFixed(1)}%)\nfirst-call (ignoring leading nomi_list_models) ${firstCallRightLenient}/${cases.length} (${(summary.firstCallCorrectIgnoringLeadingReadsRate * 100).toFixed(1)}%)\nargs first-try ${okCalls}/${totalCalls} (${summary.firstTryArgumentRate === null ? 'n/a' : (summary.firstTryArgumentRate * 100).toFixed(1) + '%'})\nno tool call at all: ${noCall}\n`)
if (OUT) fs.writeFileSync(OUT, JSON.stringify({ summary, results }, null, 2))
