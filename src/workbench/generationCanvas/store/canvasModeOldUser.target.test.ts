/**
 * 老项目画布升级——「目标行为」测试：按设计卡「生成方式按输入现算」的 ★1c / ★9 写。
 *
 * 规则（设计卡）：节点上存着的方式只是「来历不明的偏好」；当前输入它全都收得下、必需的格子也满足，才照用，否则按输入现算；
 * 没有任何输入就按文字生成；存盘原样不被改写（不迁移、不改盘）。
 *
 * 在今天的主线上这些格子有的已经对（对照节点、⑥b、⑦），有的还不对。不对的用 it.fails 登记（`KNOWN_RED`，写明第几刀转绿）：
 *   - 它们在今天必须是红的；哪天某一格意外变绿，it.fails 会让这条测试红，逼着改造那一刀把它从登记里拿掉（棘轮）。
 *   - 没有模块级状态，CI 重跑失败用例不会累加。
 * 刀次（设计卡「拆刀和先后」）：第 1 刀 = 渲染层现算（删加载收敛、连线升格 / 断线收回、界面纠偏写回、两道发送前拦截）。
 *   dc4「首尾帧停着 5 张」在 Agent / 分镜入口的源头由第 2 刀掐掉，但这份夹具是已经存盘的老数据，渲染层读的时候现算，第 1 刀就转绿。
 * 读方式的口在 canvasModeOldUser.testkit.ts（改造后换函数名只改那里）。
 */
import { describe, expect, it } from 'vitest'
import { loadFixture, openProject, readAfterNormalize, readNode } from '../../../../tests/fixtures/old-user-data/canvas/canvasModeOldUser.testkit'

type Want = { taskKind: string; canRun: boolean; sentArrayReferences: number }

/** 目标：按输入现算后每个节点发什么、钮可不可点。 */
const TARGET: Record<string, Want> = {
  'ctrl-image-t2i-no-image': { taskKind: 'text_to_image', canRun: true, sentArrayReferences: 0 },
  'ctrl-image-edit-with-image': { taskKind: 'image_edit', canRun: true, sentArrayReferences: 1 },
  'ctrl-video-t2v': { taskKind: 'text_to_video', canRun: true, sentArrayReferences: 0 },
  'ctrl-video-first-with-first-frame': { taskKind: 'image_to_video', canRun: true, sentArrayReferences: 0 },
  // ① 空视频点过「参考」：没有输入 → 按文字生成，钮可点（设计卡 ★9 ②）。
  'dc1-video-empty-reference-clicked': { taskKind: 'text_to_video', canRun: true, sentArrayReferences: 0 },
  // ② 带图复制粘贴出来的改图（没图）：按文字生成。
  'dc2-image-edit-pasted-alone': { taskKind: 'text_to_image', canRun: true, sentArrayReferences: 0 },
  // ③ 首尾帧首帧空着：按文字生成、钮可点（★4「没放首帧，这次按文字生成」）。
  'dc3-video-firstlast-first-frame-cleared': { taskKind: 'text_to_video', canRun: true, sentArrayReferences: 0 },
  // ④ 停在首尾帧的 5 张参考：来历不明的偏好放不下 5 张 → 按参考，5 张都发（★9 ③，flomo 009）。
  'dc4-video-firstlast-five-refs': { taskKind: 'image_to_video', canRun: true, sentArrayReferences: 5 },
  // ⑤ 存着文生、连着图：按参考（改图）发，图没被丢（★9 ④，07-28「男角色出女的」的反方向）。
  'dc5-image-t2i-with-image': { taskKind: 'image_edit', canRun: true, sentArrayReferences: 1 },
  // ⑥ Agent / 分镜写 edit、没参考：按文字生成。
  'dc6-agent-plan-image-edit-no-refs': { taskKind: 'text_to_image', canRun: true, sentArrayReferences: 0 },
  // ⑥b Agent 计划写了首尾帧、后来连进 1 张参考图：这个档案的首尾帧要首帧和尾帧都有（尾帧 min 1），1 张图满足不了
  // 偏好 → 按输入现算，参考类优先 → 全能参考，这张图按参考发（设计卡规则②；「连 1–2 张图 → 按参考发」）。
  // 底栏方式格显示的也是全能参考（显示的 = 发的）。早先写的「图进首帧格、照用」没核对尾帧必填，2026-11-12 改正。
  'dc6b-agent-plan-video-firstlast': { taskKind: 'image_to_video', canRun: true, sentArrayReferences: 1 },
  // ⑦ 声音转写没音频：转写必须先有音频（★4 情况 a，只能从输入开始）→ 灰钮不变，不是 bug。
  'dc7-audio-transcribe-no-audio': { taskKind: 'transcribe', canRun: false, sentArrayReferences: 0 },
  // ⑧ 3D 图生没图：混元 3D 有文生 → 按文字生成 3D，钮可点（★9 ②）。
  'dc8-model3d-image-no-image': { taskKind: 'text_to_3d', canRun: true, sentArrayReferences: 0 },
}

/**
 * 今天必红的格子 → 第几刀转绿。键 = 「节点 · 读路径」；A = 只过读取归一（没有加载收敛），B = 真实打开项目后。
 * B 路径上 dc1 / dc2 / dc6 今天碰巧对（加载收敛把存着的方式改回文生，见下一组「存盘原样」），所以只有 A 红。
 */
// 第 1 刀（渲染层现算）后全部转绿；之后谁让某格变红，就在这里登记并写明哪一刀修回。
const KNOWN_RED: Record<string, string> = {}

/** 存盘原样：打开项目后存盘读口里的 modeId 必须和 0.24.1 存的一字不差（不迁移、不改盘）。第 1 刀删了加载收敛，全部一字不差。 */
const KNOWN_RED_SAVE: Record<string, string> = {}

describe('老项目画布 · 目标（生成方式按输入现算；红的格子登记在 KNOWN_RED，注明第几刀转绿）', () => {
  const { canvas, scenarios } = loadFixture()

  it('目标：每个节点都有一条期望', () => {
    expect(Object.keys(TARGET).sort()).toEqual(scenarios.map((s) => s.key).sort())
  })

  for (const scenario of scenarios) {
    for (const path of ['A', 'B'] as const) {
      const key = `${scenario.key}|${path}`
      const knownRed = KNOWN_RED[key]
      const check = knownRed ? it.fails : it
      const label = path === 'A' ? '只过读取归一（读的时候现算，不靠加载收敛）' : '真实打开项目后'
      check(`目标 ${scenario.key} · ${label}：发 ${TARGET[scenario.key]!.taskKind}、钮${TARGET[scenario.key]!.canRun ? '可点' : '灰'}、数组参考发 ${TARGET[scenario.key]!.sentArrayReferences} 个${knownRed ? `（已知红，${knownRed}转绿）` : ''}`, () => {
        const { nodes, edges } = path === 'A' ? readAfterNormalize(canvas) : openProject(canvas)
        const got = readNode(nodes, edges, scenario.nodeId)
        expect({ taskKind: got.taskKind, canRun: got.canRun, sentArrayReferences: got.sentArrayReferences }).toEqual(TARGET[scenario.key])
      })
    }

    const saveRed = KNOWN_RED_SAVE[scenario.key]
    const checkSave = saveRed ? it.fails : it
    checkSave(`目标 ${scenario.key} · 打开项目后存盘读口里的方式和 0.24.1 存的一字不差${saveRed ? `（已知红，${saveRed}转绿）` : ''}`, () => {
      const { saved } = openProject(canvas)
      const before = canvas.nodes.find((n) => n.id === scenario.nodeId)!.meta?.archetype
      const after = saved.nodes.find((n) => n.id === scenario.nodeId)!.meta?.archetype
      expect(after).toEqual(before)
    })
  }
})
