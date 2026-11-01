// 整个包的回归：同一批不许出门的东西，同时种进模型目录、日志、上下文、轨迹，用真实组包函数组一份完整的包。
// 「这一家什么能出门」只有一个判据（`catalog/outboundVendor.ts`），四个入口都读它；任一入口撤掉判据，这里就红（反证跑过）。
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { CURRENT_CATALOG_VERSION } from '../catalog/types'
import type { TrajectoryTurnInput } from '../shared/agentLane/laneTrajectory'
import { FEEDBACK_MANIFEST_ITEMS as ITEMS } from '../shared/contracts/feedback'
import { projectLaneTrajectory } from '../telemetry/trajectoryProjection'
import { buildFeedbackReport } from './feedbackReport'

const STAMP = '2026-11-01T00:00:00.000Z'
const PROMPT = 'a girl walks in the planted rain'
const FILE_NAME = 'planted-portrait.png'
const GATEWAY = 'gw.planted-corp.example'
const MINTED_KEY = 'gw-planted-corp-example'
const ALIAS = 'planted-alias-model'
const CONNECTION = 'planted-second-rig'
const LOCAL_MODEL = 'comfy-planted-portrait-1'
const LABEL = '私人工作流标签'
const FORBIDDEN = [PROMPT, FILE_NAME, GATEWAY, MINTED_KEY, ALIAS, CONNECTION, LOCAL_MODEL, LABEL]

const WORKFLOW = { 3: { class_type: 'CLIPTextEncode', inputs: { text: PROMPT } }, 4: { class_type: 'LoadImage', inputs: { image: FILE_NAME } } }
const catalog = {
  version: CURRENT_CATALOG_VERSION,
  vendors: [
    { key: MINTED_KEY, name: GATEWAY, enabled: true, baseUrlHint: `https://${GATEWAY}/v1`, authType: 'bearer' },
    { key: 'comfyui-local', name: 'ComfyUI', enabled: true, baseUrlHint: 'http://127.0.0.1:8188', authType: 'none' },
    { key: `comfyui-local--${CONNECTION}`, name: CONNECTION, enabled: true, baseUrlHint: `https://${GATEWAY}:8188`, authType: 'none' },
    { key: 'apimart', name: 'APIMart', enabled: true, baseUrlHint: 'https://api.apimart.ai', authType: 'bearer' },
    { key: `apimart--${CONNECTION}`, name: CONNECTION, enabled: true, baseUrlHint: `https://${GATEWAY}/relay`, authType: 'bearer' },
  ],
  models: [
    { vendorKey: MINTED_KEY, modelKey: ALIAS, modelAlias: ALIAS, labelZh: LABEL, kind: 'text', enabled: true },
    { vendorKey: 'comfyui-local', modelKey: LOCAL_MODEL, labelZh: LABEL, kind: 'image', enabled: true, meta: { comfyWorkflowImport: { text: JSON.stringify(WORKFLOW) } } },
    { vendorKey: `comfyui-local--${CONNECTION}`, modelKey: LOCAL_MODEL, labelZh: LABEL, kind: 'image', enabled: true },
    { vendorKey: 'apimart', modelKey: 'gpt-5.5', labelZh: 'GPT 5.5', kind: 'text', enabled: true, note: PROMPT, customCall: { path: `https://${GATEWAY}/v1/run` }, meta: { archetypeId: 'gpt', note: PROMPT, parameters: { prompt: PROMPT }, comfyWorkflowImport: { text: FILE_NAME } } },
  ],
  mappings: [
    { id: `map-${MINTED_KEY}`, vendorKey: MINTED_KEY, modelKey: ALIAS, taskKind: 'chat', name: LABEL, enabled: true, create: { method: 'POST', path: `https://${GATEWAY}/v1/run` } },
    { id: `map-${LOCAL_MODEL}`, vendorKey: 'comfyui-local', modelKey: LOCAL_MODEL, taskKind: 'text_to_image', name: LABEL, enabled: true, create: { method: 'POST', path: '/prompt', body: { prompt: WORKFLOW } } },
    { id: `map-${CONNECTION}`, vendorKey: `comfyui-local--${CONNECTION}`, modelKey: LOCAL_MODEL, taskKind: 'text_to_image', name: LABEL, enabled: true, create: { method: 'POST', path: '/prompt', body: { prompt: WORKFLOW } } },
    { id: 'seed-apimart-chat', vendorKey: 'apimart', modelKey: 'gpt-5.5', taskKind: 'chat', name: 'GPT', enabled: true, create: { method: 'POST', path: '/v1/chat/completions' } },
  ],
  apiKeysByVendor: {
    [MINTED_KEY]: { vendorKey: MINTED_KEY, enc: 'plain', enabled: true },
    [`comfyui-local--${CONNECTION}`]: { vendorKey: `comfyui-local--${CONNECTION}`, enc: 'plain', enabled: true },
    apimart: { vendorKey: 'apimart', enc: 'plain', enabled: true },
  },
  suppressedBuiltinModels: [{ vendorKey: 'comfyui-local', modelKey: LOCAL_MODEL }, { vendorKey: MINTED_KEY, modelKey: ALIAS }],
}
const logLines = [
  `WARN  vendor         call vendor=${MINTED_KEY} model=${ALIAS} status=500 ms=12`,
  `WARN  vendor         call vendor=comfyui-local model=${LOCAL_MODEL} status=500 ms=12`,
  `WARN  vendor         call vendor=comfyui-local--${CONNECTION} model=${LOCAL_MODEL} status=500 ms=12`,
  `WARN  vendor         call vendor=apimart--${CONNECTION} model=gpt-5.5 status=500 ms=12`,
  `WARN  agent          lane-tool-failed tool=write firstLine=${PROMPT} consecutive=2`,
  `WARN  assets         open absolutePath=${['', 'Users', 'walker', FILE_NAME].join('/')}`,
  `WARN  vendor         fallback host=${GATEWAY} base=https://${GATEWAY}/v1`,
  'WARN  vendor         call vendor=apimart model=gpt-5.5 status=503 ms=1200',
].map((body) => `[${STAMP}] ${body}`)

const FIXTURE = path.join(__dirname, '../../tests/fixtures/standard-formats/nomi-agent-trace-view/trace.jsonl')
const [fixtureTurn] = fs.readFileSync(FIXTURE, 'utf8').trim().split('\n').map((line) => JSON.parse(line) as TrajectoryTurnInput)
const plantedTurn: TrajectoryTurnInput = {
  ...fixtureTurn,
  sessionId: `/nomi-lane/${LABEL}`,
  prompt: PROMPT,
  response: PROMPT,
  models: [{ provider: MINTED_KEY, model: ALIAS }, { provider: `comfyui-local--${CONNECTION}`, model: LOCAL_MODEL }, { provider: 'apimart', model: 'gpt-5.5' }],
  tools: [{ ...fixtureTurn.tools[0], arguments: { input: `${PROMPT} ${FILE_NAME}` } }],
  errors: [`request to https://${GATEWAY}/v1 failed for ${FILE_NAME}`],
}

const report = (provider: string | undefined, model: string | undefined, includeContent = false) => buildFeedbackReport({
  surface: 'generation', summary: 'walk summary', laneName: 'walk-lane', provider, model, includeContent,
}, {
  now: new Date(STAMP),
  app: { version: '0.24.0', electron: '43.0.0', node: '22.0.0', chrome: '130' },
  system: { platform: 'darwin', arch: 'arm64', osRelease: '25.5.0', locale: 'zh-CN', timeZone: 'Asia/Shanghai' },
  projectId: 'walk-project',
  readLogTail: () => logLines,
  readModelCatalog: () => catalog,
  readTrajectory: async () => [plantedTurn],
})

describe('整个包：用户的东西不出门，云端内置家照常', () => {
  it.each([
    ['自建中转', MINTED_KEY, ALIAS, 'custom', null],
    ['本机那一家', 'comfyui-local', LOCAL_MODEL, 'comfyui-local', null],
    ['本机那家的第二台', `comfyui-local--${CONNECTION}`, LOCAL_MODEL, 'comfyui-local', null],
    ['云端内置家', 'apimart', 'gpt-5.5', 'apimart', 'gpt-5.5'],
    ['云端内置家的兄弟连接', `apimart--${CONNECTION}`, 'gpt-5.5', 'apimart', 'gpt-5.5'],
    ['说了模型没说是哪一家', undefined, ALIAS, null, null],
    ['什么都没说', undefined, undefined, null, null],
  ])('问题出在%s', async (_name, provider, model, expectedProvider, expectedModel) => {
    const built = await report(provider, model)
    const text = JSON.stringify(built)
    expect(FORBIDDEN.filter((secret) => text.includes(secret))).toEqual([])
    expect(built.context.provider).toBe(expectedProvider)
    expect(built.context.model).toBe(expectedModel)

    // 四样都真的带上了，零命中不是因为整份没带。
    expect(built.manifest.entries.map((entry) => entry.path).sort()).toEqual([ITEMS.logTail, ITEMS.modelCatalog, ITEMS.trajectory].sort())
    const tail = (built.attachments[ITEMS.logTail] as string[]).join('\n')
    expect(tail).toContain('vendor=apimart model=gpt-5.5')
    expect(tail).toContain('vendor=custom model=…')
    expect(tail).toContain('vendor=comfyui-local model=…')
    const vendors = (built.attachments[ITEMS.modelCatalog] as { vendors: { key: string }[]; models: { modelKey: string }[] })
    expect(vendors.vendors.map((row) => row.key)).toEqual(['custom', 'comfyui-local', 'comfyui-local--2', 'apimart', 'apimart--2'])
    expect(vendors.models.map((row) => row.modelKey)).toEqual(['gpt-5.5'])
    const [turn] = (built.attachments[ITEMS.trajectory] as { turns: Record<string, unknown>[] }).turns
    expect(turn['gen_ai.provider.name']).toEqual(['custom', 'comfyui-local', 'apimart'])
    expect(turn['gen_ai.request.model']).toEqual(['gpt-5.5'])
  })

  it('勾了内容：提示词是用户同意带的，别的照样不带', async () => {
    const built = await report(MINTED_KEY, ALIAS, true)
    const text = JSON.stringify(built)
    const [turn] = (built.attachments[ITEMS.trajectory] as { turns: Record<string, unknown>[] }).turns
    expect(turn['gen_ai.input.messages']).toBe(PROMPT)
    expect(FORBIDDEN.filter((secret) => secret !== PROMPT && text.includes(secret))).toEqual([])
    expect(turn['gen_ai.provider.name']).toEqual(['custom', 'comfyui-local', 'apimart'])
  })

  it('定期上报走同一个投影', () => {
    const envelope = projectLaneTrajectory([plantedTurn])
    const text = JSON.stringify(envelope)
    expect(FORBIDDEN.filter((secret) => text.includes(secret))).toEqual([])
    expect(envelope.turns[0]['gen_ai.provider.name']).toEqual(['custom', 'comfyui-local', 'apimart'])
    expect(envelope.turns[0]['gen_ai.request.model']).toEqual(['gpt-5.5'])
  })
})
