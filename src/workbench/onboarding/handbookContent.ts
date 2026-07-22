/**
 * 新手上手手册的唯一内容源（纯数据 + 文案，无 React、无样式）。
 *
 * 两处出口共用这一份：
 *   ① App 内 `HandbookPanel.tsx`（React overlay，把 iconKey 映射成已登记的 tabler 组件）
 *   ② `scripts/build-handbook-html.mjs`（渲成独立 marketing/handbook.html，发群 + 挂官网）
 * 改文案只改这里，两处自动同步。iconKey = tabler 图标名去掉 `Icon` 前缀的 kebab（如 `pencil`）：
 * html 渲 `ti ti-<iconKey>`；React panel 用 HANDBOOK_ICON map（key→vendor 组件，都已登记，build 安全）。
 */

export type HandbookPipelineStep = { iconKey: string; label: string; accent?: boolean }
export type HandbookFirstWinStep = { n: number; title: string; body: string }
export type HandbookIntentRoute = {
  iconKey: string
  title: string
  body: string
  /** 标新能力（0.16）。 */
  badge?: string
  /** 缺口诚实标——渲成 warning 配色。 */
  warn?: boolean
}
export type HandbookGotcha = { iconKey: string; title: string; body: string }

/** 顶部一行流水线图：写故事 → 拆分镜 → 落画布 → 锁身份/运镜 → 时间轴 → 导出。 */
export const HANDBOOK_PIPELINE: HandbookPipelineStep[] = [
  { iconKey: 'pencil', label: '写故事' },
  { iconKey: 'scissors', label: 'AI 拆分镜' },
  { iconKey: 'layout-grid', label: '落画布' },
  { iconKey: 'wand', label: '锁身份/运镜' },
  { iconKey: 'timeline', label: '时间轴' },
  { iconKey: 'movie', label: '导出 MP4', accent: true },
]

/** 90 秒先尝甜头：不用读完手册，先看一条片自己跑出来。 */
export const HANDBOOK_FIRST_WIN: HandbookFirstWinStep[] = [
  { n: 1, title: '看回放', body: '首页点「60 秒看 Nomi 怎么出片」，零额度看整条流水线跑一遍。' },
  { n: 2, title: '接一个模型', body: '用自己的 Key，或接 Agnes 免费网关（文 / 图 / 视全解锁）。' },
  {
    n: 3,
    title: '写一句 + 拆镜',
    body: '在创作区写下故事，说「拆成镜头」——可选图片分镜（先定画面，满意再转视频）或视频分镜，一键铺成画布。',
  },
  { n: 4, title: '生成 + 导出', body: '点镜头卡的生成出图，排进时间轴，右上导出 MP4。' },
]

/** 「我想做 X → 走这条路」：能做的指清楚路径，做不到的当场标 ⚠️。 */
export const HANDBOOK_INTENT_ROUTES: HandbookIntentRoute[] = [
  {
    iconKey: 'user-check',
    title: '让同一个人每个镜头长一样',
    body: '用身份卡锁脸 → 连到每个镜头当参考。Nomi 的招牌能力。',
  },
  {
    iconKey: 'box',
    title: '控制谁站哪、朝哪',
    body: '用 3D 站位图摆一下 → AI 照着画。',
  },
  {
    iconKey: 'device-gamepad-2',
    title: '让角色走起来、做动作、要运镜',
    body: '游戏式 3D 操控：WASD 走位 + 动作库 + 摆相机，录一段 take 导出成参考视频喂生成。',
    badge: '0.16 新',
  },
  {
    iconKey: 'gift',
    title: '没有 API 额度，想先白嫖试试',
    body: '模型设置接 Agnes AI，一个 Key 解锁文本 / 图 / 视频，无限期免费。',
    badge: '0.16 新',
  },
  {
    iconKey: 'typography',
    title: '加字幕、标题卡',
    body: '进时间轴预览区，节奏你说了算。',
  },
  {
    iconKey: 'alert-triangle',
    title: '想要精确对口型 / 唇形同步',
    body: '暂不支持，这段先跳过——不藏不糊弄。',
    warn: true,
  },
]

/** 卡住了看这里：四个真实坑（都在反馈雷达 / changelog 里真出现过）。 */
export const HANDBOOK_GOTCHAS: HandbookGotcha[] = [
  {
    iconKey: 'plug-connected-x',
    title: '接了模型却不能生成',
    body: '多半缺「文本大脑」。模型设置里加一个文本模型，拆镜 / 对话才转得起来。',
  },
  {
    iconKey: 'mood-confuzed',
    title: '每个镜头脸都不一样',
    body: '把身份卡连到镜头当参考——没连，模型就分不清谁是谁。',
  },
  {
    iconKey: 'alert-circle',
    title: '模型「连了用不了」',
    body: '看报错提示：多半是账号档位（要会员 / 企业 Key / 网页授权），按提示开通即可。',
  },
  {
    iconKey: 'volume-off',
    title: '导出后没声音',
    body: '确认音频已在时间轴的音频轨上；最新版导出混音已修。',
  },
]

export const HANDBOOK_TITLE = 'Nomi 一页上手'
export const HANDBOOK_SUBTITLE = '本地优先的 AI 视频创作台 · 从一句话到一条成片'

const EN_HANDBOOK_PIPELINE: HandbookPipelineStep[] = [
  { iconKey: 'pencil', label: 'Write story' },
  { iconKey: 'scissors', label: 'AI splits shots' },
  { iconKey: 'layout-grid', label: 'Build canvas' },
  { iconKey: 'wand', label: 'Lock identity / camera' },
  { iconKey: 'timeline', label: 'Timeline' },
  { iconKey: 'movie', label: 'Export MP4', accent: true },
]

const EN_HANDBOOK_FIRST_WIN: HandbookFirstWinStep[] = [
  {
    n: 1,
    title: 'Watch the replay',
    body: 'From Home, open “See how Nomi makes a video in 60 seconds” to watch the whole workflow without spending credits.',
  },
  {
    n: 2,
    title: 'Connect one model',
    body: 'Use your own API key or connect the free Agnes gateway to unlock text, image, and video models.',
  },
  {
    n: 3,
    title: 'Write one line and split shots',
    body: 'Write a story in Creation and ask to “split into shots.” Choose image storyboards to lock visuals first or video storyboards to go directly to motion.',
  },
  {
    n: 4,
    title: 'Generate and export',
    body: 'Generate from the shot cards, arrange the results on the timeline, then export MP4 from the top right.',
  },
]

const EN_HANDBOOK_INTENT_ROUTES: HandbookIntentRoute[] = [
  {
    iconKey: 'user-check',
    title: 'Keep the same person consistent across shots',
    body: 'Use an identity card to lock the face, then connect it to every shot as a reference.',
  },
  {
    iconKey: 'box',
    title: 'Control where people stand and face',
    body: 'Create a 3D staging image and let the model follow that layout.',
  },
  {
    iconKey: 'device-gamepad-2',
    title: 'Move characters, direct actions, and add camera movement',
    body: 'Use game-style 3D controls: WASD movement, action presets, and camera placement. Record a take and use the resulting reference video for generation.',
    badge: 'New in 0.16',
  },
  {
    iconKey: 'gift',
    title: 'Try it without API credits',
    body: 'Connect Agnes AI in Model setup. One key unlocks text, image, and video models for free.',
    badge: 'New in 0.16',
  },
  {
    iconKey: 'typography',
    title: 'Add subtitles and title cards',
    body: 'Use the timeline preview workspace to control timing and presentation.',
  },
  {
    iconKey: 'alert-triangle',
    title: 'Need precise lip sync',
    body: 'Not supported yet. Skip this step for now—Nomi will not pretend otherwise.',
    warn: true,
  },
]

const EN_HANDBOOK_GOTCHAS: HandbookGotcha[] = [
  {
    iconKey: 'plug-connected-x',
    title: 'Models are connected but generation does not work',
    body: 'A text model is usually missing. Add one in Model setup so shot planning and chat can run.',
  },
  {
    iconKey: 'mood-confuzed',
    title: 'The face changes in every shot',
    body: 'Connect the identity card to each shot as a reference. Without it, the model cannot reliably identify the character.',
  },
  {
    iconKey: 'alert-circle',
    title: 'A connected model is unavailable',
    body: 'Read the error message. The provider may require a paid tier, enterprise key, or one-time web authorization.',
  },
  {
    iconKey: 'volume-off',
    title: 'The exported video has no sound',
    body: 'Make sure audio clips are placed on an audio track in the timeline.',
  },
]

export function handbookContentForLocale(locale: string) {
  if (locale !== 'en') {
    return {
      title: HANDBOOK_TITLE,
      subtitle: HANDBOOK_SUBTITLE,
      pipeline: HANDBOOK_PIPELINE,
      firstWin: HANDBOOK_FIRST_WIN,
      intentRoutes: HANDBOOK_INTENT_ROUTES,
      gotchas: HANDBOOK_GOTCHAS,
    }
  }
  return {
    title: 'Nomi quick-start guide',
    subtitle: 'A local-first AI video studio · From one sentence to a finished video',
    pipeline: EN_HANDBOOK_PIPELINE,
    firstWin: EN_HANDBOOK_FIRST_WIN,
    intentRoutes: EN_HANDBOOK_INTENT_ROUTES,
    gotchas: EN_HANDBOOK_GOTCHAS,
  }
}
