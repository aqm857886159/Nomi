vi.mock('../../../../config/useModelOptions', () => ({ preloadModelOptions: async () => [{ value: 'gpt-image-2', modelKey: 'gpt-image-2', vendor: 'apimart', label: 'gpt-image-2' }] }))
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { applyCanvasToolCall } from '../../../generationCanvas/agent/applyCanvasToolCall'
import { buildAnchorSheetPrompt, compileShotOutbound } from '../../../generationCanvas/agent/storyboardPromptCompiler'
import { isVisualAnchor } from '../../../../../electron/shared/storyboard/storyboardPromptCompiler'
import { encodeMention } from '../../../assets/promptMentions'
import { storyboardPlanToCreateNodesArgs, type PlanAnchor, type StoryboardPlan } from '../../../generationCanvas/agent/storyboardPlan'
import { buildCatalogTaskRequest } from '../../../generationCanvas/runner/catalogTaskActions'
import type { GenerationCanvasNode } from '../../../generationCanvas/model/generationCanvasTypes'
import { useGenerationCanvasStore } from '../../../generationCanvas/store/generationCanvasStore'
import { useSpendConfirmStore } from '../../../generationCanvas/spend/spendConfirm'
import { useWorkbenchStore } from '../../../workbenchStore'
import { generateAnchorCard, regenerateAnchorCard, runStoryboardBatch } from './storyboardRowActions'
import type { StoryboardRowRuntime } from './storyboardRowStatus'

// 契约测试（所见即所发，类级）：每一个「把框里的字编成请求」的入口，发出去的字 = 框里的字 + 可见引用。
//
// 起因：用户 10-29 反馈创作区一路生成的定妆卡出了没要的画风，提示词里看不到风格词——参考卡有结构化特征时
// 整段丢掉了描述框里的字。镜头行早在 2026-09-30 就收成了 compileShotOutbound 一个出口并有对等测试
// （shotOutbound.parity.test.ts），参考卡和画布节点的出站当时没被纳入同一条原则；这里补上，并把
// 「已知还没守住」的几处登记成例外表，每条带逃逸账本条目 id 与序号，而且例外本身也要被测试钉住：
// 哪天某个例外被修好了，对应断言会红，逼着把它从表里删掉（例外表只减不增）。
//
// 逃逸账本条目：tests/ux/full-walk/escapeLedger/USER-20261029-prompt-outbound-not-box.json

vi.mock('../../../generationCanvas/agent/availableModels', () => ({
  buildAgentModelEntries: () => [],
  listAvailableModelsForAgent: async () => [],
  resolveStoryboardImageDefault: async () => ({}),
  resolveStoryboardVideoDefault: async () => ({}),
}))
const regenerateNodeInPlace = vi.fn(async () => 'started')
vi.mock('../../../generationCanvas/runner/generationRunController', () => ({
  confirmAndRunNode: async (_nodeId: string, options: { deferredMaterialization?: { materialize: () => Promise<string> } }) => {
    await options.deferredMaterialization?.materialize()
    return 'started'
  },
  regenerateNodeInPlace: (...args: unknown[]) => regenerateNodeInPlace(...(args as [])),
}))
vi.mock('../../../generationCanvas/components/batchPlanPreview', () => ({
  confirmAndRunPlan: async (_plan: unknown, options: { deferredMaterialization?: { materialize: () => Promise<unknown> } }) => {
    await options.deferredMaterialization?.materialize()
    return 'started'
  },
}))

/** 例外表：已知「发出去 ≠ 框里」的地方。id 是逃逸账本条目 id，seq 是该条目里的序号（与账本 notes 对齐）。 */
const LEDGER = 'USER-20261029-prompt-outbound-not-box'
const KNOWN_EXCEPTIONS = [
  { seq: 2, where: '批量 / 生成剩余：已有的参考卡沿用旧节点提示词，不按创作区描述框重编', pinnedBy: 'batch-reuses-card-prompt' },
  { seq: 3, where: '带站位构图参考的图片请求：请求上追加一句写实重渲染要求，框里与参考芯片上都没有', pinnedBy: 'staging-composition-suffix' },
  { seq: 4, where: '发送前改空白：提示词两端空白与行内连续空白在编成请求时被整理', pinnedBy: 'whitespace-normalised' },
  { seq: 5, where: '首帧提示词框为空时借用视频提示词框的字', pinnedBy: 'keyframe-falls-back-to-shot' },
  { seq: 6, where: '孤儿 @ 引用（框里有标记但参考已不在）被静默删掉', pinnedBy: 'orphan-mention-dropped' },
  { seq: 7, where: '部分供应商适配器在最后一步再 trim 提示词（分散在各适配器里，本表不逐个钉，归后续普查）', pinnedBy: null },
  { seq: 8, where: '参考卡版面外壳（视图列表、变体行、Requirements）是固定模板，描述框里没有这些字', pinnedBy: 'sheet-template-shell' },
  { seq: 9, where: '生产质检定向重试往本次提交追加机器写的修正句（不写进节点）', pinnedBy: 'qa-retry-suffix' },
] as const satisfies ReadonlyArray<{ seq: number; where: string; pinnedBy: string | null }>

const ANCHOR_KINDS = ['character', 'scene', 'prop'] as const
const STYLE_WORDS = '真人写实摄影风格，35mm 胶片质感'

type Shape = { name: string; anchor: (kind: (typeof ANCHOR_KINDS)[number]) => PlanAnchor }
const base = (kind: (typeof ANCHOR_KINDS)[number], extra: Partial<PlanAnchor>): PlanAnchor => ({
  id: `a-${kind}`, kind, carrier: 'visual', name: '叶秋', description: `古装人物，${STYLE_WORDS}`, ...extra,
})
/** 字段形状：Agent 起草会带结构化特征，用户手写不会，旧草稿只有结构化字段。 */
const SHAPES: readonly Shape[] = [
  { name: '只有 description', anchor: (k) => base(k, {}) },
  { name: 'description + staticFeatures（Agent 起草的常见形状，修前丢风格词）', anchor: (k) => base(k, { staticFeatures: '黑色齐肩短发、瓜子脸' }) },
  { name: 'description + dynamicFeatures', anchor: (k) => base(k, { dynamicFeatures: '深蓝雨衣' }) },
  { name: 'description + static + dynamic', anchor: (k) => base(k, { staticFeatures: '黑色齐肩短发、瓜子脸', dynamicFeatures: '深蓝雨衣' }) },
  { name: 'description 前后有空白和换行', anchor: (k) => base(k, { description: `  \n古装人物，${STYLE_WORDS}\n  `, staticFeatures: '瓜子脸' }) },
]

const planOf = (anchor: PlanAnchor): StoryboardPlan => ({ title: '叶秋', anchors: [anchor], shots: [] })
const ctxOf = (plan: StoryboardPlan) => ({ initiator: 'user' as const, documentId: 'doc', designId: 'design', plan })
const anchorNode = () => useGenerationCanvasStore.getState().nodes.find((node) => node.meta?.anchorId)

beforeEach(() => {
  regenerateNodeInPlace.mockClear()
  useWorkbenchStore.getState().hydrateWorkbenchDocuments([{ id: 'doc', version: 1, title: '故事', contentJson: { type: 'doc', content: [] }, updatedAt: 1 }], 'doc')
  useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [], edges: [], groups: [], selectedNodeIds: [] })
  vi.spyOn(useSpendConfirmStore.getState(), 'requestConfirm').mockResolvedValue(true)
})

function seedPlan(anchor: PlanAnchor) {
  const plan = planOf(anchor)
  useWorkbenchStore.getState().hydrateStoryboardDesigns({ doc: [{ id: 'design', documentId: 'doc', title: plan.title, plan, committed: false, status: 'draft', sourceDocumentUpdatedAt: 1, createdAt: 1, updatedAt: 1 }] })
  return plan
}

/** 参考卡的入口：名字 → 跑完后读画布上那张卡的 prompt。每个入口都从「用户在描述框里写的 anchor」出发。 */
const anchorEntrances: ReadonlyArray<readonly [string, (anchor: PlanAnchor) => Promise<string | undefined>]> = [
  ['生成（还没有卡：generateAnchorCard 建卡）', async (anchor) => { await generateAnchorCard(ctxOf(seedPlan(anchor)), anchor); return anchorNode()?.prompt }],
  ['整方案落画布（production.materialize-storyboard）', async (anchor) => {
    await applyCanvasToolCall('create_canvas_nodes', storyboardPlanToCreateNodesArgs(planOf(anchor)))
    return anchorNode()?.prompt
  }],
  ['放到画布（runStoryboardBatch 只摆位）', async (anchor) => {
    await runStoryboardBatch(ctxOf(seedPlan(anchor)), [], { groupTitle: '叶秋', placementOnly: true })
    return anchorNode()?.prompt
  }],
  ['创作区改描述后再点生成（已有卡：写回描述再出）', async (anchor) => {
    // 先落一张「旧描述」的卡，再把描述框改成 anchor 的样子。
    const old = { ...anchor, description: '旧的一句', staticFeatures: undefined, dynamicFeatures: undefined }
    await generateAnchorCard(ctxOf(seedPlan(old)), old)
    await generateAnchorCard(ctxOf(seedPlan(anchor)), anchor)
    return anchorNode()?.prompt
  }],
  ['创作区改描述后点重生成（regenerateAnchorCard）', async (anchor) => {
    const old = { ...anchor, description: '旧的一句', staticFeatures: undefined, dynamicFeatures: undefined }
    await generateAnchorCard(ctxOf(seedPlan(old)), old)
    const node = anchorNode()!
    await regenerateAnchorCard(ctxOf(seedPlan(anchor)), anchor, node)
    return anchorNode()?.prompt
  }],
]

describe('参考卡：发出去的 = 描述框里的字（风格词不丢），每个入口 × 每种卡 × 每种字段形状', () => {
  for (const [entrance, run] of anchorEntrances) {
    for (const kind of ANCHOR_KINDS) {
      for (const shape of SHAPES) {
        it(`${entrance} · ${kind} · ${shape.name}`, async () => {
          const anchor = shape.anchor(kind)
          const prompt = await run(anchor)
          expect(prompt, '入口没把卡落到画布上').toBeTruthy()
          // 框里的字（trim 后的 description）原样在出站里，风格词随之在。
          expect(prompt).toContain(anchor.description.trim())
          expect(prompt).toContain(STYLE_WORDS)
          // 不多：结构化特征是 description 的细化，只在 meta，不追加进提示词。
          if (anchor.staticFeatures) expect(prompt).not.toContain(anchor.staticFeatures)
          if (anchor.dynamicFeatures) expect(prompt).not.toContain(anchor.dynamicFeatures)
          expect(prompt).not.toContain('身份特征（跨镜保持一致）')
          // 所有入口同一份：就是编译层那个出口的输出。
          expect(prompt).toBe(buildAnchorSheetPrompt(anchor))
        })
      }
    }
  }

  it('旧数据：description 为空、只有结构化字段的旧草稿，出站与升级前逐字相同', () => {
    for (const kind of ANCHOR_KINDS) {
      const legacy = base(kind, { description: '', staticFeatures: '黑色齐肩短发、瓜子脸', dynamicFeatures: '深蓝雨衣' })
      const prompt = buildAnchorSheetPrompt(legacy)
      expect(prompt).toContain('身份特征（跨镜保持一致）：黑色齐肩短发、瓜子脸')
      expect(prompt).toContain('服装与状态：深蓝雨衣')
    }
  })

  it('所有可出图的种类都被矩阵遍历：新增一种锚类型却没进这张表就红', () => {
    const visual = (['character', 'scene', 'prop', 'style', 'event'] as const).filter((kind) => isVisualAnchor({ carrier: 'visual', kind } as never))
    expect([...visual].sort()).toEqual([...ANCHOR_KINDS].sort())
  })
})

describe('画布节点生成（buildCatalogTaskRequest，imageActions / videoActions 两扇读门共用）：请求里的提示词 = 节点提示词框里的字', () => {
  const node = (prompt: string, meta: Record<string, unknown> = {}): GenerationCanvasNode => ({
    id: 'n', kind: 'image', title: '', prompt, position: { x: 0, y: 0 }, meta: { modelKey: 'gpt-image-2', modelVendor: 'apimart', ...meta },
  })
  const PROMPTS = [
    `一只橘猫坐在窗台上，${STYLE_WORDS}`,
    '动漫插画，赛博朋克夜景',
    'A cat on the windowsill, oil painting',
    '第一行\n第二行',
  ] as const

  for (const text of PROMPTS) {
    it(`提示词逐字发出（含风格词、换行）：${text.slice(0, 18)}`, () => {
      expect(buildCatalogTaskRequest(node(text)).request.prompt).toBe(text)
    })
  }

  it('没有构图参考、没有重试后缀时什么都不加', () => {
    const { request } = buildCatalogTaskRequest(node('一只黑猫'))
    expect(request.prompt).toBe('一只黑猫')
  })

  // ── 已知例外（每条带逃逸账本条目 id 与序号；被修好时这些断言会红，逼着删表项）──
  it(`[${LEDGER}#3 staging-composition-suffix] 带站位构图参考时请求上多一句写实要求，节点框里没有`, () => {
    const { request } = buildCatalogTaskRequest(node('两个人在街头对视'), { references: { stagingComposition: true } as never })
    expect(request.prompt.startsWith('两个人在街头对视')).toBe(true)
    expect(request.prompt).not.toBe('两个人在街头对视')
    expect(request.prompt).toContain('完全写实地重新渲染')
  })

  it(`[${LEDGER}#9 qa-retry-suffix] 质检定向重试把机器写的修正句追加到本次提交`, () => {
    const { request } = buildCatalogTaskRequest(node('一只黑猫'), { promptSuffix: '修正：手指数量' })
    expect(request.prompt).toBe('一只黑猫\n\n修正：手指数量')
  })

  it(`[${LEDGER}#4 whitespace-normalised] 提示词两端空白在编成请求时被去掉（框里是什么，发出去不是逐字）`, () => {
    const { request } = buildCatalogTaskRequest(node('  一只黑猫  '))
    expect(request.prompt).toBe('一只黑猫')
  })
})

describe('其余已知例外：当前行为被钉住（修好了就红，逼着删表项）', () => {
  it(`[${LEDGER}#2 batch-reuses-card-prompt] 批量 / 生成剩余遇到已有参考卡，沿用旧节点提示词，不按创作区新描述重编`, async () => {
    const old: PlanAnchor = base('character', { description: '旧的一句' })
    await generateAnchorCard(ctxOf(seedPlan(old)), old)
    expect(anchorNode()?.prompt).toContain('旧的一句')
    const edited: PlanAnchor = base('character', { description: `新的一句，${STYLE_WORDS}` })
    const plan: StoryboardPlan = { title: '叶秋', anchors: [edited], shots: [{ index: 1, shotId: 's1', shotKind: 'image', durationSec: 3, prompt: '街头', anchorIds: [edited.id] }] }
    useWorkbenchStore.getState().hydrateStoryboardDesigns({ doc: [{ id: 'design', documentId: 'doc', title: plan.title, plan, committed: false, status: 'draft', sourceDocumentUpdatedAt: 1, createdAt: 1, updatedAt: 1 }] })
    const row = { shot: plan.shots[0], mode: null, exec: {} as never } as unknown as StoryboardRowRuntime
    const outcome = await runStoryboardBatch(ctxOf(plan), [row])
    expect(outcome, '批量没真的跑到物化步骤，这条钉子就是空的').toBe('started')
    expect(anchorNode()?.prompt).toContain('旧的一句')
    expect(anchorNode()?.prompt).not.toContain('新的一句')
  })

  it(`[${LEDGER}#5 keyframe-falls-back-to-shot] 首帧提示词框为空时，发出去的是视频提示词框里的字`, () => {
    const shot = { index: 1, shotId: 's1', shotKind: 'video' as const, durationSec: 5, prompt: '视频框里的字', anchorIds: [], keyframe: { enabled: true, prompt: '' } }
    expect(compileShotOutbound(shot as never, 'keyframe').prompt).toBe('视频框里的字')
  })

  it(`[${LEDGER}#6 orphan-mention-dropped] 提示词里指向已经不在的参考的 @ 标记被静默删掉`, () => {
    const text = `照着${encodeMention({ url: 'nomi-local://asset/p/gone.png', name: '旧图' } as never)}画`
    const { request } = buildCatalogTaskRequest({ id: 'n', kind: 'image', title: '', prompt: text, position: { x: 0, y: 0 }, meta: { modelKey: 'gpt-image-2', modelVendor: 'apimart' } })
    expect(request.prompt).toBe('照着画')
  })

  it(`[${LEDGER}#4 whitespace-normalised] 行内连续空白与空行被折叠`, () => {
    const { request } = buildCatalogTaskRequest({ id: 'n', kind: 'image', title: '', prompt: `照着${encodeMention({ url: 'nomi-local://asset/p/gone.png', name: '旧图' } as never)}   画`, position: { x: 0, y: 0 }, meta: { modelKey: 'gpt-image-2', modelVendor: 'apimart' } })
    expect(request.prompt).not.toContain('  ')
  })

  it(`[${LEDGER}#8 sheet-template-shell] 参考卡版面外壳是固定模板：出站里有描述框里没有的版面字样`, () => {
    for (const kind of ANCHOR_KINDS) {
      const prompt = buildAnchorSheetPrompt(base(kind, {}))
      expect(prompt).toMatch(/reference sheet/)
      expect(prompt).toMatch(/Requirements:/)
    }
  })
})

describe('例外表本身：每条例外有账本序号、有一条测试钉着，序号不重复', () => {
  it('序号唯一且 ≥2（序号 1 是本 PR 已修的描述被丢）', () => {
    const seqs = KNOWN_EXCEPTIONS.map((entry) => entry.seq)
    expect(new Set(seqs).size).toBe(seqs.length)
    expect(Math.min(...seqs)).toBeGreaterThanOrEqual(2)
  })

  it('没被钉住的例外显式列出（只许是适配器那一条，其余都在上面被钉着）', () => {
    expect(KNOWN_EXCEPTIONS.filter((entry) => entry.pinnedBy === null).map((entry) => entry.seq)).toEqual([7])
  })

  it('例外总数没有悄悄变多：新增例外必须同时登记进逃逸账本条目并更新这个数', () => {
    expect(KNOWN_EXCEPTIONS).toHaveLength(8)
  })
})
