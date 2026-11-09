import { beforeAll, describe, expect, it } from 'vitest'

import i18n from '../../../i18n'
import type { TaskKind, TaskResultDto } from '../../api/taskApi'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { normalizeCatalogTaskResults } from './catalogTaskResultParse'

/**
 * 任务报成功但产物是空的（没文本 / 没视频地址 / 没音频 / 没图片地址）——这四条 message
 * 会经 classifyGenerationError 直接显示在节点错误卡上，所以必须是人话，不能是没解析出来的
 * i18n 键路径。这里按 zh-CN + en 双语锁住：既证键存在，也证语言切换后跟着变。
 */
const succeeded = (kind: TaskKind, raw: unknown = {}): TaskResultDto => ({
  id: 'task-1',
  kind,
  status: 'succeeded',
  assets: [],
  raw,
})

const node = { id: 'node-1' } as GenerationCanvasNode

const CASES: Array<{ label: string; kind: TaskKind; zh: string; en: string }> = [
  { label: '文本', kind: 'chat', zh: '模型任务完成但没有返回文本内容', en: 'The model task finished but returned no text content' },
  { label: '视频', kind: 'text_to_video', zh: '模型任务完成但没有返回视频地址', en: 'The model task finished but returned no video URL' },
  { label: '配音', kind: 'text_to_audio', zh: '配音生成完成但没有返回音频', en: 'Voiceover generation finished but returned no audio' },
  { label: '图片', kind: 'text_to_image', zh: '模型任务完成但没有返回图片地址', en: 'The model task finished but returned no image URL' },
]

describe('normalizeCatalogTaskResults 空产物报错', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('zh-CN')
  })

  for (const { label, kind, zh, en } of CASES) {
    it(`${label}：zh-CN / en 都给人话而不是键路径`, async () => {
      await i18n.changeLanguage('zh-CN')
      expect(() => normalizeCatalogTaskResults(succeeded(kind), node)).toThrow(zh)

      await i18n.changeLanguage('en')
      expect(() => normalizeCatalogTaskResults(succeeded(kind), node)).toThrow(en)

      await i18n.changeLanguage('zh-CN')
    })
  }

  it('键缺失会退化成键路径——这就是本测试要拦的形状', () => {
    expect(i18n.t('generationCommon.error.noText')).not.toContain('generationCommon.')
  })

  it('APIMart MiniMax-H3 Context-IR：从异步 data.result.prompt 归一成文本结果', () => {
    const [result] = normalizeCatalogTaskResults(
      succeeded('prompt_refine', {
        code: 200,
        data: { status: 'completed', result: { prompt: 'integrated_multimodal_description: [Shot 1]...' } },
      }),
      { ...node, meta: { modelKey: 'MiniMax-H3-Context-IR' } } as GenerationCanvasNode,
    )
    expect(result.type).toBe('text')
    expect(result.text).toContain('integrated_multimodal_description')
  })
})

describe('normalizeCatalogTaskResults intrinsic dimensions', () => {
  it('forwards source width/height without copying them onto the result', () => {
    const dimensions: Array<{ width: number; height: number }> = []
    const [normalized] = normalizeCatalogTaskResults({
      ...succeeded('text_to_image'),
      assets: [{ type: 'image', url: 'https://cdn.test/image.png', thumbnailUrl: 'https://cdn.test/image.preview.jpg', width: 1600, height: 900 }],
    }, node, (value) => dimensions.push(value))

    expect(dimensions).toEqual([{ width: 1600, height: 900 }])
    expect(normalized).not.toHaveProperty('width')
    expect(normalized).not.toHaveProperty('height')
  })
})

// 画布预览不变式 · 普通生成落画布这一跳：预览两栏只走落盘回执的投影。
describe('normalizeCatalogTaskResults canvas preview fields', () => {
  it('reported case：旧主进程 / 旧缓存把源地址填进 thumbnailUrl（图片 fallback）→ 画布结果不带它，不冒充预览', () => {
    const url = 'nomi-local://asset/p1/assets/generated/image.png'
    const [normalized] = normalizeCatalogTaskResults({ ...succeeded('text_to_image'), assets: [{ type: 'image', url, thumbnailUrl: url }] }, node)
    expect(normalized).not.toHaveProperty('thumbnailUrl')
    expect(normalized).not.toHaveProperty('previewState')
  })

  it('回执带小图 + 事实 → 原样带上；回执说缺失 → 明确 missing', () => {
    const url = 'nomi-local://asset/p1/assets/generated/image.png'
    const [ready] = normalizeCatalogTaskResults({ ...succeeded('text_to_image'), assets: [{ type: 'image', url, thumbnailUrl: 'nomi-local://asset/p1/assets/generated/image.preview.jpg', previewState: 'ready' }] }, node)
    expect(ready).toMatchObject({ thumbnailUrl: 'nomi-local://asset/p1/assets/generated/image.preview.jpg', previewState: 'ready' })
    const [missing] = normalizeCatalogTaskResults({ ...succeeded('text_to_image'), assets: [{ type: 'image', url, thumbnailUrl: null, previewState: 'missing' }] }, node)
    expect(missing).toMatchObject({ previewState: 'missing' })
    expect(missing).not.toHaveProperty('thumbnailUrl')
  })
})
