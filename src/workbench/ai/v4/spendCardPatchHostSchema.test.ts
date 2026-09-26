import { describe, expect, it } from 'vitest'

import { generationPlanInputSchema } from '../../../../electron/shared/agentCapabilities/generationPlanSchemas'
import { MODEL_ARCHETYPES } from '../../../../electron/shared/modelArchetypes'
import type { PendingSpendShot } from '../../../desktop/productionRunBridgeTypes'
import { resolveRenderedControls } from '../../generationCanvas/nodes/nodeModelArchetype'
import type { ModelOption } from '../../../config/models'
import { candidatePatchFromNode, draftAfterNodeEdit, EMPTY_SPEND_DRAFT, projectSpendNode, revisionsForConfirm } from './spendCardDraft'

// 付费卡送给宿主的改稿必须过宿主那份 schema（`generationPlanInputSchema` 的 patch 分支）。
// 2026-09-26 真付费 T5：Agent 视频卡「全部」档点生成，宿主报 ZodError invalid_union、一笔都没派——
// 卡里的生成框自动补了一个默认值（画幅 16:9），卡就把「参数条上所有控件的键」都放进补丁，没有值的那几个
// （如 seed）是 `undefined`。IPC 的 structured clone 原样带过去，宿主只认 JSON 值，于是整张卡点了没反应。

function hostAccepts(patch: unknown): boolean {
  return generationPlanInputSchema.safeParse({ operation: 'patch', operationId: 'op-1', patch }).success
}

function undefinedParameterKeys(patch: { parameters?: Readonly<Record<string, unknown>> } | undefined): string[] {
  return Object.entries(patch?.parameters ?? {}).filter(([, value]) => value === undefined).map(([key]) => key)
}

describe('付费卡改稿 → 宿主 schema · 报告里那一幕', () => {
  it('Seedance 2.0 卡：生成框自动补了画幅 16:9，确认时送出的每一条改稿宿主都收', () => {
    const shots: PendingSpendShot[] = ['shot-1', 'shot-2'].map((shotId, index) => ({
      shotId, index: index + 1, prompt: '清晨的渔港', providerId: 'apimart', modelId: 'doubao-seedance-2.0', modeId: 't2v', variantId: 'fast',
      parameters: { resolution: '480p', generate_audio: false, duration: 4 }, price: { known: false },
    }))
    const node = projectSpendNode(shots[0]!)!
    const filled = { ...node, meta: { ...(node.meta as Record<string, unknown>), size: '16:9' } }
    const draft = draftAfterNodeEdit(EMPTY_SPEND_DRAFT, shots[0]!, filled, 'all')
    const revisions = revisionsForConfirm(shots, draft)
    expect(revisions.length, '补了默认值 = 有改稿要送').toBeGreaterThan(0)
    for (const revision of revisions) {
      expect(undefinedParameterKeys(revision.patch), `${revision.shotId}：改稿里没有值为 undefined 的参数`).toEqual([])
      expect(hostAccepts(revision.patch), `${revision.shotId}：宿主 schema 收这条改稿`).toBe(true)
    }
  })
})

describe('付费卡改稿 → 宿主 schema · 每一个图片 / 视频档案', () => {
  const archetypes = MODEL_ARCHETYPES.filter((archetype) => archetype.kind === 'image' || archetype.kind === 'video')

  it('确实覆盖到一批档案（否则下面是空转）', () => {
    expect(archetypes.length).toBeGreaterThan(20)
  })

  for (const archetype of archetypes) {
    it(`${archetype.id}：卡上改一个参数，送出去的改稿宿主都收`, () => {
      const modelId = archetype.catalogModelKey ?? archetype.variants?.[0]?.modelKey ?? archetype.identifierPatterns[0]!
      const shot: PendingSpendShot = {
        shotId: 'shot-1', index: 1, prompt: 'p', providerId: 'apimart', modelId, modeId: archetype.defaultModeId,
        parameters: {}, price: { known: false },
      }
      const node = projectSpendNode(shot)
      if (!node) return
      const meta = node.meta as Record<string, unknown>
      const option = { modelKey: modelId, vendor: 'apimart', value: modelId, label: modelId, kind: node.kind } as unknown as ModelOption
      const control = resolveRenderedControls(option, meta, node.kind === 'image', node.kind === 'video')
        .find((candidate) => candidate.binding === 'parameter' && (candidate.options?.length ?? 0) > 0)
      if (!control) return
      const last = control.options!.at(-1)!
      const edited = { ...node, meta: { ...meta, [control.key]: typeof last === 'string' ? last : last.value } }
      const patch = candidatePatchFromNode(edited, shot, option)
      expect(undefinedParameterKeys(patch), `${archetype.id}：改稿里没有值为 undefined 的参数`).toEqual([])
      expect(hostAccepts(patch ?? {}), `${archetype.id}：宿主 schema 收这条改稿`).toBe(true)
    })
  }
})
