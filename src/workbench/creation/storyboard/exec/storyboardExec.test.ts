import { describe, expect, it } from 'vitest'
import type { GenerationCanvasNode } from '../../../generationCanvas/model/generationCanvasTypes'
import type { ArchetypeMode } from '../../../../config/modelArchetypes/types'
import type { PlanAnchor, PlanShot, StoryboardPlan } from '../../../generationCanvas/agent/storyboardPlan'
import {
  storyboardAnchorToCreateNodesArgs,
  storyboardShotToCreateNodesArgs,
} from '../../../generationCanvas/agent/storyboardPlan'
import { designCommittedNow, findAnchorNode, findShotKeyframeNode, findShotNode, materializedShotIds } from './storyboardNodeBinding'
import { deriveShotRowExec, deriveStoryboardBatch, SHOT_ROW_STATUSES, type StoryboardRowRuntime } from './storyboardRowStatus'

// 锁分镜表 v5 B 的执行地基：单行 materialize 转换、表↔节点绑定、行状态 derive、批量分桶。

const DESIGN = 'design-1'

const hero: PlanAnchor = { id: 'hero', kind: 'character', name: '林薇', description: '短发', carrier: 'visual' }
const styleAnchor: PlanAnchor = { id: 'mood', kind: 'style', name: '全片风格', description: '赛博霓虹', carrier: 'text' }

function shotOf(partial: Partial<PlanShot> = {}): PlanShot {
  return { index: 1, shotId: 'shot-a', durationSec: 5, anchorIds: ['hero'], prompt: '天台远景', ...partial }
}

function planOf(shots: PlanShot[], anchors: PlanAnchor[] = [hero, styleAnchor]): StoryboardPlan {
  return { title: '夜风', anchors, shots }
}

function nodeOf(partial: Partial<GenerationCanvasNode> & { id: string }): GenerationCanvasNode {
  return { kind: 'video', title: '', position: { x: 0, y: 0 }, ...partial } as GenerationCanvasNode
}

const i2vMode: ArchetypeMode = {
  id: 'i2v',
  intent: 'character',
  vendorTerm: '',
  hint: '',
  slots: [{ kind: 'image_ref', label: '角色参考', min: 0, max: 3 }],
  params: [],
  promptRequired: true,
}

const t2vMode: ArchetypeMode = { ...i2vMode, id: 't2v', intent: 'text', slots: [] }
const firstFrameMode: ArchetypeMode = {
  ...i2vMode,
  id: 'first',
  intent: 'single',
  slots: [{ kind: 'first_frame', label: '首帧', min: 1, max: 1 }],
}

describe('storyboardShotToCreateNodesArgs（单行 materialize）', () => {
  it('该行引用且没建过的锚一并建卡；已建过的用真实节点 id 连边、不重建', () => {
    const plan = planOf([shotOf()])
    const args = storyboardShotToCreateNodesArgs(plan, plan.shots[0], { storyboardDesignId: DESIGN })
    expect(args.nodes.map((node) => node.clientId)).toEqual(['hero', 'shot-a'])
    expect(args.anchorCount).toBe(1)
    expect(args.edges).toEqual([{ sourceClientId: 'hero', targetClientId: 'shot-a', mode: 'character_ref' }])

    const reused = storyboardShotToCreateNodesArgs(plan, plan.shots[0], {
      storyboardDesignId: DESIGN,
      existingAnchorNodeIdByAnchorId: { hero: 'node-77' },
    })
    expect(reused.nodes.map((node) => node.clientId)).toEqual(['shot-a'])
    expect(reused.anchorCount).toBe(0)
    expect(reused.edges).toEqual([{ sourceClientId: 'node-77', targetClientId: 'shot-a', mode: 'character_ref' }])
  })

  it('锚节点 metadata 恒带 anchorId 绑定键；镜节点带 shotId', () => {
    const plan = planOf([shotOf()])
    const args = storyboardShotToCreateNodesArgs(plan, plan.shots[0], { storyboardDesignId: DESIGN })
    expect(args.nodes[0].metadata).toMatchObject({ anchorId: 'hero', storyboardDesignId: DESIGN })
    expect(args.nodes[1].metadata).toMatchObject({ shotId: 'shot-a', storyboardDesignId: DESIGN })
  })

  it('omitAnchorReferenceEdges（该行模式不吃参考）：不建锚、不连锚边，文本锚照旧拼 prompt', () => {
    const plan = planOf([shotOf({ anchorIds: ['hero', 'mood'] })])
    const args = storyboardShotToCreateNodesArgs(plan, plan.shots[0], {
      storyboardDesignId: DESIGN,
      omitAnchorReferenceEdges: true,
    })
    expect(args.nodes.map((node) => node.clientId)).toEqual(['shot-a'])
    expect(args.edges).toEqual([])
    expect(args.nodes[0].prompt).toContain('赛博霓虹')
  })

  it('图片+视频镜：首帧图节点按需建；已建过则用真实 id 接 first_frame 边', () => {
    const plan = planOf([shotOf({ keyframe: { enabled: true, prompt: '首帧' } })])
    const fresh = storyboardShotToCreateNodesArgs(plan, plan.shots[0], { storyboardDesignId: DESIGN })
    expect(fresh.nodes.map((node) => node.clientId)).toEqual(['hero', 'shot-a-keyframe', 'shot-a'])
    expect(fresh.edges).toContainEqual({ sourceClientId: 'shot-a-keyframe', targetClientId: 'shot-a', mode: 'first_frame' })

    const reused = storyboardShotToCreateNodesArgs(plan, plan.shots[0], {
      storyboardDesignId: DESIGN,
      existingAnchorNodeIdByAnchorId: { hero: 'node-77' },
      existingKeyframeNodeId: 'node-kf',
    })
    expect(reused.nodes.map((node) => node.clientId)).toEqual(['shot-a'])
    expect(reused.edges).toContainEqual({ sourceClientId: 'node-kf', targetClientId: 'shot-a', mode: 'first_frame' })
    expect(reused.edges).toContainEqual({ sourceClientId: 'node-77', targetClientId: 'node-kf', mode: 'character_ref' })
  })

  it('单锚 materialize：视觉锚一张卡；文本锚返回 null', () => {
    const plan = planOf([shotOf()])
    const visual = storyboardAnchorToCreateNodesArgs(plan, hero, { storyboardDesignId: DESIGN })
    expect(visual?.nodes.map((node) => node.clientId)).toEqual(['hero'])
    expect(storyboardAnchorToCreateNodesArgs(plan, styleAnchor, { storyboardDesignId: DESIGN })).toBeNull()
  })
})

describe('storyboardNodeBinding（表 ↔ 节点）', () => {
  const shotNode = nodeOf({ id: 'n-shot', meta: { storyboardDesignId: DESIGN, shotId: 'shot-a' } })
  const kfNode = nodeOf({ id: 'n-kf', kind: 'image', meta: { storyboardDesignId: DESIGN, shotId: 'shot-a', storyboardKeyframe: true } })
  const anchorNode = nodeOf({ id: 'n-hero', kind: 'character', title: '林薇', meta: { storyboardDesignId: DESIGN, anchorId: 'hero', referenceSheet: true } })

  it('镜行按 designId × shotId 绑；首帧图靠 storyboardKeyframe 区分', () => {
    const nodes = [shotNode, kfNode, anchorNode]
    expect(findShotNode(nodes, DESIGN, shotOf())?.id).toBe('n-shot')
    expect(findShotKeyframeNode(nodes, DESIGN, shotOf())?.id).toBe('n-kf')
    expect(findShotNode(nodes, 'other-design', shotOf())).toBeNull()
  })

  it('变体复制（regeneratedFrom）不抢行身份：优先原节点', () => {
    const dup = nodeOf({ id: 'n-dup', regeneratedFrom: 'n-shot', meta: { storyboardDesignId: DESIGN, shotId: 'shot-a' } })
    expect(findShotNode([dup, shotNode], DESIGN, shotOf())?.id).toBe('n-shot')
  })

  it('锚按 anchorId 绑；旧项目（无 anchorId）回退 referenceSheet + 同名匹配', () => {
    expect(findAnchorNode([anchorNode], DESIGN, hero)?.id).toBe('n-hero')
    const legacy = nodeOf({ id: 'n-legacy', kind: 'character', title: '林薇', meta: { storyboardDesignId: DESIGN, referenceSheet: true } })
    expect(findAnchorNode([legacy], DESIGN, hero)?.id).toBe('n-legacy')
    expect(findAnchorNode([legacy], DESIGN, { ...hero, name: '别人' })).toBeNull()
  })

  it('committed=至少一镜已建节点（derive）；旧项目回退存量标记', () => {
    expect(materializedShotIds([shotNode, kfNode], DESIGN).size).toBe(1)
    expect(designCommittedNow({ id: DESIGN, committed: false }, [shotNode])).toBe(true)
    expect(designCommittedNow({ id: DESIGN, committed: false }, [])).toBe(false)
    expect(designCommittedNow({ id: DESIGN, committed: true }, [])).toBe(true)
  })
})

describe('deriveShotRowExec（行状态机）', () => {
  const readyAnchor = nodeOf({
    id: 'n-hero',
    kind: 'character',
    title: '林薇',
    result: { id: 'r1', type: 'image', url: 'nomi-local://a.png', createdAt: 1 },
    meta: { storyboardDesignId: DESIGN, anchorId: 'hero', referenceSheet: true, frozen: { at: 1, by: 'user' } },
  })

  const derive = (nodes: GenerationCanvasNode[], mode: ArchetypeMode | null = i2vMode, shot: PlanShot = shotOf()) =>
    deriveShotRowExec({ plan: planOf([shot]), shot, designId: DESIGN, nodes, mode })

  it('未建节点 + 锚已就绪且锁定 → ready；锚没出图 → waiting-refs（可点直达的锚在 waitingRefs 里）', () => {
    expect(derive([readyAnchor]).status).toBe('ready')
    const bare = derive([])
    expect(bare.status).toBe('waiting-refs')
    expect(bare.waitingRefs[0]?.anchor.id).toBe('hero')
  })

  it('锚出了图但没锁：单跑不拦（ready），批量前经 unlockedRefs 排除', () => {
    const unlockedAnchor = nodeOf({
      ...readyAnchor,
      meta: { storyboardDesignId: DESIGN, anchorId: 'hero', referenceSheet: true },
    })
    const exec = derive([unlockedAnchor])
    expect(exec.status).toBe('ready')
    expect(exec.unlockedRefs.map((anchor) => anchor.id)).toEqual(['hero'])
  })

  it('不吃参考的模式（t2v）不等锚', () => {
    expect(derive([], t2vMode).status).toBe('ready')
  })

  it('必填槽无来源 → missing-required（红态；批量排除）', () => {
    expect(derive([readyAnchor], firstFrameMode).status).toBe('missing-required')
  })

  it('节点态：生成中 / 失败 / 已生成 / 已锁定', () => {
    const base = { storyboardDesignId: DESIGN, shotId: 'shot-a' }
    const running = nodeOf({ id: 'n1', status: 'running', progress: { percent: 40, updatedAt: 1 }, meta: base })
    expect(derive([readyAnchor, running]).status).toBe('generating')
    expect(derive([readyAnchor, running]).progressPercent).toBe(40)

    const failed = nodeOf({ id: 'n1', status: 'error', error: '上游挂了', meta: base })
    expect(derive([readyAnchor, failed]).status).toBe('failed')
    expect(derive([readyAnchor, failed]).errorMessage).toBe('上游挂了')

    const done = nodeOf({ id: 'n1', result: { id: 'r9', type: 'video', url: 'nomi-local://v.mp4', createdAt: 1 }, meta: base })
    expect(derive([readyAnchor, done]).status).toBe('done')

    const locked = nodeOf({ ...done, meta: { ...base, frozen: { at: 2, by: 'user' } } })
    expect(derive([readyAnchor, locked]).status).toBe('locked')
  })

  it('图片+视频镜：首帧图在跑也算 generating', () => {
    const shot = shotOf({ keyframe: { enabled: true, prompt: '首帧' } })
    const kfRunning = nodeOf({
      id: 'n-kf', kind: 'image', status: 'running',
      meta: { storyboardDesignId: DESIGN, shotId: 'shot-a', storyboardKeyframe: true },
    })
    expect(derive([readyAnchor, kfRunning], i2vMode, shot).status).toBe('generating')
  })
})

describe('deriveStoryboardBatch（批量分桶 = footer 同一份）', () => {
  const rowOf = (status: (typeof SHOT_ROW_STATUSES)[number], unlocked = false): StoryboardRowRuntime => ({
    shot: shotOf(),
    mode: i2vMode,
    exec: {
      status,
      node: null,
      keyframeNode: null,
      waitingRefs: [],
      unlockedRefs: unlocked ? [hero] : [],
      missingSlots: [],
      resultUrl: null,
      progressPercent: null,
      progressMessage: null,
      errorMessage: null,
      locked: status === 'locked',
    },
  })

  it('ready/failed 进批；等待/缺料/生成中/已锁/待锁定各归各桶', () => {
    const view = deriveStoryboardBatch([
      rowOf('ready'), rowOf('failed'), rowOf('waiting-refs'), rowOf('missing-required'),
      rowOf('generating'), rowOf('locked'), rowOf('done'), rowOf('ready', true),
    ])
    expect(view.runnable).toHaveLength(2)
    expect(view.excluded).toEqual({ waitingRefs: 1, unlockedRefs: 1, missingRequired: 1, locked: 1, generating: 1 })
    expect(view.doneCount).toBe(1)
    expect(view.countByStatus.ready).toBe(2)
  })
})
