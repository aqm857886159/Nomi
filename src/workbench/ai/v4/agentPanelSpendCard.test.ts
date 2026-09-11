import { describe, expect, it } from 'vitest'

import { projectSpendCard } from './agentPanelSpendCard'
import { candidatePatchFromNode } from './spendCardDraft'
import type { PendingSpendConfirm } from '../../../desktop/productionRunBridgeTypes'
import type { GenerationCanvasNode } from '../../generationCanvas/model/generationCanvasTypes'

// 卡上每一个数都要能追到产地。这一组钉的是「印错了会怎样」而不是「长什么样」：
// 印 ¥0 会被读成免费、标题印金额会和价格行漂、报不出价还给「全部」会让主按钮无数可印。

const t = (key: string, options?: Record<string, unknown>): string =>
  options ? `${key}(${Object.entries(options).map(([k, v]) => `${k}=${String(v)}`).join(',')})` : key

function shot(index: number, amount: number | null, modelId = 'kling', mode?: string) {
  return {
    shotId: `s${index}`,
    nodeId: `node-${index}`,
    index,
    prompt: `镜头 ${index}`,
    providerId: 'kie',
    modelId,
    mode,
    parameters: { duration: '3' },
    price: amount === null ? { known: false as const } : { known: true as const, amount },
  }
}

function pending(shots: ReturnType<typeof shot>[]): PendingSpendConfirm {
  const known = shots.filter((entry) => entry.price.known)
  return {
    projectId: 'p1', runId: 'op-1', operationId: 'op-1', planVersion: 1, candidateRevision: 2,
    currency: 'CNY', shots,
    knownSubtotal: known.reduce((sum, entry) => sum + (entry.price.known ? entry.price.amount : 0), 0),
    unknownShotCount: shots.length - known.length,
  }
}

describe('付费卡投影', () => {
  it('单镜：没有翻页器、没有范围切换，主按钮印这一镜的价', () => {
    const data = projectSpendCard(pending([shot(1, 0.3)]), { page: 0, scope: 'each' }, t)!
    expect(data.kind).toBe('spend')
    expect(data.pager).toBeUndefined()
    expect(data.confirmLabel).toContain('spendParamsConfirm')
    expect(data.price?.total).toContain('amount=0.30')
  })

  it('标题里不印金额：金额随参数变，两处印同一个数一定有一个先漂', () => {
    const data = projectSpendCard(pending([shot(1, 0.3)]), { page: 0, scope: 'each' }, t)!
    expect(data.title).toBe('agentPanelV4.spendParamsTitleImage(count=1)')
    expect(data.title).not.toContain('0.30')
  })

  it('报不出价：印那句话而不是 ¥0，主按钮退成「仍要生成」，范围切换不渲染', () => {
    const data = projectSpendCard(pending([shot(1, null), shot(2, null)]), { page: 0, scope: 'all' }, t)!
    expect(data.price?.total).toBeUndefined()
    expect(data.price?.unavailable).toBe('agentPanelV4.spendParamsUnavailable')
    expect(JSON.stringify(data)).not.toContain('amount=0.00')
    expect(data.confirmLabel).toBe('agentPanelV4.spendParamsConfirmUnknown')
    expect(data.pager?.scope).toBeUndefined()
    expect(data.scope).toBe('agentPanelV4.spendParamsScopeUnknown')
  })

  it('多镜整齐：不出逐镜折叠口（把同一句话抄 N 遍没有信息量）', () => {
    const data = projectSpendCard(pending([shot(1, 0.3), shot(2, 0.3)]), { page: 0, scope: 'each' }, t)!
    expect(data.price?.perItem).toBeUndefined()
    expect(data.pager).toMatchObject({ index: 0, total: 2 })
  })

  it('多镜不整齐：算式退成「逐镜不同」并摊开每一行', () => {
    const data = projectSpendCard(pending([shot(1, 0.5), shot(2, 0.3)]), { page: 1, scope: 'each' }, t)!
    expect(data.price?.breakdown).toContain('spendParamsBreakdownMixed')
    expect(data.price?.perItem).toHaveLength(2)
    // 翻到第 2 页时主按钮印的是**那一页**的价，不是第一页的。
    expect(data.confirmLabel).toContain('amount=0.30')
  })

  it('切到「全部」：主按钮改口印合计，动作行仍然只有一颗填色按钮', () => {
    const data = projectSpendCard(pending([shot(1, 0.3), shot(2, 0.3)]), { page: 0, scope: 'all' }, t)!
    expect(data.pager?.scope?.value).toBe('all')
    expect(data.confirmLabel).toBe('agentPanelV4.spendParamsConfirmAll(count=2,amount=agentPanelV4.money(currency=CNY,amount=0.60))')
    expect(data.alternateLabel).toBeUndefined()
  })

  it('翻页越界回环：卡永远停在一个真实存在的镜头上', () => {
    const data = projectSpendCard(pending([shot(1, 0.3), shot(2, 0.4)]), { page: -1, scope: 'each' }, t)!
    expect(data.pager?.index).toBe(1)
  })

  it('「Nomi 选的」是现算的：用户换过模型之后这句话就消失', () => {
    const kept = projectSpendCard(pending([shot(1, 0.3, 'kling')]), { page: 0, scope: 'each' }, t, { agentPickedModelIds: ['kling'] })!
    expect(kept.badge).toContain('spendParamsModelPicked')
    const changed = projectSpendCard(pending([shot(1, 0.3, 'seedance')]), { page: 0, scope: 'each' }, t, { agentPickedModelIds: ['kling'] })!
    expect(changed.badge).not.toContain('spendParamsModelPicked')
  })

  it('图片单说图片、视频单才说视频——付钱前那一刻不许让人怀疑它搞错了', () => {
    const image = projectSpendCard(pending([{ ...shot(1, 0.3), mode: 'text_to_image' }]), { page: 0, scope: 'each' }, t)!
    expect(image.title).toContain('spendParamsTitleImage')
    const video = projectSpendCard(pending([{ ...shot(1, 0.3), mode: 'image_to_video' }]), { page: 0, scope: 'each' }, t)!
    expect(video.title).toContain('spendParamsTitle(')
  })

  it('没有镜头就不出卡', () => {
    expect(projectSpendCard(pending([]), { page: 0, scope: 'each' }, t)).toBeUndefined()
  })
})

describe('节点 → 候选补丁', () => {
  const base = shot(1, 0.3)
  function node(meta: Record<string, unknown>, prompt = '镜头 1'): GenerationCanvasNode {
    return {
      id: 'node-1', kind: 'video', categoryId: 'shots', title: '镜头 1', prompt,
      position: { x: 0, y: 0 }, size: { width: 340, height: 192 }, status: 'idle',
      meta: { modelKey: 'kling', modelVendor: 'kie', archetype: { id: 'kling', modeId: undefined }, duration: '3', ...meta },
    } as GenerationCanvasNode
  }

  it('一个字都没改 → 不发命令（防抖之外的第二道闸：空改动不推进 planVersion）', () => {
    expect(candidatePatchFromNode(node({}), base)).toBeUndefined()
  })

  it('改时长 → 参数整组带过去（候选认识的键才带，不另立第二份词表）', () => {
    const patch = candidatePatchFromNode(node({ duration: '5' }), base)!
    expect(patch.parameters).toEqual({ duration: '5' })
    expect(patch.prompt).toBeUndefined()
  })

  it('改提示词 / 换模型 → 各自单独进补丁', () => {
    expect(candidatePatchFromNode(node({}, '六棱柱'), base)).toEqual({ prompt: '六棱柱' })
    const swapped = candidatePatchFromNode(node({ modelKey: 'seedance', modelVendor: 'apimart' }), base)!
    expect(swapped).toMatchObject({ modelId: 'seedance', providerId: 'apimart' })
  })

  it('节点上没有的参数键回落候选原值，不把它抹成 undefined', () => {
    const patch = candidatePatchFromNode(node({ duration: undefined, modelKey: 'seedance' }), base)!
    expect(patch.parameters).toBeUndefined()
    expect(patch.modelId).toBe('seedance')
  })
})
