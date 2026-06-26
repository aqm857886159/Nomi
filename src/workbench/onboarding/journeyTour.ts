/**
 * 引导旅途的 beat 定义（纯数据，单一编排真相源）。
 *
 * 旅途 = 首页主动点「60 秒看 Nomi 怎么出片」后，用**预置数据回放**整条流水线：
 *   创作打字 → AI 拆分镜 → 落画布 → 画布工具(定妆/3D站位/运镜) → 预览字幕 → 导出。
 *
 * 节奏 = 半自动：`cinematic` beat 自动播（看的环节），`spotlight` beat 停下等用户点「下一步」
 * （讲工具的环节）。控制器（JourneyTourController）按这张表逐 beat 驱动，把 beat id 映射到
 * 具体副作用（切模式 / 打字 / 灌画布 / 聚光）。
 */
import type { WorkspaceMode } from '../workbenchStore'

export type TourBeatId =
  | 'write'
  | 'split'
  | 'canvas'
  | 'character'
  | 'staging'
  | 'trajectory'
  | 'generate'
  | 'captions'
  | 'export'

export type TourBeatKind = 'cinematic' | 'spotlight'

export type TourBeat = {
  id: TourBeatId
  /** 这一步落在哪个工作区；控制器在跑该 beat 前确保切到此模式。 */
  mode: WorkspaceMode
  kind: TourBeatKind
  /** 气泡标题。 */
  title: string
  /** 气泡一句话。 */
  body: string
  /**
   * spotlight 目标选择器（按序取第一个命中且可见的）；cinematic 不需要。
   * 画布节点目标用 `[data-tour-target="…"]`——demoProject 建节点时打这个标，稳过节点 id。
   */
  selectors?: string[]
}

export const TOUR_BEATS: TourBeat[] = [
  {
    id: 'write',
    mode: 'creation',
    kind: 'cinematic',
    title: '① 一切从你的一句话开始',
    body: '在创作区写下你的故事，AI 一个字一个字陪你码。',
  },
  {
    id: 'split',
    mode: 'creation',
    kind: 'cinematic',
    title: '② AI 把故事拆成镜头',
    body: '跨镜的人物、场景一致项也帮你锁好。',
  },
  {
    id: 'canvas',
    mode: 'generation',
    kind: 'cinematic',
    title: '③ 一键铺成画布',
    body: '每个镜头一张卡，全在你眼皮底下。',
  },
  {
    id: 'character',
    mode: 'generation',
    kind: 'spotlight',
    title: '同一个人，每镜长一样',
    body: '靠这张身份卡锁住脸——小孩和小机器人每个镜头都不串。',
    selectors: ['[data-tour-target="character"]', '.generation-canvas-v2-node'],
  },
  {
    id: 'staging',
    mode: 'generation',
    kind: 'spotlight',
    title: '谁站哪、朝哪',
    body: '用 3D 摆一下站位，AI 照着画——比如屋顶上两个并排坐。',
    selectors: ['[data-tour-target="staging"]', '.generation-canvas-v2-node'],
  },
  {
    id: 'trajectory',
    mode: 'generation',
    kind: 'spotlight',
    title: '想要推拉摇移',
    body: '画一条相机轨迹，AI 复刻这个运镜——比如夕阳下缓缓拉远。',
    selectors: ['[data-tour-target="trajectory"]', '.generation-canvas-v2-node'],
  },
  {
    id: 'generate',
    mode: 'generation',
    kind: 'spotlight',
    title: '这就是出好的成片',
    body: '示例已生成好——你自己用时，点每张卡的生成按钮出你的版本。',
    selectors: [
      '[data-tour-target="character"] [aria-label="生成素材"]',
      '.generation-canvas-v2-node [aria-label="生成素材"]',
      '[data-tour-target="character"]',
    ],
  },
  {
    id: 'captions',
    mode: 'preview',
    kind: 'spotlight',
    title: '排进时间轴',
    body: '给镜头加字幕、标题卡，节奏你说了算。',
    selectors: ['[data-tour-target="captions"]', '[aria-label="添加字幕"]', '[aria-label="文字"]'],
  },
  {
    id: 'export',
    mode: 'preview',
    kind: 'spotlight',
    title: '成片拿走',
    body: '一键导出 MP4，整条流水线就此走完。',
    selectors: ['.workbench-preview-player__export-button', '.nomi-appbar__primary'],
  },
]

/** spotlight（讲解）步数，用于气泡进度标「讲解 n/N」。 */
export const TOUR_TEACH_TOTAL = TOUR_BEATS.filter((b) => b.kind === 'spotlight').length
