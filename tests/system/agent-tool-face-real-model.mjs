// R30 · 真实模型腿（设计正本 §8.1）：42 句用户会说的话，各跑一回合，量三个数。
//
//   选对工具率 = 首调 ∈ expectedFirst 的句数 / 42
//   入参写对率 = 每一次调用都过 prepareArguments → pi 的 validateToolArguments 的句数 / 42
//   回合成功率 = 选对 ∧ 入参对 ∧ 轨迹按序含 expectedTrajectory ∧ 没碰 forbiddenVerbs ∧（调了 generate 的）收尾文字没有声称已开始生成
//
// 工具层是**真的**（`createLaneTools` + 声明上的 prepareArguments + pi 校验 + 真返回信封 `User sees:`），
// 只有领域端口是夹具（画布/文稿/时间轴/生成域返回固定事实）；模型是真的（DeepSeek 官方端点）。
// 密钥只从环境变量读，绝不打印、绝不落盘。产出：results.json + summary.md（数字进 PR 正文）。
/* global process, console, URL, fetch */
// 跑法：`npx tsx tests/system/agent-tool-face-real-model.mjs`（lane 运行时是 ESM 原生 .mts，要走 tsx 的 ESM loader）。
import fs from 'node:fs'
import path from 'node:path'
import { validateToolArguments } from '@earendil-works/pi-ai'
import { BACKGROUND_CONTEXT } from '@earendil-works/pi-agent-core/harness/context'

const here = path.dirname(new URL(import.meta.url).pathname)
const repoRoot = path.resolve(here, '..', '..')
const evidenceDir = path.join(repoRoot, 'docs/plan/agent-tool-face-v2-evidence')
const bank = JSON.parse(fs.readFileSync(path.join(evidenceDir, 'r30-bank.json'), 'utf8'))
const apiKey = process.env.DEEPSEEK_API_KEY
if (!apiKey) { console.error('DEEPSEEK_API_KEY is not set (source ~/.nomi-secrets.env)'); process.exit(2) }
const MODEL = process.env.NOMI_R30_MODEL || 'deepseek-chat'
const ENDPOINT = process.env.NOMI_R30_ENDPOINT || 'https://api.deepseek.com/chat/completions'
const CONCURRENCY = Number(process.env.NOMI_R30_CONCURRENCY || 4)
const MAX_ROUNDS = 6

const { createDocumentLaneTools } = await import('../../electron/agentLane/laneDocumentTools.ts')
const { createCanvasLaneTools } = await import('../../electron/agentLane/laneCanvasTools.ts')
const { createTimelineLaneTools } = await import('../../electron/agentLane/laneTimelineTools.ts')
const { createExtendedLaneTools } = await import('../../electron/agentLane/laneExtendedTools.ts')
const { bindLaneTool } = await import('../../electron/agentLane/laneRuntimePort.ts')
const { specsForCapability, modelFacingToolSpecs } = await import('../../electron/shared/agentCapabilities/modelFacingToolRegistry.ts')
const { createLaneTools } = await import('../../electron/agentLane/laneTools.mts')
const { createLaneModelRead } = await import('../../electron/agentLane/laneModelRead.mts')
const { composeLaneSystemPrompt } = await import('../../electron/agentLane/lanePromptSections.ts')

// ── 夹具世界：一个有 6 镜 + 1 张角色卡 + 2 个空节点的项目。形状按契约的结果 schema 走（启动时先 parse，夹具不合法就不许开跑）。
const { canvasReadResultSchema } = await import('../../electron/shared/agentCapabilities/canvasRead.ts')
const { timelineReadResultSchema } = await import('../../electron/shared/agentCapabilities/timelineRead.ts')
const node = (id, kind, title, prompt, status, x, y, extra = {}) => ({ id, kind, title, prompt, status, position: { x, y }, locked: false, hasResult: status === 'success', ...extra })
const shots = [1, 2, 3, 4, 5, 6].map((i) => node(`shot-${i}`, i <= 3 ? 'keyframe' : 'video', `镜头 ${i}`, `第 ${i} 镜：海边小镇的清晨`, i === 4 ? 'running' : 'idle', i * 320, 0, { shotIndex: i }))
const canvas = canvasReadResultSchema.parse({
  nodes: [...shots, node('node-char', 'character', '林夏', '17 岁女生，短发校服', 'success', 0, 400), node('node-empty-1', 'image', '空节点 A', '', 'idle', 0, 800), node('node-empty-2', 'image', '空节点 B', '', 'idle', 320, 800)],
  edges: [], groups: [{ id: 'group-intro', name: '开场', nodeIds: ['shot-1', 'shot-2'], collapsed: false }], selectedNodeIds: ['shot-3'],
})
const script = '海边小镇的清晨。林夏推开窗，风带着咸味。她拿起相机走向码头。渔船正要出海。她按下快门。一天开始了。'
const timeline = timelineReadResultSchema.parse({ operation: 'read_timeline', revision: 'r1', fps: 30, scale: 1, playheadFrame: 0, durationFrames: 0, valid: true, tracks: [{ id: 'v1', type: 'video', label: 'V1', clips: [] }], textClips: [], transitions: [] })
const models = [
  { modelKey: 'gpt-image-2', kind: 'image', label: 'GPT Image 2', vendorKey: 'openai', modes: [{ modeId: 't2i', label: '文生图', params: [{ key: 'aspect_ratio', type: 'select', options: [{ value: '1:1' }, { value: '16:9' }, { value: '9:16' }] }] }] },
  { modelKey: 'kling-2.1', kind: 'video', label: 'Kling 2.1', vendorKey: 'kling', modes: [{ modeId: 't2v', label: '文生视频', params: [{ key: 'duration', type: 'select', options: [{ value: '5' }, { value: '10' }] }] }, { modeId: 'i2v', label: '图生视频', params: [{ key: 'duration', type: 'select', options: [{ value: '5' }, { value: '10' }] }] }] },
  { modelKey: 'seedance-1.5', kind: 'video', label: 'Seedance 1.5', vendorKey: 'bytedance', modes: [{ modeId: 't2v', label: '文生视频', params: [] }, { modeId: 'i2v', label: '图生视频', params: [] }] },
]
const skillIndex = '<available_skills>\n- 口播成片 (talking-head-cut): 把口播素材剪成成片\n- UGC ad (ugc-ad): UGC 风格产品广告\n</available_skills>'

function fakePorts() {
  return [
    ...createDocumentLaneTools({ read: async (scope) => ({ text: scope === 'selection' ? '海边小镇的清晨。' : script }), write: async () => ({ applied: true, revision: 2, contentHash: 'h2' }) }),
    ...createCanvasLaneTools({ read: async () => canvas, write: async (input) => {
      const base = { applied: true, proposalId: 'p-1', reconciliation: { ok: true, deviationCount: 0 } }
      if (input.operation === 'create_canvas_nodes') return { ...base, operation: input.operation, affectedNodeIds: ['node-art-1'], affectedEdgeIds: [], clientIdToNodeId: { 'artifact-1': 'node-art-1' }, connectedCount: 0, skippedEdges: [] }
      if (input.operation === 'connect_canvas_edges') return { ...base, operation: input.operation, affectedNodeIds: [], affectedEdgeIds: ['e-1'], connectedCount: input.edges.length, skippedEdges: [] }
      if (input.operation === 'tidy_canvas') return { ...base, operation: input.operation, affectedNodeIds: shots.map((s) => s.id) }
      if (input.operation === 'connect_canvas_edges') return { ...base, operation: input.operation, affectedNodeIds: [], affectedEdgeIds: ['e-1'], connectedCount: (input.edges ?? []).length, skippedEdges: [] }
      return { ...base, operation: input.operation, result: {} }
    } }),
    ...createTimelineLaneTools({ read: async (input) => input.operation === 'read_timeline' ? timeline : { operation: 'inspect_timeline_range', revision: 'r1', startFrame: input.startFrame, endFrame: input.endFrame, tracks: [], textClips: [] } }),
    ...createExtendedLaneTools({ execute: async (call) => {
      const a = call.args ?? {}
      switch (call.toolName) {
        case 'draft_shots': return { ok: true, result: { operation: { operationId: a.draftId ?? 'op-1', state: 'draft', cardHidden: true, shots: (a.shots ?? []).map((s, i) => ({ shotId: s.shotId ?? `shot-${7 + i}`, candidate: { prompt: s.prompt } })) }, clamps: [] } }
        case 'generate': return { ok: true, result: { operation: { operationId: a.draftId, state: 'draft' }, shots: a.shotIds ?? ['shot-1'], nextAction: 'await_user' } }
        case 'check_job': return { ok: true, result: { operation: { operationId: a.jobId, state: 'submitted', progress: 40, spent: { amount: 0.2, currency: 'CNY' } } } }
        case 'cancel_job': return { ok: true, result: { operation: { operationId: a.jobId, state: 'cancelled' } } }
        case 'edit_timeline': return { ok: true, result: { applied: true, revision: 'r2', undoToken: 'undo-1' } }
        case 'undo': return { ok: true, result: { applied: true, revision: 'r1' } }
        case 'delete_from_canvas': return { ok: true, result: { applied: true, operation: 'delete_canvas_nodes', deletedNodeIds: a.nodeIds ?? [] } }
        case 'export_video': return { ok: true, result: { jobId: 'export-1', status: 'queued' } }
        case 'look_at_media': return { ok: true, result: { operation: 'search_media', assets: [{ assetId: 'asset-rain-1', name: '雨天街道.mp4', kind: 'video', durationSeconds: 12 }] } }
        case 'read_skill': return { ok: true, result: { name: a.name, body: '# 技能正文\n1. 读文稿 2. 拆镜头 3. 生成' } }
        case 'save_skill': return { ok: true, result: { saved: true, dirName: a.dirName } }
        default: return { ok: false, code: 'capability_unsupported', message: 'fixture has no port for ' + call.toolName }
      }
    } }),
    ...specsForCapability('model.setup.open').map((spec) => bindLaneTool(spec, async (args) => ({ ok: true, text: 'Nomi opened the model settings panel.', details: { opened: true }, nextAction: { kind: 'user_sees_panel', userSees: `The model settings panel is open${args.provider ? ` on ${args.provider}` : ''}; the user pastes the API key there. This call stored nothing.` } }))),
  ]
}

const descriptors = fakePorts()
const piTools = [...createLaneTools(descriptors), createLaneModelRead(() => models)]
const specByName = new Map(modelFacingToolSpecs('internal').map((s) => [s.name, s]))
const IDENTITY = ['You are Nomi, the assistant inside a local-first AI video workbench.', 'The user is making a short film. Use the tools to act on the script, canvas and timeline; reply in the user\'s language.'].join(' ')
const systemPrompt = composeLaneSystemPrompt(IDENTITY, [...descriptors, specByName.get('list_models')], skillIndex)
const wireTools = piTools.map((tool) => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.parameters } }))

async function chat(messages) {
  const response = await fetch(ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: MODEL, temperature: 0, messages, tools: wireTools, tool_choice: 'auto' }) })
  if (!response.ok) throw new Error(`deepseek http ${response.status}: ${(await response.text()).slice(0, 200)}`)
  return response.json()
}

async function runCase(entry) {
  const messages = [{ role: 'system', content: systemPrompt }, { role: 'user', content: entry.say }]
  const trajectory = []; let usage = { prompt_tokens: 0, completion_tokens: 0, cache_hit: 0 }; let finalText = ''
  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    const reply = await chat(messages)
    usage.prompt_tokens += reply.usage?.prompt_tokens ?? 0; usage.completion_tokens += reply.usage?.completion_tokens ?? 0; usage.cache_hit += reply.usage?.prompt_cache_hit_tokens ?? 0
    const message = reply.choices?.[0]?.message
    if (!message) break
    messages.push(message)
    const calls = message.tool_calls ?? []
    if (calls.length === 0) { finalText = message.content ?? ''; break }
    for (const call of calls) {
      const name = call.function?.name; let args
      try { args = JSON.parse(call.function?.arguments || '{}') } catch { args = call.function?.arguments }
      const tool = piTools.find((t) => t.name === name)
      const record = { name, args, valid: false, isError: false, text: '' }
      trajectory.push(record)
      if (!tool) { record.text = `Tool "${name}" is unavailable`; record.isError = true }
      else {
        try {
          const validated = validateToolArguments(tool, { id: call.id, type: 'toolCall', name, arguments: args })
          record.valid = true
          try {
            const result = await tool.execute(call.id, validated, () => undefined, undefined, {}, BACKGROUND_CONTEXT)
            record.text = (result.content ?? []).map((p) => p.text ?? '').join('\n')
          } catch (error) { record.isError = true; record.text = String(error?.message ?? error) }
        } catch (error) { record.isError = true; record.text = String(error?.message ?? error) }
      }
      messages.push({ role: 'tool', tool_call_id: call.id, content: record.text.slice(0, 6000) })
    }
  }
  return judge(entry, trajectory, finalText, usage)
}

const CLAIMS_STARTED = /已经?开始生成|正在生成|已提交生成|生成中|has started|is generating|started generating|now generating|generation (?:has )?started/i
const MENTIONS_CARD = /确认|报价|卡片|卡|批准|点头|card|confirm|approv|price|cost/i
function judge(entry, trajectory, finalText, usage) {
  const names = trajectory.map((t) => t.name)
  const firstOk = names.length > 0 && entry.expectedFirst.includes(names[0])
  const argsOk = trajectory.length > 0 && trajectory.every((t) => t.valid)
  let cursor = 0
  for (const name of names) if (name === entry.expectedTrajectory[cursor]) cursor += 1
  const trajectoryOk = cursor === entry.expectedTrajectory.length
  const forbiddenHit = names.filter((n) => entry.forbiddenVerbs.includes(n))
  const generateCalled = names.includes('generate')
  const claimOk = !generateCalled || (!CLAIMS_STARTED.test(finalText) && MENTIONS_CARD.test(finalText))
  const turnOk = firstOk && argsOk && trajectoryOk && forbiddenHit.length === 0 && claimOk
  return { id: entry.id, say: entry.say, lang: entry.lang, persona: entry.persona, bucket: entry.bucket, first: names[0] ?? null, trajectory: names, firstOk, argsOk, trajectoryOk, forbiddenHit, claimOk, turnOk, finalText: finalText.slice(0, 400), invalid: trajectory.filter((t) => !t.valid).map((t) => ({ name: t.name, args: t.args, text: t.text.slice(0, 300) })), usage }
}

async function main() {
  const queue = [...bank.cases]; const results = []
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => { while (queue.length) { const entry = queue.shift(); try { results.push(await runCase(entry)) } catch (error) { results.push({ id: entry.id, say: entry.say, lang: entry.lang, persona: entry.persona, bucket: entry.bucket, error: String(error?.message ?? error), firstOk: false, argsOk: false, turnOk: false, trajectory: [] }) } } }))
  results.sort((a, b) => a.id.localeCompare(b.id))
  const n = results.length
  const count = (key) => results.filter((r) => r[key]).length
  const by = (field) => { const out = {}; for (const r of results) { const k = r[field]; out[k] ??= { n: 0, firstOk: 0, argsOk: 0, turnOk: 0 }; out[k].n += 1; if (r.firstOk) out[k].firstOk += 1; if (r.argsOk) out[k].argsOk += 1; if (r.turnOk) out[k].turnOk += 1 } return out }
  const usage = results.reduce((acc, r) => ({ prompt: acc.prompt + (r.usage?.prompt_tokens ?? 0), completion: acc.completion + (r.usage?.completion_tokens ?? 0), cacheHit: acc.cacheHit + (r.usage?.cache_hit ?? 0) }), { prompt: 0, completion: 0, cacheHit: 0 })
  const summary = { model: MODEL, ranAt: new Date().toISOString(), total: n, firstToolAccuracy: `${count('firstOk')}/${n}`, argumentAccuracy: `${count('argsOk')}/${n}`, turnSuccess: `${count('turnOk')}/${n}`, byLang: by('lang'), byPersona: by('persona'), byBucket: by('bucket'), usage }
  fs.writeFileSync(path.join(evidenceDir, 'r30-results.json'), JSON.stringify({ summary, results }, null, 2) + '\n')
  const rows = results.map((r) => `| ${r.id} | ${r.say.replace(/\|/g, '\\|')} | ${r.first ?? '—'} | ${r.trajectory.join(' → ') || '—'} | ${r.firstOk ? '✓' : '✗'} | ${r.argsOk ? '✓' : '✗'} | ${r.turnOk ? '✓' : '✗'} | ${r.forbiddenHit?.length ? r.forbiddenHit.join(',') : ''}${r.error ? ' ERR ' + r.error.slice(0, 60) : ''} |`)
  const table = (obj) => Object.entries(obj).map(([k, v]) => `| ${k} | ${v.n} | ${v.firstOk}/${v.n} | ${v.argsOk}/${v.n} | ${v.turnOk}/${v.n} |`).join('\n')
  const md = [`# R30 · 真实模型腿 · ${MODEL} · ${summary.ranAt}`, '', `- 选对工具率（首调 ∈ expectedFirst）：**${summary.firstToolAccuracy}**`, `- 入参写对率（每次调用都过 prepareArguments → pi 校验）：**${summary.argumentAccuracy}**`, `- 回合成功率（选对 ∧ 入参对 ∧ 轨迹按序 ∧ 无禁用动词 ∧ 不声称已生成）：**${summary.turnSuccess}**`, `- tokens：prompt ${usage.prompt}（其中缓存命中 ${usage.cacheHit}）· completion ${usage.completion}`, '', '## 按语言', '| lang | n | 选对 | 入参 | 回合 |', '|---|---|---|---|---|', table(summary.byLang), '', '## 按新老手', '| persona | n | 选对 | 入参 | 回合 |', '|---|---|---|---|---|', table(summary.byPersona), '', '## 按意图桶', '| bucket | n | 选对 | 入参 | 回合 |', '|---|---|---|---|---|', table(summary.byBucket), '', '## 逐句', '| id | 用户说 | 首调 | 轨迹 | 选对 | 入参 | 回合 | 禁用/错误 |', '|---|---|---|---|---|---|---|---|', ...rows, ''].join('\n')
  fs.writeFileSync(path.join(evidenceDir, 'r30-summary.md'), md)
  console.log(JSON.stringify(summary, null, 2))
}
main().catch((error) => { console.error(error); process.exit(1) })
