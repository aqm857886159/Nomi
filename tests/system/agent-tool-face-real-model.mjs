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
// 题库可换（`NOMI_R30_BANK`），结果写回题库自己那个目录。**一套 harness 两个题库**，不是两套 harness：
// 动词面的 42 句和技能面的 22 句量的是同一件事（选对工具 / 入参写对 / 回合成功），
// 分成两个脚本就等于两份判据，而判据一旦分叉，「修好了」在哪一份里成立都说不清。
const bankPath = path.resolve(repoRoot, process.env.NOMI_R30_BANK || 'docs/plan/agent-tool-face-v2-evidence/r30-bank.json')
const evidenceDir = path.dirname(bankPath)
const outPrefix = path.basename(bankPath).replace(/bank\.json$/, '').replace(/[-_]$/, '') || 'r30'
const bank = JSON.parse(fs.readFileSync(bankPath, 'utf8'))
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
// ── 第二个夹具世界：**刚建好的空项目**。
//
// 为什么必须有它：上面那个世界已经装着一部别人的片子（海边小镇 / 林夏 6 镜）。对「给我做一条 30 秒
// 的雨夜便利店短片」这种从零起头的话，模型在那个世界里**正确地**先问「旧的替换还是并存」——
// 于是整轮停在提问上，一个镜头都没建。拿那一轮去判「它有没有先立人物资产」，量到的是
// 「它问了一句」，不是「它缺原则」（lessons/assert-you-are-in-the-situation-you-claim）。
// 「用户刚开一个项目就说做一条片子」这件事，只有在空项目里才成立。
const emptyCanvas = canvasReadResultSchema.parse({ nodes: [], edges: [], groups: [], selectedNodeIds: [] })
const script = '海边小镇的清晨。林夏推开窗，风带着咸味。她拿起相机走向码头。渔船正要出海。她按下快门。一天开始了。'
const timeline = timelineReadResultSchema.parse({ operation: 'read_timeline', revision: 'r1', fps: 30, scale: 1, playheadFrame: 0, durationFrames: 0, valid: true, tracks: [{ id: 'v1', type: 'video', label: 'V1', clips: [] }], textClips: [], transitions: [] })
const models = [
  { modelKey: 'gpt-image-2', kind: 'image', label: 'GPT Image 2', vendorKey: 'openai', modes: [{ modeId: 't2i', label: '文生图', params: [{ key: 'aspect_ratio', type: 'select', options: [{ value: '1:1' }, { value: '16:9' }, { value: '9:16' }] }] }] },
  { modelKey: 'kling-2.1', kind: 'video', label: 'Kling 2.1', vendorKey: 'kling', modes: [{ modeId: 't2v', label: '文生视频', params: [{ key: 'duration', type: 'select', options: [{ value: '5' }, { value: '10' }] }] }, { modeId: 'i2v', label: '图生视频', params: [{ key: 'duration', type: 'select', options: [{ value: '5' }, { value: '10' }] }] }] },
  { modelKey: 'seedance-1.5', kind: 'video', label: 'Seedance 1.5', vendorKey: 'bytedance', modes: [{ modeId: 't2v', label: '文生视频', params: [] }, { modeId: 'i2v', label: '图生视频', params: [] }] },
]
// 技能索引用**真实技能库**渲染（production 走的是同一对函数），不是两条编出来的假技能：
// 「直接出片」那一组要量的正是「它有没有自己去找一个技能」，而假索引里没有可找的东西。
const { readSkillRecords, findSkillRecord, isSkillSelectableInWorkbench } = await import('../../electron/skills/skillStore.ts')
const { renderLaneSkillSection, loadPiSkillFormatter, laneSkillRequiresCodingTools } = await import('../../electron/agentLane/laneSkillIndex.mts')
const { buildSelectedSkillPrompt } = await import('../../electron/harness/context/agentContext.ts')
const { parseSkillFrontmatter } = await import('../../electron/skills/skillFrontmatter.ts')
const skillRecords = readSkillRecords().filter(isSkillSelectableInWorkbench)
const skillIndex = renderLaneSkillSection(await loadPiSkillFormatter(), skillRecords.map((record) => ({
  name: record.name, description: record.description, filePath: record.filePath,
  disableModelInvocation: record.disableModelInvocation,
  requiresCodingTools: laneSkillRequiresCodingTools({ frontmatterValues: parseSkillFrontmatter(record.body).values }),
})))
// 两条臂。`owner` = 现在的生产线（`buildSelectedSkillPrompt`）；`raw` 逐字复现 2026-09-15 之前
// 那一行（`laneDesktopRuntime.ts` 的 `[next.systemPrompt, skill?.body]`），**只为了让前后数字
// 落在同一份判据上**。它不是一个生产开关，生产侧只有 owner 一条路。
const SKILL_ARM = process.env.NOMI_R30_SKILL_ARM === 'raw' ? 'raw' : 'owner'
const selectedSkillBlock = (skillKey) => {
  if (!skillKey) return ''
  const record = findSkillRecord(skillKey, '', skillRecords)
  if (!record) throw new Error(`bank names a skill that is not installed: ${skillKey}`)
  return SKILL_ARM === 'raw' ? record.body : buildSelectedSkillPrompt(record)
}

function fakePorts(world = 'default') {
  const worldCanvas = world === 'empty' ? emptyCanvas : canvas
  const worldScript = world === 'empty' ? '' : script
  return [
    ...createDocumentLaneTools({ read: async (scope) => ({ text: scope === 'selection' ? worldScript.slice(0, 7) : worldScript }), write: async () => ({ applied: true, revision: 2, contentHash: 'h2' }) }),
    ...createCanvasLaneTools({ read: async () => worldCanvas, write: async (input) => {
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
        // 真实正文：模型自己决定去读某个技能时，它读到的必须是盘上那份，否则「读了也没用上」分不清
        // 是它没读懂还是我们喂了个假的（lessons/lab-fixtures-must-mirror-real-callsites）。
        case 'read_skill': {
          const found = findSkillRecord(String(a.name ?? ''), String(a.name ?? ''), skillRecords)
          if (!found) return { ok: false, code: 'skill_not_found', message: `No installed skill named ${a.name}` }
          return { ok: true, result: { name: found.name, body: found.body } }
        }
        case 'save_skill': return { ok: true, result: { saved: true, dirName: a.dirName } }
        default: return { ok: false, code: 'capability_unsupported', message: 'fixture has no port for ' + call.toolName }
      }
    } }),
    ...specsForCapability('model.setup.open').map((spec) => bindLaneTool(spec, async (args) => ({ ok: true, text: 'Nomi opened the model settings panel.', details: { opened: true }, nextAction: { kind: 'user_sees_panel', userSees: `The model settings panel is open${args.provider ? ` on ${args.provider}` : ''}; the user pastes the API key there. This call stored nothing.` } }))),
  ]
}

const specByName = new Map(modelFacingToolSpecs('internal').map((s) => [s.name, s]))
// 身份层用**生产那一份**（`laneDesktopRuntime` 的 `systemPrompt: () => [buildLanguageRule(), NOMI_AGENT_IDENTITY, memory]`）。
// 此前这里是两句手写的英文身份——于是这条腿量的是一个没人用过的提示词，改了生产身份它一个数字都不动
// （lessons/lab-fixtures-must-mirror-real-callsites）。项目记忆那一段夹具没有，留空。
const { NOMI_AGENT_IDENTITY, buildLanguageRule } = await import('../../electron/harness/context/agentContext.ts')
// `raw` 臂 = 2026-09-14 的身份层。**逐字复现**：那天之后只在末尾追加了「出片原则」那一节，
// 所以在这个标记处切一刀再 trimEnd，得到的就是那天那个字符串；生产侧没有这条分支。
const PRINCIPLES_MARKER = '\n\n出片原则（每次都适用）：'
const identityFor = (arm) => arm === 'raw' && NOMI_AGENT_IDENTITY.includes(PRINCIPLES_MARKER)
  ? NOMI_AGENT_IDENTITY.slice(0, NOMI_AGENT_IDENTITY.indexOf(PRINCIPLES_MARKER))
  : NOMI_AGENT_IDENTITY
const IDENTITY = [buildLanguageRule(), identityFor(process.env.NOMI_R30_SKILL_ARM === 'raw' ? 'raw' : 'owner')].join('\n\n')
// 回合提示词的拼装顺序与 `laneHost` 的 `transform_context` 一致：宿主段 → 这条消息带的 composer 段。
const worldCache = new Map()
const worldFor = (world = 'default') => {
  if (!worldCache.has(world)) {
    const descriptors = fakePorts(world)
    const piTools = [...createLaneTools(descriptors), createLaneModelRead(() => models)]
    worldCache.set(world, { piTools,
      hostPrompt: composeLaneSystemPrompt(IDENTITY, [...descriptors, specByName.get('list_models')], skillIndex),
      wireTools: piTools.map((tool) => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.parameters } })) })
  }
  return worldCache.get(world)
}
const promptCache = new Map()
const promptFor = (skillKey, world = 'default') => {
  const key = `${world}|${skillKey ?? ''}`
  if (!promptCache.has(key)) {
    const block = selectedSkillBlock(skillKey)
    const base = worldFor(world).hostPrompt
    promptCache.set(key, block ? `${base}\n\n${block}` : base)
  }
  return promptCache.get(key)
}
async function chat(messages, wireTools) {
  const response = await fetch(ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: MODEL, temperature: 0, messages, tools: wireTools, tool_choice: 'auto' }) })
  if (!response.ok) throw new Error(`deepseek http ${response.status}: ${(await response.text()).slice(0, 200)}`)
  return response.json()
}

async function runCase(entry) {
  const { piTools, wireTools } = worldFor(entry.world)
  const messages = [{ role: 'system', content: promptFor(entry.skillKey, entry.world) }, { role: 'user', content: entry.say }]
  const trajectory = []; let usage = { prompt_tokens: 0, completion_tokens: 0, cache_hit: 0 }; let finalText = ''
  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    const reply = await chat(messages, wireTools)
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
// 「技能被用上了没有」的判据。标记词取自该技能**正文里的专有说法**，不是句子本身能推出来的词；
// 同一句话不挂技能的对照组就是这些标记的校准器——对照也命中，说明标记不合格（记进证据文档）。
function skillEvidence(entry, trajectory, finalText) {
  if (!entry.evidenceText?.length && !entry.evidenceArgs?.length) return {}
  const argsBlob = JSON.stringify(trajectory.map((t) => t.args ?? {}))
  const hitText = (entry.evidenceText ?? []).filter((needle) => finalText.includes(needle))
  const hitArgs = (entry.evidenceArgs ?? []).filter((needle) => argsBlob.includes(needle))
  const textOk = (entry.evidenceText ?? []).length === 0 || hitText.length > 0
  const argsOk = (entry.evidenceArgs ?? []).length === 0 || hitArgs.length > 0
  return { skillVisible: textOk, skillParamOk: argsOk, skillOk: textOk && argsOk, hitText, hitArgs }
}

// 「直接出片」那五句要验的原则。每条都从**这一轮真的发生了什么**读，不问模型。
const PRINCIPLE_CHECKS = {
  // 建了人物/场景资产（角色卡、定妆卡）——drama-short 说这是命门，Agent 自述里正是它没做。
  'character-asset': (t) => t.some((c) => c.name === 'draft_shots'
    && /character|角色|人物|定妆|设定/.test(JSON.stringify(c.args ?? {}))),
  // 用了参考图模式（i2v / 参考槽 / 连参考边），而不是每镜纯文生视频。
  'reference-mode': (t) => t.some((c) => (c.name === 'draft_shots' || c.name === 'arrange_canvas')
    && /i2v|图生|reference|referenc|character_ref|firstFrame|first_frame/.test(JSON.stringify(c.args ?? {}))),
  // 自己去查了一条技能（索引就在系统提示词里，read_skill 也在工具面上）。
  'skill-consulted': (t) => t.some((c) => c.name === 'read_skill'),
  // 画幅落成了参数（问了用户也算做到：那句话会出现在收尾文字里，由 asked 补判）。
  'aspect-ratio-asked': (t, text) => t.some((c) => /aspect|aspectRatio|16:9|9:16/.test(JSON.stringify(c.args ?? {})))
    || /画幅|横屏|竖屏|16:9|9:16|aspect ratio/.test(text),
}
function principles(entry, trajectory, finalText) {
  if (!entry.principles?.length) return {}
  const met = {}
  for (const key of entry.principles) met[key] = Boolean(PRINCIPLE_CHECKS[key]?.(trajectory, finalText))
  return { principles: met, principlesMet: Object.values(met).filter(Boolean).length, principlesTotal: entry.principles.length }
}

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
  return { id: entry.id, say: entry.say, lang: entry.lang, persona: entry.persona, bucket: entry.bucket, ...(entry.skillKey ? { skillKey: entry.skillKey } : {}), ...(entry.controlFor ? { controlFor: entry.controlFor } : {}), first: names[0] ?? null, trajectory: names, firstOk, argsOk, trajectoryOk, forbiddenHit, claimOk, turnOk, ...skillEvidence(entry, trajectory, finalText), ...principles(entry, trajectory, finalText), finalText: finalText.slice(0, 900), toolArgs: trajectory.map((t) => ({ name: t.name, args: t.args })), invalid: trajectory.filter((t) => !t.valid).map((t) => ({ name: t.name, args: t.args, text: t.text.slice(0, 300) })), usage }
}

async function main() {
  const queue = [...bank.cases]; const results = []
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => { while (queue.length) { const entry = queue.shift(); try { results.push(await runCase(entry)) } catch (error) { results.push({ id: entry.id, say: entry.say, lang: entry.lang, persona: entry.persona, bucket: entry.bucket, error: String(error?.message ?? error), firstOk: false, argsOk: false, turnOk: false, trajectory: [] }) } } }))
  results.sort((a, b) => a.id.localeCompare(b.id))
  const n = results.length
  const count = (key) => results.filter((r) => r[key]).length
  const by = (field) => { const out = {}; for (const r of results) { const k = r[field]; out[k] ??= { n: 0, firstOk: 0, argsOk: 0, turnOk: 0 }; out[k].n += 1; if (r.firstOk) out[k].firstOk += 1; if (r.argsOk) out[k].argsOk += 1; if (r.turnOk) out[k].turnOk += 1 } return out }
  const usage = results.reduce((acc, r) => ({ prompt: acc.prompt + (r.usage?.prompt_tokens ?? 0), completion: acc.completion + (r.usage?.completion_tokens ?? 0), cacheHit: acc.cacheHit + (r.usage?.cache_hit ?? 0) }), { prompt: 0, completion: 0, cacheHit: 0 })
  const withSkillMetric = results.filter((r) => r.skillOk !== undefined)
  const skillMetrics = withSkillMetric.length === 0 ? undefined : {
    n: withSkillMetric.length,
    skillVisible: `${withSkillMetric.filter((r) => r.skillVisible).length}/${withSkillMetric.length}`,
    skillParamOk: `${withSkillMetric.filter((r) => r.skillParamOk).length}/${withSkillMetric.length}`,
    skillOk: `${withSkillMetric.filter((r) => r.skillOk).length}/${withSkillMetric.length}`,
    selected: (() => { const sel = withSkillMetric.filter((r) => r.skillKey); return `${sel.filter((r) => r.skillOk).length}/${sel.length}` })(),
    control: (() => { const ctl = withSkillMetric.filter((r) => !r.skillKey); return `${ctl.filter((r) => r.skillOk).length}/${ctl.length}` })(),
  }
  const withPrinciples = results.filter((r) => r.principles)
  const principleTally = {}
  for (const r of withPrinciples) for (const [k, v] of Object.entries(r.principles)) {
    principleTally[k] ??= { n: 0, met: 0 }; principleTally[k].n += 1; if (v) principleTally[k].met += 1
  }
  const summary = { model: MODEL, arm: SKILL_ARM, bank: path.relative(repoRoot, bankPath), ranAt: new Date().toISOString(), total: n, firstToolAccuracy: `${count('firstOk')}/${n}`, argumentAccuracy: `${count('argsOk')}/${n}`, turnSuccess: `${count('turnOk')}/${n}`, byLang: by('lang'), byPersona: by('persona'), byBucket: by('bucket'), ...(skillMetrics ? { skillMetrics } : {}), ...(withPrinciples.length ? { principleTally } : {}), usage }
  fs.writeFileSync(path.join(evidenceDir, `${outPrefix}-results${SKILL_ARM === 'raw' ? '-raw' : ''}.json`), JSON.stringify({ summary, results }, null, 2) + '\n')
  const rows = results.map((r) => `| ${r.id} | ${r.say.replace(/\|/g, '\\|')} | ${r.first ?? '—'} | ${r.trajectory.join(' → ') || '—'} | ${r.firstOk ? '✓' : '✗'} | ${r.argsOk ? '✓' : '✗'} | ${r.turnOk ? '✓' : '✗'} | ${r.forbiddenHit?.length ? r.forbiddenHit.join(',') : ''}${r.error ? ' ERR ' + r.error.slice(0, 60) : ''} |`)
  const table = (obj) => Object.entries(obj).map(([k, v]) => `| ${k} | ${v.n} | ${v.firstOk}/${v.n} | ${v.argsOk}/${v.n} | ${v.turnOk}/${v.n} |`).join('\n')
  const skillRows = withSkillMetric.map((r) => `| ${r.id} | ${r.skillKey ?? '（不挂技能·对照）'} | ${r.skillVisible ? '✓' : '✗'} | ${r.skillParamOk ? '✓' : '✗'} | ${(r.hitText ?? []).join('、') || '—'} | ${(r.hitArgs ?? []).join('、') || '—'} |`)
  const principleRows = withPrinciples.map((r) => `| ${r.id} | ${r.say.replace(/\|/g, '\\|')} | ${Object.entries(r.principles).map(([k, v]) => `${k}:${v ? '✓' : '✗'}`).join(' · ')} | ${r.trajectory.join(' → ') || '—'} |`)
  const md = [`# R30 · 真实模型腿 · ${MODEL} · arm=${SKILL_ARM} · ${summary.ranAt}`, '', `- 选对工具率（首调 ∈ expectedFirst）：**${summary.firstToolAccuracy}**`, `- 入参写对率（每次调用都过 prepareArguments → pi 校验）：**${summary.argumentAccuracy}**`, `- 回合成功率（选对 ∧ 入参对 ∧ 轨迹按序 ∧ 无禁用动词 ∧ 不声称已生成）：**${summary.turnSuccess}**`, `- tokens：prompt ${usage.prompt}（其中缓存命中 ${usage.cacheHit}）· completion ${usage.completion}`, '', '## 按语言', '| lang | n | 选对 | 入参 | 回合 |', '|---|---|---|---|---|', table(summary.byLang), '', '## 按新老手', '| persona | n | 选对 | 入参 | 回合 |', '|---|---|---|---|---|', table(summary.byPersona), '', '## 按意图桶', '| bucket | n | 选对 | 入参 | 回合 |', '|---|---|---|---|---|', table(summary.byBucket), '', ...(skillMetrics ? ['## 技能可见证据（选了技能 vs 同句对照）',
    `- 回复里看得出被用：**${skillMetrics.skillVisible}**（选了技能 ${skillMetrics.selected} · 对照 ${skillMetrics.control}）`,
    `- 技能规定的参数真的写进入参：**${skillMetrics.skillParamOk}**`, '',
    '| id | 挂的技能 | 正文见证据 | 入参见证据 | 命中的正文标记 | 命中的入参标记 |', '|---|---|---|---|---|---|', ...skillRows, ''] : []),
  ...(withPrinciples.length ? ['## 「直接出片」的做事原则',
    ...Object.entries(principleTally).map(([k, v]) => `- ${k}: **${v.met}/${v.n}**`), '',
    '| id | 用户说 | 原则 | 轨迹 |', '|---|---|---|---|', ...principleRows, ''] : []),
  '## 逐句', '| id | 用户说 | 首调 | 轨迹 | 选对 | 入参 | 回合 | 禁用/错误 |', '|---|---|---|---|---|---|---|---|', ...rows, ''].join('\n')
  fs.writeFileSync(path.join(evidenceDir, `${outPrefix}-summary${SKILL_ARM === 'raw' ? '-raw' : ''}.md`), md)
  console.log(JSON.stringify(summary, null, 2))
}
main().catch((error) => { console.error(error); process.exit(1) })
