// 「分镜方案经常做错：建了好几个方案、数量不对，最后才合到一个」（用户 10-05）的零额度回环：
// 只把**模型**脚本化——它发的 `draft_shots` 照真的走：动词 schema → lane 翻译 → 生成传输适配器 →
// 生成规划 handler → 渲染层落方案的那两个函数（就是 `storyboard.*-design` 真正调用的那几个）。
// 三段轨迹逐字来自审计线 A-sb 的脚本化大脑（`tests/ux/audit-storyboard.walk.mjs` P10，PR #1030），中英各走一遍。
//
// 修之前这里三条都红：①同一请求第二次起草多出一份方案 ②2 镜方案行号是 3、4 ③「改第 1 镜」改到角色参考卡。
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useWorkbenchStore } from '../../workbenchStore'
import { extendAgentStoryboardDesign, patchAgentStoryboardDesign, upsertAgentStoryboardDesign } from './agentStoryboardDesign'
import { createModuleRegistry } from '../../../../electron/capabilityCore/moduleRegistry'
import { createGenerationPlanningHandler, createInMemoryGenerationOperationStore } from '../../../../electron/capabilityCore/mcpGenerationTools'
import { createPiGenerationTransportAdapter } from '../../../../electron/capabilityCore/generationTransportAdapters'
import { verbToTransportCall } from '../../../../electron/agentLane/laneVerbTransport'
import { writeVerbs } from '../../../../electron/shared/agentCapabilities/verbs/writeVerbs'
import type { StoryboardRequestTarget } from '../../../../electron/shared/agentCapabilities/generationInvocationContext'
import type { ProjectLeaseV2 } from '../../../../electron/capabilityCore/projectLease'
import type { StoryboardPlan } from '../../generationCanvas/agent/storyboardPlan'
import { addAnchor, addShot, updateShotPrompt } from '../../generationCanvas/agent/storyboardPlanEdits'
import { patchStoryboardSubject } from '../../../../electron/shared/storyboard/storyboardSubjectAdapter'

vi.mock('../../project/projectCanvasReadSurface', () => ({
  withProjectAction: (action: (value: unknown) => unknown) => action({
    binding: { projectId: 'project-1' }, signal: new AbortController().signal, assertCurrent: () => undefined,
  }),
}))

const registry = createModuleRegistry([{
  moduleId: 'generation.single-shot', version: '1.0.0', inputKinds: ['text', 'image'], outputKinds: ['image'],
  modes: ['text-to-image'], parameterSchema: {}, assetInputSchema: { references: { kind: 'image', max: 4 } },
  providers: [{ providerId: 'apimart', models: [{ modelId: 'gpt-image-2', modes: ['text-to-image'], parameterSchema: {},
    capabilities: { submitIdempotency: true, query: true, reconcile: true, cancel: true } }] }],
}])

const binding = { projectId: 'project-1', immutableProjectUuid: '11111111-1111-4111-8111-111111111111', projectGeneration: 1 }
const lease = { ...binding, version: 2, keyId: 'k', algorithm: 'HMAC-SHA256', issuer: 'nomi-main', canonicalRootDigest: 'r',
  leasePrincipal: 'mcp:codex', sessionId: 'mcp-session:test', connectionNonce: 'n', manifestDigest: 'm', audience: 'nomi-mcp',
  issuedAt: '2026-10-05T00:00:00.000Z', expiresAt: '2099-01-01T00:00:00.000Z', nonce: 'x', scopeSet: ['generation:create', 'generation:plan'],
  scopeHash: 'h', revocationEpoch: 0, mac: 'mac' } as ProjectLeaseV2

/** 渲染层那一侧：`capabilityApplyHandler` 对这三个 op 调的就是这三个函数。 */
const renderer = async (op: string, payload: unknown): Promise<unknown> => {
  const data = payload as Record<string, unknown>
  if (op === 'storyboard.upsert-design') return upsertAgentStoryboardDesign(data)
  if (op === 'storyboard.patch-design') return patchAgentStoryboardDesign(data)
  if (op === 'storyboard.extend-design') return extendAgentStoryboardDesign(data)
  throw new Error(`unexpected renderer op ${op}`)
}

const draftShotsVerb = writeVerbs().find(verb => verb.name === 'draft_shots')!
const designs = () => useWorkbenchStore.getState().storyboardDesignsByDocumentId.doc ?? []
const planOf = (id: string): StoryboardPlan => designs().find(design => design.id === id)!.plan as StoryboardPlan

function lane() {
  const operations = createInMemoryGenerationOperationStore()
  const handler = createGenerationPlanningHandler({ registry, operations, requestRenderer: renderer, now: () => '2026-10-05T00:00:00.000Z' })
  const adapter = createPiGenerationTransportAdapter(binding, { planning: handler, leaseFor: () => lease })
  let seq = 0
  /** 一轮用户请求：同一个 requestId 下模型可以调好几次 `draft_shots`。 */
  const request = (requestId: string) => {
    const target: StoryboardRequestTarget = { projectId: 'project-1', sourceDocumentId: 'doc', sourceDocumentRevision: 1,
      sourceDocumentContentHash: 'hash', targetKind: 'storyboard', requestId,
      plans: designs().map(design => ({ id: design.id, title: design.title })) }
    return async (args: Record<string, unknown>) => {
      // 模型面：动词自己的容忍 + schema（pi 的 ajv 在真 lane 上跑的是同一份）。
      const admitted = draftShotsVerb.schema.parse(draftShotsVerb.prepareArguments ? draftShotsVerb.prepareArguments(args) : args)
      const translated = verbToTransportCall({ toolCallId: `call-${++seq}`, toolName: 'draft_shots', args: admitted })!
      return adapter.tryExecute(translated.call, new AbortController().signal, {
        storyboardTarget: target, sourceDocument: { documentId: 'doc', revision: 1, contentHash: 'hash' },
      }) as Promise<{ ok: boolean; result?: Record<string, unknown>; message?: string; code?: string }>
    }
  }
  return { request }
}

beforeEach(() => {
  const store = useWorkbenchStore.getState()
  store.hydrateWorkbenchDocuments([{ id: 'doc', version: 1, title: 'Doc', updatedAt: 1, contentJson: { type: 'doc', content: [] } }], 'doc')
  store.hydrateStoryboardDesigns({})
})

const img = { providerId: 'apimart', modelId: 'gpt-image-2' }
const LANGS = [
  { lang: 'zh-CN', t: (zh: string, _en: string) => zh },
  { lang: 'en', t: (_zh: string, en: string) => en },
] as const

for (const { lang, t } of LANGS) {
  const anchor = (title: string, prompt: string, kind: 'character' | 'scene') =>
    ({ role: 'anchor', title, prompt, taskKind: 'text_to_image', candidate: img, storyboard: { kind, carrier: 'visual', scope: 'selective' } })
  const shot = (title: string, prompt: string) => ({ title, prompt, taskKind: 'text_to_image', candidate: img })

  describe(`[${lang}] 一份请求一份方案；镜号只数镜头；改第 N 镜只落到镜头`, () => {
    it('AUD1：2 张参考卡 + 2 镜的方案，镜头行号是 1、2，参考卡不占号', async () => {
      const { request } = lane()
      const result = await request('aud-1')({ shots: [
        anchor(t('小满', 'Xiaoman'), t('扎马尾的小女孩，红雨衣', 'A girl in a ponytail and red raincoat'), 'character'),
        anchor(t('雨巷', 'Rain alley'), t('窄巷，霓虹，积水', 'Narrow alley, neon, puddles'), 'scene'),
        shot(t('追逐', 'Chase'), t('小满冲进雨巷', 'Xiaoman runs into the alley')),
        shot(t('回头', 'Look back'), t('她回头，车灯扫过', 'She looks back as headlights sweep')),
      ] })
      expect(result.ok).toBe(true)
      expect(designs()).toHaveLength(1)
      const plan = planOf(designs()[0].id)
      expect(plan.shots.map(value => value.index)).toEqual([1, 2])
      expect(plan.shots.map(value => value.shotId)).toEqual(['shot-1', 'shot-2'])
      // 参考卡的 id 不在镜号空间里：模型说「第 1 镜」时写的 shot-1 不可能指到它们。
      expect(plan.anchors.map(value => value.id)).toEqual(['anchor-1', 'anchor-2'])
      // 模型手里那份（草稿）和用户看到的那份是同一套 id。
      const operation = (result.result as { operation: { shots: Array<{ shotId: string }> } }).operation
      expect(operation.shots.map(value => value.shotId)).toEqual(['anchor-1', 'anchor-2', 'shot-1', 'shot-2'])
    })

    it('AUD2：「改第 1 镜」写 shot-1，改到的是第 1 个镜头，参考卡一个字不动', async () => {
      const { request } = lane()
      await request('aud-1')({ shots: [
        anchor(t('小满', 'Xiaoman'), t('扎马尾的小女孩，红雨衣', 'A girl in a ponytail and red raincoat'), 'character'),
        anchor(t('雨巷', 'Rain alley'), t('窄巷，霓虹，积水', 'Narrow alley, neon, puddles'), 'scene'),
        shot(t('追逐', 'Chase'), t('小满冲进雨巷', 'Xiaoman runs into the alley')),
        shot(t('回头', 'Look back'), t('她回头，车灯扫过', 'She looks back as headlights sweep')),
      ] })
      const designId = designs()[0].id
      const anchorsBefore = planOf(designId).anchors
      const edited = t('她站在天台边缘，风吹起雨衣', 'She stands at the rooftop edge, the raincoat blowing')
      const result = await request('aud-2')({ operationId: designId, shots: [{ shotId: 'shot-1', prompt: edited }] })
      expect(result.ok).toBe(true)
      expect(planOf(designId).shots[0].prompt).toBe(edited)
      expect(planOf(designId).shots[1].prompt).toBe(t('她回头，车灯扫过', 'She looks back as headlights sweep'))
      expect(planOf(designId).anchors).toEqual(anchorsBefore)
    })

    it('AUD3：同一请求先立角色、再补镜头——左栏只有一份方案，镜头补在它上面', async () => {
      const { request } = lane()
      const turn = request('aud-3')
      const first = await turn({ shots: [anchor(t('阿哲', 'Azhe'), t('戴眼镜的青年', 'A young man with glasses'), 'character')] })
      expect(first.ok).toBe(true)
      const designId = designs()[0].id
      // 宿主的回执指向**这一份**方案，不再说「下一次 draft_shots 再补」。
      const receipt = JSON.stringify(first.result)
      expect(receipt).not.toMatch(/later draft_shots call/)
      expect(receipt).toContain(`operationId ${designId}`)
      const second = await turn({ shots: [
        shot(t('开场', 'Opening'), t('阿哲推门走进咖啡店', 'Azhe pushes the door into the cafe')),
        shot(t('对话', 'Talk'), t('阿哲与店员交谈', 'Azhe talks with the clerk')),
      ] })
      expect(second.ok).toBe(true)
      expect(designs()).toHaveLength(1)
      const plan = planOf(designId)
      expect(plan.anchors.map(value => value.id)).toEqual(['anchor-1'])
      expect(plan.shots.map(value => [value.index, value.shotId])).toEqual([[1, 'shot-1'], [2, 'shot-2']])
      expect(JSON.stringify(second.result)).toContain(designId)
    })

    it('用户明确要另起一份（newPlan）：同一请求里才会出第二份', async () => {
      const { request } = lane()
      const turn = request('aud-4')
      await turn({ shots: [shot(t('开场', 'Opening'), t('海边日出', 'Sunrise over the sea'))] })
      await turn({ newPlan: true, shots: [shot(t('另一版开场', 'Alternative opening'), t('海边黄昏', 'Dusk over the sea'))] })
      expect(designs()).toHaveLength(2)
    })

    it('下一轮「再加两镜」：带 operationId 的新镜头补在同一份上，行号接着数', async () => {
      const { request } = lane()
      await request('aud-5')({ shots: [
        anchor(t('小满', 'Xiaoman'), t('红雨衣', 'Red raincoat'), 'character'),
        shot(t('追逐', 'Chase'), t('小满冲进雨巷', 'Xiaoman runs into the alley')),
        shot(t('回头', 'Look back'), t('她回头', 'She looks back')),
      ] })
      const designId = designs()[0].id
      const result = await request('aud-6')({ operationId: designId, shots: [
        shot(t('天台', 'Rooftop'), t('她爬上天台', 'She climbs to the rooftop')),
        anchor(t('天台', 'Rooftop'), t('雨夜天台，水塔', 'Rainy rooftop with a water tower'), 'scene'),
        shot(t('远眺', 'Gaze'), t('她远眺城市', 'She gazes over the city')),
      ] })
      expect(result.ok).toBe(true)
      expect(designs()).toHaveLength(1)
      const plan = planOf(designId)
      expect(plan.shots.map(value => [value.index, value.shotId])).toEqual([[1, 'shot-1'], [2, 'shot-2'], [3, 'shot-3'], [4, 'shot-4']])
      expect(plan.anchors.map(value => value.id)).toEqual(['anchor-1', 'anchor-2'])
      expect(JSON.stringify(result.result)).toContain('shot-3')
    })

    it('旧方案里锚占着 shot-1：「改第 1 镜」被拒并列出真实镜头，参考卡不动', async () => {
      const { request } = lane()
      await request('aud-7')({ shots: [shot(t('开场', 'Opening'), t('海边日出', 'Sunrise over the sea'))] })
      const designId = designs()[0].id
      // 修复前 Agent 建的方案长这样：锚 id 是 shot-1、shot-2，镜头从 shot-3 起。
      const legacy: StoryboardPlan = { title: 'legacy', anchors: [
        { id: 'shot-1', kind: 'character', carrier: 'visual', name: t('小满', 'Xiaoman'), description: t('红雨衣', 'Red raincoat') },
      ], shots: [{ index: 1, shotId: 'shot-2', shotKind: 'image', durationSec: 0, anchorIds: [], prompt: t('追逐', 'Chase') }] }
      useWorkbenchStore.getState().setStoryboardPlan(legacy, 'doc', designId, true)
      const result = await request('aud-8')({ operationId: designId, shots: [{ shotId: 'shot-1', prompt: t('天台', 'Rooftop') }] })
      expect(result.ok).toBe(false)
      expect(result.message).toContain('shot-2')
      expect(planOf(designId).anchors[0]).toMatchObject({ description: t('红雨衣', 'Red raincoat') })
      expect(planOf(designId).shots[0].prompt).toBe(t('追逐', 'Chase'))
    })
  })
}

// ── 类级矩阵：门表清单里每一扇「往方案里加行」的门，造出同一份「2 张参考卡 + 2 镜」的方案 ──
// 门表（`node scripts/door-map.mjs nextStoryboardSubjectIds appendStoryboardSubjects ...`，根因合同 doors）：
// Agent 一次起草、Agent 同一请求分两次起草、Agent 下一轮带 operationId 补、手建编辑器加锚加镜。
// 对每一扇门核同三条不变量：镜号只数镜头（1..N）、锚的 id 不在镜号段里、「第 1 镜」（shot-1）落到第一个镜头。
type Entrance = { id: string; build: (lang: (typeof LANGS)[number]) => Promise<string> }
const ENTRANCES: Entrance[] = [
  { id: 'agent-one-call', build: async ({ t }) => {
    await lane().request('m-1')({ shots: [
      { role: 'anchor', title: t('甲', 'A'), prompt: t('角色甲', 'Character A'), taskKind: 'text_to_image', candidate: img, storyboard: { kind: 'character', carrier: 'visual' } },
      { role: 'anchor', title: t('乙', 'B'), prompt: t('场景乙', 'Scene B'), taskKind: 'text_to_image', candidate: img, storyboard: { kind: 'scene', carrier: 'visual' } },
      { title: t('一', 'One'), prompt: t('第一镜', 'First shot'), taskKind: 'text_to_image', candidate: img },
      { title: t('二', 'Two'), prompt: t('第二镜', 'Second shot'), taskKind: 'text_to_image', candidate: img },
    ] })
    return designs()[0].id
  } },
  { id: 'agent-same-request-two-calls', build: async ({ t }) => {
    const turn = lane().request('m-2')
    await turn({ shots: [
      { role: 'anchor', title: t('甲', 'A'), prompt: t('角色甲', 'Character A'), taskKind: 'text_to_image', candidate: img, storyboard: { kind: 'character', carrier: 'visual' } },
      { role: 'anchor', title: t('乙', 'B'), prompt: t('场景乙', 'Scene B'), taskKind: 'text_to_image', candidate: img, storyboard: { kind: 'scene', carrier: 'visual' } },
    ] })
    await turn({ shots: [
      { title: t('一', 'One'), prompt: t('第一镜', 'First shot'), taskKind: 'text_to_image', candidate: img },
      { title: t('二', 'Two'), prompt: t('第二镜', 'Second shot'), taskKind: 'text_to_image', candidate: img },
    ] })
    return designs()[0].id
  } },
  { id: 'agent-next-request-append', build: async ({ t }) => {
    const { request } = lane()
    await request('m-3')({ shots: [
      { role: 'anchor', title: t('甲', 'A'), prompt: t('角色甲', 'Character A'), taskKind: 'text_to_image', candidate: img, storyboard: { kind: 'character', carrier: 'visual' } },
      { role: 'anchor', title: t('乙', 'B'), prompt: t('场景乙', 'Scene B'), taskKind: 'text_to_image', candidate: img, storyboard: { kind: 'scene', carrier: 'visual' } },
    ] })
    const designId = designs()[0].id
    await request('m-4')({ operationId: designId, shots: [
      { title: t('一', 'One'), prompt: t('第一镜', 'First shot'), taskKind: 'text_to_image', candidate: img },
      { title: t('二', 'Two'), prompt: t('第二镜', 'Second shot'), taskKind: 'text_to_image', candidate: img },
    ] })
    return designId
  } },
  { id: 'hand-made-editor', build: async ({ t }) => {
    let value: StoryboardPlan = { title: 'hand', anchors: [], shots: [] }
    value = addAnchor(addAnchor(value, 'character'), 'scene')
    value = updateShotPrompt(addShot(value), 0, t('第一镜', 'First shot'))
    value = updateShotPrompt(addShot(value), 1, t('第二镜', 'Second shot'))
    const saved = useWorkbenchStore.getState().setStoryboardPlan(value, 'doc', undefined, true, 'user')!
    return saved.id
  } },
]

for (const lang of LANGS) {
  describe(`[${lang.lang}] 矩阵：门表清单里每一扇门都守同三条不变量`, () => {
    for (const entrance of ENTRANCES) {
      it(`${entrance.id}：一份方案、镜号 1..2、锚不占号、shot-1 是第一个镜头`, async () => {
        const designId = await entrance.build(lang)
        expect(designs()).toHaveLength(1)
        const value = planOf(designId)
        expect(value.shots.map(shot => shot.index)).toEqual([1, 2])
        expect(value.anchors).toHaveLength(2)
        expect(value.anchors.every(anchor => !/^shot-\d+$/.test(anchor.id))).toBe(true)
        const target = patchStoryboardSubject(value, 'shot-1', { prompt: 'x' })
        expect('description' in target).toBe(false)
        expect((target as { index: number }).index).toBe(1)
      })
    }
  })
}
