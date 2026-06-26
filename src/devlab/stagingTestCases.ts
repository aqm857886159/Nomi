// 站位参考图「姿势/人物」回归测试用例 —— harness(stagingShots.tsx) + 单测(stagingPoses.test.ts) 共用，单一真相源。
// 30 例覆盖：12 个 solo 姿势（断肢/悬空高发区）+ 多人布局/朝向 + 机位 + 人群。
// 每例 expect = 子 agent(VLM) 审查时的「应当看到」基准，check = 必须人眼判定无的缺陷清单。
import type { StagingSpec } from '../workbench/generationCanvas/nodes/scene3d/stagingBuilder'

export type StagingTestCase = {
  id: string // 两位序号-语义，文件名/截图名用
  expect: string // 这例应当看到什么（正向）
  check: string // 必须确认「没有」的缺陷（负向，子 agent 审查重点）
  spec: StagingSpec
}

// 通用断肢/穿插/悬空清单（所有例都查）。
const ANATOMY = '断肢/肢体扭曲反关节/手脚穿插身体/悬空离地/陷入地面'

export const STAGING_TEST_CASES: StagingTestCase[] = [
  // ── A. 12 个 solo 姿势（姿势引擎核心，缺陷高发）──
  { id: '01-standing', expect: '1 人自然站立，双臂垂体侧，朝镜头', check: `${ANATOMY}；手臂不应外展成 T 字`, spec: { characters: [{ pose: 'standing' }], camera: { angle: 'front', height: 'eye', shot: 'wide' } } },
  { id: '02-tpose', expect: '1 人 T 字站姿，双臂水平外展', check: `${ANATOMY}；双臂应基本水平等高`, spec: { characters: [{ pose: 't-pose' }], camera: { angle: 'front', height: 'eye', shot: 'wide' } } },
  { id: '03-walk', expect: '1 人行走中，手脚自然对侧摆动', check: `${ANATOMY}；两脚不应同时离地或劈叉过大`, spec: { characters: [{ pose: 'walk' }], camera: { angle: 'three-quarter', height: 'eye', shot: 'wide' } } },
  { id: '04-run', expect: '1 人奔跑，前倾、大幅摆臂屈腿', check: `${ANATOMY}；前倾不应整体后仰或前扑倒地`, spec: { characters: [{ pose: 'run' }], camera: { angle: 'three-quarter', height: 'eye', shot: 'wide' } } },
  { id: '05-sit', expect: '1 人坐姿：大腿水平、小腿垂直、脚掌踩平', check: `${ANATOMY}；不应悬空（无椅子时臀应接近地）、脚尖不应下垂、小腿不应反折`, spec: { characters: [{ pose: 'sit' }], camera: { angle: 'three-quarter', height: 'eye', shot: 'wide' } } },
  { id: '06-squat', expect: '1 人深蹲：髋膝深屈、躯干前倾压膝上、脚掌踩平', check: `${ANATOMY}；不应整体后仰跌坐、脚尖点地悬跟`, spec: { characters: [{ pose: 'squat' }], camera: { angle: 'three-quarter', height: 'eye', shot: 'wide' } } },
  { id: '07-single-knee', expect: '1 人单膝跪：前腿脚掌踩平、后膝着地小腿贴地', check: `${ANATOMY}；后腿不应整条悬空、后脚不应翘起、两腿不应穿插`, spec: { characters: [{ pose: 'single-knee' }], camera: { angle: 'three-quarter', height: 'eye', shot: 'wide' } } },
  { id: '08-double-knee', expect: '1 人双膝跪地，小腿贴地、坐于脚跟附近', check: `${ANATOMY}；双膝应着地不悬空、脚背贴地`, spec: { characters: [{ pose: 'double-knee' }], camera: { angle: 'three-quarter', height: 'eye', shot: 'wide' } } },
  { id: '09-hands-on-hips', expect: '1 人叉腰：双手撑髋、肘外张', check: `${ANATOMY}；手应落在髋部附近、肘不应反折`, spec: { characters: [{ pose: 'hands-on-hips' }], camera: { angle: 'front', height: 'eye', shot: 'wide' } } },
  { id: '10-point', expect: '1 人右臂前伸指向，另臂垂体侧', check: `${ANATOMY}；指向臂应大致水平前伸、不应穿身`, spec: { characters: [{ pose: 'point' }], camera: { angle: 'three-quarter', height: 'eye', shot: 'wide' } } },
  { id: '11-wave', expect: '1 人右臂高举挥手，另臂垂体侧', check: `${ANATOMY}；举臂应高过肩、不应反折或穿头`, spec: { characters: [{ pose: 'wave' }], camera: { angle: 'front', height: 'eye', shot: 'wide' } } },
  { id: '12-cheer', expect: '1 人双臂高举欢呼', check: `${ANATOMY}；双臂应对称高举过头、不应反折`, spec: { characters: [{ pose: 'cheer' }], camera: { angle: 'front', height: 'eye', shot: 'wide' } } },

  // ── B. 多人姿势 + 互动（朝向 + 姿势组合）──
  { id: '13-propose', expect: '左侧单膝跪、右侧站立，两人面对面（求婚），仰拍中景', check: `${ANATOMY}；跪者后腿不应悬空、两人不应重叠穿插、应彼此面对`, spec: { characters: [{ name: 'A', pose: 'single-knee', facing: 'toward' }, { name: 'B', pose: 'standing', facing: 'toward' }], layout: 'facing', camera: { angle: 'three-quarter', height: 'low', shot: 'medium' } } },
  { id: '14-interview', expect: '一坐一站，面对面（访谈）', check: `${ANATOMY}；坐者不应悬空、两人应相对`, spec: { characters: [{ pose: 'sit', facing: 'toward' }, { pose: 'standing', facing: 'toward' }], layout: 'facing', camera: { angle: 'three-quarter', height: 'eye', shot: 'medium' } } },
  { id: '15-standoff', expect: '两人面对面叉腰对峙', check: `${ANATOMY}；两人应相对、不应背对或穿插`, spec: { characters: [{ pose: 'hands-on-hips', facing: 'toward' }, { pose: 'hands-on-hips', facing: 'toward' }], layout: 'facing', camera: { angle: 'front', height: 'eye', shot: 'medium' } } },
  { id: '16-point-at', expect: 'A 指向 B，两人面对面', check: `${ANATOMY}；A 指向臂应朝向 B 一侧、不应朝外`, spec: { characters: [{ pose: 'point', facing: 'toward' }, { pose: 'standing', facing: 'toward' }], layout: 'facing', camera: { angle: 'three-quarter', height: 'eye', shot: 'medium' } } },
  { id: '17-trio-mixed-pose', expect: '三人并排：站/叉腰/挥手', check: `${ANATOMY}；三人间距均匀不重叠、各自姿势清晰`, spec: { characters: [{ pose: 'standing' }, { pose: 'hands-on-hips' }, { pose: 'wave' }], layout: 'side-by-side', camera: { angle: 'front', height: 'eye', shot: 'wide' } } },
  { id: '18-squat-stand', expect: '一蹲一站，面对面', check: `${ANATOMY}；蹲者不应跌坐、两人不应穿插`, spec: { characters: [{ pose: 'squat', facing: 'toward' }, { pose: 'standing', facing: 'toward' }], layout: 'facing', camera: { angle: 'three-quarter', height: 'eye', shot: 'medium' } } },
  { id: '19-intimate-close', expect: '两人面对面近景亲密', check: `${ANATOMY}；近景下两人不应穿插重叠、应彼此相对`, spec: { characters: [{ pose: 'standing', facing: 'toward' }, { pose: 'standing', facing: 'toward' }], layout: 'facing', camera: { angle: 'front', height: 'eye', shot: 'close' } } },
  { id: '20-behind-depth', expect: '三人一前两后有纵深', check: `${ANATOMY}；应读得出前后纵深、人物不应完全重叠`, spec: { characters: [{ pose: 'standing' }, { pose: 'standing' }, { pose: 'standing' }], layout: 'behind', camera: { angle: 'three-quarter', height: 'high', shot: 'wide' } } },

  // ── C. 布局 / 空间关系 ──
  { id: '21-line-four', expect: '四人纵队，侧机位读出一列纵深', check: `${ANATOMY}；应为一列、不应挤成一团`, spec: { characters: [{ pose: 'standing' }, { pose: 'standing' }, { pose: 'standing' }, { pose: 'standing' }], layout: 'line', camera: { angle: 'side', height: 'eye', shot: 'wide' } } },
  { id: '22-circle-four', expect: '四人围圈朝圆心，俯角', check: `${ANATOMY}；应围成圈、面朝内、不应叠在一处`, spec: { characters: [{ pose: 'standing' }, { pose: 'standing' }, { pose: 'standing' }, { pose: 'standing' }], layout: 'circle', camera: { angle: 'front', height: 'high', shot: 'wide' } } },
  { id: '23-circle-overhead', expect: '三人围圈，顶视读方位', check: `${ANATOMY}；顶视应见三人三角分布`, spec: { characters: [{ pose: 'standing' }, { pose: 'standing' }, { pose: 'standing' }], layout: 'circle', camera: { angle: 'front', height: 'overhead', shot: 'wide' } } },
  { id: '24-five-row', expect: '五人并排一排，全景', check: `${ANATOMY}；五人应均匀一排、不应越界重叠`, spec: { characters: Array.from({ length: 5 }, () => ({ pose: 'standing' as const })), layout: 'side-by-side', camera: { angle: 'front', height: 'eye', shot: 'wide' } } },
  { id: '25-behind-high', expect: '三人一前两后，俯拍', check: `${ANATOMY}；俯角下应读出纵深层次`, spec: { characters: [{ pose: 'standing' }, { pose: 'standing' }, { pose: 'standing' }], layout: 'behind', camera: { angle: 'three-quarter', height: 'high', shot: 'wide' } } },

  // ── D. 朝向变体 ──
  { id: '26-solo-away', expect: '1 人背对镜头站立', check: `${ANATOMY}；应看到背面、双臂仍自然垂体侧`, spec: { characters: [{ pose: 'standing', facing: 'away' }], camera: { angle: 'front', height: 'eye', shot: 'wide' } } },
  { id: '27-trio-mixed-facing', expect: '三人并排：朝镜头/背对/朝左', check: `${ANATOMY}；三人朝向应各不相同且可分辨`, spec: { characters: [{ facing: 'camera' }, { facing: 'away' }, { facing: 'left' }], layout: 'side-by-side', camera: { angle: 'front', height: 'eye', shot: 'wide' } } },
  { id: '28-back-camera', expect: '从背后机位看 1 人（背面机位）', check: `${ANATOMY}；应见人物背面`, spec: { characters: [{ pose: 'standing' }], camera: { angle: 'back', height: 'eye', shot: 'wide' } } },

  // ── E. 机位 / 人群 ──
  { id: '29-cheer-crowd', expect: '主角双臂欢呼 + 背景人群', check: `${ANATOMY}；主角姿势清晰、人群在后不挤主角`, spec: { characters: [{ pose: 'cheer' }], camera: { angle: 'front', height: 'eye', shot: 'wide' }, crowd: { rows: 2, columns: 5 } } },
  { id: '30-run-low', expect: '1 人奔跑，低机位仰拍强化动势', check: `${ANATOMY}；仰拍下仍前倾奔跑、不应后仰`, spec: { characters: [{ pose: 'run' }], camera: { angle: 'three-quarter', height: 'low', shot: 'wide' } } },
]
