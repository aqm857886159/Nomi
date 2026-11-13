// 类级：分镜的模型身份是 (modelKey, modelVendor) 一对——写要成对、读（回显）与执行（落地）用同一把尺。
//
// 报障那三个组件的复现在 creation/storyboard/storyboardModelVendorIdentity.test.ts；这里钉的是
// **不变量本身**，不认任何一个具体入口：任何写口只写半个身份、任何读口按名字挑第一家，都会在这里红。
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { ModelOption } from '../../../config/models'
import { findModelOptionByIdentifier } from '../../../config/modelOptionResolvers'
import { pickImplicitVendorMatch } from '../../../config/modelIdentity'
import { useDedupedModelSelect, type DedupedModelSelectView } from '../../common/useDedupedModelSelect'
import { resolveGenerationPlan } from '../../../../electron/shared/videoCapabilities/planResolver'
import type { VideoModelCandidate } from '../../../../electron/shared/videoCapabilities/recommendation'
import { buildAgentModelEntries, pickStoryboardDefaultModel } from './availableModels'
import { normalizeStoryboardAnchorDefaults } from './storyboardAnchorPolicy'
import { parseStoryboardPlan } from './storyboardPlanSchema'
import { buildModelEntryIndex, buildPlannedNodeMeta } from './plannedNodeMeta'
import { storyboardPlanToCreateNodesArgs, type PlanShot, type StoryboardPlan } from './storyboardPlan'
import {
  addShot,
  insertShotAt,
  planModelSelection,
  shotKindPatch,
  updateAnchor,
  updateShotAt,
} from './storyboardPlanEdits'

const CUSTOM = 'my-relay-example-com'
const custom = { value: 'gpt-image-2', label: 'image2', modelKey: 'gpt-image-2', vendor: CUSTOM, vendorName: 'My Relay', kind: 'image' } as ModelOption
const apimart = {
  value: 'gpt-image-2', label: 'GPT Image 2', modelKey: 'gpt-image-2', vendor: 'apimart', kind: 'image',
  meta: { canonicalModelId: 'gpt image 2' },
} as ModelOption
// 目录新接入的在前：自定义那条排第一，正是「按名字取第一家」会选错的前提。
const OPTIONS: ModelOption[] = [custom, apimart]

const shot = (over: Partial<PlanShot> = {}): PlanShot => ({ index: 1, shotKind: 'image', durationSec: 3, anchorIds: [], prompt: 'p', ...over })
const planOf = (shots: PlanShot[]): StoryboardPlan => ({ title: 't', anchors: [], shots })

describe('写：模型身份两半一起写，不留为别的模型记下的供应商', () => {
  it('updateShotAt 收到只带 modelKey 的补丁（旧 JS / any 调用者）：modelVendor 被清掉，不沿用旧的那家', () => {
    const plan = planOf([shot({ modelKey: 'seedream', modelVendor: CUSTOM })])
    const loose = { modelKey: 'gpt-image-2' } as unknown as Parameters<typeof updateShotAt>[2]
    const next = updateShotAt(plan, 0, loose)
    expect(next.shots[0]).toMatchObject({ modelKey: 'gpt-image-2' })
    expect(next.shots[0]!.modelVendor).toBeUndefined()
  })

  it('updateAnchor 同一条规则', () => {
    const plan: StoryboardPlan = { title: 't', shots: [], anchors: [{ id: 'a', kind: 'character', name: 'A', description: '', carrier: 'visual', modelKey: 'x', modelVendor: CUSTOM }] }
    const loose = { modelKey: 'gpt-image-2' } as unknown as Parameters<typeof updateAnchor>[2]
    expect(updateAnchor(plan, 'a', loose).anchors[0]!.modelVendor).toBeUndefined()
    expect(updateAnchor(plan, 'a', planModelSelection('gpt-image-2', 'apimart')).anchors[0]).toMatchObject({ modelKey: 'gpt-image-2', modelVendor: 'apimart' })
  })

  it('不碰模型的补丁不动供应商', () => {
    const plan = planOf([shot({ modelKey: 'gpt-image-2', modelVendor: 'apimart' })])
    expect(updateShotAt(plan, 0, { prompt: 'new' }).shots[0]!.modelVendor).toBe('apimart')
  })

  it('新增 / 插入镜头继承上一镜的模型时，两半一起继承', () => {
    const plan = planOf([shot({ modelKey: 'gpt-image-2', modelVendor: 'apimart' })])
    expect(addShot(plan).shots[1]).toMatchObject({ modelKey: 'gpt-image-2', modelVendor: 'apimart' })
    expect(insertShotAt(plan, 1).shots[1]).toMatchObject({ modelKey: 'gpt-image-2', modelVendor: 'apimart' })
  })

  it('切镜头类型清模型时供应商一起清', () => {
    const patch = shotKindPatch(shot({ modelKey: 'gpt-image-2', modelVendor: 'apimart' }), 'video')
    expect(patch).toHaveProperty('modelKey', undefined)
    expect(patch).toHaveProperty('modelVendor', undefined)
  })


})

describe('读：只记了模型名的旧镜头——界面显示哪家，请求就发去哪家', () => {
  function modelBoxVendor(options: ModelOption[], value: string, vendor?: string): string | undefined {
    let view!: DedupedModelSelectView
    function Probe() {
      view = useDedupedModelSelect(options, value, () => {}, vendor)
      return null
    }
    renderToStaticMarkup(createElement(Probe))
    return view.selectedModel?.providers.find((provider) => view.providerValue.startsWith(`${provider.vendor}\u0000`))?.vendor
  }
  function executionVendor(options: ModelOption[], value: string, order: string[] = []): unknown {
    const index = buildModelEntryIndex(buildAgentModelEntries(options), order)
    return buildPlannedNodeMeta({ modelKey: value }, index)?.modelVendor
  }

  it('同名多家、没记供应商：回显 / 读档案 / 执行三处都落 APIMart（内置中转 > 自接），不是目录第一条的自定义', () => {
    expect(findModelOptionByIdentifier(OPTIONS, 'gpt-image-2')?.vendor).toBe('apimart')
    expect(modelBoxVendor(OPTIONS, 'gpt-image-2')).toBe('apimart')
    expect(executionVendor(OPTIONS, 'gpt-image-2')).toBe('apimart')
  })

  it('用户在设置里把自定义那家排到前面：三处一起跟着用户的顺序走', () => {
    const order = [CUSTOM]
    expect(findModelOptionByIdentifier(OPTIONS, 'gpt-image-2', undefined, order)?.vendor).toBe(CUSTOM)
    expect(executionVendor(OPTIONS, 'gpt-image-2', order)).toBe(CUSTOM)
    expect(pickImplicitVendorMatch(OPTIONS, (option) => option.vendor, order)?.vendor).toBe(CUSTOM)
  })

  it('同名只有一家：直接用那一家', () => {
    expect(findModelOptionByIdentifier([custom], 'gpt-image-2')?.vendor).toBe(CUSTOM)
    expect(executionVendor([custom], 'gpt-image-2')).toBe(CUSTOM)
  })

  it('记了供应商：永远按 (modelKey, vendor) 精确命中，回显与执行都不换家', () => {
    expect(modelBoxVendor(OPTIONS, 'gpt-image-2', CUSTOM)).toBe(CUSTOM)
    const index = buildModelEntryIndex(buildAgentModelEntries(OPTIONS))
    expect(buildPlannedNodeMeta({ modelKey: 'gpt-image-2', modelVendor: CUSTOM }, index)?.modelVendor).toBe(CUSTOM)
  })

  it('记的那家已经不提供这个模型：模型框不假装选中了别家', () => {
    expect(modelBoxVendor(OPTIONS, 'gpt-image-2', 'gone-vendor')).toBeUndefined()
  })
})

describe('落画布：默认模型那一半也不许「A 模型 × B 家」', () => {
  const defaults = {
    defaultImageModelKey: 'img-default', defaultImageModelVendor: 'kie',
    defaultVideoModelKey: 'vid-default', defaultVideoModelVendor: 'apimart',
  }

  it('没选模型的图片镜：默认图片模型配默认图片模型那一家（不是视频默认那家，也不是镜头上残留的供应商）', () => {
    const args = storyboardPlanToCreateNodesArgs(planOf([shot({ modelVendor: CUSTOM })]), defaults)
    const node = args.nodes.find((candidate) => candidate.kind === 'image')!
    expect(node).toMatchObject({ modelKey: 'img-default', modelVendor: 'kie' })
  })

  it('没选模型的视频镜：视频默认配视频默认那一家', () => {
    const args = storyboardPlanToCreateNodesArgs(planOf([shot({ shotKind: 'video', durationSec: 5 })]), defaults)
    expect(args.nodes.find((candidate) => candidate.kind === 'video')).toMatchObject({ modelKey: 'vid-default', modelVendor: 'apimart' })
  })

  it('选了模型的镜头：用镜头自己的那一对', () => {
    const args = storyboardPlanToCreateNodesArgs(planOf([shot({ modelKey: 'gpt-image-2', modelVendor: 'apimart' })]), defaults)
    expect(args.nodes.find((candidate) => candidate.kind === 'image')).toMatchObject({ modelKey: 'gpt-image-2', modelVendor: 'apimart' })
  })

  it('没选模型的视觉锚：默认图片模型那一家，锚上残留的供应商不混进来', () => {
    const plan: StoryboardPlan = {
      title: 't', shots: [shot({ anchorIds: ['a'] })],
      anchors: [{ id: 'a', kind: 'character', name: 'A', description: 'd', carrier: 'visual', modelVendor: CUSTOM }],
    }
    const node = storyboardPlanToCreateNodesArgs(plan, defaults).nodes.find((candidate) => candidate.clientId === 'a')!
    expect(node).toMatchObject({ modelKey: 'img-default', modelVendor: 'kie' })
  })
})

describe('分镜节奏审阅（planResolver）：同名多家按记下的那家取约束', () => {
  it('shot 带 modelVendor → 候选是那一家', () => {
    const base = { modelKey: 'seedance', label: 'Seedance', archetype: { id: 'x', kind: 'video', defaultModeId: 'm', modes: [] } } as unknown as Omit<VideoModelCandidate, 'provider'>
    const candidates = [{ ...base, provider: CUSTOM }, { ...base, provider: 'apimart' }] as VideoModelCandidate[]
    const result = resolveGenerationPlan({ shots: [{ id: 's1', durationSec: 5, modelKey: 'seedance', modelVendor: 'apimart' }], candidates })
    expect(result.shots[0]!.candidate?.provider).toBe('apimart')
  })
})

describe('Agent 落方案：只给了模型名的镜头，补 vendor 时不许替用户挑「列表里第一个同名的」', () => {
  const H3 = (vendor: string) => ({ value: 'MiniMax-H3', modelKey: 'MiniMax-H3', vendor, label: 'MiniMax H3', kind: 'video' }) as ModelOption
  const anchor = { id: 'hero', kind: 'character' as const, carrier: 'visual' as const, name: 'Hero', description: 'd', referenceUrl: 'https://example.com/hero.png', referenceKind: 'image' as const }
  const plan = (): StoryboardPlan => ({
    title: 't', anchors: [anchor],
    shots: [{ index: 1, shotKind: 'video', durationSec: 6, prompt: 'p', anchorIds: ['hero'], modelKey: 'MiniMax-H3' }],
  })

  it('同名两家、镜头没记 vendor：落盘的 vendor 是 apimart（与模型框回显同一把尺），不是目录第一条的自定义', () => {
    const entries = buildAgentModelEntries([H3(CUSTOM), H3('apimart')])
    expect(normalizeStoryboardAnchorDefaults(plan(), entries).shots[0]!.modelVendor).toBe('apimart')
  })

  it('用户把自定义排在前面：跟用户的顺序', () => {
    const entries = buildAgentModelEntries([H3('apimart'), H3(CUSTOM)])
    expect(normalizeStoryboardAnchorDefaults(plan(), entries, [CUSTOM]).shots[0]!.modelVendor).toBe(CUSTOM)
  })

  it('兜底默认模型阶梯：阶梯选模型，同名多家选哪家同一把尺', () => {
    const entries = buildAgentModelEntries([custom, apimart])
    expect(pickStoryboardDefaultModel(entries, 'image')?.vendor).toBe('apimart')
    expect(pickStoryboardDefaultModel(entries, 'image', [CUSTOM])?.vendor).toBe(CUSTOM)
  })
})

describe('持久化边界：方案解析（重开项目 / materialize 能力）不丢模型身份', () => {
  it('锚上选的 (modelKey, modelVendor) 经 parseStoryboardPlan 原样保留', () => {
    const parsed = parseStoryboardPlan({
      title: 't', shots: [],
      anchors: [{ id: 'a', kind: 'character', name: 'A', description: 'd', carrier: 'visual', modelKey: 'gpt-image-2', modelVendor: 'apimart', modeId: 't2i' }],
    })
    expect(parsed.anchors[0]).toMatchObject({ modelKey: 'gpt-image-2', modelVendor: 'apimart', modeId: 't2i' })
  })

  it('镜头与首帧的一对同样保留', () => {
    const parsed = parseStoryboardPlan({
      title: 't', anchors: [],
      shots: [{ index: 1, durationSec: 5, anchorIds: [], prompt: 'p', modelKey: 'seedance', modelVendor: 'kie', keyframe: { enabled: true, modelKey: 'gpt-image-2', modelVendor: 'apimart' } }],
    })
    expect(parsed.shots[0]).toMatchObject({ modelKey: 'seedance', modelVendor: 'kie', keyframe: { modelKey: 'gpt-image-2', modelVendor: 'apimart' } })
  })
})
