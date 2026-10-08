import { encodeMention } from '../workbench/assets/promptMentions'
import {
  ART_LIN_WEI,
  ART_LIN_WEI_SIDE,
  ART_PENDING,
  ART_STORE_DAY,
  ART_STORE_NEON,
  ART_WATCH,
  ART_WATCH_CHAIN,
  ART_WATCH_SILVER,
  shotArt,
  type ArtRatio,
} from './listViewArt'

export type ListViewState = 'default' | 'selected' | 'generate' | 'deep-link' | 'canvas' | 'empty' | 'long' | 'junction'
export type ListViewLocale = 'zh' | 'en'
export type AnchorState = 'locked' | 'pending' | 'none'
export type ListCardKind = 'shot' | 'group-image' | 'director'
export type ShotStatus = 'ready' | 'generating' | 'failed' | 'skipped'
export type MediaKind = 'image' | 'video'

/** 可被引用的画布节点（视觉锚 + 画布上已出图的素材）。名字分中英两轨，同一份数据喂锚条、卡、检查器、提示词。 */
export type RefId = 'lin' | 'store' | 'look' | 'watch' | 'oldWatch' | 'chain' | 'storeDay' | 'linSide'
export type RefSource = {
  id: RefId
  nodeId: string
  zh: string
  en: string
  art: string
  /** 没有结果图 = 还不能被引用（等定妆）。 */
  ready: boolean
  anchor: boolean
  categoryId: 'cast' | 'scene' | 'prop'
}

export const REFS: Record<RefId, RefSource> = {
  lin: { id: 'lin', nodeId: 'ref-lin', zh: '林薇', en: 'Lin Wei', art: ART_LIN_WEI, ready: true, anchor: true, categoryId: 'cast' },
  store: { id: 'store', nodeId: 'ref-store', zh: '便利店霓虹', en: 'Store neon', art: ART_STORE_NEON, ready: true, anchor: true, categoryId: 'scene' },
  look: { id: 'look', nodeId: 'ref-look', zh: '雨夜妆造', en: 'Rain look', art: ART_PENDING, ready: false, anchor: true, categoryId: 'cast' },
  watch: { id: 'watch', nodeId: 'ref-watch', zh: '怀表', en: 'Watch', art: ART_WATCH, ready: true, anchor: false, categoryId: 'prop' },
  oldWatch: { id: 'oldWatch', nodeId: 'ref-old-watch', zh: '旧怀表', en: 'Old pocket watch', art: ART_WATCH_SILVER, ready: true, anchor: false, categoryId: 'prop' },
  chain: { id: 'chain', nodeId: 'ref-chain', zh: '怀表链', en: 'Watch chain', art: ART_WATCH_CHAIN, ready: true, anchor: false, categoryId: 'prop' },
  storeDay: { id: 'storeDay', nodeId: 'ref-store-day', zh: '便利店 · 白天', en: 'Store · day', art: ART_STORE_DAY, ready: true, anchor: false, categoryId: 'scene' },
  linSide: { id: 'linSide', nodeId: 'ref-lin-side', zh: '林薇 · 侧脸', en: 'Lin Wei · profile', art: ART_LIN_WEI_SIDE, ready: true, anchor: false, categoryId: 'cast' },
}

export const ANCHOR_IDS: RefId[] = ['lin', 'store', 'look']

export function refName(id: RefId, locale: ListViewLocale): string {
  return locale === 'en' ? REFS[id].en : REFS[id].zh
}

export type ListCard = {
  id: string
  kind: ListCardKind
  media: MediaKind
  title: string
  titleEn: string
  /** 带 @[asset:url] 标记的提示词（与产品落盘同一格式），由真 PromptEditor 渲染成 chip。 */
  prompt: string
  promptEn: string
  /** 提示词里引用了哪些（按出现顺序 = 参考边顺序 = chip 编号）。 */
  refs: RefId[]
  ratio: ArtRatio
  art: string
  status: ShotStatus
  model: string
  groupId: string
  groupLabel: string
  groupLabelEn: string
  anchor: RefId | null
  selected: boolean
  autoReference?: boolean
  connectionOn?: boolean
}

export type ListSection = {
  id: string
  title: string
  titleEn: string
  subtitle: string
  subtitleEn: string
  cards: ListCard[]
}

export const listCopy = {
  zh: {
    title: '画布 · 列表视图',
    subtitle: '同一份镜头，在画布和列表之间切换。',
    canvas: '画布',
    list: '列表',
    anchors: '视觉锚',
    locked: '已定妆',
    pending: '等定妆',
    filter: '只看：分镜 · 雨夜便利店',
    storyboard: '分镜 · 雨夜便利店',
    ungrouped: '未分组',
    director: '导演台',
    connectPrevious: '接上一镜',
    connect: '连接上一镜',
    autoRef: '自动引用',
    versions: '版本',
    openCanvas: '在画布里看',
    close: '收起检查器',
    noNodes: '暂无生成节点',
    backCanvas: '返回画布',
    canvasNodeHint: '在列表里看',
    longHint: '搜索镜头或节点',
    cardMenu: '卡片菜单',
    collapseGroup: '收起分组',
    image: '图片',
    video: '视频',
    done: '已生成',
    generating: '生成中',
    failed: '失败',
    skipped: '本次跳过',
    canvasNodes: '画布节点',
    moreView: '更多视图操作',
    generationCanvas: '生成画布',
    addNode: '添加节点',
  },
  en: {
    title: 'Canvas · list view',
    subtitle: 'The same shots, two ways to work: canvas or list.',
    canvas: 'Canvas',
    list: 'List',
    anchors: 'Visual anchors',
    locked: 'Styled',
    pending: 'Awaiting look',
    filter: 'Only: Storyboard · Rainy convenience store',
    storyboard: 'Storyboard · Rainy convenience store',
    ungrouped: 'Ungrouped',
    director: 'Director desk',
    connectPrevious: 'Use previous frame',
    connect: 'Connect previous',
    autoRef: 'Auto reference',
    versions: 'Versions',
    openCanvas: 'Open in canvas',
    close: 'Close inspector',
    noNodes: 'No generated nodes yet',
    backCanvas: 'Back to canvas',
    canvasNodeHint: 'View in list',
    longHint: 'Search shots or nodes',
    cardMenu: 'Card menu',
    collapseGroup: 'Collapse group',
    image: 'Image',
    video: 'Video',
    done: 'Generated',
    generating: 'Generating',
    failed: 'Failed',
    skipped: 'Skipped this run',
    canvasNodes: 'Canvas nodes',
    moreView: 'More view actions',
    generationCanvas: 'Generation canvas',
    addNode: 'Add node',
  },
} as const

export function statusLabel(status: ShotStatus, locale: ListViewLocale): string {
  const t = listCopy[locale]
  if (status === 'ready') return t.done
  if (status === 'generating') return t.generating
  if (status === 'failed') return t.failed
  return t.skipped
}

export function statusTone(status: ShotStatus): 'success' | 'info' | 'danger' | 'warning' {
  if (status === 'ready') return 'success'
  if (status === 'generating') return 'info'
  if (status === 'failed') return 'danger'
  return 'warning'
}

/**
 * 提示词模板：`{lin}` 这类占位在落盘串里展开成「名字 + @[asset:url]」——
 * 和产品里 insertAutoMentions 写出来的形状一致（名字留在句子里，chip 跟在名字后面）。
 */
const PROMPTS: Array<[string, string]> = [
  ['远景，雨后便利店门口，{lin}站在雨棚边，霓虹倒影慢慢推近', 'Wide shot, {lin} by the store awning after rain, neon reflections slowly push in'],
  ['近景，{lin}侧脸，水珠沿发梢滑下，{store}落在睫毛上', 'Close-up, {lin} in profile, droplets run from her hair, {store} caught in her lashes'],
  ['低机位，{watch}落在积水里，车灯从画面外扫过', 'Low angle, the {watch} lies in a puddle as headlights sweep across frame'],
  ['俯拍，{store}与湿漉漉的车道形成冷暖交错的几何线条', 'Top down, {store} glows over the wet lanes in a cool-warm pattern'],
  ['中景，{lin}转身看向后门，风衣下摆被风带起', 'Medium shot, {lin} turns toward the back door, coat hem lifted by wind'],
  ['特写，手指收紧{chain}，雨声盖过远处对白', 'Insert, fingers tighten around the {chain} while rain covers distant dialogue'],
]

const TOKEN_RE = /\{(lin|store|look|watch|oldWatch|chain|storeDay|linSide)\}/g

export function tokenRefs(template: string): RefId[] {
  const out: RefId[] = []
  for (const match of template.matchAll(TOKEN_RE)) {
    const id = match[1] as RefId
    if (!out.includes(id)) out.push(id)
  }
  return out
}

/** 展开占位。`bound` 里的引用写成「名字 + chip」，其余只留名字（= 用户手写、还没绑定的那种）。 */
export function expandPrompt(template: string, locale: ListViewLocale, bound: readonly RefId[] | 'all' = 'all'): string {
  return template.replace(TOKEN_RE, (_, id: RefId) => {
    const name = refName(id, locale)
    const isBound = bound === 'all' || bound.includes(id)
    if (isBound && REFS[id].ready) return `${name}${encodeMention(REFS[id].art)}`
    // 没绑定的就是句子里的普通词（英文小写，像人随手写的那样）。
    return locale === 'en' ? name.toLowerCase() : name
  })
}

const TONES = ['#384d67|#111827', '#704b45|#201312', '#5d526f|#1b1726', '#506a63|#162622', '#87613e|#2b1c12', '#476274|#121c26']
const RATIOS: ArtRatio[] = ['16:9', '9:16', '1:1', '16:9', '9:16', '1:1']
const STATUSES: ShotStatus[] = ['ready', 'generating', 'failed', 'skipped', 'ready', 'ready']
const MEDIA: MediaKind[] = ['video', 'video', 'image', 'video', 'image', 'video']
const SHOT_ANCHOR: Array<RefId | null> = ['lin', 'lin', 'watch', 'look', 'lin', 'chain']

function shotStatus(index: number, long: boolean): ShotStatus {
  if (!long) return STATUSES[index % 6]
  if (index === 1) return 'generating'
  if (index === 6) return 'failed'
  if (index === 12) return 'skipped'
  return 'ready'
}

function shotCard(index: number, long: boolean, selected: boolean): ListCard {
  const template = PROMPTS[index % PROMPTS.length]
  const no = String(index + 1).padStart(2, '0')
  const ratio = RATIOS[index % 6]
  const media = MEDIA[index % 6]
  return {
    id: `shot-${index + 1}`,
    kind: 'shot',
    media,
    title: `镜 ${no}`,
    titleEn: `Shot ${no}`,
    prompt: template[0],
    promptEn: template[1],
    refs: tokenRefs(template[0]),
    ratio,
    art: shotArt(index + 1, ratio, TONES[index % 6]),
    status: shotStatus(index, long),
    model: media === 'image' ? 'gpt-image-2' : 'seedance-2',
    groupId: 'storyboard',
    groupLabel: '分镜 · 雨夜便利店',
    groupLabelEn: 'Storyboard · Rainy convenience store',
    anchor: SHOT_ANCHOR[index % 6],
    selected,
    autoReference: index === 1,
    connectionOn: index === 3,
  }
}

function imageCard(id: string, index: number, groupId: string, groupLabel: string, groupLabelEn: string, title: [string, string], selected: boolean): ListCard {
  const template = PROMPTS[(index + 2) % PROMPTS.length]
  const ratio: ArtRatio = index % 2 === 0 ? '9:16' : '1:1'
  return {
    id,
    kind: 'group-image',
    media: 'image',
    title: title[0],
    titleEn: title[1],
    prompt: template[0],
    promptEn: template[1],
    refs: tokenRefs(template[0]),
    ratio,
    art: shotArt(index + 11, ratio, TONES[(index + 2) % 6]),
    status: 'ready',
    model: 'gpt-image-2',
    groupId,
    groupLabel,
    groupLabelEn,
    anchor: tokenRefs(template[0])[0] ?? null,
    selected,
    autoReference: index === 1,
  }
}

function directorCard(selected: boolean): ListCard {
  return {
    id: 'director-desk',
    kind: 'director',
    media: 'video',
    title: '导演台 · 预演',
    titleEn: 'Director desk · previz',
    prompt: '节奏预演、镜头串联与旁白草稿',
    promptEn: 'Pacing pass, shot assembly, and voiceover draft',
    refs: [],
    ratio: '16:9',
    art: '',
    status: 'ready',
    model: '',
    groupId: 'ungrouped',
    groupLabel: '未分组',
    groupLabelEn: 'Ungrouped',
    anchor: null,
    selected,
  }
}

export function createListSections(state: ListViewState): ListSection[] {
  // selected = 检查器开着的那张（卡描边高亮）；列表上没有多选。
  const selected = new Set(state === 'selected' ? ['shot-2'] : [])
  const long = state === 'long'
  const storyboard: ListSection = {
    id: 'storyboard',
    title: '分镜 · 雨夜便利店',
    titleEn: 'Storyboard · Rainy convenience store',
    subtitle: long ? '30 镜 · 混合画幅 · 镜号优先' : '6 镜 · 混合画幅 · 镜号优先',
    subtitleEn: long ? '30 shots · mixed ratios · ordered by shot number' : '6 shots · mixed ratios · ordered by shot number',
    cards: Array.from({ length: long ? 30 : 6 }, (_, index) => shotCard(index, long, selected.has(`shot-${index + 1}`))),
  }
  const posterCount = long ? 10 : 3
  const posters: ListSection = {
    id: 'poster-a',
    title: '画布分组 · 海报试稿',
    titleEn: 'Canvas group · Poster pass',
    subtitle: `${posterCount} 张 · 画布分组`,
    subtitleEn: `${posterCount} images · canvas group`,
    cards: Array.from({ length: posterCount }, (_, index) =>
      imageCard(
        `poster-a-${index + 1}`,
        index,
        'poster-a',
        '画布分组 · 海报试稿',
        'Canvas group · Poster pass',
        [`海报 ${String(index + 1).padStart(2, '0')}`, `Poster ${String(index + 1).padStart(2, '0')}`],
        selected.has(`poster-a-${index + 1}`),
      ),
    ),
  }
  const ungrouped: ListSection = {
    id: 'ungrouped',
    title: '未分组',
    titleEn: 'Ungrouped',
    subtitle: '2 张素材 · 1 张导演台',
    subtitleEn: '2 assets · 1 director desk',
    cards: [
      imageCard('ungrouped-1', 3, 'ungrouped', '未分组', 'Ungrouped', ['素材 01', 'Asset 01'], selected.has('ungrouped-1')),
      imageCard('ungrouped-2', 4, 'ungrouped', '未分组', 'Ungrouped', ['素材 02', 'Asset 02'], false),
      directorCard(selected.has('director-desk')),
    ],
  }
  if (state === 'deep-link') return [storyboard]
  if (long) return [storyboard, posters]
  return [storyboard, posters, ungrouped]
}
