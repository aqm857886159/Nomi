// 终态结果落地（生成与找回共用，设计卡 docs/plan/2026-11-26-layer-split.md ★9 第 3 条）。
// 反例：把图层那一支删掉 → 「一笔图层落成一个结果」红（会落成 3 张普通图）；把「各层都已落进项目」那道闸删掉 →
// 「临时地址不进白板」红；把尺寸回报改回逐张 → 「只回报底图尺寸」红。
import { describe, expect, it, vi } from 'vitest'
import type { TaskResultDto } from '../../api/taskApi'
import { createGenerationNode } from '../model/graphOps'
import { matchNomiErrorCode } from '../../../../electron/shared/nomiErrorCodes'
import { readWhiteboardEditingState } from '../nodes/whiteboard/whiteboardState'
import { landTaskResults, type LandTaskResultsDeps } from './landTaskResults'

const project = { projectId: 'project-a', immutableProjectUuid: 'uuid-a', projectGeneration: 1 }
const node = createGenerationNode({ id: 'split-node', kind: 'image', prompt: '' })

function layered(urls: string[], layers: TaskResultDto['layers']): TaskResultDto {
  return {
    id: 'task-1', kind: 'image_edit', status: 'succeeded', raw: { vendor: 'raw' },
    assets: urls.map((url, index) => ({ type: 'image', url, width: index === 0 ? 2560 : 600, height: index === 0 ? 1440 : 300 })),
    layers,
  } as TaskResultDto
}

const LAYERS: TaskResultDto['layers'] = [
  { zIndex: 0, name: '背景' },
  { zIndex: 1, name: '标题', text: '夏日', box: { left: 0, top: 0, right: 1280, bottom: 360 } },
  { zIndex: 2, box: { left: 1280, top: 720, right: 2560, bottom: 1440 } },
]

function deps(over: Partial<LandTaskResultsDeps> = {}) {
  const renderBoard = vi.fn(async () => new Blob(['png'], { type: 'image/png' }))
  const persist = vi.fn(async () => ({ url: 'nomi-local://composite.png', previewState: 'source' as const }))
  const readImageSize = vi.fn(async () => ({ width: 2560, height: 1440 }))
  return { renderBoard, persist, readImageSize, ...over }
}

describe('landTaskResults', () => {
  it('普通结果：每张一份，每张回报尺寸（与拆出前相同）', async () => {
    const seen: unknown[] = []
    const results = await landTaskResults(layered(['nomi-local://a.png', 'nomi-local://b.png'], undefined), node, project, (d) => seen.push(d))
    expect(results.map((result) => result.url)).toEqual(['nomi-local://a.png', 'nomi-local://b.png'])
    expect(seen).toHaveLength(2)
  })

  it('一笔图层落成一个结果：地址是合成图，raw 里是可编辑白板；只回报底图尺寸', async () => {
    const seen: unknown[] = []
    const d = deps()
    const results = await landTaskResults(layered(['nomi-local://base.png', 'nomi-local://title.png', 'nomi-local://shape.png'], LAYERS), node, project, (dims) => seen.push(dims), d)
    expect(results).toHaveLength(1)
    const [result] = results
    expect(result).toMatchObject({ type: 'image', url: 'nomi-local://composite.png', previewState: 'source', taskId: 'task-1' })
    expect(result).not.toHaveProperty('thumbnailUrl')
    expect(seen).toEqual([{ width: 2560, height: 1440 }])
    // 合成按底图清晰度（2560 宽 / 1280 画布 = 2）。
    expect(d.renderBoard).toHaveBeenCalledWith(expect.anything(), { pixelRatio: 2 })
    // 存进任务自己的项目。
    expect(vi.mocked(d.persist!).mock.calls[0]![2]).toMatchObject({ binding: project })
    // 打开画板读到的就是这份白板：底图 + 两层，名字照规则。
    const state = readWhiteboardEditingState({ ...node, result })!
    expect(state.layers.map((layer) => layer.name)).toEqual(['背景', '底图', '标题', '图层 2'])
    expect(state.canvasAssets.map((asset) => asset.url)).toEqual(['nomi-local://base.png', 'nomi-local://title.png', 'nomi-local://shape.png'])
  })

  it.each([
    ['某层还是供应商临时地址（没落进项目）', ['nomi-local://base.png', 'https://cdn.example/title.png', 'nomi-local://shape.png'], {}, 'retrieval-download'],
    ['读不出底图像素', ['nomi-local://base.png', 'nomi-local://t.png', 'nomi-local://s.png'], { readImageSize: vi.fn(async () => null) }, 'retrieval-download'],
    ['合成失败', ['nomi-local://base.png', 'nomi-local://t.png', 'nomi-local://s.png'], { renderBoard: vi.fn(async () => { throw new Error('leafer') }) }, 'retrieval-download'],
    ['存盘没成', ['nomi-local://base.png', 'nomi-local://t.png', 'nomi-local://s.png'], { persist: vi.fn(async () => null) }, 'retrieval-download'],
    ['层数与图数对不上', ['nomi-local://base.png', 'nomi-local://t.png'], {}, 'retrieval-parse'],
  ] as const)('%s → 挂取回阶段（可找回），不判失败、不当普通多张落', async (_label, urls, over, code) => {
    let thrown: unknown
    try {
      await landTaskResults(layered([...urls], LAYERS), node, project, undefined, deps(over as Partial<LandTaskResultsDeps>))
    } catch (error) {
      thrown = error
    }
    expect(matchNomiErrorCode((thrown as Error).message)).toBe(code)
  })
})
