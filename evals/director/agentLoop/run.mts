// Agent 在环评测（门槛 ① 的量具）命令行。见 directorAgentLoop.mts 头部。
//
//   pnpm exec tsx evals/director/agentLoop/run.mts --mode synthetic-oracle         零花费：量具自检（oracle 计划经真 lane + 真工具面 + 真执行体）
//   pnpm exec tsx evals/director/agentLoop/run.mts --mode replay --recordings <dir>  零花费：按录音回放
//   NOMI_EVAL_AGENT_SPEND_OK=1 NOMI_EVAL_AGENT_BASE_URL=… NOMI_EVAL_AGENT_MODEL=… NOMI_EVAL_AGENT_API_KEY=… \
//   pnpm exec tsx evals/director/agentLoop/run.mts --mode record --recordings <dir>  会花文本额度：真模型跑一遍并录音
//
// 共同参数：--cards <id 或 tier 片段>（同 run.ts），--out <目录>（默认 evals/runs/director-agentloop-<时间>-<mode>）。
// 密钥只从进程环境读，不写进录音、报告或日志。
import './bootstrapEnv.mts'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHttpFixture } from '../../../tests/agent-runtime/httpFixture.mts'
import type { NomiModelConfig } from '../../../electron/agentLane/laneRuntimePort.js'
import { parseDirectorCard, type DirectorCard } from '../cardSchema'
import { S1_ORACLE_PLANS } from '../s1OraclePlans'
import { recordingFetch, replayFetch, runAgentLoopCard, summarize, type AgentLoopCardResult, type CardEndpoint, type RecordedExchange } from './directorAgentLoop.mts'

type Mode = 'synthetic-oracle' | 'record' | 'replay'
type PublicModel = Omit<NomiModelConfig, 'apiKey'>
type Recording = Readonly<{ cardId: string; model: PublicModel; exchanges: readonly RecordedExchange[] }>

const here = path.dirname(fileURLToPath(import.meta.url))
const arg = (name: string) => {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

async function loadCards(filter?: string): Promise<DirectorCard[]> {
  const raw = JSON.parse(await fs.readFile(path.join(here, '../cards/all.json'), 'utf8')) as unknown[]
  const cards = raw.map(parseDirectorCard)
  return filter ? cards.filter((card) => card.id.includes(filter) || card.tier === filter) : cards
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`record mode needs ${name} in the process environment`)
  return value
}

/** 录音里不留密钥：回放时用占位值（密钥只在请求头里，请求体哈希不受影响）。 */
function publicModel(model: NomiModelConfig): PublicModel {
  const { apiKey: _apiKey, ...rest } = model as NomiModelConfig & { apiKey?: string }
  return rest as PublicModel
}

async function writeRecording(dir: string, recording: Recording): Promise<void> {
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(path.join(dir, `${recording.cardId}.json`), `${JSON.stringify(recording, null, 2)}
`)
}

async function endpointFor(mode: Mode, card: DirectorCard, recordings: string | undefined): Promise<CardEndpoint | { skip: string }> {
  if (mode === 'synthetic-oracle') {
    const plan = S1_ORACLE_PLANS[card.id]
    if (!plan) return { skip: 'no oracle plan for this card' }
    const http = await createHttpFixture([
      { type: 'tool', calls: [{ id: 'call-oracle', name: 'stage_shot', arguments: { plan } }] },
      { type: 'text', text: 'Preview staged.' },
    ])
    const model = { kind: 'openai-compatible', providerId: 'nomi-eval', modelId: 'synthetic-oracle', baseURL: http.baseURL, authType: 'api-key', apiKey: 'fixture-key' } as NomiModelConfig
    // 给了 --recordings 就顺手录下来：回放这条路可以零花费地端到端自检（synthetic 录音 → replay 分数必须逐位相同）
    const exchanges: RecordedExchange[] = []
    return {
      model, fetch: recordings ? recordingFetch(globalThis.fetch, exchanges) : globalThis.fetch,
      finish: async () => {
        await http.close()
        if (recordings) await writeRecording(recordings, { cardId: card.id, model: publicModel(model), exchanges })
        return { exchanges }
      },
    }
  }
  if (!recordings) throw new Error(`${mode} mode needs --recordings <dir>`)
  const file = path.join(recordings, `${card.id}.json`)
  if (mode === 'record') {
    if (process.env.NOMI_EVAL_AGENT_SPEND_OK !== '1') throw new Error('record mode calls a real model; set NOMI_EVAL_AGENT_SPEND_OK=1 to confirm')
    const model = {
      kind: 'openai-compatible', providerId: 'nomi-eval', modelId: requiredEnv('NOMI_EVAL_AGENT_MODEL'),
      baseURL: requiredEnv('NOMI_EVAL_AGENT_BASE_URL'), authType: 'api-key', apiKey: requiredEnv('NOMI_EVAL_AGENT_API_KEY'),
    } as NomiModelConfig
    const exchanges: RecordedExchange[] = []
    return {
      model, fetch: recordingFetch(globalThis.fetch, exchanges),
      finish: async () => {
        await fs.mkdir(recordings, { recursive: true })
        const recording: Recording = { cardId: card.id, model: publicModel(model), exchanges }
        await fs.writeFile(file, `${JSON.stringify(recording, null, 2)}\n`)
        return { exchanges }
      },
    }
  }
  let recording: Recording
  try {
    recording = JSON.parse(await fs.readFile(file, 'utf8')) as Recording
  } catch {
    return { skip: 'no recording for this card' }
  }
  let stale: string | undefined
  const used: RecordedExchange[] = []
  return {
    model: { ...recording.model, apiKey: 'replay-placeholder' } as NomiModelConfig,
    fetch: replayFetch(recording.exchanges, (why) => { stale ??= why }, used),
    finish: async () => ({ exchanges: used, ...(stale ? { replayStale: stale } : {}) }),
  }
}

function note(result: AgentLoopCardResult): string {
  return (result.replayStale ?? result.error ?? result.score.reasons.slice(0, 2).join('; ')).replaceAll('|', '/')
}

function report(mode: Mode, results: readonly AgentLoopCardResult[], skipped: readonly string[]): string {
  const summary = summarize(results)
  const banner = mode === 'synthetic-oracle'
    ? '> Harness self-check: the model is a local fixture that answers with the oracle plan. This is NOT a model score.'
    : mode === 'replay' ? '> Replayed from recordings (zero cost).' : '> Recorded from a real model.'
  return [
    `# Director 3D-BOX · Agent-in-the-loop · ${mode}`,
    '',
    banner,
    '',
    `Cards: ${summary.cards} · skipped: ${skipped.length}`,
    `Average total: ${summary.averageTotal.toFixed(3)}`,
    `Plan accepted rate: ${(summary.planAcceptedRate * 100).toFixed(1)}%`,
    `First stage_shot applied: ${(summary.firstAttemptRate * 100).toFixed(1)}%`,
    `Replay stale: ${summary.replayStale}`,
    '',
    '| Card | Attempts | Applied | First ok | Requests | Total | Correspondence | Note |',
    '|---|---:|---:|:-:|---:|---:|---:|---|',
    ...results.map((result) => `| ${result.cardId} | ${result.stageShotAttempts} | ${result.stageShotCalls.filter((call) => call.result.applied).length} | ${result.firstAttemptApplied ? 'yes' : 'no'} | ${result.modelRequests} | ${result.score.total.toFixed(3)} | ${(result.score.correspondenceRate * 100).toFixed(1)}% | ${note(result)} |`),
    ...(skipped.length ? ['', `Skipped: ${skipped.join(', ')}`] : []),
  ].join('\n')
}

async function main(): Promise<void> {
  const mode = (arg('--mode') ?? 'synthetic-oracle') as Mode
  if (!['synthetic-oracle', 'record', 'replay'].includes(mode)) throw new Error(`unknown mode: ${mode}`)
  const recordings = arg('--recordings')
  const cards = await loadCards(arg('--cards'))
  const results: AgentLoopCardResult[] = []
  const skipped: string[] = []
  for (const card of cards) {
    const endpoint = await endpointFor(mode, card, recordings)
    if ('skip' in endpoint) {
      skipped.push(`${card.id} (${endpoint.skip})`)
      continue
    }
    const result = await runAgentLoopCard(card, endpoint)
    results.push(result)
    console.log(`${card.id}: total ${result.score.total.toFixed(3)} · attempts ${result.stageShotAttempts} · requests ${result.modelRequests}${result.error ? ` · ${result.error}` : ''}`)
  }
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)
  const out = arg('--out') ?? path.resolve(here, '../../runs', `director-agentloop-${stamp}-${mode}`)
  await fs.mkdir(out, { recursive: true })
  const plain = results.map(({ stageShotCalls, ...rest }) => ({
    ...rest,
    stageShotCalls: stageShotCalls.map((call) => ({
      operation: call.input.operation, applied: call.result.applied,
      ...(call.result.applied ? { revision: call.result.revision, issues: call.result.issues.length } : { rejected: call.result.rejected }),
    })),
  }))
  await fs.writeFile(path.join(out, 'scores.json'), `${JSON.stringify({ mode, generatedAt: new Date().toISOString(), summary: summarize(results), skipped, results: plain }, null, 2)}\n`)
  await fs.writeFile(path.join(out, 'report.md'), `${report(mode, results, skipped)}\n`)
  console.log(JSON.stringify({ mode, out, ...summarize(results), skipped: skipped.length }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
