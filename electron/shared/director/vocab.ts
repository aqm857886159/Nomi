/** Director plan vocabulary. Rendering labels and measurement thresholds live with their consumers. */
export const EVAL_SHOT_SIZES = ['远景', '全景', '中景', '中近景', '近景', '特写', '大特写'] as const
export type EvalShotSize = (typeof EVAL_SHOT_SIZES)[number]

export const CAMERA_MOVES = [
  'orbit_left', 'orbit_right', 'push_in', 'pull_out', 'crane_up', 'crane_down',
  'track_left', 'track_right', 'arc_left', 'arc_right', 'zoom_in', 'zoom_out', 'dolly_zoom',
] as const
export type CameraMove = (typeof CAMERA_MOVES)[number]

export const DIRECTOR_SCENE_TEMPLATES = ['street', 'room', 'courtyard', 'product_stage'] as const
export type DirectorSceneTemplate = (typeof DIRECTOR_SCENE_TEMPLATES)[number]

/**
 * 环境词：说的是「这场戏在哪种地方」，不是舞台上的一件东西。规划器按提示词会把它们也写进 setPieces.kind
 *（为了让实体对应不丢词），但它们由场景模板本身承担——编译器不能把它们做成一个灰盒。
 * 比较前先小写并把空格 / 连字符换成下划线。
 */
export const DIRECTOR_ENVIRONMENT_WORDS = [
  'room', 'interior', 'indoor', 'indoors', 'outdoor', 'outdoors', 'ground', 'floor', 'street', 'courtyard', 'studio', 'hallway', 'corridor',
  'quiet_room', 'quiet_street', 'market_street', 'storm_ground', 'empty_street', 'empty_room',
  'gallery', 'museum', 'cafe', 'kitchen', 'station', 'rooftop', 'shop', 'office', 'library', 'park',
  '房间', '室内', '室外', '街道', '庭院', '地面', '走廊', '美术馆', '画廊', '咖啡馆', '厨房', '车站', '屋顶', '商店', '办公室', '图书馆', '公园',
] as const
/** 计划里的摆位关系词（schema 的 relation 枚举从这里取，成员不变）。 */
export const DIRECTOR_PLACEMENT_RELATIONS = ['near', 'in_front_of', 'behind', 'left_of', 'right_of', 'on', 'between', 'along', 'at'] as const
export type DirectorPlacementRelation = (typeof DIRECTOR_PLACEMENT_RELATIONS)[number]
/**
 * 关系词的空间含义——编译器的舞台模型按它解析到站位，不再「取参照原点再推到最近空位」。
 *   frame：mark = 落到参照的命名站位（地面 / 结构 / 家具）；support = 落在参照上（顶面，或参照是人 = 拿在手里）；
 *          facing = 在参照自己的朝向里取方向（前 0°、后 180°）；screen = 在画面左右取方向（观众在 +Z 一侧）；axis = 沿参照长边。
 *   spacing：中心距离的下限（米）。实际距离 = max(下限, 两者沿该方向的半宽之和 + 30cm)——一条公式管人、车、家具，不写两两特例。
 *   lateral：在站位基础上横向错开（near 一类，多个东西挨着同一个参照时左右交替）。
 *   faceRef：摆好后面向参照（「站在某人面前」= 面对他）。
 */
export const DIRECTOR_RELATION_SPACE: Record<DirectorPlacementRelation, { frame: 'mark' | 'support' | 'facing' | 'screen' | 'axis'; direction?: number; spacing: number; lateral?: boolean; faceRef?: boolean }> = {
  at: { frame: 'mark', spacing: 0 },
  near: { frame: 'mark', spacing: 1.2, lateral: true },
  between: { frame: 'mark', spacing: 1.2, lateral: true },
  on: { frame: 'support', spacing: 0 },
  in_front_of: { frame: 'facing', direction: 0, spacing: 1.8, faceRef: true },
  behind: { frame: 'facing', direction: 180, spacing: 1.8 },
  left_of: { frame: 'screen', direction: -90, spacing: 1.8 },
  right_of: { frame: 'screen', direction: 90, spacing: 1.8 },
  along: { frame: 'axis', spacing: 1.5 },
}

const nounKey =(noun: string) => noun.trim().toLowerCase().replace(/[\s-]+/g, '_')
export const isEnvironmentWord = (kind: string): boolean => (DIRECTOR_ENVIRONMENT_WORDS as readonly string[]).includes(nounKey(kind))

/**
 * 舞台种类：计划里的名词（布景件 kind、演员 desc / id）指的是舞台上哪一类东西。种类决定它在舞台上的角色
 *（地面 / 结构 / 家具 / 手持物）和典型尺寸——尺寸住在编译侧的舞台模型，这里只管「词 → 种类」。
 * 认不出的名词不归类（编译器按兜底方盒处理并报问题），不猜。
 */
export const DIRECTOR_STAGE_KINDS = ['ground', 'road', 'wall', 'gate', 'tree', 'building', 'backdrop', 'pedestal', 'table', 'seat', 'counter', 'paper', 'small_item'] as const
export type DirectorStageKind = (typeof DIRECTOR_STAGE_KINDS)[number]
const STAGE_KIND_NOUNS: Record<DirectorStageKind, readonly string[]> = {
  ground: ['ground', 'floor', 'stage_floor', '地面', '地板'],
  road: ['road', 'lane', 'sidewalk', '马路', '道路', '人行道'],
  wall: ['wall', 'fence', 'wall_enclosure', '墙', '院墙', '围墙', '墙壁'],
  gate: ['gate', 'door', 'doorway', 'entrance', '门', '院门', '大门', '门口', '房门'],
  tree: ['tree', '树', '大树'],
  building: ['building', 'buildings', 'house', '楼', '房子', '建筑'],
  backdrop: ['backdrop', 'background_wall', '背景墙', '背景板'],
  pedestal: ['pedestal', 'display_stand', 'stand', 'plinth', '展台', '底座', '台座'],
  table: ['table', 'desk', '桌', '桌子', '餐桌', '咖啡桌', '书桌'],
  seat: ['chair', 'bench', 'stool', 'sofa', '椅子', '长椅', '凳子', '沙发'],
  counter: ['counter', 'bar', '柜台', '吧台'],
  paper: ['letter', 'envelope', 'note', 'document', 'photo', 'ticket', 'map', '信', '信封', '纸条', '文件', '照片', '车票', '地图'],
  small_item: ['cap', 'lid', 'key', 'phone', 'cup', 'ring', 'wallet', 'knife', '瓶盖', '盖子', '钥匙', '手机', '杯子', '戒指', '钱包', '刀'],
}
const CJK = /[㐀-鿿]/
/** 名词 → 舞台种类：整词相等，或作为下划线分隔的词出现（cafe_table → table），中文按包含（圆形展台 → 展台）；多个命中取最长的那个词。 */
export function stageKindOf(noun: string): DirectorStageKind | undefined {
  const key = nounKey(noun)
  let best: { kind: DirectorStageKind; length: number } | undefined
  for (const kind of DIRECTOR_STAGE_KINDS)
    for (const word of STAGE_KIND_NOUNS[kind]) {
      const hit = key === word || key.split('_').includes(word) || key.startsWith(`${word}_`) || key.endsWith(`_${word}`) || (CJK.test(word) && key.includes(word))
      if (hit && (!best || word.length > best.length)) best = { kind, length: word.length }
    }
  return best?.kind
}
