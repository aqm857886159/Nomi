import { describe, expect, it, vi } from 'vitest'
import { generationCandidateSchema, generationPlanInputSchema } from '../shared/agentCapabilities/generationPlanSchemas'
import { MCP_GENERATION_TOOL_CATALOG } from './mcpGenerationToolCatalog'
import { validateToolArguments } from './mcpProtocol'
import { toPublishedJsonSchema } from '../shared/agentCapabilities/modelVisibleJsonSchema'

import { createPiGenerationTransportAdapter } from './generationTransportAdapters'
import { draftShotFromPlan } from './mcpGenerationMultiShot'
import type { ProjectLeaseV2 } from './projectLease'

const tool = MCP_GENERATION_TOOL_CATALOG.find(tool => tool.name === 'nomi_operation_plan')!

describe('MCP generation draft schema parity', () => {
  it('accepts lane prompt-only shots and preserves nested JSON parameters', () => {
    const shot = { prompt: 'A sunrise', taskKind: 'text_to_image', modelId: 'from-context', mode: 'from-context',
      parameters: { nested: { list: [null, true, 3, 'value', { child: [] }] } },
      references: [{ assetId: 'asset-1', contentHash: 'hash-1', version: 1, kind: 'image', role: 'reference' }],
    }
    expect(generationPlanInputSchema.safeParse({ operation: 'create', shots: [shot] }).success).toBe(true)
    const args = { leaseHandle: 'lease', projectId: 'project', shots: [shot] }
    expect(validateToolArguments(tool.name, tool.inputSchema, args)).toBeNull()
    expect(tool.build(args)).toMatchObject({ shots: [shot] })
  })

  it('derives every create and patch property from the canonical lane generation owner', () => {
    const create = toPublishedJsonSchema(generationPlanInputSchema.options[1].omit({ operation: true, newPlan: true }))
    const properties = tool.inputSchema.properties as Record<string, unknown>
    expect(properties).toMatchObject(create.properties as Record<string, unknown>)
    expect(properties.patch).toMatchObject({ type: 'object', additionalProperties: false })
    expect(validateToolArguments(tool.name, tool.inputSchema, { leaseHandle: 'lease', operationId: 'op', patch: { parameters: { nested: [null, { x: true }] } } })).toBeNull()
  })

  it('exposes typed candidate/reference/patch fields and rejects malformed metadata', () => {
    for (const args of [
      { candidate: { candidateId: 'one', revision: 'bad' } },
      { references: [{ assetId: 'a', contentHash: 'h', version: 'bad' }] },
      { operationId: 'op', patch: { references: [{ assetId: 'a', contentHash: 'h', version: 'bad' }] } },
    ]) expect(validateToolArguments(tool.name, tool.inputSchema, { leaseHandle: 'lease', ...args })).not.toBeNull()
  })

  // 名字原本叫「…the same existing candidate rejection」——把「只给 prompt 的镜头会被拒」当成契约钉住了。
  // 「existing」这个词是马脚：有人量到了那个拒绝，选择冻结它，而不是问它该不该存在。2026-09-18 查明那正是
  // 缺陷本身（单镜早就允许只给 prompt，多镜不允许）。这条测试真正守得住的不变量是**两个入口结果一致**，
  // 与结果是收是拒无关；那条留下，冻结的那半删掉（正面用例在 mcpMultiShotCreateEntrance.e2e.test.ts）。
  it('routes prompt-only shots from both surfaces to the same outcome', async () => {
    const shot = { prompt: 'A sunrise' }
    const parsers = {
      record: (value: unknown) => value as Record<string, unknown>,
      candidateFrom: (value: unknown) => generationCandidateSchema.parse(value),
    }
    const binding = { projectId: 'project', immutableProjectUuid: '11111111-1111-4111-8111-111111111111', projectGeneration: 1 }
    let refusedOnTheLane: unknown
    const planning = vi.fn(async ({ params }: { params: Record<string, unknown> }) => {
      try { return draftShotFromPlan((params.shots as unknown[])[0], 0, 'shot-1', parsers) }
      catch (error) { refusedOnTheLane = error; throw error }
    })
    const adapter = createPiGenerationTransportAdapter(binding, {
      planning, leaseFor: () => ({ ...binding } as ProjectLeaseV2),
    })
    try {
      const laneResult = await adapter.tryExecute({ toolCallId: 'parity', toolName: 'nomi_generation_plan',
        args: { operation: 'create', shots: [shot] } }, new AbortController().signal)
      const external = tool.build({ leaseHandle: 'lease', projectId: binding.projectId, shots: [shot] })
      expect(planning).toHaveBeenCalledWith(expect.objectContaining({ capability: 'create', params: expect.objectContaining({ shots: external.shots }) }))
      // Parity 不是「两边各自失败」——那两条断言互不相干，删掉任意一条另一条照样绿。守得住的
      // 不变量是**同一份入参在同一个 owner 上被同一个理由拒掉**：外部入口直接调用抛出来的那句话，
      // 必须逐字等于 lane 这条路收敛成码之前拿到的那一句。
      let refusedExternally: unknown
      try { draftShotFromPlan((external.shots as unknown[])[0], 0, 'shot-1', parsers) } catch (error) { refusedExternally = error }
      expect(refusedExternally).toBeInstanceOf(Error)
      // 2026-09-30（付费卡① 第 9 条）：只给提示词、没写种类也没点名模型的镜头，先被问「要图还是视频」——
      // 不再按提示词猜一个再去找那一类的默认模型。两边拿到的仍是逐字同一句。
      expect((refusedExternally as Error).message).toMatch(/set taskKind/)
      expect((refusedOnTheLane as Error).message).toBe((refusedExternally as Error).message)
      // 2026-09-22 改判：这一句**不是**宿主内部异常文本，是我们自己写给模型的一句可行动的话
      // （抛出点的注释写着它为什么这么写：DeepSeek 连调 6 次都不知道自己可以点名一个模型）。
      // 旧断言把它当成「要收敛掉的内部文本」，于是运输边界只发一个裸码——run2 的轨迹里，
      // 这一句正是 6 次「draft_shots failed inside Nomi」的真身。
      //
      // parity 因此更强了，不是更弱：lane 这条路发布的正文现在**逐字等于**外部入口抛出来的那一句，
      // 两边连措辞都不再有分歧。真正要守的「不泄露」由 `transportFailure` 的另一条轴保证：
      // 只有我们有意抛的 `ModelFacingRefusal` 才带正文，别人抛的一个字都不带
      // （阳性对照在 `generationDomainRefusalReachesModel.test.ts`）。
      expect(laneResult).toMatchObject({ ok: false, code: 'generation_input_invalid' })
      expect((laneResult as { message?: string }).message).toBe((refusedExternally as Error).message)
    } finally { adapter.dispose() }
  })

})
