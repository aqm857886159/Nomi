import { describe, it, expect } from 'vitest'
import { canRunGenerationNode } from './generationRunController'
import { MODEL_ARCHETYPES } from '../../../config/modelArchetypes'
import { SLOT_ACCEPTS } from '../agent/referenceEdgeCapability'
import { GENERATION_NODE_KINDS, getGenerationNodeExecutionKind } from '../model/generationNodeKinds'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'

// 回归：Seedance omni 视频节点放了参考数组就该「可生成」。修复前 canRunGenerationNode 只看
// 首/尾帧 + referenceImages，看不到 referenceImageUrls → omni 节点 ↑ 按钮被锁死、误提示「需要首帧」。

function videoNode(modeId: string, meta: Record<string, unknown> = {}): GenerationCanvasNode {
  return {
    id: 'v1', kind: 'video', title: 'v', position: { x: 0, y: 0 }, prompt: '',
    meta: { modelKey: 'seedance-2', archetype: { id: 'seedance-2', modeId }, ...meta },
  } as GenerationCanvasNode
}

describe('canRunGenerationNode — 视频节点参考判定', () => {
  it('omni 无任何参考 → 不可生成', () => {
    expect(canRunGenerationNode(videoNode('omni'), { nodes: [], edges: [] })).toBe(false)
  })
  it('omni 放了角色图数组 → 可生成（修复点）', () => {
    const node = videoNode('omni', { referenceImageUrls: ['https://cdn/c1.png'] })
    expect(canRunGenerationNode(node, { nodes: [node], edges: [] })).toBe(true)
  })
  it('omni 放了参考视频（nomi-local，传输前本地化）→ 可生成', () => {
    const node = videoNode('omni', { referenceVideoUrls: ['nomi-local://asset/p/v.mp4'] })
    expect(canRunGenerationNode(node, { nodes: [node], edges: [] })).toBe(true)
  })
  it('omni 只连了一段视频（画布边，非 meta 上传）→ 可生成（用户反馈 2026-08-20：↑ 按钮点不了）', () => {
    // 复现用户截图：素材库拖进来一段 mp4（kind='asset' + result.type='video'）连到 omni 镜头，
    // 提示词写好了，composer 也把它显示成已填的「参考视频」槽 —— 但 ↑ 按钮灰着点不动。
    const source = {
      id: 's1', kind: 'asset', title: 'v', position: { x: 0, y: 0 }, prompt: '',
      result: { id: 'r1', type: 'video', url: 'nomi-local://asset/p/clip.mp4' },
    } as unknown as GenerationCanvasNode
    const node = videoNode('omni')
    const edges = [{ id: 'e1', source: 's1', target: 'v1', mode: 'reference' } as never]
    expect(canRunGenerationNode(node, { nodes: [node, source], edges })).toBe(true)
  })
  it('首帧模式：有 firstFrameUrl → 可生成；空 → 不可', () => {
    expect(canRunGenerationNode(videoNode('first', { firstFrameUrl: 'https://cdn/f.png' }), { nodes: [], edges: [] })).toBe(true)
    expect(canRunGenerationNode(videoNode('first'), { nodes: [], edges: [] })).toBe(false)
  })
  it('image / text 节点（无档案上下文）始终可生成（prompt 缺失由下游兜底）', () => {
    expect(canRunGenerationNode({ kind: 'image' } as GenerationCanvasNode)).toBe(true)
    expect(canRunGenerationNode({ kind: 'text' } as GenerationCanvasNode)).toBe(true)
  })
  it('文生视频（t2v，模式无参考槽）无参考也可生成（修复：原 video 一律要首帧→锁死 t2v 按钮）', () => {
    // apimart Seedance t2v 模式 slots:[] → prompt-only 即可生成
    const node = {
      id: 'v1', kind: 'video', title: 'v', position: { x: 0, y: 0 }, prompt: '一只猫跳下沙发',
      meta: { modelKey: 'doubao-seedance-2.0', archetype: { id: 'seedance-2-apimart', modeId: 't2v' } },
    } as GenerationCanvasNode
    expect(canRunGenerationNode(node, { nodes: [node], edges: [] })).toBe(true)
  })
  it('RunningHub Seedance 默认 text 模式（slots:[]）无参考可生成（用户反馈：C-Dance 按钮点不了）', () => {
    const node = {
      id: 'v1', kind: 'video', title: 'v', position: { x: 0, y: 0 }, prompt: '一只猫跳下沙发',
      meta: { modelKey: 'bytedance/seedance-2.0-global', archetype: { id: 'runninghub-seedance', modeId: 'text' } },
    } as GenerationCanvasNode
    expect(canRunGenerationNode(node, { nodes: [node], edges: [] })).toBe(true)
  })

  // 回归（2026-08-24 用户反馈）：「Comfyui 我配置的文生视频工作流，但是提交必须输入图片才能发出」。
  // 死锁链：本判定原本「无档案 → 必须先有参考才放行」，而 ComfyUI 导入图**从不带档案**
  // （resolveTaskArchetype 对 comfy vendor 直接返回 null）→ 纯文生视频的图里没有图输入、UI 也不显示参考框，
  // 按钮却非要一张参考才亮 → 用户只能连张图去喂它 → runtime 又以「模型没有『图生视频』通道，参考图发不出去」
  // 拒发 → 两头堵死，这类工作流整个发不出去。判据改回「模型自己声明要什么」：无档案一律放行，
  // 由 runtime 的诚实闸兜底（与 image/audio 两支同口径）。
  it('ComfyUI 文生视频工作流（无档案）无参考也可生成', () => {
    const node = {
      id: 'v1', kind: 'video', title: 'v', position: { x: 0, y: 0 }, prompt: '日出前，面包师打开木质百叶窗',
      meta: { modelKey: 'h3-t2v', modelVendor: 'comfyui-local', vendor: 'comfyui-local' },
    } as GenerationCanvasNode
    expect(canRunGenerationNode(node, { nodes: [node], edges: [] })).toBe(true)
  })
  it('第 2+ 台 ComfyUI 实例（comfyui-local-xxx 前缀）同样放行，不能只保得住第一台', () => {
    const node = {
      id: 'v1', kind: 'video', title: 'v', position: { x: 0, y: 0 }, prompt: '一只猫跳下沙发',
      meta: { modelKey: 'h3-t2v', modelVendor: 'comfyui-local-rtx4090', vendor: 'comfyui-local-rtx4090' },
    } as GenerationCanvasNode
    expect(canRunGenerationNode(node, { nodes: [node], edges: [] })).toBe(true)
  })
  it('自定义接入的无档案视频模型同样放行（判据是「模型声明了什么」，不是「手上有没有参考」）', () => {
    const node = {
      id: 'v1', kind: 'video', title: 'v', position: { x: 0, y: 0 }, prompt: '一只猫跳下沙发',
      meta: { modelKey: 'some-custom-t2v', modelVendor: 'my-relay', vendor: 'my-relay' },
    } as GenerationCanvasNode
    expect(canRunGenerationNode(node, { nodes: [node], edges: [] })).toBe(true)
  })
})

// L3 护栏（2026-07-06）：图生图模式（image_edit + 有参考槽）零参考 → 不可生成，
// 对齐视频节点护栏；此前 image 恒 true，空参考的图生图被静默当纯文生发出去。
describe('canRunGenerationNode — 图像节点图生图参考判定', () => {
  function imageNode(modeId: string, meta: Record<string, unknown> = {}): GenerationCanvasNode {
    return {
      id: 'i1', kind: 'image', title: 'i', position: { x: 0, y: 0 }, prompt: '放在一起',
      meta: { modelKey: 'gpt-image-2', archetype: { id: 'gpt-image-2', modeId }, ...meta },
    } as GenerationCanvasNode
  }
  it('i2i（图生图）无任何参考 → 不可生成', () => {
    expect(canRunGenerationNode(imageNode('i2i'), { nodes: [], edges: [] })).toBe(false)
  })
  it('i2i 有 meta 上传参考（referenceImageUrls）→ 可生成', () => {
    const node = imageNode('i2i', { referenceImageUrls: ['https://cdn/a.png'] })
    expect(canRunGenerationNode(node, { nodes: [node], edges: [] })).toBe(true)
  })
  it('i2i 有连线参考（源已生成）→ 可生成', () => {
    const source = {
      id: 's1', kind: 'image', title: 's', position: { x: 0, y: 0 }, prompt: '',
      result: { id: 'r1', url: 'nomi-local://asset/p/dog.png' },
    } as unknown as GenerationCanvasNode
    const node = imageNode('i2i')
    expect(canRunGenerationNode(node, { nodes: [node, source], edges: [{ id: 'e1', source: 's1', target: 'i1', mode: 'reference' } as never] })).toBe(true)
  })
  it('t2i（文生图）无参考照旧可生成', () => {
    expect(canRunGenerationNode(imageNode('t2i'), { nodes: [], edges: [] })).toBe(true)
  })
})

// 结构保证（不变量）：把「t2v 按钮被锁死」从「修了这一处」升级成「整类不再复发」。
// 规则：video / model3d 节点的「可生成（空参考时）」必须 ⟺「当前模式无参考槽（slots:[]）」——
//   无参考槽 = 纯文生（t2v / 文生3D）= prompt-only 可生成；有参考槽 = 需先放参考。
// 走遍**所有** video + model3d 档案 × 所有模式，任何新档案/新模式若让 gate 与槽声明不一致（如给 t2v 模式留了
// 多余槽 → 误锁按钮；或给 i2v 模式漏了槽 → 空跑必失败），这里立刻红，不必等用户撞到灰按钮。
// 2026-09-02 起纳入 model3d（#320 J11 实证 3D 节点派发恒被挡——kind 边界漏 3D 的第二次同族发作，第一次=#286）。
// 注：故意按 slots 判定而非 transportTaskKind——HappyHorse 把所有模式都挂 text_to_video 做 kie 分流路由，
//   transportTaskKind 已被重载、不可信；slots 才是「这个模式吃不吃参考」的单一真相。
const SLOT_DECLARED_KINDS = ['video', 'model3d'] as const

describe('不变量：video / model3d 可生成判定 ⟺ 当前模式无参考槽（防 t2v / 文生3D 按钮锁死类复发）', () => {
  const slotDeclaredArchetypes = MODEL_ARCHETYPES.filter((a) => (SLOT_DECLARED_KINDS as readonly string[]).includes(a.kind))
  it('覆盖到了 video 档案（防 registry 改动后空跑）', () => {
    expect(slotDeclaredArchetypes.filter((a) => a.kind === 'video').length).toBeGreaterThan(5)
  })
  it('覆盖到了 model3d 档案（hunyuan3d / hitem3d / meshy6 / meshy-7）', () => {
    expect(slotDeclaredArchetypes.filter((a) => a.kind === 'model3d').length).toBeGreaterThanOrEqual(4)
  })
  for (const archetype of slotDeclaredArchetypes) {
    const nodeKind = archetype.kind
    for (const mode of archetype.modes || []) {
      const slotless = (mode.slots || []).length === 0
      it(`${archetype.id}/${mode.id}：空参考时可生成=${slotless}（slots=${(mode.slots || []).length}）`, () => {
        const node = {
          id: 'inv1', kind: nodeKind, title: 'v', position: { x: 0, y: 0 },
          prompt: slotless ? '一只猫跳下沙发' : '',
          meta: { modelKey: archetype.identifierPatterns?.[0] || archetype.id, archetype: { id: archetype.id, modeId: mode.id } },
        } as GenerationCanvasNode
        expect(canRunGenerationNode(node, { nodes: [node], edges: [] })).toBe(slotless)
      })
    }
  }
})

// 不变量 2（2026-08-20）：把「连线放了参考、按钮还是灰的」从「修了 omni 视频这一处」升级成「整类不再复发」。
// 规则：**有参考槽的模式，连一条该模式收得下的参考边，就必须可生成** —— 不管那条边送的是图还是视频，
// 也不管它落的是数组槽（image_ref/video_ref）还是首帧槽。
// 根因是判定与发送两套口径：发送侧按槽的 accept 去 referenceImages/referenceVideos/referenceAudios 取值，
// 判定侧只读 meta 手动上传 → 连线来的视频在发送侧看得见、判定侧看不见。现在两侧共用
// edgeListForArraySlotAccept，这里逐档案逐模式钉住，新档案/新槽种漏接当场红。
describe('不变量：有参考槽的模式，连一条它收得下的参考边就必须可生成（防「连了线按钮还是灰的」复发）', () => {
  const slotDeclaredArchetypes = MODEL_ARCHETYPES.filter((a) => (SLOT_DECLARED_KINDS as readonly string[]).includes(a.kind))
  for (const archetype of slotDeclaredArchetypes) {
    const nodeKind = archetype.kind
    for (const mode of archetype.modes || []) {
      const slots = mode.slots || []
      if (slots.length === 0) continue // 无槽 = t2v / 文生3D，由不变量 1 覆盖
      // 边只送得出 image / video（SLOT_ACCEPTS.audio_ref = []：今天没有音频源节点种类）。
      // **每种资产各测一条**，不能「模式收图就只喂图」——原 bug 正是「omni 收图也收视频，只连视频时点不动」：
      // 喂图那条恒绿，会把它盖过去。一次只放一条边 = 逐个槽单独验，漏接哪个槽哪条红。
      const kinds = (['image', 'video'] as const).filter((kind) =>
        slots.some((s) => SLOT_ACCEPTS[s.kind].includes(kind)),
      )
      if (kinds.length === 0) continue // 只有音频槽 → 边进不来，见下面的前提断言
      for (const assetType of kinds) {
      it(`${archetype.id}/${mode.id}：只连一条${assetType === 'image' ? '图片' : '视频'}参考边 → 可生成`, () => {
        const source = {
          id: 'src', kind: 'asset', title: 's', position: { x: 0, y: 0 }, prompt: '',
          result: { id: 'r', type: assetType, url: `nomi-local://asset/p/ref.${assetType === 'image' ? 'png' : 'mp4'}` },
        } as unknown as GenerationCanvasNode
        const node = {
          id: 'inv2', kind: nodeKind, title: 'v', position: { x: 0, y: 0 }, prompt: '一只猫跳下沙发',
          meta: { modelKey: archetype.identifierPatterns?.[0] || archetype.id, archetype: { id: archetype.id, modeId: mode.id } },
        } as GenerationCanvasNode
        const edges = [{ id: 'e', source: 'src', target: 'inv2', mode: 'reference' } as never]
        expect(canRunGenerationNode(node, { nodes: [node, source], edges })).toBe(true)
      })
      }
    }
  }
  it('前提仍成立：音频参考槽收不到画布边（有了音频源节点种类就来补上面的覆盖）', () => {
    expect(SLOT_ACCEPTS.audio_ref).toEqual([])
  })
})

// 不变量 3（2026-09-02，#320 缺口②）：**kind × 派发闸的穷举矩阵**。canRunGenerationNode 的兜底是
// `return false`——registry 每声明一个 executionKind，这里就必须有对应分支，否则该 kind 的生成钮
// 恒灰 + runner 抛「暂不支持」，而且当场看不出（编译绿、别的 kind 全好）。已两次同族发作：
// #286 漏 model3d → 参数底栏不渲染；#320 漏 model3d → 派发恒被挡。规则（与四条既有分支同口径）：
//   有 executionKind 的 kind：**无档案（archetype 缺失）时必须放行**——「要不要参考」是模型声明的属性，
//   由 runtime 诚实闸兜底拒发；无 executionKind 的 kind（asset 等素材/编辑器节点）：必须恒 false。
// 新 kind 一进 registry 自动进此矩阵，漏接分支当场红，不必等用户撞到死按钮。
describe('不变量：registry 穷举——每个 executionKind 都必须被派发闸认领（防「新 kind 漏分支」整族复发）', () => {
  it('registry 覆盖了全部五个能力面（image/text/audio/video/model3d）', () => {
    const execKinds = new Set(GENERATION_NODE_KINDS.map((k) => getGenerationNodeExecutionKind(k)).filter(Boolean))
    expect([...execKinds].sort()).toEqual(['audio', 'image', 'model3d', 'text', 'video'])
  })
  for (const kind of GENERATION_NODE_KINDS) {
    const exec = getGenerationNodeExecutionKind(kind)
    if (exec) {
      it(`${kind}（executionKind=${exec}）：无档案裸节点必须可派发`, () => {
        const node = {
          id: 'mx1', kind, title: 'n', position: { x: 0, y: 0 }, prompt: '一只猫',
          meta: { modelKey: 'some-custom-model', modelVendor: 'my-relay', vendor: 'my-relay' },
        } as GenerationCanvasNode
        expect(canRunGenerationNode(node, { nodes: [node], edges: [] })).toBe(true)
      })
    } else {
      it(`${kind}（无 executionKind）：必须恒不可派发`, () => {
        const node = { id: 'mx2', kind, title: 'n', position: { x: 0, y: 0 }, prompt: '' } as GenerationCanvasNode
        expect(canRunGenerationNode(node, { nodes: [node], edges: [] })).toBe(false)
      })
    }
  }
})
