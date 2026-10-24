// Agent 选区投影的真模型量具（R13.3）：选中 N 个节点，让 Agent 逐个说出标题，数它说对几个。
//
// 走的是产品同一条链：renderer 的生产构造器 `buildResidentContextSnapshot` → 主进程 `createDesktopLaneInput`
// （内部调 `formatAgentContextSnapshot`）→ 真 `openLane`（pi 循环）→ 真实 OpenAI 兼容端点。
// 不挂任何工具：量的是投影本身给了模型多少信息，而不是模型会不会自己去 look_at_canvas 补读。
// 风格抄 evals/director/agentLoop/run.mts 的 record 模式（同一组环境变量与花钱确认开关）。
//
//   NOMI_EVAL_AGENT_SPEND_OK=1 NOMI_EVAL_AGENT_BASE_URL=… NOMI_EVAL_AGENT_MODEL=… NOMI_EVAL_AGENT_API_KEY=… \
//   pnpm exec tsx docs/evidence/2026-10-21-agent-selection-truncation/probe.mts --count 12 --trials 3 --out <file.json>
//
// 密钥只从进程环境读，不写进输出。
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { openLane } from '../../../electron/agentLane/laneHost.mjs'
import { createDesktopLaneInput } from '../../../electron/agentLane/laneDesktopInput'
import { formatAgentContextSnapshot } from '../../../electron/shared/agentContextSnapshot'
import { buildLanguageRule, NOMI_AGENT_IDENTITY } from '../../../electron/harness/context/agentContext'
import { buildResidentContextSnapshot } from '../../../src/workbench/ai/resident/residentContextSnapshot'
import type { NomiModelConfig } from '../../../electron/agentLane/laneRuntimePort'
import type { LaneComposerContext } from '../../../electron/shared/agentLane/laneDesktopContracts'

// 互不相同、模型猜不到的标题：只有读到投影才说得对。
const TITLES = [
  '琥珀走廊', '青铜月台', '白鹭渡口', '灰烬剧院', '缄默灯塔', '北岸集市', '折叠雪原', '蓝焰车站', '沉香茶室', '破晓天台',
  '潮汐书店', '黑檀电梯', '铜钟广场', '雾中邮局', '星砂温室', '无声游乐场', '镜面隧道', '赤陶庭院', '漂浮图书馆', '锈蚀钟楼',
  '月光洗衣房', '玻璃鲸落', '纸灯渡船', '回声矿井', '晚霞水塔', '盐湖电台', '雨伞走廊', '孤岛信号塔', '琉璃花房', '旧港仓库',
  '风铃隧道', '夜航列车', '麦田剧场', '霓虹后巷', '冰封温泉', '木偶工坊', '云端栈桥', '砂糖码头', '碎星旅馆', '松烟书院',
]
const PROMPT = '我现在在画布上选中了一些节点。请逐个列出我当前选中的每个节点的标题，一行一个，只列标题，不要调用任何工具，也不要补充别的。'

const arg = (name: string) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined }
const need = (name: string) => { const v = process.env[name]?.trim(); if (!v) throw new Error(`needs ${name}`); return v }

async function once(count: number, model: NomiModelConfig) {
  const ids = Array.from({ length: count }, (_, i) => `gen-v2-image-lw9x${(i + 10).toString(36)}k-ab${(i + 10).toString(36)}z`)
  const titles = Array.from({ length: count }, (_, i) => TITLES[i % TITLES.length] + (i >= TITLES.length ? `${Math.floor(i / TITLES.length) + 1}` : ''))
  const snapshot = buildResidentContextSnapshot({
    canvas: { revision: 8, nodes: ids.map((id, i) => ({ id, title: titles[i], kind: 'image' })), selectedNodeIds: ids },
  })
  const context: LaneComposerContext = { approvalPolicy: { mode: 'request' }, contextSnapshot: snapshot }
  const projection = formatAgentContextSnapshot(snapshot)
  const projectDir = await mkdtemp(join(tmpdir(), 'nomi-selection-probe-'))
  process.env.NOMI_SETTINGS_DIR = join(projectDir, 'settings')
  process.env.NOMI_PROJECTS_DIR = join(projectDir, 'projects')
  const input = createDesktopLaneInput({
    projectId: 'selection-probe', capture: () => context, activate: () => {}, prepare: async (captured: LaneComposerContext) => captured,
    model: () => ({ model: { modelKey: model.modelId } as never, kind: 'openai-compatible' }),
  })
  const sent: string[] = []
  const fetch: typeof globalThis.fetch = (url, init) => { sent.push(typeof init?.body === 'string' ? init.body : ''); return globalThis.fetch(url, init) }
  let answer = ''
  let error: string | undefined
  const lane = await openLane({
    fetch, projectDir, model, tools: [], input,
    systemPrompt: [buildLanguageRule(), NOMI_AGENT_IDENTITY].filter(Boolean).join('\n\n'),
    systemPromptClosing: buildLanguageRule,
  })
  try {
    await lane.execute({ kind: 'prompt', text: PROMPT })
    const parts = lane.projection().parts
    answer = parts.filter((part) => part.kind === 'assistant-text').map((part) => (part as { text: string }).text).join('\n')
    const failed = parts.filter((part) => part.kind === 'error').map((part) => (part as { text: string }).text)
    if (!answer && failed.length) error = failed.join(' | ').slice(0, 500)
    if (!answer && !failed.length) error = `no assistant text; part kinds: ${parts.map((part) => part.kind).join(',')}`
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught)
  } finally {
    await lane.close().catch(() => undefined)
    await rm(projectDir, { recursive: true, force: true }).catch(() => undefined)
  }
  const correct = titles.filter((title) => answer.includes(title)).length
  const seen = titles.filter((title) => projection.includes(title)).length
  const mentionsOmission = /(未列出|没有列出|没列出|还有\s*\d+|共\s*\d+|omitted|not listed)/.test(answer)
  const tail = (() => {
    try {
      const messages = (JSON.parse(sent[0] ?? '{}').messages ?? []) as Array<{ role: string; content: unknown }>
      return JSON.stringify(messages.filter((x) => x.role === 'user').at(-1)?.content ?? '').slice(0, 400)
    } catch { return '' }
  })()
  return { count, correct, titlesInProjection: seen, projectionChars: projection.length, mentionsOmission, error, answer, firstRequestUserTail: tail }
}

async function main() {
  if (process.env.NOMI_EVAL_AGENT_SPEND_OK !== '1') throw new Error('this probe calls a real model; set NOMI_EVAL_AGENT_SPEND_OK=1 to confirm')
  const model = {
    kind: 'openai-compatible', providerId: 'nomi-eval', modelId: need('NOMI_EVAL_AGENT_MODEL'),
    // `--key-env NAME`：密钥放在另一个环境变量里时，按名字取（命令行里不出现密钥本身）。
    baseURL: need('NOMI_EVAL_AGENT_BASE_URL'), authType: 'api-key', apiKey: need(arg('--key-env') ?? 'NOMI_EVAL_AGENT_API_KEY'),
  } as NomiModelConfig
  const count = Number(arg('--count') ?? 12)
  const trials = Number(arg('--trials') ?? 3)
  const results = []
  for (let i = 0; i < trials; i += 1) results.push(await once(count, model))
  const summary = {
    modelId: model.modelId, count, trials,
    correct: results.map((r) => r.correct), titlesInProjection: results.map((r) => r.titlesInProjection),
    mentionsOmission: results.map((r) => r.mentionsOmission), projectionChars: results[0]?.projectionChars,
    errors: results.filter((r) => r.error).length,
  }
  console.log(JSON.stringify(summary))
  const out = arg('--out')
  if (out) { await mkdir(dirname(out), { recursive: true }); await writeFile(out, JSON.stringify({ summary, results }, null, 2)) }
}
main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exit(1) })
