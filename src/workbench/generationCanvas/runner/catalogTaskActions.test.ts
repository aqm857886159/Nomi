import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildCatalogTaskRequest,
  isRateLimitedPollError,
  isSlowLaneBackend,
  nextPollDelayMs,
  normalizeCatalogTaskResult,
  resolvePollBudget,
  resolvePollIntervalMs,
  runCatalogGenerationTask,
} from './catalogTaskActions'
import { resolveGenerationReferences } from './generationReferenceResolver'
import { resolveTaskKind } from './catalogTaskResolve'
import { GENERATION_NODE_KINDS, getGenerationNodeExecutionKind } from '../model/generationNodeKinds'
import { MODEL_ARCHETYPES } from '../../../config/modelArchetypes'
import { encodeMention } from '../../assets/promptMentions'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import type { TaskRequestDto, TaskResultDto } from '../../api/taskApi'
import type { ModelCatalogModelDto, ModelCatalogVendorDto } from '../../api/modelCatalogApi'
import * as localTaskControl from './localTaskControl'

afterEach(() => {
  vi.unstubAllGlobals()
})

function textNode(): GenerationCanvasNode {
  return { id: 'n1', kind: 'text', title: '', position: { x: 0, y: 0 }, meta: { modelKey: 'gpt-x' } }
}

function imageNode(): GenerationCanvasNode {
  return { id: 'n2', kind: 'image', title: '', position: { x: 0, y: 0 }, meta: { modelKey: 'sd' } }
}

function generatedVideoNode(): GenerationCanvasNode {
  return { id: 'v1', kind: 'video', title: '', position: { x: 0, y: 0 }, meta: { modelKey: 'comfyui-local-video' } }
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

  it('全能参考模式：连入的视频引用在最终请求提示词中投影为 @video1', () => {
    const videoUrl = 'nomi-local://asset/project/drone-reference.mp4'
    const node = seedanceVideoNode('omni', {})
    node.prompt = `镜头运动参考 ${encodeMention(videoUrl)}`

    const request = buildCatalogTaskRequest(node, {
      references: { referenceVideos: [videoUrl] },
    }).request

    expect(request.prompt).toBe('镜头运动参考 @video1')
    expect((request.extras?.archetypeInput as Record<string, unknown>).reference_video_urls).toEqual([videoUrl])
  })
})

describe('buildCatalogTaskRequest — 档案 mapping 桶由 transportTaskKind 显式决定（修 omni 误路由）', () => {
  function videoNode(modelKey: string, modeId: string, extra: Record<string, unknown> = {}): GenerationCanvasNode {
    return {
      id: 'r1', kind: 'video', title: '', position: { x: 0, y: 0 }, prompt: 'x',
      // 变体（fast/mini）不改 archetype id —— 仍是 'seedance-2'（变体是正交轴 meta.variantId，非独立档案）。
      meta: { modelKey, modelVendor: 'kie', vendor: 'kie', archetype: { id: modelKey.includes('happyhorse') ? 'happyhorse' : 'seedance-2', modeId }, ...extra },
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

describe('buildCatalogTaskRequest — 保持提示词原文，执行层负责组装对白', () => {
  const wanNode = (extraMeta: Record<string, unknown> = {}): GenerationCanvasNode => ({
    id: 'dialogue-shot',
    kind: 'video',
    title: '对白镜头',
    position: { x: 0, y: 0 },
    prompt: '镜头缓慢推近',
    meta: {
      modelKey: 'wan/3-0-video',
      modelVendor: 'kie',
      vendor: 'kie',
      archetype: { id: 'wan-3.0', modeId: 't2v' },
      dialogue: '你终于来了。',
      ...extraMeta,
    },
  })

  it('直接构建请求不改写持久化 prompt', () => {
    expect(buildCatalogTaskRequest(wanNode()).request.prompt).toBe('镜头缓慢推近')
  })

  it('当前 mode 显式关闭 audio 时不注入对白', () => {
    expect(buildCatalogTaskRequest(wanNode({ audio: false })).request.prompt).toBe('镜头缓慢推近')
  })
})

describe('buildCatalogTaskRequest — ComfyUI 本地 workflow 不吃旧档案 archetype', () => {
  it('只绑定首帧的 Comfy i2v 即便残留 Dreamina archetype，也走 flat firstFrameUrl', () => {
    const node: GenerationCanvasNode = {
      id: 'comfy-i2v',
      kind: 'video',
      title: '',
      position: { x: 0, y: 0 },
      prompt: '一杯咖啡',
      meta: {
        modelKey: 'comfy-wan2-2-5b-t2v-mrvi3py1',
        modelVendor: 'comfyui-local',
        vendor: 'comfyui-local',
        archetype: { id: 'dreamina-seedance-2', modeId: 'multimodal', variantId: 'fast' },
        comfy_width: 1280,
        comfy_height: 704,
        comfy_length: 121,
        comfy_fps: 24,
        comfy_batch_size: 1,
      },
    }
    const built = buildCatalogTaskRequest(node, {
      references: { firstFrameUrl: 'nomi-local://asset/first.png' },
    })

    expect(built.vendor).toBe('comfyui-local')
    expect(built.request.kind).toBe('image_to_video')
    expect(built.request.extras?.firstFrameUrl).toBe('nomi-local://asset/first.png')
    expect(built.request.extras?.lastFrameUrl).toBeUndefined()
    expect(built.request.extras?.archetypeInput).toBeUndefined()
  })
})

// 根因回归（2026-07-24 群反馈）：档案分支曾让 archetypeInput **独占**参考通道——标准 camelCase 面
// （firstFrameUrl/lastFrameUrl）被丢，参考只剩 kie 键 `input_urls`；而通用中转模板读的是标准键
// （multipart `{{request.params.reference_images}}` / chat `chat_image_parts` / i2v `image_url`），
// → 中转上撞档案名的模型改图不带图被拒（「未开启生图功能」类）、i2v 首帧到不了 wire；接入测试
// （t2i 不吃参考键）却能过。收口后不变量：**标准参考面永远在场，档案投影叠加其上**（两面并存，
// 内置家 body 只引用自家声明键、多出的标准键不进 body → 零影响）。
describe('buildCatalogTaskRequest — 标准参考面与档案投影并存（中转不丢参考）', () => {
  const relayNode = (vendor: string): GenerationCanvasNode => ({
    id: 'relay-i2i',
    kind: 'image',
    title: '',
    position: { x: 0, y: 0 },
    prompt: '把它改成蓝色',
    meta: {
      modelKey: 'gpt-image-2',
      modelVendor: vendor,
      vendor,
      archetype: { id: 'gpt-image-2', modeId: 'i2i' },
    },
  })

  it('中转 vendor：archetypeInput 照常（档案是通用能力面），且标准 referenceImages 同时在场', () => {
    const built = buildCatalogTaskRequest(relayNode('my-relay'), {
      references: { referenceImages: ['nomi-local://asset/ref.png'] },
    })
    expect(built.request.kind).toBe('image_edit')
    const archetypeInput = built.request.extras?.archetypeInput as Record<string, unknown>
    expect(archetypeInput.input_urls).toEqual(['nomi-local://asset/ref.png'])
    // 关键不变量：标准面不被档案吞——中转 multipart/chat 模板由它派生 reference_images/chat_image_parts。
    expect(built.request.extras?.referenceImages).toEqual(['nomi-local://asset/ref.png'])
  })

  it('kie 行为零变化：档案投影仍在（input_urls + kie 模式枚举），标准面并存不进 kie body', () => {
    const built = buildCatalogTaskRequest(relayNode('kie'), {
      references: { referenceImages: ['nomi-local://asset/ref.png'] },
    })
    expect(built.request.kind).toBe('image_edit')
    const archetypeInput = built.request.extras?.archetypeInput as Record<string, unknown>
    expect(archetypeInput.input_urls).toEqual(['nomi-local://asset/ref.png'])
    expect(archetypeInput.model).toBe('gpt-image-2-image-to-image')
    expect(built.request.extras?.referenceImages).toEqual(['nomi-local://asset/ref.png'])
  })

  it('档案图槽上传（meta.referenceImageUrls）同样进标准面；t2i 模式的残留不复活', () => {
    const uploaded: GenerationCanvasNode = {
      id: 'relay-upload', kind: 'image', title: '', position: { x: 0, y: 0 }, prompt: '改成蓝色调',
      meta: {
        modelKey: 'gpt-image-2', modelVendor: 'y7-mock', vendor: 'y7-mock',
        archetype: { id: 'gpt-image-2', modeId: 'i2i' },
        referenceImageUrls: ['nomi-local://asset/up.png'],
      },
    }
    const built = buildCatalogTaskRequest(uploaded, { references: {} })
    expect(built.request.kind).toBe('image_edit')
    // 走查 B 段抓出的第二个吞点：上传住档案槽键，从没进过标准面 → multipart 0 张图被抛。
    expect(built.request.extras?.referenceImages).toEqual(['nomi-local://asset/up.png'])
    // t2i 模式（无 image_ref 槽）→ 残留不复活进标准面（否则 chat 回退的 t2i body 会带旧图）。
    const t2i: GenerationCanvasNode = {
      ...uploaded,
      meta: { ...uploaded.meta, archetype: { id: 'gpt-image-2', modeId: 't2i' } },
    }
    expect(buildCatalogTaskRequest(t2i, { references: {} }).request.extras?.referenceImages).toBeUndefined()
  })

  it('档案视频节点的 i2v 首帧：标准 firstFrameUrl 不再被档案分支丢掉（中转 image_url 由它派生）', () => {
    const node: GenerationCanvasNode = {
      id: 'relay-i2v',
      kind: 'video',
      title: '',
      position: { x: 0, y: 0 },
      prompt: '镜头缓慢推近',
      // 首帧模式（真实链路：连 first_frame 边时 useNodeModelAutoSelect 自动切到该模式）。
      meta: { modelKey: 'bytedance/seedance-2', modelVendor: 'my-relay', vendor: 'my-relay', archetype: { id: 'seedance-2', modeId: 'first' } },
    }
    const built = buildCatalogTaskRequest(node, {
      references: { firstFrameUrl: 'nomi-local://asset/first.png' },
    })
    expect(built.request.extras?.archetypeInput).toBeTruthy()
    expect(built.request.extras?.firstFrameUrl).toBe('nomi-local://asset/first.png')
    // M2 互斥在标准面同样生效：当前模式无尾帧槽 → 标准 lastFrameUrl 不带。
    expect(built.request.extras?.lastFrameUrl).toBeUndefined()
  })
})

// 已持久化 vendor 的节点只能沿候选 revision lineage 迁移；独立供应商即便同名/同 archetype 也不能
// 被静默选中，否则一次 credential repair 会把旧节点送到完全无关的端点并产生付费请求。
describe('runCatalogGenerationTask — 旧节点只沿 catalog lineage 迁移', () => {
  const vendorDto = (key: string, hasApiKey: boolean, meta?: unknown): ModelCatalogVendorDto => ({ key, name: key, enabled: true, hasApiKey, ...(meta ? { meta } : {}), createdAt: '', updatedAt: '' })
  const apimartSeedream: ModelCatalogModelDto = { modelKey: 'doubao-seedream-4.5', vendorKey: 'apimart', labelZh: 'Seedream 4.5', kind: 'image', enabled: true, published: true, publishedModes: ['text_to_image'], meta: { archetypeId: 'seedream' }, createdAt: '', updatedAt: '' }

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

  it('无 lineage 的 legacy vendor 不再按 archetype 静默请求 apimart', async () => {
    const { calls, options } = harness()
    await expect(runCatalogGenerationTask(staleKieNode, options)).rejects.toThrow(/没有已连接的供应商提供/)
    expect(calls).toHaveLength(0)
  })

  it('无关同名模型排前时，真实 resolve→run 调用链只请求同 lineage active successor', async () => {
    const calls: Array<{ vendor: string; request: TaskRequestDto }> = []
    const candidate = {
      ...apimartSeedream,
      modelKey: 'seedream',
      vendorKey: 'kie--candidate-revision-2',
    }
    const candidateMeta = {
      adapterCandidateRootVendorKey: 'kie',
      adapterCandidateSourceVendorKey: 'kie',
      adapterCandidatePromotionPredecessors: {
        seedream: { vendorKey: 'kie', publishedModes: ['text_to_image'] },
      },
    }

    await runCatalogGenerationTask(staleKieNode, {
      listCatalogVendors: async () => [
        vendorDto('kie', true),
        vendorDto('unrelated', true),
        vendorDto('kie--candidate-revision-2', true, candidateMeta),
      ],
      // enabled:true 的真实 DTO 不含已停用 source model；source vendor 仍因另一个兄弟模型可执行。
      listCatalogModels: async () => [
        { ...candidate, vendorKey: 'unrelated' },
        candidate,
      ],
      runTask: async (vendor: string, request: TaskRequestDto) => {
        calls.push({ vendor, request })
        return { id: 't-candidate', kind: request.kind, status: 'succeeded', assets: [{ type: 'image', url: 'https://x/candidate.png' }], raw: {} }
      },
    })

    expect(calls).toHaveLength(1)
    expect(calls[0].vendor).toBe('kie--candidate-revision-2')
    expect(calls[0].request.extras?.modelKey).toBe('seedream')
  })

  it('同 lineage successor disabled 时不向无关同名供应商提交请求', async () => {
    const runTask = vi.fn()
    await expect(runCatalogGenerationTask(staleKieNode, {
      listCatalogVendors: async () => [
        vendorDto('kie', true),
        vendorDto('unrelated', true),
        vendorDto('kie--candidate-disabled', false, {
          adapterCandidateRootVendorKey: 'kie',
          adapterCandidateSourceVendorKey: 'kie',
        }),
      ],
      listCatalogModels: async () => [{ ...apimartSeedream, modelKey: 'seedream', vendorKey: 'unrelated' }],
      runTask,
    })).rejects.toThrow(/没有已连接的供应商提供/)
    expect(runTask).not.toHaveBeenCalled()
  })

  it('没有任何已连接供应商提供该款 → 抛清晰可行动错误，而非 cryptic key missing', async () => {
    const { options } = harness()
    await expect(
      runCatalogGenerationTask(staleKieNode, { ...options, listCatalogVendors: async () => [vendorDto('kie', false)], listCatalogModels: async () => [] }),
    ).rejects.toThrow(/没有已连接的供应商提供/)
  })
})

describe('runCatalogGenerationTask — ComfyUI 提交时序与 prompt UUID', () => {
  const comfyNode: GenerationCanvasNode = {
    id: 'comfy-node',
    kind: 'image',
    title: '',
    position: { x: 0, y: 0 },
    prompt: '画一个红色立方体',
    meta: { modelKey: 'my-comfy-workflow', modelVendor: 'comfyui-local', vendor: 'comfyui-local' },
  }

  function stubComfyBridge(events: string[], watched: Array<Record<string, unknown>>) {
    vi.stubGlobal('window', {
      nomiDesktop: {
        tasks: {
          comfyuiWatch: async (payload: Record<string, unknown>) => {
            events.push('watch:start')
            watched.push(payload)
            await Promise.resolve()
            events.push('watch:ready')
            return { ok: true }
          },
          comfyuiUnwatch: async (promptId: string) => {
            events.push(`unwatch:${promptId}`)
          },
        },
      },
    })
  }

  it('先等 watcher 就绪再提交，且客户端 UUID 原样穿透给 runTask', async () => {
    const events: string[] = []
    const watched: Array<Record<string, unknown>> = []
    stubComfyBridge(events, watched)

    const result = await runCatalogGenerationTask(comfyNode, {
      runTask: async (_vendor, request) => {
        events.push('run')
        const promptId = String(request.extras?.comfyPromptId || '')
        expect(promptId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
        expect(promptId).toBe(watched[0]?.promptId)
        return {
          id: promptId,
          kind: request.kind,
          status: 'succeeded',
          assets: [{ type: 'image', url: 'nomi-local://comfy-output.png' }],
          raw: {},
        }
      },
    })

    const promptId = String(watched[0]?.promptId)
    expect(events).toEqual(['watch:start', 'watch:ready', 'run', `unwatch:${promptId}`])
    expect(result.url).toBe('nomi-local://comfy-output.png')
  })

  it('提交失败时立即注销预登记 watcher', async () => {
    const events: string[] = []
    const watched: Array<Record<string, unknown>> = []
    stubComfyBridge(events, watched)

    await expect(runCatalogGenerationTask(comfyNode, {
      runTask: async () => {
        events.push('run')
        throw new Error('submit failed')
      },
    })).rejects.toThrow('submit failed')

    const promptId = String(watched[0]?.promptId)
    expect(events).toEqual(['watch:start', 'watch:ready', 'run', `unwatch:${promptId}`])
  })
})

describe('runCatalogGenerationTask — 轮询硬超时抛 RecoverableTimeoutError（可找回，非普通失败）', () => {
  const videoNode: GenerationCanvasNode = {
    id: 'v1', kind: 'video', title: '', position: { x: 0, y: 0 }, prompt: '一只猫跑过草地',
    meta: { modelKey: 'vid', vendor: 'asyncv' },
  }

  it('超时抛 RecoverableTimeoutError，detail 带 taskId/vendor/taskKind，且软超时后回报 still-generating', async () => {
    const { isRecoverableTimeoutError } = await import('./recoverableTimeout')
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
    if (!isRecoverableTimeoutError(error)) throw error
    expect(error.detail).toMatchObject({
      taskId: 'up-task-9', vendor: 'asyncv', taskKind: 'text_to_video', modelKey: 'vid',
    })
  })
})

describe('runCatalogGenerationTask — confirmed local cancellation wins over polling', () => {
  const node: GenerationCanvasNode = {
    id: 'local-image-node', kind: 'image', title: '', position: { x: 0, y: 0 }, prompt: 'a crane',
    meta: { modelKey: 'generate_image', vendor: 'antigravity-cli' },
  }
  it.each(['before-query', 'during-query'])('does not publish a late success when cancelled %s', async (moment) => {
    let cancelled = false
    const cancelFlag = vi.spyOn(localTaskControl, 'isTaskCancelRequested').mockImplementation((id) => id === node.id && cancelled)
    const runTask = vi.fn(async (_vendor: string, request: TaskRequestDto): Promise<TaskResultDto> => {
      if (moment === 'before-query') cancelled = true
      return { id: 'local-job', kind: request.kind, status: 'queued', assets: [], raw: {} }
    })
    const fetchTaskResult = vi.fn(async () => {
      await Promise.resolve()
      cancelled = true // Models a cancellation acknowledgement arriving while the query was in flight.
      return { vendor: 'antigravity-cli', result: {
        id: 'local-job', kind: 'text_to_image' as const, status: 'succeeded' as const,
        assets: [{ type: 'image' as const, url: 'nomi-local://late-output.jpg' }], raw: {},
      } }
    })
    try {
      await expect(runCatalogGenerationTask(node, { runTask, fetchTaskResult, pollIntervalMs: 1 })).rejects.toMatchObject({ name: 'LocalTaskCancelledError' })
      expect(runTask).toHaveBeenCalledOnce()
      expect(fetchTaskResult).toHaveBeenCalledTimes(moment === 'before-query' ? 0 : 1)
    } finally { cancelFlag.mockRestore() }
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

  // 2026-07-31：厂商文档（Seedance 2.0 交付文档 §5.1）要求「查询间隔分散到 3-5 秒以上」+
  // 「429 时指数退避并加入随机抖动」。以前是固定 1500ms、零抖动、429 被空 catch 吞掉照原节奏再敲。
  it('轮询撞 429 → 等待指数退避；不是限流的失败不退避', async () => {
    const waits: number[] = []
    const realSetTimeout = globalThis.setTimeout
    const spy = vi
      .spyOn(globalThis, 'setTimeout')
      .mockImplementation(((fn: () => void, ms?: number) => {
        waits.push(Number(ms))
        return realSetTimeout(fn, 0) // 记录时长但立即触发，测试不真等
      }) as unknown as typeof globalThis.setTimeout)
    try {
      let fetchCount = 0
      const result = await runCatalogGenerationTask(videoNode, {
        runTask: async (_v, req) => ({ id: 'up-3', kind: req.kind, status: 'queued' as const, assets: [], raw: {} }),
        fetchTaskResult: async () => {
          fetchCount += 1
          if (fetchCount <= 2) throw new Error('Provider request failed (HTTP 429) at asyncv: too many requests')
          if (fetchCount === 3) throw new TypeError('Failed to fetch') // 普通抖动 → 退避必须复位
          return { vendor: 'asyncv', result: { id: 'up-3', kind: 'text_to_video' as const, status: 'succeeded' as const, assets: [{ type: 'video' as const, url: 'https://x/o.mp4' }], raw: {} } }
        },
        pollIntervalMs: 100,
        pollRandom: () => 0.5, // 抖动系数恒为 1，只看退避倍数
        pollTimeoutMs: 5000,
      })
      // 100 → 撞 429 → 200 → 再撞 429 → 400 → 普通抖动(复位) → 100
      expect(waits.slice(0, 4)).toEqual([100, 200, 400, 100])
      expect(result.url).toBe('https://x/o.mp4')
    } finally {
      spy.mockRestore()
    }
  })
})

// 轮询节奏三件套（2026-07-31 按厂商文档 §5.1 补）：间隔按后端分档、±30% 抖动、429 指数退避。
describe('轮询节奏 — 间隔分档 / 抖动 / 限流退避', () => {
  it('间隔分档复用慢道判据：视频与本地后端 3s，云图像 1.5s', () => {
    expect(resolvePollIntervalMs('text_to_video', 'volcengine')).toBe(3000)
    expect(resolvePollIntervalMs('image_to_video', 'kie')).toBe(3000)
    expect(resolvePollIntervalMs('text_to_image', 'comfyui-local')).toBe(3000) // 本地后端也是慢道
    expect(resolvePollIntervalMs('text_to_image', 'kie')).toBe(1500) // 秒级云图像不放慢
  })

  it('无限流时只叠 ±30% 抖动，落在 [0.7x, 1.3x] 且不恒等于基准（否则又是同相位齐发）', () => {
    expect(nextPollDelayMs(3000, 0, () => 0)).toBe(2100) // 下界 0.7x
    expect(nextPollDelayMs(3000, 0, () => 1)).toBe(3900) // 上界 1.3x
    expect(nextPollDelayMs(3000, 0, () => 0.5)).toBe(3000) // 中点=基准
  })

  it('429 连击 → 指数退避 2^n，并封顶 30s（久限流不该把间隔滚到分钟级）', () => {
    const noJitter = () => 0.5
    expect(nextPollDelayMs(3000, 1, noJitter)).toBe(6000)
    expect(nextPollDelayMs(3000, 2, noJitter)).toBe(12000)
    expect(nextPollDelayMs(3000, 3, noJitter)).toBe(24000)
    expect(nextPollDelayMs(3000, 4, noJitter)).toBe(30000) // 48000 被封顶
    expect(nextPollDelayMs(3000, 9, () => 1)).toBe(30000) // 抖动也不许突破封顶
  })

  it('限流判定优先信 structured（IPC 穿透的事实），文案兜底，普通失败不误判', () => {
    const structured = (payload: Record<string, unknown>) =>
      'NOMI_VENDOR_ERR_B64::' + Buffer.from(JSON.stringify(payload), 'utf8').toString('base64') + ':: boom'
    expect(isRateLimitedPollError(new Error(structured({ category: 'quota', httpStatus: 429 })))).toBe(true)
    expect(isRateLimitedPollError(new Error(structured({ category: 'server', httpStatus: 502 })))).toBe(false)
    expect(isRateLimitedPollError(new Error('Provider request failed (HTTP 429)'))).toBe(true)
    expect(isRateLimitedPollError(new Error('rate limit exceeded'))).toBe(true)
    expect(isRateLimitedPollError(new TypeError('Failed to fetch'))).toBe(false)
    // 任务 id / 时间戳里恰好含 429 不该被当成限流
    expect(isRateLimitedPollError(new Error('task cgt-20260429-abc failed'))).toBe(false)
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

  it('anonymous upload consent 穿透到 request.extras', () => {
    const built = buildCatalogTaskRequest({ ...imageNode(), prompt: 'a cat', meta: { modelKey: 'sd', modelVendor: 'openai' } }, { anonymousAssetHostingConsent: 'allow' })
    expect((built.request.extras as Record<string, unknown>).anonymousAssetHostingConsent).toBe('allow')
  })

  it('把当前请求实际引用的本地素材作为上传 allowlist 传给主进程', () => {
    const built = buildCatalogTaskRequest(
      {
        ...imageNode(),
        prompt: 'a cat',
        meta: { modelKey: 'sd', modelVendor: 'openai', referenceImageUrls: ['nomi-local://asset/active.png'] },
      },
      { references: { referenceImages: ['nomi-local://asset/active.png'] } },
    )
    expect((built.request.extras as Record<string, unknown>).activeAssetUrls).toEqual(['nomi-local://asset/active.png'])
  })
  it('未给 idempotencyKey → extras 不带该键（无键时 runTask 不介入，向后兼容）', () => {
    const node: GenerationCanvasNode = { id: 'n1', kind: 'image', title: '', position: { x: 0, y: 0 }, prompt: '画只猫', meta: { modelKey: 'gpt-image-2-image-to-image', modelVendor: 'kie', vendor: 'kie', archetype: { id: 'gpt-image-2', modeId: 't2i' } } }
    const built = buildCatalogTaskRequest(node, {})
    expect((built.request.extras as Record<string, unknown>).idempotencyKey).toBeUndefined()
  })
  it('production QA 的 promptSuffix 只追加到本次请求，不改写节点原始 prompt', () => {
    const node: GenerationCanvasNode = { id: 'n1', kind: 'image', title: '', position: { x: 0, y: 0 }, prompt: '保持雨夜窗边构图', meta: { modelKey: 'gpt-image-2-image-to-image', modelVendor: 'kie', vendor: 'kie', archetype: { id: 'gpt-image-2', modeId: 't2i' } } }
    const built = buildCatalogTaskRequest(node, { promptSuffix: '只修正：主体身份，不改变背景。' })
    expect(built.request.prompt).toContain('保持雨夜窗边构图')
    expect(built.request.prompt).toContain('只修正：主体身份，不改变背景。')
    expect(node.prompt).toBe('保持雨夜窗边构图')
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

describe('normalizeCatalogTaskResult — generated video duration', () => {
  it('uses localized asset duration before the canvas metadata fallback', () => {
    const node = generatedVideoNode()
    const result = normalizeCatalogTaskResult(
      {
        id: 't-video',
        kind: 'text_to_video',
        status: 'succeeded',
        assets: [{ type: 'video', url: 'nomi-local://asset/p/video.mp4', durationSeconds: 3.0625 }],
        raw: {},
      },
      { ...node, meta: { ...node.meta, videoDuration: 5 } },
    )

    expect(result.durationSeconds).toBe(3.0625)
  })

  it('does not freeze a previous video metadata duration into a newly generated result', () => {
    const node = generatedVideoNode()
    const result = normalizeCatalogTaskResult(
      {
        id: 't-video',
        kind: 'text_to_video',
        status: 'succeeded',
        assets: [{ type: 'video', url: 'nomi-local://asset/p/new-video.mp4' }],
        raw: {},
      },
      { ...node, meta: { ...node.meta, videoDuration: 8 } },
    )

    expect(result.durationSeconds).toBeUndefined()
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
    expect(ai.model).toBe('seedream/4.5-edit')
    expect(ai.image_urls).toEqual(['https://x/1.png', 'https://x/2.png'])
    expect(ai).not.toHaveProperty('input_urls')
    expect(ai).not.toHaveProperty('reference_image_urls')
  })
})

describe('供应商真实 modelKey + 节点 meta.archetype.id：连线参考必须进入图生图字段', () => {
  const SOURCE_URL = 'https://x/direct-source.png'
  const source: GenerationCanvasNode = {
    id: 'source', kind: 'image', title: '源图', position: { x: 0, y: 0 }, prompt: '',
    result: { id: 'source-result', type: 'image', url: SOURCE_URL, createdAt: 0 },
  }

  it.each([
    ['apimart', 'doubao-seedream-4.5', 'seedream', 'edit', 'image_urls'],
    ['apimart', 'gemini-2.5-flash-image-preview', 'nano-banana', 'edit', 'image_urls'],
    ['modelscope', 'Qwen/Qwen-Image-Edit-2511', 'modelscope-image-edit', 'edit', 'image_url'],
    ['volcengine', 'doubao-seedream-5-0-260128', 'volcengine-seedream', 'edit', 'image_urls'],
    ['volcengine', 'doubao-seedream-4-5-251128', 'volcengine-seedream', 'edit', 'image_urls'],
    ['volcengine', 'doubao-seedream-4-0-250828', 'volcengine-seedream', 'edit', 'image_urls'],
  ])('%s / %s（%s.%s）：直接参考边进入 %s', (vendor, modelKey, archetypeId, modeId, inputKey) => {
    const target: GenerationCanvasNode = {
      id: 'target', kind: 'image', title: '目标图', position: { x: 100, y: 0 }, prompt: '改成蓝色',
      meta: {
        modelKey, modelAlias: modelKey, modelVendor: vendor, vendor,
        archetype: { id: archetypeId, modeId },
      },
    }
    const references = resolveGenerationReferences(target, {
      nodes: [source, target],
      edges: [{ id: 'source-target', source: source.id, target: target.id, mode: 'reference', order: 0 }],
    })
    const request = buildCatalogTaskRequest(target, { references }).request
    expect(request.kind).toBe('image_edit')
    expect((request.extras?.archetypeInput as Record<string, unknown>)[inputKey]).toEqual([SOURCE_URL])
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

describe('normalizeCatalogTaskResult — 终态失败抛出的是上游真原因（2026-07-30 用户真机回归）', () => {
  function failed(extra: Partial<TaskResultDto>): TaskResultDto {
    return {
      id: 'task_01KYRKKK35KCAASMFC7ND2PR6P',
      kind: 'text_to_image',
      status: 'failed',
      assets: [],
      raw: {},
      ...extra,
    }
  }

  it('用主进程给的一等字段 error，而不是「模型任务执行失败」', () => {
    expect(() => normalizeCatalogTaskResult(failed({ error: 'Requested entity was not found.' }), imageNode())).toThrow(
      /Requested entity was not found\./,
    )
  })

  it('taskId / kind 仍带在后缀里（支持排查用）', () => {
    expect(() => normalizeCatalogTaskResult(failed({ error: 'boom' }), imageNode())).toThrow(
      /taskId=task_01KYRKKK35KCAASMFC7ND2PR6P, kind=text_to_image/,
    )
  })

  it('主进程也扒不出原因时才落兜底文案（不编造）', () => {
    expect(() =>
      normalizeCatalogTaskResult(failed({ raw: { data: { status: 'failed' } } }), imageNode()),
    ).toThrow(/模型任务执行失败/)
  })
})

// 群反馈 2026-07-30：Codex 生图「接入正常、到拉取步骤超时」——根因是本地生图(codex `codex exec $imagegen`,
// 官方 smoke 就 ~75s)被按快道云 API 的 2min 硬超时腰斩。修法：按「后端时延」分档,本地进程后端进慢道。
describe('resolvePollBudget / isSlowLaneBackend — 轮询超时按后端时延分档（本地生图不被云 API 的 2min 腰斩）', () => {
  it('本地进程后端(codex-local/comfyui-local)的图像任务走慢道（5min 软 / 20min 硬），不是 2min', () => {
    for (const vendor of ['codex-local', 'comfyui-local']) {
      for (const kind of ['text_to_image', 'image_edit'] as const) {
        expect(isSlowLaneBackend(kind, vendor)).toBe(true)
        expect(resolvePollBudget(kind, vendor)).toEqual({ softMs: 300000, hardMs: 1200000 })
      }
    }
  })

  it('视频任务仍走慢道（与后端无关）', () => {
    expect(isSlowLaneBackend('text_to_video', 'apimart')).toBe(true)
    expect(resolvePollBudget('image_to_video', 'kie')).toEqual({ softMs: 300000, hardMs: 1200000 })
  })

  it('快道云图像 API（apimart/kie 等）保持 2min 软=硬，不被放宽', () => {
    expect(isSlowLaneBackend('text_to_image', 'apimart')).toBe(false)
    expect(resolvePollBudget('text_to_image', 'apimart')).toEqual({ softMs: 120000, hardMs: 120000 })
    expect(resolvePollBudget('image_edit', 'kie')).toEqual({ softMs: 120000, hardMs: 120000 })
  })
})

// 穷举矩阵（2026-09-02，#320 缺口②第二边界）：resolveTaskKind 的兜底是 throw「not implemented yet」。
// 此前 model3d 被两头漏掉——档案桶分支只认 video/image/audio（RunningHub 混元/Meshy 带档案也砸到 throw）、
// 底部又没有 model3d 兜底。矩阵钉住：每个 registry 声明的 executionKind 都必须解析出 taskKind，不许 throw；
// 3D 档案的模式 transportTaskKind（text_to_3d / image_to_3d）必须被尊重。新 kind 漏接当场红。
describe('resolveTaskKind — kind × 能力面穷举（防「档案桶/兜底漏 kind → throw」复发）', () => {
  const bareNode = (kind: GenerationCanvasNode['kind']): GenerationCanvasNode =>
    ({ id: 'tk1', kind, title: '', position: { x: 0, y: 0 }, prompt: '一只猫',
       meta: { modelKey: 'some-custom-model', modelVendor: 'my-relay', vendor: 'my-relay' } } as GenerationCanvasNode)

  const EXPECTED_BARE: Record<string, string> = {
    text: 'chat', image: 'text_to_image', video: 'text_to_video', audio: 'text_to_audio', model3d: 'text_to_3d',
  }
  for (const kind of GENERATION_NODE_KINDS) {
    const exec = getGenerationNodeExecutionKind(kind)
    if (!exec) continue // 无 executionKind 的 kind 到不了 resolveTaskKind（派发闸已挡），不在此矩阵
    it(`${kind}（executionKind=${exec}）：无档案裸节点解析为 ${EXPECTED_BARE[exec]}，不 throw`, () => {
      expect(resolveTaskKind(bareNode(kind), {})).toBe(EXPECTED_BARE[exec])
    })
  }

  it('model3d 无档案 + 有图参考 → image_to_3d（与 image/video 同一启发式口径）', () => {
    expect(resolveTaskKind(bareNode('model3d'), { referenceImages: ['nomi-local://asset/p/ref.png'] })).toBe('image_to_3d')
    expect(resolveTaskKind(bareNode('model3d'), { firstFrameUrl: 'nomi-local://asset/p/ref.png' })).toBe('image_to_3d')
  })

  it('3D 档案（meshy6）模式 transportTaskKind 被尊重：text→text_to_3d / image→image_to_3d', () => {
    const withMode = (modeId: string): GenerationCanvasNode =>
      ({ id: 'tk2', kind: 'model3d', title: '', position: { x: 0, y: 0 }, prompt: '一只猫',
         meta: { modelKey: 'meshy6', archetype: { id: 'meshy6', modeId } } } as GenerationCanvasNode)
    expect(resolveTaskKind(withMode('text'), {})).toBe('text_to_3d')
    expect(resolveTaskKind(withMode('image'), {})).toBe('image_to_3d')
  })

  it('全部 model3d 档案 × 模式：解析结果 = 模式声明的 transportTaskKind（registry 驱动，新 3D 档案自动进矩阵）', () => {
    for (const archetype of MODEL_ARCHETYPES.filter((a) => a.kind === 'model3d')) {
      for (const mode of archetype.modes || []) {
        const node = { id: 'tk3', kind: 'model3d', title: '', position: { x: 0, y: 0 }, prompt: 'x',
          meta: { modelKey: archetype.identifierPatterns?.[0] || archetype.id, archetype: { id: archetype.id, modeId: mode.id } } } as GenerationCanvasNode
        expect(resolveTaskKind(node, {})).toBe(mode.transportTaskKind ?? archetype.transportTaskKind)
      }
    }
  })
})
