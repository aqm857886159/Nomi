import { describe, expect, it } from 'vitest'
import type { GenerationCanvasNode } from '../../../generationCanvas/model/generationCanvasTypes'
import type { ArchetypeMode } from '../../../../../electron/shared/modelArchetypes/types'
import { SEEDANCE_2_APIMART_ARCHETYPE } from '../../../../../electron/shared/videoCapabilities/seedanceApimart'
import type { PlanAnchor, PlanShot, StoryboardPlan } from '../../../generationCanvas/agent/storyboardPlan'
import {
  storyboardAnchorToCreateNodesArgs,
  storyboardShotToCreateNodesArgs,
} from '../../../generationCanvas/agent/storyboardPlan'
import { designCommittedNow, findAnchorNode, findShotKeyframeNode, findShotNode, materializedShotIds } from './storyboardNodeBinding'
import {
  deriveAnchorCardRuntimes,
  deriveShotRowExec,
  deriveStoryboardBatch,
  SHOT_ROW_STATUSES,
  type StoryboardRowRuntime,
} from './storyboardRowStatus'

// 锁分镜表 v5 B 的执行地基：单行 materialize 转换、表↔节点绑定、行状态 derive、批量分桶。

const DESIGN = 'design-1'

const hero: PlanAnchor = { id: 'hero', kind: 'character', name: '林薇', description: '短发', carrier: 'visual' }
const styleAnchor: PlanAnchor = { id: 'mood', kind: 'style', name: '全片风格', description: '赛博霓虹', carrier: 'text' }
/** 行上参考列里摆着一张来自「林薇」的参考图——「引用」只有这一种读法（anchorIds 不产生任何作用）。 */
const heroBinding = { image_ref: [{ url: 'nomi-local://a.png', name: '林薇', anchorId: 'hero' }] }

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
  it('单行 materialize 只建这一镜自己：不顺手建它引用的定妆卡、不连任何锚边；提示词逐字等于行上写的', () => {
    const plan = planOf([shotOf({ anchorIds: ['hero', 'mood'], prompt: '一条巨龙盘在山顶' })])
    const args = storyboardShotToCreateNodesArgs(plan, plan.shots[0], { storyboardDesignId: DESIGN })
    expect(args.nodes.map((node) => node.clientId)).toEqual(['shot-a'])
    expect(args.anchorCount).toBe(0)
    expect(args.edges).toEqual([])
    expect(args.nodes[0].prompt).toBe('一条巨龙盘在山顶')
  })

  it('镜节点带 shotId + designId；不带任何锚绑定键', () => {
    const plan = planOf([shotOf()])
    const args = storyboardShotToCreateNodesArgs(plan, plan.shots[0], { storyboardDesignId: DESIGN })
    expect(args.nodes[0].metadata).toMatchObject({ shotId: 'shot-a', storyboardDesignId: DESIGN })
    expect(args.nodes[0].metadata).not.toHaveProperty('anchorId')
  })

  it('图片+视频镜：首帧图节点按需建；已建过则用真实 id 接 first_frame 边；首帧只拿首帧提示词', () => {
    const plan = planOf([shotOf({ keyframe: { enabled: true, prompt: '首帧' } })])
    const fresh = storyboardShotToCreateNodesArgs(plan, plan.shots[0], { storyboardDesignId: DESIGN })
    expect(fresh.nodes.map((node) => node.clientId)).toEqual(['shot-a-keyframe', 'shot-a'])
    expect(fresh.nodes[0].prompt).toBe('首帧')
    expect(fresh.edges).toEqual([{ sourceClientId: 'shot-a-keyframe', targetClientId: 'shot-a', mode: 'first_frame' }])

    const reused = storyboardShotToCreateNodesArgs(plan, plan.shots[0], { storyboardDesignId: DESIGN, existingKeyframeNodeId: 'node-kf' })
    expect(reused.nodes.map((node) => node.clientId)).toEqual(['shot-a'])
    expect(reused.edges).toEqual([{ sourceClientId: 'node-kf', targetClientId: 'shot-a', mode: 'first_frame' }])
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
    expect(findShotNode([dup], DESIGN, shotOf())).toBeNull()
    expect(findShotNode([{ ...dup, regeneratedFrom: undefined, derivedFrom: 'n-shot' }], DESIGN, shotOf())).toBeNull()
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

  const derive = (nodes: GenerationCanvasNode[], mode: ArchetypeMode | null = i2vMode, shot: PlanShot = shotOf({ referenceBindings: heroBinding })) =>
    deriveShotRowExec({ plan: planOf([shot]), shot, designId: DESIGN, nodes, mode })

  it('行不等任何参考卡：锚有没有出图、锁没锁定，都不改变行状态（发出去的只有参考列里已摆着的图）', () => {
    expect(derive([readyAnchor]).status).toBe('ready')
    expect(derive([]).status).toBe('ready')
    const unlocked = nodeOf({ ...readyAnchor, meta: { storyboardDesignId: DESIGN, anchorId: 'hero', referenceSheet: true } })
    expect(derive([unlocked]).status).toBe('ready')
  })

  it('只有 anchorIds、参考列里什么都没摆：不产生任何作用（不等、不拦、不算缺）', () => {
    const exec = derive([], i2vMode, shotOf({ anchorIds: ['hero', 'mood', 'ghost'] }))
    expect(exec.status).toBe('ready')
  })

  it('不吃参考的模式（t2v）+ 行上摆着参考图 → anchor-ignored，并逐张点名；行上没摆就是 ready', () => {
    const exec = derive([], t2vMode)
    expect(exec.status).toBe('anchor-ignored')
    expect(exec.ignoredAnchors.map((ignored) => ignored.name)).toEqual(['林薇'])
    expect(derive([], t2vMode, shotOf({ anchorIds: ['hero'] })).status).toBe('ready')
  })

  it('必填槽无来源 → missing-required（红态；批量排除）', () => {
    expect(derive([readyAnchor], firstFrameMode).status).toBe('missing-required')
  })

  /**
   * 0.22.0 误报：APIMart Seedance 2.0 图生视频只有一个 image_ref 槽（min 1），开了首帧的行
   * 生成时那张首帧就发进这个槽，行却判「缺参考图」、红着、被批量跳过。
   */
  it('只有 image_ref 必填槽的图生视频 + 开了首帧 → 不缺参考、进批量', () => {
    const apimartI2v = SEEDANCE_2_APIMART_ARCHETYPE.modes.find((mode) => mode.id === 'i2v')!
    const shot = shotOf({ anchorIds: [], keyframe: { enabled: true } })
    const exec = deriveShotRowExec({ plan: planOf([shot]), shot, designId: DESIGN, nodes: [], mode: apimartI2v })
    expect(exec.missingSlots).toEqual([])
    expect(exec.status).not.toBe('missing-required')
    const batch = deriveStoryboardBatch([{ shot, mode: apimartI2v, exec }])
    expect(batch.runnable.map((row) => row.shot.shotId)).toEqual(['shot-a'])
    expect(batch.excluded.missingRequired).toBe(0)
    // 对照：没开首帧的同一行确实缺参考、不进批量（判据没有被放宽成恒绿）。
    const bare = shotOf({ anchorIds: [] })
    const bareExec = deriveShotRowExec({ plan: planOf([bare]), shot: bare, designId: DESIGN, nodes: [], mode: apimartI2v })
    expect(bareExec.status).toBe('missing-required')
    expect(deriveStoryboardBatch([{ shot: bare, mode: apimartI2v, exec: bareExec }]).excluded.missingRequired).toBe(1)
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

  /**
   * 钱闸（2026-09-06 验收现场）：`recoverable` 说的是「任务已提交、钱已扣、上游多半已出片，
   * 只是本地轮询没接住」。它曾被折进 `failed`，于是表上是红色「生成失败」+ 会重新扣费的重试
   * ——10 镜 × $0.34272 = $3.43 的重复付费只差一次点击。这三条断言就是那道闸。
   */
  it('节点 recoverable → 行是 recoverable（不是 failed），且拿得到要续查的那个节点', () => {
    const base = { storyboardDesignId: DESIGN, shotId: 'shot-a' }
    const stuck = nodeOf({ id: 'n1', status: 'recoverable', error: '任务仍在上游进行', meta: base })
    const exec = derive([readyAnchor, stuck])
    expect(exec.status).toBe('recoverable')
    expect(exec.status).not.toBe('failed')
    expect(exec.recoverableNode?.id).toBe('n1')
  })

  it('首帧图 recoverable：续查的是首帧图那个节点（不是本体）', () => {
    const shot = shotOf({ keyframe: { enabled: true, prompt: '首帧' } })
    const kfStuck = nodeOf({
      id: 'n-kf', kind: 'image', status: 'recoverable',
      meta: { storyboardDesignId: DESIGN, shotId: 'shot-a', storyboardKeyframe: true },
    })
    const exec = derive([readyAnchor, kfStuck], i2vMode, shot)
    expect(exec.status).toBe('recoverable')
    expect(exec.recoverableNode?.id).toBe('n-kf')
  })

  it('真失败排在可找回之前：一个 error 一个 recoverable → 行仍是 failed（那一步没出片，只能重跑）', () => {
    const shot = shotOf({ keyframe: { enabled: true, prompt: '首帧' } })
    const kfFailed = nodeOf({
      id: 'n-kf', kind: 'image', status: 'error', error: '首帧挂了',
      meta: { storyboardDesignId: DESIGN, shotId: 'shot-a', storyboardKeyframe: true },
    })
    const stuck = nodeOf({ id: 'n1', status: 'recoverable', meta: { storyboardDesignId: DESIGN, shotId: 'shot-a' } })
    expect(derive([readyAnchor, kfFailed, stuck], i2vMode, shot).status).toBe('failed')
  })

  it('图片+视频镜：首帧图在跑也算 generating', () => {
    const shot = shotOf({ keyframe: { enabled: true, prompt: '首帧' } })
    const kfRunning = nodeOf({
      id: 'n-kf', kind: 'image', status: 'running',
      meta: { storyboardDesignId: DESIGN, shotId: 'shot-a', storyboardKeyframe: true },
    })
    expect(derive([readyAnchor, kfRunning], i2vMode, shot).status).toBe('generating')
  })

  it('参考已变（B3）：跑时快照 vs 锚当前 result 不一致（行上摆着来自这张锚的参考图）→ changedRefs 亮；重跑后消', () => {
    const base = { storyboardDesignId: DESIGN, shotId: 'shot-a' }
    const doneWithOldRef = nodeOf({
      id: 'n1',
      result: { id: 'r9', type: 'video', url: 'nomi-local://v.mp4', createdAt: 1 },
      meta: { ...base, refSnapshot: { 'n-hero': 'r0' } }, // 跑时用的是 r0；锚现在是 r1
    })
    expect(derive([readyAnchor, doneWithOldRef]).changedRefs.map((anchor) => anchor.id)).toEqual(['hero'])

    const doneWithFreshRef = nodeOf({ ...doneWithOldRef, meta: { ...base, refSnapshot: { 'n-hero': 'r1' } } })
    expect(derive([readyAnchor, doneWithFreshRef]).changedRefs).toEqual([])
  })

  it('参考已变：无快照的旧产物不报（只有确知用了旧版才亮）；locked 定稿不闹', () => {
    const base = { storyboardDesignId: DESIGN, shotId: 'shot-a' }
    const legacyDone = nodeOf({ id: 'n1', result: { id: 'r9', type: 'video', url: 'nomi-local://v.mp4', createdAt: 1 }, meta: base })
    expect(derive([readyAnchor, legacyDone]).changedRefs).toEqual([])

    const lockedStale = nodeOf({
      id: 'n1',
      result: { id: 'r9', type: 'video', url: 'nomi-local://v.mp4', createdAt: 1 },
      meta: { ...base, refSnapshot: { 'n-hero': 'r0' }, frozen: { at: 2, by: 'user' } },
    })
    expect(derive([readyAnchor, lockedStale]).status).toBe('locked')
    expect(derive([readyAnchor, lockedStale]).changedRefs).toEqual([])
  })

  it('参考已变（首帧行）：锚边连在首帧图上 → diff 首帧图的快照', () => {
    const shot = shotOf({ keyframe: { enabled: true, prompt: '首帧' }, referenceBindings: heroBinding })
    const kfDone = nodeOf({
      id: 'n-kf', kind: 'image',
      result: { id: 'rk', type: 'image', url: 'nomi-local://k.png', createdAt: 1 },
      meta: { storyboardDesignId: DESIGN, shotId: 'shot-a', storyboardKeyframe: true, refSnapshot: { 'n-hero': 'r0' } },
    })
    const videoDone = nodeOf({
      id: 'n1',
      result: { id: 'r9', type: 'video', url: 'nomi-local://v.mp4', createdAt: 1 },
      meta: { storyboardDesignId: DESIGN, shotId: 'shot-a' },
    })
    expect(derive([readyAnchor, kfDone, videoDone], i2vMode, shot).changedRefs.map((anchor) => anchor.id)).toEqual(['hero'])
  })
})

describe('deriveStoryboardBatch（批量分桶 = footer 同一份）', () => {
  const rowOf = (status: (typeof SHOT_ROW_STATUSES)[number], _unused = false, shotId = 'shot-a'): StoryboardRowRuntime => ({
    shot: shotOf({ shotId }),
    mode: i2vMode,
    exec: {
      status,
      node: null,
      keyframeNode: null,
      recoverableNode: null,
      ignoredAnchors: [],
      missingSlots: [],
      plannedFirstFrame: null,
      changedRefs: [],
      resultUrl: null,
      progressPercent: null,
      progressMessage: null,
      errorMessage: null,
      locked: status === 'locked',
    },
  })

  it('ready/failed 进批；缺料/生成中/已锁各归各桶', () => {
    const view = deriveStoryboardBatch([
      rowOf('ready'), rowOf('failed'), rowOf('missing-required'),
      rowOf('generating'), rowOf('locked'), rowOf('done'),
    ])
    expect(view.runnable).toHaveLength(2)
    expect(view.excluded).toEqual({ missingRequired: 1, locked: 1, generating: 1, recoverable: 0, skipped: 0 })
    expect(view.doneCount).toBe(1)
    expect(view.countByStatus.ready).toBe(1)
  })

  /**
   * 批量走 `confirmAndRunPlan`：铸新的付费令牌 + 重新提交。可找回的行钱已经花过一次，
   * 进 runnable 就等于让「生成未生成的 N 镜」那一下把它再买一遍。
   */
  it('可找回的行不进 runnable，归 excluded.recoverable；真失败的行仍进 runnable', () => {
    const view = deriveStoryboardBatch([
      rowOf('recoverable', false, 'shot-a'),
      rowOf('failed', false, 'shot-b'),
    ])
    expect(view.runnable.map((row) => row.shot.shotId)).toEqual(['shot-b'])
    expect(view.excluded.recoverable).toBe(1)
    expect(view.countByStatus.recoverable).toBe(1)
    expect(view.countByStatus.failed).toBe(1)
  })

  /**
   * v6 §2.10「本次跳过」。合同 §9.3 写死：跳过必须进**这一份** derive，不许 footer 自己再减一次
   * ——两处各减一次正是"数字对不上"的经典成因。
   */
  it('本次跳过的行从 runnable 里摘出去、进 excluded.skipped，但不改「这镜做完没有」的计数', () => {
    const rows = [rowOf('ready', false, 'shot-a'), rowOf('ready', false, 'shot-b'), rowOf('failed', false, 'shot-c')]
    const view = deriveStoryboardBatch(rows, new Set(['shot-b']))
    expect(view.runnable.map((row) => row.shot.shotId)).toEqual(['shot-a', 'shot-c'])
    expect(view.excluded.skipped).toBe(1)
    // 跳过不是状态：ready 仍然是 2 个 ready。
    expect(view.countByStatus.ready).toBe(2)
  })

  it('跳过一个已生成的行不会把它从「已完成」里减掉（跳过说的是这一批跑不跑，不是做没做完）', () => {
    const view = deriveStoryboardBatch([rowOf('done', false, 'shot-a')], new Set(['shot-a']))
    expect(view.doneCount).toBe(1)
    expect(view.excluded.skipped).toBe(0)
  })
})

describe('deriveAnchorCardRuntimes（参考卡执行态 = 节点投影，B3）', () => {
  it('视觉锚按节点投影分态；文本锚恒文字卡；被引用数只数行上摆着的绑定', () => {
    const plan = planOf([shotOf({ referenceBindings: heroBinding }), shotOf({ index: 2, shotId: 'shot-b', referenceBindings: heroBinding }), shotOf({ index: 3, shotId: 'shot-c' })])
    const [heroCard, styleCard] = deriveAnchorCardRuntimes({ plan, designId: DESIGN, nodes: [] })
    expect(heroCard.visual).toBe(true)
    expect(heroCard.node).toBeNull()
    expect(heroCard.resultUrl).toBeNull()
    expect(heroCard.referencedByCount).toBe(2) // 第 3 镜只有 anchorIds，不算
    expect(styleCard.visual).toBe(false) // 文本锚不生成图
  })

  it('已生成未锁 → resultUrl + locked=false；锁定 → locked=true；生成中带进度', () => {
    const plan = planOf([shotOf()])
    const doneNode = nodeOf({
      id: 'n-hero',
      result: { id: 'r1', type: 'image', url: 'nomi-local://a.png', createdAt: 1 },
      meta: { storyboardDesignId: DESIGN, anchorId: 'hero', referenceSheet: true },
    })
    const [done] = deriveAnchorCardRuntimes({ plan, designId: DESIGN, nodes: [doneNode] })
    expect(done.resultUrl).toBe('nomi-local://a.png')
    expect(done.locked).toBe(false)

    const lockedNode = nodeOf({ ...doneNode, meta: { ...(doneNode.meta || {}), frozen: { at: 1, by: 'user' } } })
    const [locked] = deriveAnchorCardRuntimes({ plan, designId: DESIGN, nodes: [lockedNode] })
    expect(locked.locked).toBe(true)

    const runningNode = nodeOf({ id: 'n-hero', status: 'running', progress: { percent: 55, updatedAt: 1 }, meta: { storyboardDesignId: DESIGN, anchorId: 'hero', referenceSheet: true } })
    const [running] = deriveAnchorCardRuntimes({ plan, designId: DESIGN, nodes: [runningNode] })
    expect(running.generating).toBe(true)
    expect(running.progressPercent).toBe(55)
  })
})


it('an existing storyboard image is a reusable first frame, never a completed video', () => {
  const shot = shotOf({ shotKind: 'video', keyframe: { enabled: true, prompt: 'Opening' } })
  const image = nodeOf({ id: 'existing-image', kind: 'image', result: { id: 'image-result', type: 'image', url: 'nomi-local://frame.png', createdAt: 1 }, meta: { storyboardDesignId: DESIGN, shotId: shot.shotId } })
  expect(findShotNode([image], DESIGN, shot)).toBeNull()
  expect(findShotKeyframeNode([image], DESIGN, shot)?.id).toBe(image.id)
  const exec = deriveShotRowExec({ plan: planOf([shot]), shot, designId: DESIGN, nodes: [image], mode: firstFrameMode })
  expect(exec.status).toBe('ready')
  expect(exec.keyframeNode?.id).toBe(image.id)
  const next = storyboardShotToCreateNodesArgs(planOf([shot]), shot, { storyboardDesignId: DESIGN, materializationOperationId: 'storyboard:design', existingKeyframeNodeId: image.id })
  expect(next.nodes).toHaveLength(1)
  expect(next.nodes[0].kind).toBe('video')
  expect(next.nodes[0].metadata?.materializationClientId).not.toBe(shot.shotId)
  expect(next.edges).toEqual([{ sourceClientId: image.id, targetClientId: shot.shotId, mode: 'first_frame' }])
})
it('a previous video cannot satisfy an image row after switching output type', () => {
  const shot = shotOf({ shotKind: 'image' })
  const video = nodeOf({ id: 'old-video', kind: 'video', meta: { storyboardDesignId: DESIGN, shotId: shot.shotId } })
  expect(findShotNode([video], DESIGN, shot)).toBeNull()
})

it('a video node with an image payload cannot satisfy a video row', () => {
  const shot = shotOf({ shotKind: 'video', anchorIds: [] })
  const wrong = nodeOf({ id: 'wrong-video', kind: 'video', result: { id: 'wrong-output', type: 'image', url: 'nomi-local://frame.png', createdAt: 1 },
    meta: { storyboardDesignId: DESIGN, shotId: shot.shotId } })
  expect(deriveShotRowExec({ plan: planOf([shot]), shot, designId: DESIGN, nodes: [wrong], mode: t2vMode }).status).not.toBe('done')
})
