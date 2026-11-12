/**
 * 老项目画布升级——「今天的行为」特征测试（全绿，照实断言，错的行为也照实记）。
 *
 * 夹具是 0.24.1 真实存盘写出来的 13 个生成节点（来历见 tests/fixtures/old-user-data/canvas/canvasModeOldUser.testkit.ts）。每个节点读两条路径：
 *   A「只过读取归一」：节点原样，没有加载收敛；
 *   B「真实打开项目」：restoreSnapshot（含 convergeStuckInputModes）之后 store 里的那份——创作者真正看到、真正发出去的。
 * 断言的是：存着的方式 / 此刻按哪个方式发 / 发出去的任务种类 / 生成钮可不可点 / 数组类参考真正发出几个。
 * 这些是现状；「生成方式按输入现算」改造会让其中一部分变掉，变掉的格子在目标测试里（canvasModeOldUser.target.test.ts）有对应条目，
 * 改造那一刀要同时改这里的期望（改一格就是一条可审的差异，不是悄悄变）。
 */
import { describe, expect, it } from 'vitest'
import { loadFixture, openProject, readAfterNormalize, readNode, type ModeRead } from '../../../../tests/fixtures/old-user-data/canvas/canvasModeOldUser.testkit'

const read = (storedModeId: string, effectiveModeId: string, taskKind: string, canRun: boolean, sentArrayReferences = 0): ModeRead => ({
  storedModeId, effectiveModeId, taskKind, canRun, sentArrayReferences,
})

/** 每个节点：[A 只过归一, B 真实打开项目后]。 */
const TODAY: Record<string, [ModeRead, ModeRead]> = {
  'ctrl-image-t2i-no-image': [read('t2i', 't2i', 'text_to_image', true), read('t2i', 't2i', 'text_to_image', true)],
  'ctrl-image-edit-with-image': [read('edit', 'edit', 'image_edit', true, 1), read('edit', 'edit', 'image_edit', true, 1)],
  'ctrl-video-t2v': [read('t2v', 't2v', 'text_to_video', true), read('t2v', 't2v', 'text_to_video', true)],
  'ctrl-video-first-with-first-frame': [read('first', 'first', 'image_to_video', true), read('first', 'first', 'image_to_video', true)],
  // ① 空视频点过「参考」：不加载收敛时钮灰着；打开项目时加载收敛把存着的方式悄悄改回文生，钮才亮。
  'dc1-video-empty-reference-clicked': [read('omni', 'omni', 'image_to_video', false), read('t2v', 't2v', 'text_to_video', true)],
  // ② 带图复制粘贴出来的改图节点（没有边）：同上。
  'dc2-image-edit-pasted-alone': [read('edit', 'edit', 'image_edit', false), read('t2i', 't2i', 'text_to_image', true)],
  // ③ 首尾帧首帧被清空：加载收敛专门跳过首帧类方式，打开后照样停在首尾帧、钮灰着（现状的洞）。
  'dc3-video-firstlast-first-frame-cleared': [read('firstlast', 'firstlast', 'image_to_video', false), read('firstlast', 'firstlast', 'image_to_video', false)],
  // ④ 首尾帧方式连着 5 张参考：停在首尾帧，数组类参考一张都不发（发的是首尾两格，其余 3 张没用到）。
  'dc4-video-firstlast-five-refs': [read('firstlast', 'firstlast', 'image_to_video', true, 0), read('firstlast', 'firstlast', 'image_to_video', true, 0)],
  // ⑤ 文生图却连着一张图：按文生发，连着的图没有被发出去（0 张）。
  'dc5-image-t2i-with-image': [read('t2i', 't2i', 'text_to_image', true, 0), read('t2i', 't2i', 'text_to_image', true, 0)],
  // ⑥ Agent / 分镜计划写的改图、没参考：同 ②。
  'dc6-agent-plan-image-edit-no-refs': [read('edit', 'edit', 'image_edit', false), read('t2i', 't2i', 'text_to_image', true)],
  // ⑥b Agent 写首尾帧、随后连了 1 张参考：停在首尾帧，钮亮，参考落在首帧格（不在数组里）。
  'dc6b-agent-plan-video-firstlast': [read('firstlast', 'firstlast', 'image_to_video', true), read('firstlast', 'firstlast', 'image_to_video', true)],
  // ⑦ 声音转写没音频：钮灰（转写必须先有音频）。
  'dc7-audio-transcribe-no-audio': [read('transcribe', 'transcribe', 'transcribe', false), read('transcribe', 'transcribe', 'transcribe', false)],
  // ⑧ 3D 图生没图：钮灰；混元 3D 其实有文生 3D 方式，但存着图生就停在图生。
  'dc8-model3d-image-no-image': [read('image', 'image', 'image_to_3d', false), read('image', 'image', 'image_to_3d', false)],
}

describe('老项目画布 · 现状（0.24.1 存盘在今天的主线上怎么读）', () => {
  const { canvas, scenarios } = loadFixture()

  it('现状：夹具里 13 个节点都有一条期望，没有多也没有少', () => {
    expect(Object.keys(TODAY).sort()).toEqual(scenarios.map((s) => s.key).sort())
  })

  describe.each(scenarios.map((s) => [s.key, s] as const))('%s', (key, scenario) => {
    it('现状 A：只过读取归一，节点按存着的方式读', () => {
      const { nodes, edges } = readAfterNormalize(canvas)
      expect(readNode(nodes, edges, scenario.nodeId)).toEqual(TODAY[key]![0])
    })
    it('现状 B：真实打开项目（含加载收敛）后，创作者看到、发出去的是这样', () => {
      const { nodes, edges } = openProject(canvas)
      expect(readNode(nodes, edges, scenario.nodeId)).toEqual(TODAY[key]![1])
    })
  })

  it('现状：0.24.1 自己读这些节点读出来的，和今天主线「只过归一」读出来的方式 / 任务种类 / 钮状态一致（今天没改读法）', () => {
    const { v0241Reads } = loadFixture()
    const { nodes, edges } = readAfterNormalize(canvas)
    for (const s of scenarios) {
      const now = readNode(nodes, edges, s.nodeId)
      const then = v0241Reads[s.key]!
      expect({ key: s.key, mode: now.effectiveModeId, kind: now.taskKind, canRun: now.canRun })
        .toEqual({ key: s.key, mode: then.readModeId, kind: then.taskKind, canRun: then.canRun })
    }
  })

  it('现状：打开项目时加载收敛把 3 个节点存着的方式改成了文生，而且存盘读口（下次自动保存写的那份）跟着改了', () => {
    const { saved } = openProject(canvas)
    const changed = scenarios
      .map((s) => {
        const before = (canvas.nodes.find((n) => n.id === s.nodeId)!.meta?.archetype as { modeId?: string }).modeId
        const after = ((saved.nodes.find((n) => n.id === s.nodeId)!.meta?.archetype ?? {}) as { modeId?: string }).modeId
        return before === after ? null : `${s.key}: ${before} -> ${after}`
      })
      .filter(Boolean)
    expect(changed).toEqual([
      'dc1-video-empty-reference-clicked: omni -> t2v',
      'dc2-image-edit-pasted-alone: edit -> t2i',
      'dc6-agent-plan-image-edit-no-refs: edit -> t2i',
    ])
  })

  it('现状：打开项目不增删节点和连线', () => {
    const { nodes, edges } = openProject(canvas)
    expect(nodes.map((n) => n.id).sort()).toEqual(canvas.nodes.map((n) => n.id).sort())
    expect(edges.map((e) => e.id).sort()).toEqual(canvas.edges.map((e) => e.id).sort())
  })
})
