import { describe, expect, it } from 'vitest'
import { buildAnchorSheetPrompt, effectiveShotDurationSec, storyboardPlanToCreateNodesArgs, type StoryboardPlan } from './storyboardPlan'
import { parseStoryboardPlan, storyboardPlanSchema } from './storyboardPlanSchema'
import { storyboardProfileForKey } from './storyboardProfiles'

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
    expect(p).toContain('Character reference sheet')
    expect(p).toContain('林夏')
    expect(p).toContain('齐肩黑发')
    expect(p).toContain('full-body front A-pose')
    expect(p).toContain('Variants: 成年, 童年')
  })

  it('场景卡提示词：含多角度（远景/近景/俯视），无变体则不出变体行', () => {
    const p = buildAnchorSheetPrompt({ id: 's', kind: 'scene', name: '天台', description: '夜晚霓虹', carrier: 'visual' })
    expect(p).toContain('Environment reference sheet')
    expect(p).toContain('distant establishing view')
    expect(p).not.toContain('Variants:')
  })

  it('视觉锚落画布用定妆卡提示词 + 锁 GPT Image 2（defaultImageModelKey 注入）', () => {
    const { nodes } = storyboardPlanToCreateNodesArgs(PLAN, { defaultImageModelKey: 'gpt-image-2', defaultImageModeId: 'default' })
    const linxia = nodes.find((n) => n.clientId === 'a-linxia')
    expect(linxia?.modelKey).toBe('gpt-image-2')
    expect(linxia?.prompt).toContain('Character reference sheet')
    // 文本锚（风格）仍不建节点
    expect(nodes.some((n) => n.clientId === 'a-style')).toBe(false)
  })

  it('整批落「分镜」分类（用户拍板 A：角色/场景/镜头落在一起，参考边同屏可连）', () => {
    expect(storyboardPlanToCreateNodesArgs(PLAN).groupCategoryId).toBe('shots')
  })

  it('落画布节点保留原稿和分镜设计来源', () => {
    const { nodes } = storyboardPlanToCreateNodesArgs(PLAN, {
      creationDocumentId: 'doc-a',
      storyboardDesignId: 'storyboard-b',
    })
    expect(nodes).not.toHaveLength(0)
    expect(nodes.every((node) => (
      node.metadata?.creationDocumentId === 'doc-a'
      && node.metadata?.storyboardDesignId === 'storyboard-b'
    ))).toBe(true)
  })

  // ⚠️ 现状固化，不是「期望行为」：2026-08-18 修「批量选不了供应商」时实查到的缺口。
  // 画布框选那条链已经能把 vendor 一路写进节点；分镜这条**不能**——PlanShot 只有 modelKey，
  // 没有 vendor 字段，storyboardPlanToCreateNodesArgs 自然也传不出去。落地时 buildPlannedNodeMeta
  // 用 entryByKey.get(modelKey) 反查厂商，而 buildAgentModelEntries 按 modelKey 首次出现去重
  // （见 availableModels.ts 的 seen 集合）→ 同一 modelKey 多家可用时**首家胜出**，与用户所选无关。
  // 这条测试就是那个缺口的记录：等 PlanShot/PlanCreatedNode 补上 vendor 字段时，改这条即可。
  it('厂商在 plan→canvas 落地路径上被丢弃：PlanShot 存不下 vendor，节点参数里也没有', () => {
    const plan: StoryboardPlan = {
      ...PLAN,
      shots: [{ index: 1, durationSec: 5, anchorIds: [], prompt: '镜一', modelKey: 'nano-banana' }],
    }
    const { nodes } = storyboardPlanToCreateNodesArgs(plan)
    const shot = nodes.find((n) => n.prompt === '镜一')

    // 用户选的模型确实传下去了……
    expect(shot?.modelKey).toBe('nano-banana')
    // ……但「哪一家」没有：PlanCreatedNode 上根本不存在 vendor 槽（多家可用时落地取目录首家）。
    expect(shot).not.toHaveProperty('vendor')
    expect(Object.keys(shot ?? {})).not.toContain('modelVendor')
  })

  it('anchorCount = 视觉锚数（落画布布局据此分「参考行 / 镜头网格」）', () => {
    const { nodes, anchorCount } = storyboardPlanToCreateNodesArgs(PLAN)
    // PLAN：3 视觉锚（角色/场景/道具）+ 2 镜头；文本锚（风格）不建节点
    expect(anchorCount).toBe(3)
    // 前 anchorCount 个是锚、其后是镜头（标题「镜头 N」）——布局角色边界的契约
    expect(nodes.slice(0, anchorCount).every((n) => !n.title.startsWith('镜头'))).toBe(true)
    expect(nodes.slice(anchorCount).every((n) => n.title.startsWith('镜头'))).toBe(true)
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

  it('镜头 → video 节点（用户拍板 B-clean），duration 写进 params，默认视频模型可注入', () => {
    const { nodes } = storyboardPlanToCreateNodesArgs(PLAN, {
      defaultImageModelKey: 'gpt-image-2',
      defaultVideoModelKey: 'seedance-2',
      defaultVideoModeId: 'i2v',
    })
    const shotNodes = nodes.filter((n) => n.clientId.startsWith('shot-'))
    expect(shotNodes).toHaveLength(2)
    // 镜头是视频节点；时长写进 duration 参数（落画布按所选模型控件钳值）。
    expect(shotNodes[0]).toMatchObject({ clientId: 'shot-1', kind: 'video', title: '镜头 1', modelKey: 'seedance-2', modeId: 'i2v' })
    expect(shotNodes[0].params).toEqual({ duration: 5 })
    expect(shotNodes[1]).toMatchObject({ clientId: 'shot-2', kind: 'video', modelKey: 'seedance-2', params: { duration: 8 } })
  })

  it('用户为某镜选了模型 → 用所选模型，且不套默认模型的 modeId（防张冠李戴，由下游按所选模型取默认模式）', () => {
    const plan: StoryboardPlan = {
      title: 't',
      anchors: [],
      shots: [
        { index: 1, durationSec: 5, anchorIds: [], prompt: '镜一', modelKey: 'kling-3', modeId: 'kling-i2v' }, // 用户选了模型+模式
        { index: 2, durationSec: 5, anchorIds: [], prompt: '镜二', modelKey: 'kling-3' }, // 选了模型没指定模式
        { index: 3, durationSec: 5, anchorIds: [], prompt: '镜三' }, // 没选 → 默认
      ],
    }
    const { nodes } = storyboardPlanToCreateNodesArgs(plan, { defaultVideoModelKey: 'seedance-2', defaultVideoModeId: 'seedance-i2v' })
    const shots = nodes.filter((n) => n.clientId.startsWith('shot-'))
    expect(shots[0]).toMatchObject({ modelKey: 'kling-3', modeId: 'kling-i2v' })
    expect(shots[1].modelKey).toBe('kling-3')
    expect(shots[1].modeId).toBeUndefined() // 选了别的模型却没指定模式 → 不套默认模型的 modeId
    expect(shots[2]).toMatchObject({ modelKey: 'seedance-2', modeId: 'seedance-i2v' }) // 没选 → 默认模型+默认模式
  })

  it('未指定模型且调用方没有 Nomi 默认值 → 保持未选择，不擅自套测试最低价模型', () => {
    const plan: StoryboardPlan = {
      title: '用户目标',
      anchors: [],
      shots: [{ index: 1, durationSec: 5, anchorIds: [], prompt: '镜一', shotKind: 'video' }],
    }
    const { nodes } = storyboardPlanToCreateNodesArgs(plan)
    expect(nodes[0]).not.toHaveProperty('modelKey')
    expect(nodes[0]).not.toHaveProperty('modeId')
  })

  it('文本锚描述拼进引用它的镜头 prompt（不建边）', () => {
    const { nodes } = storyboardPlanToCreateNodesArgs(PLAN)
    const shot1 = nodes.find((n) => n.clientId === 'shot-1')!
    expect(shot1.prompt).toContain('林夏倚护栏远望，镜头缓推')
    expect(shot1.prompt).toContain('全片风格：冷色调、胶片颗粒') // style 文本锚拼入
    const shot2 = nodes.find((n) => n.clientId === 'shot-2')!
    expect(shot2.prompt).toBe('林夏背起书包向楼梯走，跟拍') // 镜2 没引用 style → prompt 不变
  })

  it('定妆卡 → 镜头参考边（角色 character_ref / 场景 style_ref / 道具 reference）；B-clean 不连 shot→shot 链', () => {
    const { edges } = storyboardPlanToCreateNodesArgs(PLAN)
    expect(edges).toEqual([
      { sourceClientId: 'a-linxia', targetClientId: 'shot-1', mode: 'character_ref', order: 0 },
      { sourceClientId: 'a-roof', targetClientId: 'shot-1', mode: 'style_ref', order: 1 },
      // a-style 是文本锚 → 不连边（拼进 prompt 了）
      { sourceClientId: 'a-linxia', targetClientId: 'shot-2', mode: 'character_ref', order: 0 },
      { sourceClientId: 'a-bag', targetClientId: 'shot-2', mode: 'reference', order: 1 },
      // B-clean：不再连 shot→shot 时序链（视频→视频会落到未实现的首帧接力；连贯靠共享定妆卡参考）
    ])
  })

  it('引用了不存在的锚 id → 忽略，不崩不连', () => {
    const plan: StoryboardPlan = {
      title: 't',
      anchors: [{ id: 'a1', kind: 'character', name: 'A', description: 'd', carrier: 'visual' }],
      shots: [{ index: 1, durationSec: 5, anchorIds: ['a1', 'ghost'], prompt: 'p' }],
    }
    const { edges } = storyboardPlanToCreateNodesArgs(plan)
    expect(edges).toEqual([{ sourceClientId: 'a1', targetClientId: 'shot-1', mode: 'character_ref', order: 0 }])
  })

  it('@ 顺序重排参考边；无来源节点的上传/素材库引用落到既有数组 metadata', () => {
    const first = 'https://cdn.example/first.png'
    const second = 'https://cdn.example/second.png'
    const plan: StoryboardPlan = {
      title: '外部参考',
      anchors: [
        { id: 'first', kind: 'prop', name: '第一张', description: '', carrier: 'visual', referenceUrl: first, referenceKind: 'image' },
        { id: 'second', kind: 'prop', name: '第二张', description: '', carrier: 'visual', referenceUrl: second, referenceKind: 'image', referenceSourceNodeId: 'canvas-node' },
      ],
      shots: [{ index: 1, durationSec: 5, anchorIds: ['first', 'second'], prompt: `先 @[asset:${encodeURIComponent(second)}] 再 @[asset:${encodeURIComponent(first)}]` }],
    }
    const { edges, nodes } = storyboardPlanToCreateNodesArgs(plan)
    expect(edges).toEqual([{ sourceClientId: 'canvas-node', targetClientId: 'shot-1', mode: 'reference', order: 0 }])
    expect(nodes.find((node) => node.clientId === 'shot-1')?.metadata?.referenceImageUrls).toEqual([first])
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

describe('图片分镜（shotKind=image，用户拍板 2026-07-02 image-first）', () => {
  const IMAGE_PLAN: StoryboardPlan = {
    title: '小说配图',
    anchors: [
      { id: 'a-ye', kind: 'character', name: '叶林', description: '十七岁少年，苍白清秀', carrier: 'visual' },
      { id: 'a-market', kind: 'scene', name: '地下黑市', description: '潮湿地下通道，霓虹冷光', carrier: 'visual' },
    ],
    shots: [
      { index: 1, shotKind: 'image', durationSec: 0, anchorIds: ['a-ye', 'a-market'], prompt: '叶林站在黑市入口，远景三分构图' },
      { index: 2, shotKind: 'video', durationSec: 6, anchorIds: ['a-ye'], prompt: '手持跟拍叶林走进手术室' },
    ],
  }

  it('图片镜头 → image 节点、无 duration、绑默认图片模型；视频镜头不受影响', () => {
    const { nodes } = storyboardPlanToCreateNodesArgs(IMAGE_PLAN, {
      defaultImageModelKey: 'img-model',
      defaultImageModeId: 'img-mode',
      defaultVideoModelKey: 'vid-model',
      defaultVideoModeId: 'vid-mode',
    })
    const shot1 = nodes.find((n) => n.clientId === 'shot-1')!
    expect(shot1.kind).toBe('image')
    expect(shot1.modelKey).toBe('img-model')
    expect(shot1.modeId).toBe('img-mode')
    expect(shot1.params?.duration).toBeUndefined()
    const shot2 = nodes.find((n) => n.clientId === 'shot-2')!
    expect(shot2.kind).toBe('video')
    expect(shot2.modelKey).toBe('vid-model')
    expect(shot2.params?.duration).toBe(6)
  })

  it('图片镜头仍连定妆卡参考边（锁身份），与视频镜头同语义', () => {
    const { edges } = storyboardPlanToCreateNodesArgs(IMAGE_PLAN)
    expect(edges).toContainEqual({ sourceClientId: 'a-ye', targetClientId: 'shot-1', mode: 'character_ref', order: 0 })
    expect(edges).toContainEqual({ sourceClientId: 'a-market', targetClientId: 'shot-1', mode: 'style_ref', order: 1 })
  })

  it('缺省 shotKind → 按 video 兜底（旧草稿兼容，行为不变）', () => {
    const { nodes } = storyboardPlanToCreateNodesArgs(PLAN, { defaultVideoModelKey: 'vid-model' })
    for (const n of nodes.filter((node) => node.clientId.startsWith('shot-'))) {
      expect(n.kind).toBe('video')
    }
  })

  it('parseStoryboardPlan 接受带 shotKind 的方案（schema 同步）', () => {
    expect(() => parseStoryboardPlan(IMAGE_PLAN)).not.toThrow()
  })
})

describe('ffDesc/lfDesc 静态首尾帧分解（W2 §4.1，对齐 ViMax ff_desc/lf_desc）', () => {
  const base = {
    title: '首尾帧分解',
    anchors: [{ id: 'a-hero', kind: 'character' as const, name: '主角', description: '黑风衣', carrier: 'visual' as const }],
  }
  const opts = {
    defaultImageModelKey: 'img-model', defaultImageModeId: 'img-t2i', defaultImageRefModeId: 'img-i2i',
    defaultVideoModelKey: 'vid-model', defaultVideoModeId: 'vid-i2v',
  }

  it('有 ffDesc 无 keyframe.prompt → 首帧图用 ffDesc（不被镜头的运动词污染）', () => {
    const plan: StoryboardPlan = {
      ...base,
      shots: [{
        index: 1, shotKind: 'video', durationSec: 6, anchorIds: ['a-hero'],
        ffDesc: '中近景静态：主角坐在电脑前，冷蓝屏幕光照亮侧脸',
        prompt: '镜头缓慢推近，他抬手点击连接', // 运动描述——不该当首帧图提示词
        keyframe: { enabled: true },
      }],
    }
    const { nodes } = storyboardPlanToCreateNodesArgs(plan, opts)
    const kf = nodes.find((n) => n.clientId === 'shot-1-keyframe')
    expect(kf?.prompt).toContain('中近景静态')
    expect(kf?.prompt).not.toContain('缓慢推近') // ★首帧不吃运动词
  })

  it('keyframe.prompt（用户手改）优先级高于 ffDesc', () => {
    const plan: StoryboardPlan = {
      ...base,
      shots: [{
        index: 1, shotKind: 'video', durationSec: 6, anchorIds: ['a-hero'],
        ffDesc: 'planner 给的首帧', prompt: '运动',
        keyframe: { enabled: true, prompt: '用户手改的首帧' },
      }],
    }
    const { nodes } = storyboardPlanToCreateNodesArgs(plan, opts)
    expect(nodes.find((n) => n.clientId === 'shot-1-keyframe')?.prompt).toContain('用户手改的首帧')
  })

  it('两者都没有 → 退回 shot.prompt（今天的行为，零退化）', () => {
    const plan: StoryboardPlan = {
      ...base,
      shots: [{ index: 1, shotKind: 'video', durationSec: 6, anchorIds: ['a-hero'], prompt: '镜头推进', keyframe: { enabled: true } }],
    }
    const { nodes } = storyboardPlanToCreateNodesArgs(plan, opts)
    expect(nodes.find((n) => n.clientId === 'shot-1-keyframe')?.prompt).toContain('镜头推进')
  })

  it('zod：ffDesc/lfDesc 是可选字符串，带上能过校验、不带也能过（旧草稿不破）', () => {
    const withDesc = storyboardPlanSchema.safeParse({
      title: 't', anchors: [], shots: [{ index: 1, durationSec: 5, anchorIds: [], prompt: 'p', ffDesc: '首帧', lfDesc: '尾帧' }],
    })
    expect(withDesc.success).toBe(true)
    const without = storyboardPlanSchema.safeParse({
      title: 't', anchors: [], shots: [{ index: 1, durationSec: 5, anchorIds: [], prompt: 'p' }],
    })
    expect(without.success).toBe(true)
  })
})

describe('图片+视频分镜（video shot + keyframe.enabled）', () => {
  const IMAGE_VIDEO_PLAN: StoryboardPlan = {
    title: '首帧驱动视频',
    anchors: [
      { id: 'a-hero', kind: 'character', name: '主角', description: '黑色风衣，疲惫神情', carrier: 'visual' },
      { id: 'a-room', kind: 'scene', name: '书房', description: '夜间书房，电脑冷光', carrier: 'visual' },
      { id: 'a-style', kind: 'style', name: '全片风格', description: '低饱和电影感', carrier: 'text', scope: 'all' },
    ],
    shots: [
      {
        index: 1,
        shotKind: 'video',
        durationSec: 6,
        anchorIds: ['a-hero', 'a-room', 'a-style'],
        keyframe: {
          enabled: true,
          prompt: '主角坐在电脑前，冷蓝屏幕光照亮侧脸，中近景静态构图',
          params: { aspect_ratio: '16:9' },
        },
        prompt: '镜头从电脑屏幕缓慢推近主角侧脸，他抬手点击连接',
      },
      {
        index: 2,
        shotKind: 'video',
        durationSec: 6,
        anchorIds: ['a-hero', 'a-style'],
        keyframe: { enabled: true, prompt: '主角眼眶湿润的面部特写，背景全黑' },
        prompt: '固定近景，主角喉结微动，眼神从克制到崩溃',
      },
    ],
  }

  it('每个逻辑 video shot 派生首帧 image + video，并用 first_frame 串起来', () => {
    const { nodes, edges, anchorCount } = storyboardPlanToCreateNodesArgs(IMAGE_VIDEO_PLAN, {
      defaultImageModelKey: 'img-model',
      defaultImageModeId: 'img-t2i',
      defaultImageRefModeId: 'img-i2i',
      defaultVideoModelKey: 'vid-model',
      defaultVideoModeId: 'vid-i2v',
    })
    expect(anchorCount).toBe(2)
    const created = nodes.slice(anchorCount)
    expect(created.map((node) => [node.clientId, node.kind, node.title])).toEqual([
      ['shot-1-keyframe', 'image', '镜头 1 首帧'],
      ['shot-1', 'video', '镜头 1'],
      ['shot-2-keyframe', 'image', '镜头 2 首帧'],
      ['shot-2', 'video', '镜头 2'],
    ])
    expect(nodes.find((node) => node.clientId === 'shot-1-keyframe')).toMatchObject({
      modelKey: 'img-model',
      modeId: 'img-i2i',
      params: { aspect_ratio: '16:9' },
    })
    expect(nodes.find((node) => node.clientId === 'shot-1')).toMatchObject({
      modelKey: 'vid-model',
      modeId: 'vid-i2v',
      params: { duration: 6 },
    })
    expect(edges).toEqual([
      { sourceClientId: 'a-hero', targetClientId: 'shot-1-keyframe', mode: 'character_ref', order: 0 },
      { sourceClientId: 'a-room', targetClientId: 'shot-1-keyframe', mode: 'style_ref', order: 1 },
      { sourceClientId: 'shot-1-keyframe', targetClientId: 'shot-1', mode: 'first_frame' },
      { sourceClientId: 'a-hero', targetClientId: 'shot-2-keyframe', mode: 'character_ref', order: 0 },
      { sourceClientId: 'shot-2-keyframe', targetClientId: 'shot-2', mode: 'first_frame' },
  ])
  })

  it('文本锚同时拼进首帧 prompt 和视频 prompt', () => {
    const { nodes } = storyboardPlanToCreateNodesArgs(IMAGE_VIDEO_PLAN)
    expect(nodes.find((node) => node.clientId === 'shot-1-keyframe')?.prompt).toContain('全片风格：低饱和电影感')
    expect(nodes.find((node) => node.clientId === 'shot-1')?.prompt).toContain('全片风格：低饱和电影感')
  })

  it('首帧图带 storyboardKeyframe 身份标记（不占镜号，落地后共用所属视频镜号）；视频不带', () => {
    const { nodes } = storyboardPlanToCreateNodesArgs(IMAGE_VIDEO_PLAN)
    expect(nodes.find((node) => node.clientId === 'shot-1-keyframe')?.storyboardKeyframe).toBe(true)
    expect(nodes.find((node) => node.clientId === 'shot-1')?.storyboardKeyframe).toBeUndefined()
  })

  it('parseStoryboardPlan 接受 keyframe 字段', () => {
    expect(() => parseStoryboardPlan(IMAGE_VIDEO_PLAN)).not.toThrow()
  })

  it('parseStoryboardPlan 兼容合法的 shots 字符串化数组', () => {
    const parsed = parseStoryboardPlan({ ...IMAGE_VIDEO_PLAN, shots: JSON.stringify(IMAGE_VIDEO_PLAN.shots) })
    expect(parsed.shots).toHaveLength(2)
    expect(parsed.shots[0].keyframe?.enabled).toBe(true)
  })

  it('parseStoryboardPlan 拒绝残缺的 shots 字符串，避免猜修坏方案', () => {
    expect(() =>
      parseStoryboardPlan({
        ...IMAGE_VIDEO_PLAN,
        shots: '[{"index":1,"shotKind":"video","durationSec":6,"anchorIds":[],"prompt":"p","keyframe":{"enabled":true,"prompt":"k"}}',
      }),
    ).toThrow()
  })
})

describe('参考卡身份标记（referenceSheet，防占镜号）', () => {
  it('所有视觉锚节点带 referenceSheet:true；镜头节点不带', () => {
    const { nodes } = storyboardPlanToCreateNodesArgs(PLAN)
    for (const n of nodes.filter((node) => node.clientId.startsWith('a-'))) {
      expect(n.referenceSheet).toBe(true)
    }
    for (const n of nodes.filter((node) => node.clientId.startsWith('shot-'))) {
      expect(n.referenceSheet).toBeUndefined()
    }
  })
})

describe('W2 圣经字段（static/dynamic 落 meta + 卡片 prompt 分区）', () => {
  const BIBLE_PLAN: StoryboardPlan = {
    title: '圣经计划',
    anchors: [
      {
        id: 'a-hero',
        kind: 'character',
        name: '林夏',
        description: '齐肩黑发，红色校服',
        staticFeatures: '鹅蛋脸、左眉一颗痣、单眼皮、身高约 165',
        dynamicFeatures: '红色校服 / 雨夜披深蓝雨衣',
        carrier: 'visual',
      },
    ],
    shots: [{ index: 1, durationSec: 5, anchorIds: ['a-hero'], prompt: '林夏倚护栏远望' }],
  }

  it('static/dynamic 落进锚节点顶层字段（→ applyCanvasToolCall 透传 node.meta）', () => {
    const { nodes } = storyboardPlanToCreateNodesArgs(BIBLE_PLAN)
    const hero = nodes.find((n) => n.clientId === 'a-hero')!
    expect(hero.staticFeatures).toBe('鹅蛋脸、左眉一颗痣、单眼皮、身高约 165')
    expect(hero.dynamicFeatures).toBe('红色校服 / 雨夜披深蓝雨衣')
  })

  it('无 static/dynamic 的锚不带这些字段（旧草稿向后兼容，不凭空塞空串）', () => {
    const { nodes } = storyboardPlanToCreateNodesArgs(PLAN)
    const hero = nodes.find((n) => n.clientId === 'a-linxia')!
    expect(hero).not.toHaveProperty('staticFeatures')
    expect(hero).not.toHaveProperty('dynamicFeatures')
  })

  it('buildAnchorSheetPrompt 有 static/dynamic 时用「身份特征/服装与状态」分区（身份先锁、可变层另起）', () => {
    const p = buildAnchorSheetPrompt(BIBLE_PLAN.anchors[0])
    expect(p).toContain('身份特征（跨镜保持一致）：鹅蛋脸、左眉一颗痣')
    expect(p).toContain('服装与状态：红色校服 / 雨夜披深蓝雨衣')
    // 仍是角色定妆卡骨架（多视图/身份锁没丢）。
    expect(p).toContain('Character reference sheet')
    expect(p).toContain('full-body front A-pose')
  })

  it('buildAnchorSheetPrompt 无 static/dynamic 时退化到 description（旧行为不变）', () => {
    const p = buildAnchorSheetPrompt({ id: 'a', kind: 'character', name: '林夏', description: '齐肩黑发，红校服', carrier: 'visual' })
    expect(p).toContain('齐肩黑发')
    expect(p).not.toContain('身份特征（跨镜保持一致）')
  })

  it('parseStoryboardPlan 接受带 static/dynamic 的方案（schema 同步）', () => {
    expect(() => parseStoryboardPlan(BIBLE_PLAN)).not.toThrow()
    expect(parseStoryboardPlan(BIBLE_PLAN).anchors[0].staticFeatures).toBe('鹅蛋脸、左眉一颗痣、单眼皮、身高约 165')
  })
})

// 定妆卡的身份文字下发给镜头（2026-09-02 实测后加，见 anchorPromptBits 注释里的 0/4 vs 3/4）。
describe('视觉锚的身份特征拼进镜头 prompt', () => {
  const planWithBible = {
    title: '身份下发',
    anchors: [
      {
        id: 'a-maren', kind: 'character' as const, name: 'Maren', description: '灯塔看守人的女儿',
        carrier: 'visual' as const,
        staticFeatures: '12 岁女孩、鹅蛋脸、灰蓝色杏眼、左眉尾一道浅疤',
        dynamicFeatures: '黄色油布外套、深蓝裙、黑胶靴',
      },
      { id: 'a-noBible', kind: 'prop' as const, name: '火柴盒', description: '黄铜防水火柴盒', carrier: 'visual' as const },
    ],
    shots: [
      { index: 1, durationSec: 5, anchorIds: ['a-maren'], prompt: '她在灯塔廊道划亮火柴，脸部特写', ffDesc: '静态首帧：火柴刚亮' },
      { index: 2, durationSec: 5, anchorIds: ['a-noBible'], prompt: '火柴盒静物' },
    ],
  }

  const shotPromptOf = (index: number): string => {
    const { nodes } = storyboardPlanToCreateNodesArgs(parseStoryboardPlan(planWithBible))
    return nodes.filter((n) => n.clientId.startsWith('shot-'))[index]?.prompt ?? ''
  }

  it('身份 DNA（staticFeatures）拼进引用它的镜头', () => {
    const prompt = shotPromptOf(0)
    expect(prompt).toContain('她在灯塔廊道划亮火柴，脸部特写')
    expect(prompt).toContain('12 岁女孩、鹅蛋脸、灰蓝色杏眼、左眉尾一道浅疤')
  })

  // 这条是本次最容易被后人「顺手也拼上」的一条，拼了就会跟画面打架：卡上写着穿黄油布外套，
  // 而这一镜她可能刚从水里爬出来。static=跨镜不变的身份，dynamic=跨镜本来就该变的服装状态。
  it('服装与状态（dynamicFeatures）**不**拼进镜头', () => {
    const prompt = shotPromptOf(0)
    expect(prompt).not.toContain('黄色油布外套')
    expect(prompt).not.toContain('黑胶靴')
  })

  // 首帧节点只在「视频镜头 + keyframe.enabled」时才建（storyboardPlan.ts:541）。
  // 第一版这条测试没开 enabled，于是一个首帧节点都没匹配到、for 循环零次迭代**空转通过**——
  // 先断言「确实建出了首帧节点」（阳性对照），再断言它的内容，否则这条测试永远绿。
  it('首帧提示词同样拿到身份 DNA（视频镜头的首帧图也得是同一个人）', () => {
    const videoPlan = {
      ...planWithBible,
      shots: [{
        index: 1, durationSec: 5, anchorIds: ['a-maren'], shotKind: 'video' as const,
        prompt: '她划亮火柴，镜头缓推',
        keyframe: { enabled: true, prompt: '静态首帧：火柴刚亮' },
      }],
    }
    const { nodes } = storyboardPlanToCreateNodesArgs(parseStoryboardPlan(videoPlan))
    const keyframes = nodes.filter((n) => typeof n.prompt === 'string' && n.prompt.includes('静态首帧：火柴刚亮'))
    expect(keyframes.length, '没建出首帧节点——这条断言会空转，先修夹具再谈内容').toBeGreaterThan(0)
    for (const kf of keyframes) {
      expect(kf.prompt).toContain('12 岁女孩、鹅蛋脸、灰蓝色杏眼、左眉尾一道浅疤')
      expect(kf.prompt).not.toContain('黄色油布外套')
    }
  })

  it('没有身份 DNA 的视觉锚 → 镜头 prompt 一个字不变（旧方案向后兼容）', () => {
    expect(shotPromptOf(1)).toBe('火柴盒静物')
  })
})

describe('v5 IR 扩展（sceneId / scenes / profileKey / 图片镜停留时长）', () => {
  const V5_PLAN: StoryboardPlan = {
    title: '夜风',
    profileKey: 'genre.short-drama',
    scenes: [
      { id: 'scene-1', title: '天台 · 夜' },
      { id: 'scene-2', title: '天台 · 雨后' },
    ],
    anchors: [],
    shots: [
      { index: 1, sceneId: 'scene-1', shotKind: 'video', durationSec: 5, anchorIds: [], prompt: '远景缓推' },
      { index: 2, sceneId: 'scene-2', shotKind: 'image', durationSec: 0, anchorIds: [], prompt: '旧照定格' },
      { index: 3, sceneId: 'scene-2', shotKind: 'image', durationSec: 6, anchorIds: [], prompt: '空镜收尾' },
    ],
  }

  it('parseStoryboardPlan 接受并保留 sceneId/scenes/profileKey（schema 同步、不剥字段）', () => {
    const parsed = parseStoryboardPlan(V5_PLAN)
    expect(parsed.profileKey).toBe('genre.short-drama')
    expect(parsed.scenes).toEqual(V5_PLAN.scenes)
    expect(parsed.shots.map((s) => s.sceneId)).toEqual(['scene-1', 'scene-2', 'scene-2'])
  })

  it('全可选=向后兼容：旧 plan（无新字段）照常通过', () => {
    expect(() => parseStoryboardPlan(PLAN)).not.toThrow()
    const parsed = parseStoryboardPlan(PLAN)
    expect(parsed.scenes).toBeUndefined()
    expect(parsed.profileKey).toBeUndefined()
  })

  it('effectiveShotDurationSec：图片镜停留（0 → 默认 3、显式值原样）；视频镜原值', () => {
    expect(effectiveShotDurationSec(V5_PLAN.shots[1])).toBe(3)
    expect(effectiveShotDurationSec(V5_PLAN.shots[2])).toBe(6)
    expect(effectiveShotDurationSec(V5_PLAN.shots[0])).toBe(5)
  })

  it('落画布：图片镜把停留时长写进 metadata.imageDurationSec（只写入；视频镜不写）', () => {
    const { nodes } = storyboardPlanToCreateNodesArgs(V5_PLAN)
    const image1 = nodes.find((n) => n.clientId === 'shot-2')!
    expect(image1.metadata?.imageDurationSec).toBe(3) // 旧 planner 的 0 → 默认停留
    expect(image1.params?.duration).toBeUndefined() // 停留不是生成参数
    const image2 = nodes.find((n) => n.clientId === 'shot-3')!
    expect(image2.metadata?.imageDurationSec).toBe(6)
    const video = nodes.find((n) => n.clientId === 'shot-1')!
    expect(video.metadata).not.toHaveProperty('imageDurationSec')
    expect(video.params?.duration).toBe(5)
  })
})

describe('v5 C2 storyboard profiles', () => {
  it('内置短剧 profile 是 9:16 + 台词 + 骨架，自由 profile 无骨架', () => {
    const shortDrama = storyboardProfileForKey('genre.short-drama')
    expect(shortDrama).toMatchObject({ aspect: '9:16', dialogue: true })
    expect(shortDrama.promptSkeleton.map((segment) => segment.key)).toEqual(['shotSize', 'emotion'])
    expect(storyboardProfileForKey('genre.free-form')).toMatchObject({ aspect: '16:9', dialogue: false, promptSkeleton: [] })
  })

  it('storyboardProfile schema 与 promptSegments 可选且不剥除文本真相', () => {
    const profile = storyboardProfileForKey('genre.short-drama')
    const parsed = parseStoryboardPlan({
      title: 't',
      profileKey: 'genre.short-drama',
      storyboardProfile: profile,
      anchors: [],
      shots: [{ index: 1, durationSec: 5, anchorIds: [], prompt: '远景，雨夜', promptSegments: [{ key: 'shotSize', start: 0, end: 2 }] }],
    })
    expect(parsed.storyboardProfile).toEqual(profile)
    expect(parsed.shots[0].prompt).toBe('远景，雨夜')
  })
})
