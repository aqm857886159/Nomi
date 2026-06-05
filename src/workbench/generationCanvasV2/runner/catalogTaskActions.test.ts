import { describe, expect, it } from 'vitest'
import { buildCatalogTaskRequest, normalizeCatalogTaskResult } from './catalogTaskActions'
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

describe('buildCatalogTaskRequest — C2b 档案模式投影（M2 互斥）', () => {
  it('首帧模式：残留的 lastFrameUrl 不进 extras（不会触发 §2 坑2 的 422）', () => {
    const node = seedanceVideoNode('first', { firstFrameUrl: 'F.png', lastFrameUrl: 'L.png' })
    const { request } = buildCatalogTaskRequest(node)
    expect(request.extras?.firstFrameUrl).toBe('F.png')
    expect(request.extras?.lastFrameUrl).toBeFalsy()
  })

  it('首尾帧模式：first + last 两帧都进 extras', () => {
    const node = seedanceVideoNode('firstlast', { firstFrameUrl: 'F.png', lastFrameUrl: 'L.png' })
    const { request } = buildCatalogTaskRequest(node)
    expect(request.extras?.firstFrameUrl).toBe('F.png')
    expect(request.extras?.lastFrameUrl).toBe('L.png')
  })

  it('全能参考模式：角色图数组进 extras（按序），残留的 firstFrameUrl 不进（互斥含数组）', () => {
    const node = seedanceVideoNode('omni', {
      referenceImageUrls: ['c1.png', 'c2.png'],
      referenceVideoUrls: ['v1.mp4'],
      firstFrameUrl: 'stale.png',
    })
    const { request } = buildCatalogTaskRequest(node)
    expect(request.extras?.referenceImageUrls).toEqual(['c1.png', 'c2.png'])
    expect(request.extras?.referenceVideoUrls).toEqual(['v1.mp4'])
    expect(request.extras?.firstFrameUrl).toBeFalsy()
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
