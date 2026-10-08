export type Direction = 'a' | 'b' | 'c' | 'd'
export type Locale = 'zh' | 'en'
export type ShotStatus = 'ready' | 'generating' | 'failed' | 'skipped'
type Ratio = '16:9' | '9:16' | '1:1'

export type Shot = {
  id: string
  scene: string
  ratio: Ratio
  kind: '图片' | '视频' | '图生视频'
  status: ShotStatus
  prompt: string
  promptEn: string
  model: string
  duration: string
  selected: boolean
  tone: string
}

export const copy = {
  zh: {
    title: '分镜方案 · 版式探索',
    subtitle: '同一组镜头数据，四种阅读方式。这里只验证版式，不连接生成逻辑。',
    grid: 'A · 画面优先格子板',
    inspector: 'B · 紧凑列表 + 右侧检查器',
    rows: 'C · 改良现行一行一镜',
    hybrid: 'D · 格子板 + 侧滑检查器',
    six: '6 镜混合比例',
    thirty: '30 镜长列表',
    state: '状态同屏',
    narrow: '最小宽度',
    scene: '场景 01 · 雨夜天台',
    all: '全部镜头',
    selected: '已选 2',
    generate: '生成已选',
    play: '播放全部',
    filter: '按锚点筛选',
    inspectorTitle: '镜 02 · 近景',
    prompt: '提示词',
    parameters: '模型与参数',
    references: '参考与首帧',
    versions: '版本 3',
    status: '生成状态',
    anchor: '@林薇',
    referenceSlot: '参考槽 · 1',
    firstFrame: '首帧计划',
    regenerate: '重生成',
    handoff: '交给 Agent',
    skip: '本次跳过',
    lock: '锁定',
    sceneMove: '移到场',
    locate: '画布定位',
    remaining: '生成剩余 12 项',
    failure: '失败：厂商未启用该模型',
    done: '已生成',
    generating: '生成中',
    skipped: '本次跳过',
    failed: '失败',
    auto: '自动',
    image: '图片',
    video: '视频',
    imageToVideo: '图生视频',
    model: 'Seedance 2.5',
    more: '更多操作',
    density: '密度',
  },
  en: {
    title: 'Storyboard plan · layout explore',
    subtitle: 'One shot dataset, four reading modes. Layout only; generation logic is not connected.',
    grid: 'A · Image-first grid',
    inspector: 'B · Compact list + inspector',
    rows: 'C · Refined one-shot rows',
    hybrid: 'D · Grid + slide-out inspector',
    six: '6 shots · mixed ratios',
    thirty: '30 shots · long list',
    state: 'States together',
    narrow: 'Minimum width',
    scene: 'Scene 01 · Rooftop after rain',
    all: 'All shots',
    selected: '2 selected',
    generate: 'Generate selected',
    play: 'Play all',
    filter: 'Filter by anchor',
    inspectorTitle: 'Shot 02 · close-up',
    prompt: 'Prompt',
    parameters: 'Model & parameters',
    references: 'References & first frame',
    versions: '3 versions',
    status: 'Generation status',
    anchor: '@Lin Wei',
    referenceSlot: 'Reference slot · 1',
    firstFrame: 'First-frame plan',
    regenerate: 'Regenerate',
    handoff: 'Hand off to Agent',
    skip: 'Skip this run',
    lock: 'Lock',
    sceneMove: 'Move to scene',
    locate: 'Locate on canvas',
    remaining: '12 shots left to generate',
    failure: 'Failed: model is not enabled by vendor',
    done: 'Generated',
    generating: 'Generating',
    skipped: 'Skipped this run',
    failed: 'Failed',
    auto: 'Auto',
    image: 'Image',
    video: 'Video',
    imageToVideo: 'Image to video',
    model: 'Seedance 2.5',
    more: 'More actions',
    density: 'Density',
  },
} as const

export function dataImage(shot: number, ratio: Ratio, tone: string, label: string): string {
  const [from, to] = tone.split('|')
  const [w, h] = ratio === '16:9' ? [320, 180] : ratio === '9:16' ? [180, 320] : [240, 240]
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs><rect width="${w}" height="${h}" fill="url(#g)"/><circle cx="${w * 0.76}" cy="${h * 0.25}" r="${Math.min(w, h) * 0.17}" fill="rgba(255,235,192,.30)"/><path d="M0 ${h * 0.78} Q ${w * 0.28} ${h * 0.56}, ${w * 0.54} ${h * 0.78} T ${w} ${h * 0.7} V ${h} H0Z" fill="rgba(16,20,27,.42)"/><text x="${w * 0.08}" y="${h * 0.14}" font-family="Inter,system-ui" font-size="${Math.max(11, Math.min(16, w / 18))}" fill="rgba(255,255,255,.82)">SHOT ${String(shot).padStart(2, '0')}</text><text x="${w / 2}" y="${h * 0.92}" font-family="Inter,system-ui" font-size="${Math.max(10, Math.min(14, w / 22))}" text-anchor="middle" fill="rgba(255,255,255,.78)">${label}</text></svg>`
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

const tones = [
  '#384d67|#111827',
  '#704b45|#201312',
  '#5d526f|#1b1726',
  '#506a63|#162622',
  '#87613e|#2b1c12',
  '#476274|#121c26',
]
const promptsZh = [
  '远景，雨后天台，@林薇 独自站在栏杆边，霓虹反光，缓推',
  '近景，@林薇 侧脸，水珠沿着发梢滑下，霓虹在睫毛上留下一道光',
  '低机位，旧怀表落在积水里，车灯从画面外扫过',
  '俯拍，天台与高架车流形成冷暖交错的几何线条',
  '中景，@林薇 转身看向楼梯口，风衣下摆被风带起',
  '特写，手指收紧怀表链，雨声盖过远处对白',
]
const promptsEn = [
  'Wide shot, rooftop after rain, @Lin Wei alone by the rail, neon reflections, slow push in',
  'Close-up, @Lin Wei in profile, droplets running from her hair, neon caught in her lashes',
  'Low angle, an old pocket watch in a puddle as headlights sweep across frame',
  'Top down, rooftop and traffic lanes form a cool-warm geometric pattern',
  'Medium shot, @Lin Wei turns toward the stairwell, coat hem lifted by the wind',
  'Insert, fingers tighten around the watch chain while rain covers the distant dialogue',
]

export function createShots(count: number, locale: Locale): Shot[] {
  const kinds: Shot['kind'][] = ['视频', '图生视频', '图片', '视频', '图片', '图生视频']
  const ratios: Ratio[] = ['16:9', '9:16', '1:1', '16:9', '9:16', '1:1']
  const statuses: ShotStatus[] = ['ready', 'generating', 'failed', 'skipped', 'ready', 'ready']
  const list: Shot[] = []
  for (let i = 0; i < count; i += 1) {
    const template = i % 6
    const status =
      count === 6
        ? statuses[template]
        : i === 1
          ? 'generating'
          : i === 6
            ? 'failed'
            : i === 12
              ? 'skipped'
              : i % 5 === 0
                ? 'ready'
                : 'ready'
    const ratio = ratios[template]
    list.push({
      id: `shot-${i + 1}`,
      scene: i < Math.ceil(count / 2) ? '01' : i < Math.ceil(count * 0.82) ? '02' : '03',
      ratio,
      kind: kinds[template],
      status,
      prompt: promptsZh[template],
      promptEn: promptsEn[template],
      model: template === 2 ? 'Nano Banana 2' : 'Seedance 2.5',
      duration: ratio === '1:1' ? '3s' : template % 2 === 0 ? '5s' : '8s',
      selected: template === 1 || template === 4,
      tone: tones[template],
    })
  }
  if (locale === 'en') return list
  return list
}

export function statusTone(status: ShotStatus): 'success' | 'info' | 'danger' | 'warning' {
  if (status === 'ready') return 'success'
  if (status === 'generating') return 'info'
  if (status === 'failed') return 'danger'
  return 'warning'
}

export function statusLabel(status: ShotStatus, t: typeof copy.zh): string {
  if (status === 'ready') return t.done
  if (status === 'generating') return t.generating
  if (status === 'failed') return t.failed
  return t.skipped
}

export function kindLabel(kind: Shot['kind'], t: typeof copy.zh): string {
  if (kind === '图片') return t.image
  if (kind === '视频') return t.video
  return t.imageToVideo
}
