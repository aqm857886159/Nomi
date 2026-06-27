import { describe, expect, it } from 'vitest'
import { buildCatalogTaskRequest, normalizeCatalogTaskResult, runCatalogGenerationTask } from './catalogTaskActions'
import { resolveGenerationReferences } from './generationReferenceResolver'
import { MODEL_ARCHETYPES } from '../../../config/modelArchetypes'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import type { TaskRequestDto, TaskResultDto } from '../../api/taskApi'
import type { ModelCatalogModelDto, ModelCatalogVendorDto } from '../../api/modelCatalogApi'

function textNode(): GenerationCanvasNode {
  return { id: 'n1', kind: 'text', title: '', position: { x: 0, y: 0 }, meta: { modelKey: 'gpt-x' } }
}

function imageNode(): GenerationCanvasNode {
  return { id: 'n2', kind: 'image', title: '', position: { x: 0, y: 0 }, meta: { modelKey: 'sd' } }
}

function chatResult(raw: unknown, status: TaskResultDto['status'] = 'succeeded'): TaskResultDto {
  return { id: 'task-1', kind: 'chat', status, assets: [], raw }
}

describe('normalizeCatalogTaskResult — C5 text branch', () => {
  it('extracts OpenAI choices[0].message.content', () => {
    const result = normalizeCatalogTaskResult(chatResult({ choices: [{ message: { content: '  你好世界  ' } }] }), textNode())
    expect(result.type).toBe('text')
    expect(result.text).toBe('你好世界')
    expect(result.url).toBeUndefined()
    expect(result.taskKind).toBe('text')
    expect(result.model).toBe('gpt-x')
  })

  it('extracts OpenAI message.content as array of parts', () => {
    const result = normalizeCatalogTaskResult(
      chatResult({ choices: [{ message: { content: [{ type: 'text', text: 'foo' }, { type: 'text', text: 'bar' }] } }] }),
      textNode(),
    )
    expect(result.text).toBe('foobar')
  })

  it('falls back to Anthropic-style content[].text', () => {
    const result = normalizeCatalogTaskResult(chatResult({ content: [{ type: 'text', text: 'claude says hi' }] }), textNode())
    expect(result.text).toBe('claude says hi')
  })

  it('throws when the chat response carries no text', () => {
    expect(() => normalizeCatalogTaskResult(chatResult({ choices: [{ message: { content: '' } }] }), textNode())).toThrow(
      /没有返回文本/,
    )
  })

  it('throws on a failed text task', () => {
    expect(() => normalizeCatalogTaskResult(chatResult({ error: 'boom' }, 'failed'), textNode())).toThrow()
  })
})

// C2b：认得档案的模型（Seedance）在「首帧」模式下，即便 meta 里残留了上一次「首尾帧」模式放的
// lastFrameUrl，构建出的请求 extras 也不得带 last（M2 互斥发生在传输投影，避免上游 422）。
function seedanceVideoNode(modeId: string, extraMeta: Record<string, unknown>): GenerationCanvasNode {
  return {
    id: 'v1', kind: 'video', title: '', position: { x: 0, y: 0 }, prompt: '一只猫',
    meta: {
      modelKey: 'bytedance/seedance-2', modelVendor: 'kie', vendor: 'kie',
      archetype: { id: 'seedance-2', modeId },
      ...extraMeta,
    },
  }
}

// 回归锁（分镜参考链路确诊 2026-06-14）：角色卡(已生成 url) --character_ref 边--> Seedance omni 镜头，
// 经 resolveGenerationReferences → buildCatalogTaskRequest，角色图必须以**参考图数组**送达
// （reference_image_urls，全片身份参考），而不是被塞成 first_frame_url（只当第一帧→后面跑偏没角色）。
describe('分镜参考投递：character_ref 边 → omni 镜头 → 角色图进 reference_image_urls', () => {
  const charNode = (): GenerationCanvasNode => ({
    id: 'c1', kind: 'image', title: '林夏', position: { x: 0, y: 0 }, prompt: '',
    meta: { modelKey: 'gpt-image-2' }, result: { id: 'r', type: 'image', url: 'nomi-local://char.png', createdAt: 0 },
  })
  const shotOmni = (): GenerationCanvasNode => ({
    id: 'v1', kind: 'video', title: '镜头1', position: { x: 0, y: 0 }, prompt: '男孩说话',
    meta: { modelKey: 'bytedance/seedance-2', modelVendor: 'kie', vendor: 'kie', archetype: { id: 'seedance-2', modeId: 'omni' } },
  })
  const edge = { id: 'e', source: 'c1', target: 'v1', mode: 'character_ref' as const }

  it('omni：角色图落 reference_image_urls，不落 first_frame_url', () => {
    const shot = shotOmni()
    const references = resolveGenerationReferences(shot, { nodes: [charNode(), shot], edges: [edge] })
    const ai = buildCatalogTaskRequest(shot, { references }).request.extras?.archetypeInput as Record<string, unknown>
    expect(ai.reference_image_urls).toEqual(['nomi-local://char.png'])
    expect(ai.first_frame_url).toBeUndefined()
  })

  it('上游角色未生成（无 url）→ 参考为空（应由 canRunGenerationNode 拦下裸跑）', () => {
    const char = { ...charNode(), result: undefined }
    const shot = shotOmni()
    const references = resolveGenerationReferences(shot, { nodes: [char, shot], edges: [edge] })
    expect(references.referenceImages).toEqual([])
  })
})

// ★最高风险铁律（audit 2026-06-16）：数组参考收口到有序边后，N 张图经 character_ref 边 → Seedance omni
// 必须照样按 **order 顺序** 把图塞进 reference_image_urls（保 character1..N）。这是「绝不弄坏现有数组参考生成」的回归锁。
describe('数组参考有序收口：多张 character_ref 边 → omni 镜头 → image_urls 按 order', () => {
  const img = (id: string, url: string): GenerationCanvasNode => ({
    id, kind: 'image', title: id, position: { x: 0, y: 0 }, prompt: '',
    meta: { modelKey: 'gpt-image-2' }, result: { id: `${id}-r`, type: 'image', url, createdAt: 0 },
  })
  const shotOmni = (): GenerationCanvasNode => ({
    id: 'v1', kind: 'video', title: '镜头1', position: { x: 0, y: 0 }, prompt: '三人同框',
    meta: { modelKey: 'bytedance/seedance-2', modelVendor: 'kie', vendor: 'kie', archetype: { id: 'seedance-2', modeId: 'omni' } },
  })

  it('三条边按 order 0,1,2 → reference_image_urls = [a,b,c]（顺序稳定，不靠 edges 数组序）', () => {
    const a = img('a', 'nomi-local://a.png')
    const b = img('b', 'nomi-local://b.png')
    const c = img('c', 'nomi-local://c.png')
    const shot = shotOmni()
    // 故意把 edges 数组打乱（order 才是真相源）：
    const edges = [
      { id: 'ec', source: 'c', target: 'v1', mode: 'character_ref' as const, order: 2 },
      { id: 'ea', source: 'a', target: 'v1', mode: 'character_ref' as const, order: 0 },
      { id: 'eb', source: 'b', target: 'v1', mode: 'character_ref' as const, order: 1 },
    ]
    const references = resolveGenerationReferences(shot, { nodes: [a, b, c, shot], edges })
    const ai = buildCatalogTaskRequest(shot, { references }).request.extras?.archetypeInput as Record<string, unknown>
    expect(ai.reference_image_urls).toEqual(['nomi-local://a.png', 'nomi-local://b.png', 'nomi-local://c.png'])
  })
})

describe('buildCatalogTaskRequest — 档案驱动 input（extras.archetypeInput，M2 互斥）', () => {
  const archetypeInput = (node: GenerationCanvasNode) =>
    buildCatalogTaskRequest(node).request.extras?.archetypeInput as Record<string, unknown>

  it('首帧模式：残留的 lastFrameUrl 不进 archetypeInput（不会触发 §2 坑2 的 422）', () => {
    const ai = archetypeInput(seedanceVideoNode('first', { firstFrameUrl: 'F.png', lastFrameUrl: 'L.png' }))
    expect(ai.first_frame_url).toBe('F.png')
    expect(ai.last_frame_url).toBeUndefined()
  })

  it('首尾帧模式：first + last 两帧都进', () => {
    const ai = archetypeInput(seedanceVideoNode('firstlast', { firstFrameUrl: 'F.png', lastFrameUrl: 'L.png' }))
    expect(ai.first_frame_url).toBe('F.png')
    expect(ai.last_frame_url).toBe('L.png')
  })

  it('全能参考模式：角色图数组进（按序），残留的 firstFrameUrl 不进（互斥含数组）', () => {
    const ai = archetypeInput(seedanceVideoNode('omni', {
      referenceImageUrls: ['c1.png', 'c2.png'],
      referenceVideoUrls: ['v1.mp4'],
      firstFrameUrl: 'stale.png',
    }))
    expect(ai.reference_image_urls).toEqual(['c1.png', 'c2.png'])
    expect(ai.reference_video_urls).toEqual(['v1.mp4'])
    expect(ai.first_frame_url).toBeUndefined()
  })
})

describe('buildCatalogTaskRequest — 档案 mapping 桶由 transportTaskKind 显式决定（修 omni 误路由）', () => {
  function videoNode(modelKey: string, modeId: string, extra: Record<string, unknown> = {}): GenerationCanvasNode {
    return {
      id: 'r1', kind: 'video', title: '', position: { x: 0, y: 0 }, prompt: 'x',
      meta: { modelKey, modelVendor: 'kie', vendor: 'kie', archetype: { id: modelKey.includes('happyhorse') ? 'happyhorse' : modelKey.includes('fast') ? 'seedance-2-fast' : 'seedance-2', modeId }, ...extra },
    }
  }
  it('Seedance omni（无首帧）→ image_to_video，不再误判 text_to_video 撞 HappyHorse mapping', () => {
    expect(buildCatalogTaskRequest(videoNode('bytedance/seedance-2', 'omni', { referenceImageUrls: ['c1'] })).request.kind).toBe('image_to_video')
  })
  it('Seedance 首帧 → image_to_video', () => {
    expect(buildCatalogTaskRequest(videoNode('bytedance/seedance-2', 'first', { firstFrameUrl: 'F' })).request.kind).toBe('image_to_video')
  })
  it('Seedance Fast → 复用 image_to_video 桶', () => {
    expect(buildCatalogTaskRequest(videoNode('bytedance/seedance-2-fast', 'first', { firstFrameUrl: 'F' })).request.kind).toBe('image_to_video')
  })
  it('HappyHorse 任意模式 → text_to_video 桶', () => {
    expect(buildCatalogTaskRequest(videoNode('happyhorse', 't2v')).request.kind).toBe('text_to_video')
    expect(buildCatalogTaskRequest(videoNode('happyhorse', 'i2v', { firstFrameUrl: 'F' })).request.kind).toBe('text_to_video')
  })
})

// 根因回归（2026-06-08）：断开 kie、连 apimart 后，钉死在 kie 的老节点运行时必须自动迁到
// apimart 的同款模型，而不是抛 `API key missing: kie`。
describe('runCatalogGenerationTask — 断开 kie 后老节点自动迁移到已连接供应商', () => {
  const vendorDto = (key: string, hasApiKey: boolean): ModelCatalogVendorDto => ({ key, name: key, enabled: true, hasApiKey, createdAt: '', updatedAt: '' })
  const apimartSeedream: ModelCatalogModelDto = { modelKey: 'doubao-seedream-4.5', vendorKey: 'apimart', labelZh: 'Seedream 4.5', kind: 'image', enabled: true, meta: { archetypeId: 'seedream' }, createdAt: '', updatedAt: '' }

  const staleKieNode: GenerationCanvasNode = {
    id: 'n1', kind: 'image', title: '', position: { x: 0, y: 0 }, prompt: '画只猫',
    meta: { modelKey: 'seedream', modelVendor: 'kie', vendor: 'kie', archetype: { id: 'seedream', modeId: 't2i' } },
  }

  function harness() {
    const calls: Array<{ vendor: string; request: TaskRequestDto }> = []
    const options = {
      listCatalogVendors: async () => [vendorDto('apimart', true), vendorDto('kie', false)],
      listCatalogModels: async () => [apimartSeedream],
      runTask: async (vendor: string, request: TaskRequestDto) => {
        calls.push({ vendor, request })
        return { id: 't1', kind: request.kind, status: 'succeeded' as const, assets: [{ type: 'image' as const, url: 'https://x/out.png' }], raw: {} }
      },
    }
    return { calls, options }
  }

  it('请求打到 apimart，modelKey 改写成 doubao-seedream-4.5（不再要 kie 的 key）', async () => {
    const { calls, options } = harness()
    const result = await runCatalogGenerationTask(staleKieNode, options)
    expect(calls).toHaveLength(1)
    expect(calls[0].vendor).toBe('apimart')
    expect(calls[0].request.extras?.modelKey).toBe('doubao-seedream-4.5')
    expect(result.url).toBe('https://x/out.png')
  })

  it('没有任何已连接供应商提供该款 → 抛清晰可行动错误，而非 cryptic key missing', async () => {
    const { options } = harness()
    await expect(
      runCatalogGenerationTask(staleKieNode, { ...options, listCatalogVendors: async () => [vendorDto('kie', false)], listCatalogModels: async () => [] }),
    ).rejects.toThrow(/没有已连接的供应商提供/)
  })
})

describe('runCatalogGenerationTask — 轮询硬超时抛 RecoverableTimeoutError（可找回，非普通失败）', () => {
  const videoNode: GenerationCanvasNode = {
    id: 'v1', kind: 'video', title: '', position: { x: 0, y: 0 }, prompt: '一只猫跑过草地',
    meta: { modelKey: 'vid', vendor: 'asyncv' },
  }

  it('超时抛 RecoverableTimeoutError，detail 带 taskId/vendor/taskKind，且软超时后回报 still-generating', async () => {
    const { isRecoverableTimeoutError, RecoverableTimeoutError } = await import('./recoverableTimeout')
    const phases: string[] = []
    const error = await runCatalogGenerationTask(videoNode, {
      // 首发拿到 taskId、非终态 → 进轮询
      runTask: async (_v, req) => ({ id: 'up-task-9', kind: req.kind, status: 'queued' as const, assets: [], raw: {} }),
      // 始终非终态 → 必定走到硬超时
      fetchTaskResult: async () => ({ vendor: 'asyncv', result: { id: 'up-task-9', kind: 'text_to_video' as const, status: 'queued' as const, assets: [], raw: {} } }),
      pollIntervalMs: 1,
      pollTimeoutMs: 4, // soft=hard=4ms（覆盖时收敛），几个 tick 即超时
      onProgress: (p) => { if (p.phase) phases.push(p.phase) },
    }).catch((e) => e)

    expect(isRecoverableTimeoutError(error)).toBe(true)
    expect((error as InstanceType<typeof RecoverableTimeoutError>).detail).toMatchObject({
      taskId: 'up-task-9', vendor: 'asyncv', taskKind: 'text_to_video', modelKey: 'vid',
    })
  })
})

// ★钱安全铁律回归（2026-06-27 用户报「平台冒出很多视频、费用被扣」根因）：
// 付费任务已提交(runTask 成功、拿到 taskId)后，轮询查结果失败【绝不】能冒泡出去触发外层
// runGenerationNode 重试循环——那会重新 runTask 二次扣费(单确认最多 ×3/节点、批量再乘)。
// 查结果是免费的：抖动就免费重试查询；持续失败 → 落 RecoverableTimeoutError(可找回，不重发)。
describe('runCatalogGenerationTask — 轮询查询失败绝不重新提交付费任务（钱安全回归）', () => {
  const videoNode: GenerationCanvasNode = {
    id: 'v1', kind: 'video', title: '', position: { x: 0, y: 0 }, prompt: '一只猫跑过草地',
    meta: { modelKey: 'vid', vendor: 'asyncv' },
  }

  it('轮询期一次网络抖动 → 免费重试查询、付费 runTask 只调一次、最终拿到结果', async () => {
    let submitCount = 0
    let fetchCount = 0
    const result = await runCatalogGenerationTask(videoNode, {
      runTask: async (_v, req) => { submitCount += 1; return { id: 'up-1', kind: req.kind, status: 'queued' as const, assets: [], raw: {} } },
      fetchTaskResult: async () => {
        fetchCount += 1
        if (fetchCount === 1) throw new TypeError('Failed to fetch') // 第一次查结果网络抖动
        return { vendor: 'asyncv', result: { id: 'up-1', kind: 'text_to_video' as const, status: 'succeeded' as const, assets: [{ type: 'video' as const, url: 'https://x/out.mp4' }], raw: {} } }
      },
      pollIntervalMs: 1,
      pollTimeoutMs: 5000, // 充足，确保走的是「重试查询」而非「超时」路径
    })
    expect(submitCount).toBe(1) // ★绝不二次提交付费任务
    expect(result.url).toBe('https://x/out.mp4')
  })

  it('轮询持续失败 → 落 RecoverableTimeoutError（可找回，非重发），runTask 仍只一次', async () => {
    const { isRecoverableTimeoutError } = await import('./recoverableTimeout')
    let submitCount = 0
    const error = await runCatalogGenerationTask(videoNode, {
      runTask: async (_v, req) => { submitCount += 1; return { id: 'up-2', kind: req.kind, status: 'queued' as const, assets: [], raw: {} } },
      fetchTaskResult: async () => { throw new TypeError('Failed to fetch') }, // 查结果一直失败
      pollIntervalMs: 1,
      pollTimeoutMs: 4, // hard=4ms → 几个 tick 即落 recoverable，不重发
    }).catch((e) => e)
    expect(isRecoverableTimeoutError(error)).toBe(true)
    expect(submitCount).toBe(1) // ★持续失败也绝不二次提交
  })
})

// 幂等键穿透回归：options.idempotencyKey 必须落进 request.extras.idempotencyKey，
// 否则 electron 侧台账拿不到键、去重失效（= 提交幂等整条链断在最后一跳）。
describe('buildCatalogTaskRequest — idempotencyKey 穿透到 request.extras', () => {
  it('options.idempotencyKey → request.extras.idempotencyKey', () => {
    const node: GenerationCanvasNode = { id: 'n1', kind: 'image', title: '', position: { x: 0, y: 0 }, prompt: '画只猫', meta: { modelKey: 'gpt-image-2-image-to-image', modelVendor: 'kie', vendor: 'kie', archetype: { id: 'gpt-image-2', modeId: 't2i' } } }
    const built = buildCatalogTaskRequest(node, { idempotencyKey: 'run-abc-123' })
    expect((built.request.extras as Record<string, unknown>).idempotencyKey).toBe('run-abc-123')
  })
  it('未给 idempotencyKey → extras 不带该键（无键时 runTask 不介入，向后兼容）', () => {
    const node: GenerationCanvasNode = { id: 'n1', kind: 'image', title: '', position: { x: 0, y: 0 }, prompt: '画只猫', meta: { modelKey: 'gpt-image-2-image-to-image', modelVendor: 'kie', vendor: 'kie', archetype: { id: 'gpt-image-2', modeId: 't2i' } } }
    const built = buildCatalogTaskRequest(node, {})
    expect((built.request.extras as Record<string, unknown>).idempotencyKey).toBeUndefined()
  })
})

describe('normalizeCatalogTaskResult — image path unaffected', () => {
  it('still returns an image result from an asset', () => {
    const result = normalizeCatalogTaskResult(
      { id: 't2', kind: 'text_to_image', status: 'succeeded', assets: [{ type: 'image', url: 'https://x/y.png' }], raw: {} },
      imageNode(),
    )
    expect(result.type).toBe('image')
    expect(result.url).toBe('https://x/y.png')
  })
})

describe('GPT Image 2 档案（图像，2 模式打不同 taskKind 桶 + input_urls）', () => {
  const gptNode = (modeId: string, extra: Record<string, unknown> = {}): GenerationCanvasNode => ({
    id: 'g1', kind: 'image', title: '', position: { x: 0, y: 0 }, prompt: '画只猫',
    meta: { modelKey: 'gpt-image-2-image-to-image', modelVendor: 'kie', vendor: 'kie', archetype: { id: 'gpt-image-2', modeId }, ...extra },
  })
  it('文生图模式：taskKind=text_to_image，model=t2i enum，无 input_urls', () => {
    const built = buildCatalogTaskRequest(gptNode('t2i'))
    expect(built.request.kind).toBe('text_to_image')
    const ai = built.request.extras?.archetypeInput as Record<string, unknown>
    expect(ai.model).toBe('gpt-image-2-text-to-image')
    expect(ai).not.toHaveProperty('input_urls')
  })
  it('图生图模式：taskKind=image_edit，model=i2i enum，输入图进 input_urls（不是 reference_image_urls）', () => {
    const built = buildCatalogTaskRequest(gptNode('i2i', { referenceImageUrls: ['https://x/a.png', 'https://x/b.png'] }))
    expect(built.request.kind).toBe('image_edit')
    const ai = built.request.extras?.archetypeInput as Record<string, unknown>
    expect(ai.model).toBe('gpt-image-2-image-to-image')
    expect(ai.input_urls).toEqual(['https://x/a.png', 'https://x/b.png'])
    expect(ai).not.toHaveProperty('reference_image_urls')
  })
})

describe('Seedream 档案（图像，改图输入图走 image_urls，与 GPT 同桶不同键）', () => {
  const sdNode = (modeId: string, extra: Record<string, unknown> = {}): GenerationCanvasNode => ({
    id: 's1', kind: 'image', title: '', position: { x: 0, y: 0 }, prompt: '改图',
    meta: { modelKey: 'seedream', modelVendor: 'kie', vendor: 'kie', archetype: { id: 'seedream', modeId }, ...extra },
  })
  it('文生图：taskKind=text_to_image，model=4.5 t2i enum', () => {
    const built = buildCatalogTaskRequest(sdNode('t2i'))
    expect(built.request.kind).toBe('text_to_image')
    expect((built.request.extras?.archetypeInput as Record<string, unknown>).model).toBe('seedream/4.5-text-to-image')
  })
  it('改图：taskKind=image_edit，输入图进 image_urls（不是 input_urls / reference_image_urls）', () => {
    const built = buildCatalogTaskRequest(sdNode('edit', { referenceImageUrls: ['https://x/1.png', 'https://x/2.png'] }))
    expect(built.request.kind).toBe('image_edit')
    const ai = built.request.extras?.archetypeInput as Record<string, unknown>
    expect(ai.model).toBe('bytedance/seedream-v4-edit')
    expect(ai.image_urls).toEqual(['https://x/1.png', 'https://x/2.png'])
    expect(ai).not.toHaveProperty('input_urls')
    expect(ai).not.toHaveProperty('reference_image_urls')
  })
})

// ───────── 「接入即验证」零额度结构闸门 ─────────
// 遍历**每个内置档案 × 每个模式**：把该模式声明的参考槽都填上 → 构建请求 → 断言每个填进去的参考值
// 都真的到达了请求（extras.archetypeInput）。这正是 omni 参考图丢失那类 bug 的结构防线：以后任何模型/
// 模式若"声明了槽但参考没进请求"，这条直接红。动态遍历 MODEL_ARCHETYPES → 新增档案自动纳入，漏不掉。
describe('接入即验证（零额度）：每个档案/模式声明的参考槽，值都进得了请求', () => {
  // 槽 kind → 渲染层存它的 meta 键 + 一个 dummy 值（数组槽给数组）。
  const SLOT_FILL: Record<string, { key: string; value: unknown; flat: string[] }> = {
    first_frame: { key: 'firstFrameUrl', value: 'https://x/ff.png', flat: ['https://x/ff.png'] },
    last_frame: { key: 'lastFrameUrl', value: 'https://x/lf.png', flat: ['https://x/lf.png'] },
    image_ref: { key: 'referenceImageUrls', value: ['https://x/ir.png'], flat: ['https://x/ir.png'] },
    video_ref: { key: 'referenceVideoUrls', value: ['https://x/vr.mp4'], flat: ['https://x/vr.mp4'] },
    audio_ref: { key: 'referenceAudioUrls', value: ['https://x/ar.mp3'], flat: ['https://x/ar.mp3'] },
    source_video: { key: 'sourceVideoUrl', value: 'https://x/sv.mp4', flat: ['https://x/sv.mp4'] },
  }
  // 扁平出所有 url 字符串：含 combineSlotsInto 的 [{url,role}]，也含火山 content item 的
  // {image_url:{url}} / {video_url:{url}} / {audio_url:{url}}。只关心"槽值是否进入请求"，不关心供应商外壳。
  const flattenValues = (value: unknown): string[] => {
    if (typeof value === 'string') return /^https?:\/\//i.test(value) ? [value] : []
    if (Array.isArray(value)) return value.flatMap(flattenValues)
    if (value && typeof value === 'object') return Object.values(value as Record<string, unknown>).flatMap(flattenValues)
    return []
  }

  for (const archetype of MODEL_ARCHETYPES) {
    for (const mode of archetype.modes) {
      const refSlots = mode.slots.filter((s) => SLOT_FILL[s.kind])
      it(`${archetype.id} / ${mode.id}：${refSlots.length} 个参考槽的值都进请求（不静默丢）`, () => {
        const meta: Record<string, unknown> = {
          modelKey: archetype.identifierPatterns[0],
          modelVendor: 'kie', vendor: 'kie',
          archetype: { id: archetype.id, modeId: mode.id },
        }
        for (const s of refSlots) meta[SLOT_FILL[s.kind].key] = SLOT_FILL[s.kind].value
        const nodeKind = archetype.kind === 'image' ? 'image' : 'video'
        const node: GenerationCanvasNode = { id: 'g1', kind: nodeKind, title: '', position: { x: 0, y: 0 }, prompt: 'p', meta }
        const ai = buildCatalogTaskRequest(node).request.extras?.archetypeInput as Record<string, unknown>
        expect(ai, '档案模型必须产出 archetypeInput').toBeTruthy()
        const present = new Set(flattenValues(ai))
        for (const s of refSlots) {
          for (const v of SLOT_FILL[s.kind].flat) {
            expect(present.has(v), `${archetype.id}/${mode.id} 的槽 ${s.kind} 值未进请求体（会像 omni 参考图那样静默丢）`).toBe(true)
          }
        }
      })
    }
  }
})
