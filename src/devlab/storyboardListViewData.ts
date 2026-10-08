import { createShots, type Shot } from './storyboardLayoutExploreData'

export type ListViewState = 'default' | 'selected' | 'batch' | 'deep-link' | 'canvas' | 'empty' | 'long'
export type ListViewLocale = 'zh' | 'en'
export type AnchorState = 'locked' | 'pending' | 'none'
export type ListCardKind = 'shot' | 'group-image' | 'director'

export type ListCard = {
  id: string
  kind: ListCardKind
  title: string
  titleEn: string
  prompt: string
  promptEn: string
  ratio: Shot['ratio']
  shot?: Shot
  groupId: string
  groupLabel: string
  anchorLabel: string
  anchorState: AnchorState
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
    clearFilter: '清除分镜筛选',
    storyboard: '分镜 · 雨夜便利店',
    poster: '画布分组 · 海报试稿',
    ungrouped: '未分组',
    director: '导演台',
    generateSelected: '生成已选',
    selectedCount: '已选',
    connectPrevious: '接上一镜',
    connect: '连接上一镜',
    autoRef: '自动引用',
    manualRef: '手动引用',
    references: '参考',
    versions: '版本',
    prompt: '提示词',
    parameters: '模型与参数',
    status: '生成状态',
    openCanvas: '在画布里看',
    remove: '移除',
    close: '收起检查器',
    noNodes: '暂无生成节点',
    backCanvas: '返回画布',
    canvasNodeHint: '在列表里看',
    allShots: '全部镜头',
    longHint: '\u641c\u7d22\u955c\u5934\u6216\u8282\u70b9',
    generated: '已生成',
    generating: '生成中',
    failed: '失败',
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
    clearFilter: 'Clear storyboard filter',
    storyboard: 'Storyboard · Rainy convenience store',
    poster: 'Canvas group · Poster pass',
    ungrouped: 'Ungrouped',
    director: 'Director desk',
    generateSelected: 'Generate selected',
    selectedCount: 'selected',
    connectPrevious: 'Use previous frame',
    connect: 'Connect previous',
    autoRef: 'Auto reference',
    manualRef: 'Manual reference',
    references: 'References',
    versions: 'Versions',
    prompt: 'Prompt',
    parameters: 'Model & parameters',
    status: 'Generation status',
    openCanvas: 'Open in canvas',
    remove: 'Remove',
    close: 'Close inspector',
    noNodes: 'No generated nodes yet',
    backCanvas: 'Back to canvas',
    canvasNodeHint: 'View in list',
    allShots: 'All shots',
    longHint: 'Search shots or nodes',
    generated: 'Generated',
    generating: 'Generating',
    failed: 'Failed',
  },
} as const

export const anchors = [
  { id: 'anchor-lin', label: '@林薇', labelEn: '@Lin Wei', status: 'locked' as const },
  { id: 'anchor-store', label: '便利店霓虹', labelEn: 'Store neon', status: 'locked' as const },
  { id: 'anchor-look', label: '雨夜妆造', labelEn: 'Rain look', status: 'pending' as const },
]

const promptByIndex = [
  [
    '远景，雨后便利店门口，@林薇站在雨棚边，霓虹倒影慢慢推近',
    'Wide shot, @Lin Wei by the convenience store after rain, neon reflections slowly push in',
  ],
  [
    '近景，@林薇侧脸，水珠沿发梢滑下，霓虹落在睫毛上',
    'Close-up, @Lin Wei in profile, droplets run from her hair, neon caught in her lashes',
  ],
  [
    '低机位，旧怀表落在积水里，车灯从画面外扫过',
    'Low angle, an old pocket watch in a puddle as headlights sweep across frame',
  ],
  [
    '俯拍，便利店与湿漉漉的车道形成冷暖交错的几何线条',
    'Top down, the store and wet lanes form a cool-warm geometric pattern',
  ],
  [
    '中景，@林薇转身看向后门，风衣下摆被风带起',
    'Medium shot, @Lin Wei turns toward the back door, coat hem lifted by wind',
  ],
  [
    '特写，手指收紧怀表链，雨声盖过远处对白',
    'Insert, fingers tighten around the watch chain while rain covers distant dialogue',
  ],
]

function shotCard(shot: Shot, index: number, groupId: string, groupLabel: string, selected: boolean): ListCard {
  const [prompt, promptEn] = promptByIndex[index % promptByIndex.length]
  return {
    id: shot.id,
    kind: 'shot',
    title: `镜 ${shot.id.replace('shot-', '').padStart(2, '0')}`,
    titleEn: `Shot ${shot.id.replace('shot-', '').padStart(2, '0')}`,
    prompt,
    promptEn,
    ratio: shot.ratio,
    shot,
    groupId,
    groupLabel,
    anchorLabel: index === 3 ? '雨夜妆造' : index % 2 === 0 ? '@林薇' : '便利店霓虹',
    anchorState: index === 3 ? 'pending' : 'locked',
    selected,
    autoReference: index === 1,
    connectionOn: index === 3,
  }
}

function imageCard(
  id: string,
  shot: Shot,
  index: number,
  groupId: string,
  groupLabel: string,
  selected: boolean,
): ListCard {
  const [prompt, promptEn] = promptByIndex[(index + 2) % promptByIndex.length]
  return {
    id,
    kind: 'group-image',
    title: `海报 ${String(index + 1).padStart(2, '0')}`,
    titleEn: `Poster ${String(index + 1).padStart(2, '0')}`,
    prompt,
    promptEn,
    ratio: shot.ratio,
    shot,
    groupId,
    groupLabel,
    anchorLabel: index === 2 ? '雨夜妆造' : '便利店霓虹',
    anchorState: index === 2 ? 'pending' : 'locked',
    selected,
    autoReference: index === 1,
  }
}

function directorCard(selected: boolean): ListCard {
  return {
    id: 'director-desk',
    kind: 'director',
    title: '导演台 · 预演',
    titleEn: 'Director desk · previz',
    prompt: '节奏预演、镜头串联与旁白草稿',
    promptEn: 'Pacing pass, shot assembly, and voiceover draft',
    ratio: '16:9',
    groupId: 'ungrouped',
    groupLabel: '未分组',
    anchorLabel: '导演台',
    anchorState: 'none',
    selected,
  }
}

export function createListSections(state: ListViewState, locale: ListViewLocale): ListSection[] {
  const selected = new Set(
    state === 'batch' ? ['shot-2', 'poster-a-2', 'poster-b-3', 'ungrouped-1'] : state === 'selected' ? ['shot-2'] : [],
  )
  const shots = createShots(state === 'long' ? 30 : 6, locale)
  const storyboardCards = shots.map((shot, index) =>
    shotCard(shot, index, 'storyboard', '分镜 · 雨夜便利店', selected.has(shot.id)),
  )
  const posterShots = createShots(state === 'long' ? 20 : 3, locale)
  const posterCards = posterShots.map((shot, index) => {
    const groupId = index < posterShots.length / 2 ? 'poster-a' : 'poster-b'
    const groupLabel = index < posterShots.length / 2 ? '海报试稿 A' : '海报试稿 B'
    return imageCard(
      `${groupId}-${(index % 10) + 1}`,
      shot,
      index,
      groupId,
      groupLabel,
      selected.has(`${groupId}-${(index % 10) + 1}`),
    )
  })
  const sections: ListSection[] = [
    {
      id: 'storyboard',
      title: '分镜 · 雨夜便利店',
      titleEn: 'Storyboard · Rainy convenience store',
      subtitle: '6 镜 · 混合画幅 · 镜号优先',
      subtitleEn: '6 shots · mixed ratios · ordered by shot number',
      cards: storyboardCards,
    },
    {
      id: 'poster-a',
      title: '画布分组 · 海报试稿 A',
      titleEn: 'Canvas group · Poster pass A',
      subtitle: '10 张 · 画布分组',
      subtitleEn: '10 images · canvas group',
      cards: posterCards.filter((card) => card.groupId === 'poster-a'),
    },
    {
      id: 'poster-b',
      title: '画布分组 · 海报试稿 B',
      titleEn: 'Canvas group · Poster pass B',
      subtitle: '10 张 · 画布分组',
      subtitleEn: '10 images · canvas group',
      cards: posterCards.filter((card) => card.groupId === 'poster-b'),
    },
    {
      id: 'ungrouped',
      title: '未分组',
      titleEn: 'Ungrouped',
      subtitle: '2 张素材 · 1 张导演台',
      subtitleEn: '2 assets · 1 director desk',
      cards: [
        imageCard('ungrouped-1', createShots(1, locale)[0], 0, 'ungrouped', '未分组', selected.has('ungrouped-1')),
        imageCard(
          'ungrouped-2',
          createShots(1, locale)[1] ?? createShots(1, locale)[0],
          1,
          'ungrouped',
          '未分组',
          false,
        ),
        directorCard(selected.has('director-desk')),
      ],
    },
  ]
  if (state === 'deep-link') return [sections[0]]
  if (state !== 'long') {
    const posterB = sections.find((section) => section.id === 'poster-b')
    return sections
      .filter((section) => section.id !== 'poster-b')
      .map((section) => {
        if (section.id === 'storyboard') return { ...section, cards: section.cards.slice(0, 6) }
        if (section.id !== 'poster-a') return section
        return {
          ...section,
          title: section.title.replace(' A', ''),
          titleEn: section.titleEn.replace(' A', ''),
          subtitle: section.subtitle.replace('10', '3'),
          subtitleEn: section.subtitleEn.replace('10', '3'),
          cards: [...section.cards, ...(posterB?.cards ?? [])],
        }
      })
  }
  return sections.filter((section) => section.id !== 'ungrouped')
}
