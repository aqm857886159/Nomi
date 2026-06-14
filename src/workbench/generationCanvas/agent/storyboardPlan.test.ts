import { describe, expect, it } from 'vitest'
import { buildAnchorSheetPrompt, parseStoryboardPlan, storyboardPlanToCreateNodesArgs, type StoryboardPlan } from './storyboardPlan'

const PLAN: StoryboardPlan = {
  title: '雨夜追凶',
  anchors: [
    { id: 'a-linxia', kind: 'character', name: '林夏', description: '齐肩黑发，红色校服', carrier: 'visual' },
    { id: 'a-roof', kind: 'scene', name: '天台', description: '夜晚水泥护栏，城市霓虹', carrier: 'visual' },
    { id: 'a-bag', kind: 'prop', name: '红书包', description: '深红双肩，星星挂饰', carrier: 'visual' },
    { id: 'a-style', kind: 'style', name: '全片风格', description: '冷色调、胶片颗粒', carrier: 'text', scope: 'all' },
  ],
  shots: [
    { index: 1, durationSec: 5, anchorIds: ['a-linxia', 'a-roof', 'a-style'], prompt: '林夏倚护栏远望，镜头缓推' },
    { index: 2, durationSec: 8, anchorIds: ['a-linxia', 'a-bag'], prompt: '林夏背起书包向楼梯走，跟拍' },
  ],
}

describe('storyboardPlanToCreateNodesArgs', () => {
  it('视觉锚 → 卡片节点（clientId=anchor.id），文本锚不建节点', () => {
    const { nodes } = storyboardPlanToCreateNodesArgs(PLAN)
    const anchorNodes = nodes.filter((n) => n.clientId.startsWith('a-'))
    expect(anchorNodes.map((n) => [n.clientId, n.kind, n.title])).toEqual([
      ['a-linxia', 'character', '林夏'],
      ['a-roof', 'scene', '天台'],
      ['a-bag', 'image', '红书包'], // 道具无专用节点种类 → image（通用参考图），防 registry 查不到崩
    ]) // a-style(文本锚)不在
  })

  it('定妆卡提示词：角色含身份锁+多视图+变体行（变体来自 anchor.variants）', () => {
    const p = buildAnchorSheetPrompt({
      id: 'a', kind: 'character', name: '林夏', description: '齐肩黑发，红校服', carrier: 'visual', variants: ['成年', '童年'],
    })
    expect(p).toContain('角色定妆参考卡')
    expect(p).toContain('林夏')
    expect(p).toContain('齐肩黑发')
    expect(p).toContain('正面全身 A-Pose')
    expect(p).toContain('变体行：成年、童年')
  })

  it('场景卡提示词：含多角度（远景/近景/俯视），无变体则不出变体行', () => {
    const p = buildAnchorSheetPrompt({ id: 's', kind: 'scene', name: '天台', description: '夜晚霓虹', carrier: 'visual' })
    expect(p).toContain('场景参考卡')
    expect(p).toContain('远景 establishing')
    expect(p).not.toContain('变体行')
  })

  it('视觉锚落画布用定妆卡提示词 + 锁 GPT Image 2（defaultImageModelKey 注入）', () => {
    const { nodes } = storyboardPlanToCreateNodesArgs(PLAN, { defaultImageModelKey: 'gpt-image-2', defaultImageModeId: 'default' })
    const linxia = nodes.find((n) => n.clientId === 'a-linxia')
    expect(linxia?.modelKey).toBe('gpt-image-2')
    expect(linxia?.prompt).toContain('角色定妆参考卡')
    // 文本锚（风格）仍不建节点
    expect(nodes.some((n) => n.clientId === 'a-style')).toBe(false)
  })

  it('整批落「分镜」分类（用户拍板 A：角色/场景/镜头落在一起，参考边同屏可连）', () => {
    expect(storyboardPlanToCreateNodesArgs(PLAN).groupCategoryId).toBe('shots')
  })

  it('镜头乱序吐出 → 按 shot.index 排序后建节点（审计 A5：钉死数组序=镜序）', () => {
    const shuffled: StoryboardPlan = {
      ...PLAN,
      shots: [
        { index: 3, durationSec: 4, anchorIds: [], prompt: '镜三' },
        { index: 1, durationSec: 5, anchorIds: [], prompt: '镜一' },
        { index: 2, durationSec: 6, anchorIds: [], prompt: '镜二' },
      ],
    }
    const { nodes } = storyboardPlanToCreateNodesArgs(shuffled)
    const shotNodes = nodes.filter((n) => n.clientId.startsWith('shot-'))
    expect(shotNodes.map((n) => n.title)).toEqual(['镜头 1', '镜头 2', '镜头 3'])
  })

  it('镜头 → image 节点（用户拍板 image-first），无 duration params，默认图片模型可注入', () => {
    const { nodes } = storyboardPlanToCreateNodesArgs(PLAN, {
      defaultImageModelKey: 'gpt-image-2',
      defaultImageModeId: 't2i',
      defaultImageRefModeId: 'i2i',
    })
    const shotNodes = nodes.filter((n) => n.clientId.startsWith('shot-'))
    expect(shotNodes).toHaveLength(2)
    // 镜1/镜2 都引用定妆卡（有参考入边）→ 图生图模式 i2i；image 节点不带 duration params。
    expect(shotNodes[0]).toMatchObject({ clientId: 'shot-1', kind: 'image', title: '镜头 1', modelKey: 'gpt-image-2', modeId: 'i2i' })
    expect(shotNodes[0].params).toBeUndefined()
    expect(shotNodes[1]).toMatchObject({ clientId: 'shot-2', kind: 'image', modeId: 'i2i' })
    expect(shotNodes[1].params).toBeUndefined()
  })

  it('逐节点选模式：有参考入边（定妆卡/前镜）用图生图，无入边的首镜用文生图（GPT Image 2 i2i 槽 min:1）', () => {
    const plan: StoryboardPlan = {
      title: 't',
      anchors: [],
      shots: [
        { index: 1, durationSec: 5, anchorIds: [], prompt: '镜一' }, // 首镜无锚无前镜 → 文生图 t2i
        { index: 2, durationSec: 5, anchorIds: [], prompt: '镜二' }, // 有前镜入边 → 图生图 i2i
      ],
    }
    const { nodes } = storyboardPlanToCreateNodesArgs(plan, { defaultImageModeId: 't2i', defaultImageRefModeId: 'i2i' })
    const shots = nodes.filter((n) => n.clientId.startsWith('shot-'))
    expect(shots[0].modeId).toBe('t2i') // 首镜无入边 → 纯文生
    expect(shots[1].modeId).toBe('i2i') // 第二镜有 shot→shot 入边 → 图生图
  })

  it('文本锚描述拼进引用它的镜头 prompt（不建边）', () => {
    const { nodes } = storyboardPlanToCreateNodesArgs(PLAN)
    const shot1 = nodes.find((n) => n.clientId === 'shot-1')!
    expect(shot1.prompt).toContain('林夏倚护栏远望，镜头缓推')
    expect(shot1.prompt).toContain('全片风格：冷色调、胶片颗粒') // style 文本锚拼入
    const shot2 = nodes.find((n) => n.clientId === 'shot-2')!
    expect(shot2.prompt).toBe('林夏背起书包向楼梯走，跟拍') // 镜2 没引用 style → prompt 不变
  })

  it('定妆卡 → 镜头参考边（角色 character_ref / 场景 style_ref / 道具 reference）+ shot→shot 时序链', () => {
    const { edges } = storyboardPlanToCreateNodesArgs(PLAN)
    expect(edges).toEqual([
      { sourceClientId: 'a-linxia', targetClientId: 'shot-1', mode: 'character_ref' },
      { sourceClientId: 'a-roof', targetClientId: 'shot-1', mode: 'style_ref' },
      // a-style 是文本锚 → 不连边（拼进 prompt 了）
      { sourceClientId: 'a-linxia', targetClientId: 'shot-2', mode: 'character_ref' },
      { sourceClientId: 'a-bag', targetClientId: 'shot-2', mode: 'reference' },
      // 顺序叙事默认连 shot→shot 时序链（用户拍板 2026-06-15）
      { sourceClientId: 'shot-1', targetClientId: 'shot-2', mode: 'reference' },
    ])
  })

  it('引用了不存在的锚 id → 忽略，不崩不连', () => {
    const plan: StoryboardPlan = {
      title: 't',
      anchors: [{ id: 'a1', kind: 'character', name: 'A', description: 'd', carrier: 'visual' }],
      shots: [{ index: 1, durationSec: 5, anchorIds: ['a1', 'ghost'], prompt: 'p' }],
    }
    const { edges } = storyboardPlanToCreateNodesArgs(plan)
    expect(edges).toEqual([{ sourceClientId: 'a1', targetClientId: 'shot-1', mode: 'character_ref' }])
  })

  it('产出的节点种类都是画布支持的（结构保证：防 prop/style 等非节点种类漏进去崩 defaultSize）', () => {
    // 画布 registry 支持的种类（src/workbench/generationCanvas/nodes/registry.ts）。
    const VALID_NODE_KINDS = new Set(['text', 'character', 'scene', 'image', 'keyframe', 'video', 'shot', 'output', 'panorama', 'scene3d'])
    const { nodes } = storyboardPlanToCreateNodesArgs(PLAN)
    for (const node of nodes) expect(VALID_NODE_KINDS.has(node.kind)).toBe(true)
  })

  it('summary 取 title，空 title 兜底', () => {
    expect(storyboardPlanToCreateNodesArgs(PLAN).summary).toBe('雨夜追凶')
    expect(storyboardPlanToCreateNodesArgs({ title: '  ', anchors: [], shots: [] }).summary).toBe('分镜方案')
  })
})

describe('parseStoryboardPlan（落库前运行时守卫）', () => {
  it('合法方案对象原样解析', () => {
    expect(parseStoryboardPlan(PLAN)).toEqual(PLAN)
  })

  it('锚类型非法 → throw（畸形对象不入 store）', () => {
    const bad = { ...PLAN, anchors: [{ ...PLAN.anchors[0], kind: 'monster' }] }
    expect(() => parseStoryboardPlan(bad)).toThrow()
  })

  it('缺必填字段（镜头无 prompt）→ throw', () => {
    const bad = { title: 't', anchors: [], shots: [{ index: 1, durationSec: 5, anchorIds: [] }] }
    expect(() => parseStoryboardPlan(bad)).toThrow()
  })
})
