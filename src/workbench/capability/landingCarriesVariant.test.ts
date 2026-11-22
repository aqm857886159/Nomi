// 「Agent 选的变体落到画布节点上要原样留住」的渲染半（R-d2-defaults #2，2026-10-22）。
//
// 症状：Agent 起草 Seedance 2.0 标准 / Mini，候选、付费卡、宿主派发都是所选变体，落地节点停在默认 Fast，
// 在节点上点 ↑ 发的是 Fast。直接原因：落地报文没带 variantId，渲染层「新建」「重绑定」两处手写的
// buildPlannedNodeMeta 入参也都没有它。这里走真 `materializeShots` 的两扇门（新建经 create_canvas_nodes 写边界，
// Agent 改稿经 landedShotIntent 的 applyAgentRevision——D2 第③步起只写 Agent 真改了的那几样），钉住两扇门用的是
// 同一个投影、变体都过得来；以及「只动已有节点」的重放不改用户切过的变体。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { persistNowSpy } = vi.hoisted(() => ({ persistNowSpy: vi.fn(async () => null) }))
vi.mock('../project/workbenchProjectSession', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../project/workbenchProjectSession')>()),
  persistActiveWorkbenchProjectNow: persistNowSpy,
}))

// 模型清单用真档案：KIE 的 Seedance 2（standard / fast / mini 三个变体），经真 buildAgentModelEntries 建条目。
vi.mock('../generationCanvas/agent/availableModels', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../generationCanvas/agent/availableModels')>()
  return {
    ...actual,
    listAvailableModelsForAgent: vi.fn(async () => actual.buildAgentModelEntries([
      { value: 'bytedance/seedance-2', modelKey: 'bytedance/seedance-2', label: 'Seedance 2', vendor: 'kie', kind: 'video', meta: { archetypeId: 'seedance-2' } },
    ])),
  }
})

import { materializeShots, type MaterializeShotInput } from './multiShotCanvasLanding'
import { useGenerationCanvasStore } from '../generationCanvas/store/generationCanvasStore'
import { resetClientIdRegistry } from '../generationCanvas/agent/applyCanvasToolCall'
import { currentArchetypeVariant } from '../generationCanvas/nodes/controls/archetypeMeta'
import { EVERY_VARIANT, resolveModelArchetype } from '../../../electron/shared/modelArchetypes'
import { createProjectSessionTestHarness, type ProjectSessionTestHarness } from '../project/projectSessionTestHarness'

const OPERATION_ID = 'canvas-landing:run-variant'
const archetype = resolveModelArchetype({ modelKey: 'bytedance/seedance-2', vendorKey: 'kie', meta: { archetypeId: 'seedance-2' } }, { variant: EVERY_VARIANT })!
const DEFAULT_VARIANT = archetype.defaultVariantId!
/** 非默认变体：默认变体两边恰好都落到它，测它证明不了什么。 */
const NON_DEFAULT = (archetype.variants ?? []).map((variant) => variant.id).filter((id) => id !== DEFAULT_VARIANT)

function shot(revision: number, variantId: string | undefined, extra: Partial<MaterializeShotInput> = {}): MaterializeShotInput {
  return {
    shotId: 'shot-1', role: 'shot', kind: 'video', title: '镜头 1', prompt: '雨夜街口',
    candidate: {
      candidateId: 'candidate-1', revision, vendor: 'kie', modelKey: 'bytedance/seedance-2', modeId: archetype.defaultModeId,
      mode: 'text_to_video', ...(variantId ? { variantId } : {}),
    },
    ...extra,
  }
}

const land = (shots: MaterializeShotInput[], existingOnly?: boolean) =>
  materializeShots({ materializationOperationId: OPERATION_ID, runId: 'run-variant', shots, ...(existingOnly ? { existingOnly } : {}) })

function landedVariant(): string | undefined {
  const node = useGenerationCanvasStore.getState().nodes
    .find((candidate) => (candidate.meta as Record<string, unknown> | undefined)?.materializationOperationId === OPERATION_ID)
  return currentArchetypeVariant(archetype, node?.meta as Record<string, unknown>)?.id
}

describe('落地线带上变体：新建与重绑定同一个投影', () => {
  // 落地只认它出发时那个项目的生命周期（受控画布夹具里也一样）。
  let landingProject: ProjectSessionTestHarness
  beforeEach(async () => {
    landingProject = createProjectSessionTestHarness()
    await landingProject.open('project-a')
    resetClientIdRegistry()
    useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [], edges: [], groups: [] })
  })
  afterEach(() => landingProject.dispose())

  it('前提：这个档案至少有两个非默认变体', () => {
    expect(NON_DEFAULT.length).toBeGreaterThanOrEqual(2)
  })

  it.each(NON_DEFAULT)('报告的格：首次落地（create_canvas_nodes 写边界）变体 %s 原样落到节点', async (variantId) => {
    await land([shot(1, variantId)])
    expect(landedVariant()).toBe(variantId)
  })

  it('重绑定：候选 revision 变新、变体从默认改成非默认 → 节点跟过去；再改回不写（宿主补默认）→ 节点回默认', async () => {
    await land([shot(1, DEFAULT_VARIANT)])
    expect(landedVariant()).toBe(DEFAULT_VARIANT)
    await land([shot(2, NON_DEFAULT[0])])
    expect(landedVariant()).toBe(NON_DEFAULT[0])
    await land([shot(3, undefined)])
    expect(landedVariant()).toBe(DEFAULT_VARIANT)
  })

  it('只动已有节点的重放（打开项目对账 / Run 跟随）：不重绑定候选，用户在节点上切过的变体不被改回', async () => {
    await land([shot(1, NON_DEFAULT[0])])
    const node = useGenerationCanvasStore.getState().nodes[0]
    const meta = node.meta as Record<string, unknown>
    useGenerationCanvasStore.getState().updateNode(node.id, { meta: { ...meta, archetype: { ...(meta.archetype as object), variantId: NON_DEFAULT[1] } } })
    await land([shot(2, NON_DEFAULT[0])], true)
    expect(landedVariant()).toBe(NON_DEFAULT[1])
  })

  it('同一 revision 的幂等重放不动节点（修复不放宽重绑定闸）', async () => {
    await land([shot(1, NON_DEFAULT[0])])
    const node = useGenerationCanvasStore.getState().nodes[0]
    const meta = node.meta as Record<string, unknown>
    useGenerationCanvasStore.getState().updateNode(node.id, { meta: { ...meta, archetype: { ...(meta.archetype as object), variantId: NON_DEFAULT[1] } } })
    await land([shot(1, NON_DEFAULT[0])])
    expect(landedVariant()).toBe(NON_DEFAULT[1])
  })
})
