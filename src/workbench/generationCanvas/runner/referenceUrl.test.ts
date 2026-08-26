import { describe, it, expect } from 'vitest'
import { asUrl, resultUrl, findNodeResultUrl } from './referenceUrl'
import type { GenerationCanvasNode, GenerationNodeResult } from '../model/generationCanvasTypes'

// L2（2026-07-06）：URL 口径翻转为**本地持久文件优先**。providerUrl 是服务商临时直链（kie ~3 天 /
// apimart 72h），过期后「chip 加载失败 + 发死链给服务商」——本地优先让这整类失效；providerUrl 仅在
// 无本地拷贝时兜底（#4「providerUrl-only 被生成侧丢」仍覆盖）。

describe('resultUrl — 本地持久文件优先，providerUrl 兜底', () => {
  it('url + providerUrl 都有 → 取本地 url（nomi-local 永不过期）', () => {
    const result = { url: 'nomi-local://asset/p/a.png', providerUrl: 'https://cdn.kie/a.png' } as GenerationNodeResult
    expect(resultUrl(result)).toBe('nomi-local://asset/p/a.png')
  })
  it('只有 providerUrl（无本地拷贝）→ 兜到 providerUrl（#4 不回归）', () => {
    const result = { providerUrl: 'https://cdn.kie/a.png' } as GenerationNodeResult
    expect(resultUrl(result)).toBe('https://cdn.kie/a.png')
  })
  it('都没有 → thumbnailUrl 最后兜底；全空 → 空串', () => {
    expect(resultUrl({ thumbnailUrl: 'https://cdn/t.png' } as GenerationNodeResult)).toBe('https://cdn/t.png')
    expect(resultUrl({} as GenerationNodeResult)).toBe('')
    expect(resultUrl(undefined)).toBe('')
  })
})

describe('findNodeResultUrl — 节点/历史引用同口径', () => {
  const node = {
    id: 'n1', kind: 'image', title: '', position: { x: 0, y: 0 }, prompt: '',
    result: { id: 'r2', url: 'nomi-local://asset/p/r2.png', providerUrl: 'https://cdn/r2.png' },
    history: [{ id: 'r1', providerUrl: 'https://cdn/r1.png' }],
  } as unknown as GenerationCanvasNode
  const byId = new Map([[node.id, node]])
  it('nodeId → 当前 result 的本地 url', () => {
    expect(findNodeResultUrl(byId, 'n1')).toBe('nomi-local://asset/p/r2.png')
  })
  it('nodeId:resultId → 历史条目（providerUrl-only 兜底仍可用）', () => {
    expect(findNodeResultUrl(byId, 'n1:r1')).toBe('https://cdn/r1.png')
  })
})

// 白名单本身（2026-08-26）：形态判定与出站侧共用 assetValueScheme，别再各列一份。
describe('asUrl — 放行「能发出去或主进程能物化」的形态', () => {
  const inlineImage = `data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]).toString('base64')}`

  it('公网 URL 与 nomi-local 照旧放行（含首尾空白修剪）', () => {
    expect(asUrl('https://cdn/a.png')).toBe('https://cdn/a.png')
    expect(asUrl('  http://cdn/a.png  ')).toBe('http://cdn/a.png')
    expect(asUrl('nomi-local://asset/p/a.png')).toBe('nomi-local://asset/p/a.png')
  })

  it('data: 内联字节放行 —— 修「落盘失败退回 base64 的图连线当参考被静默丢掉」', () => {
    expect(asUrl(inlineImage)).toBe(inlineImage)
    expect(resultUrl({ url: inlineImage } as GenerationNodeResult)).toBe(inlineImage)
  })

  it('blob: 仍放行（要喂参考 chip 的显示；到不了 vendor 由主进程付费前拒发）', () => {
    expect(asUrl('blob:file:///abc-123')).toBe('blob:file:///abc-123')
  })

  it('裸 / 开头不再放行（既发不出去也只有开发态显示得出来，全仓无生产者）', () => {
    expect(asUrl('/prompt-media/expressions/a.webp')).toBe('')
  })

  it('非媒体 data: 与非 URL 判空（节点引用另走 findNodeResultUrl）', () => {
    expect(asUrl('data:text/plain,hello')).toBe('')
    expect(asUrl('n1:r1')).toBe('')
    expect(asUrl('')).toBe('')
    expect(asUrl(42)).toBe('')
  })
})
