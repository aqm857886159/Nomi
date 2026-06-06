import { describe, expect, it } from 'vitest'
import { buildCatalogTaskRequest, normalizeCatalogTaskResult } from './catalogTaskActions'
import { MODEL_ARCHETYPES } from '../../../config/modelArchetypes'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import type { TaskResultDto } from '../../api/taskApi'

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
  const flattenValues = (obj: Record<string, unknown>): string[] =>
    Object.values(obj).flatMap((v) => (Array.isArray(v) ? v : [v])).filter((v): v is string => typeof v === 'string')

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
        const node: GenerationCanvasNode = { id: 'g1', kind: 'video', title: '', position: { x: 0, y: 0 }, prompt: 'p', meta }
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
