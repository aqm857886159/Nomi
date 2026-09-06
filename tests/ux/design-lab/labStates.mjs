// 设计实验室状态清单的**共享读取口**（走查、视觉基线 spec、门岗三处共用一份）。
//
// 为什么用源码正则而不是 import：注册表是 .tsx（含 JSX + TS 类型），node 直接 import 不了；
// 而把清单再抄一份 JSON 就是第二个真相源——正是本实验室要消灭的那种东西。
//
// 这把正则的活性由走查兜底：`design-lab-<屏>.walk.mjs` 会拿活页面的
// `window.__designLabStates` 和这里的解析结果逐项比对，对不上当场红。
// 没有那道比对，一个解析漏项会静默地少截一张图、少比一条基线——典型的假绿。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
export const CALIBRATION_FILE = path.join(REPO_ROOT, 'tests/ux/design-lab/calibration.json')
const BASELINE_ROOT = path.join(REPO_ROOT, 'tests/ux/design-lab/__baselines__')

/**
 * 屏的登记表。**必须与 `src/devlab/designLab/labScreens.ts` 一一对应**——那边是页面的真相源，
 * 这边是取景/基线/门岗的。加一屏要同时改两处；只改一处的后果是那屏截不出图或留下孤儿基线，
 * 而 `check-design-lab.mjs` 的「基线 ↔ 注册表一一对应」那一条会把它逼出来。
 *
 * 注册表真身按来源/主题拆在各自的 `states/` 里（单文件 ≤800 行，R12 巨壳门岗）。
 * 解析顺序 = 文件名排序，与汇总口的拼接顺序一一对应（文件名带数字前缀就是为了这个）。
 */
export const LAB_SCREENS = {
  'agent-panel': {
    registryDir: path.join(REPO_ROOT, 'src/devlab/designLab/states'),
    baselineDir: path.join(BASELINE_ROOT, 'agent-panel'),
  },
  editing: {
    registryDir: path.join(REPO_ROOT, 'src/devlab/designLab/editing/states'),
    baselineDir: path.join(BASELINE_ROOT, 'editing'),
  },
  'host-config': {
    registryDir: path.join(REPO_ROOT, 'src/devlab/designLab/hostConfig/states'),
    baselineDir: path.join(BASELINE_ROOT, 'host-config'),
  },
  settings: {
    registryDir: path.join(REPO_ROOT, 'src/devlab/designLab/settings/states'),
    baselineDir: path.join(BASELINE_ROOT, 'settings'),
  },
}

export const LAB_SCREEN_IDS = Object.keys(LAB_SCREENS)

function screenConfig(screenId) {
  const config = LAB_SCREENS[screenId]
  if (!config) throw new Error(`未知的实验室屏：${screenId}（已登记：${LAB_SCREEN_IDS.join(', ')}）`)
  return config
}

export function baselineDirFor(screenId) {
  return screenConfig(screenId).baselineDir
}

/**
 * 注册项形如：`id: 'form-06-tool-line',` 紧跟 `name`, `source`, `coverage`；
 * `capture: 'viewport'`（浮层类形态要截整屏）是可选的，出现在同一条注册项内。
 */
export function readLabStates(screenId = 'agent-panel') {
  const registryDir = screenConfig(screenId).registryDir
  const files = fs.readdirSync(registryDir).filter((name) => name.endsWith('.tsx')).sort()
  if (!files.length) throw new Error(`${registryDir} 里一个注册表文件都没有`)
  const source = files.map((name) => fs.readFileSync(path.join(registryDir, name), 'utf8')).join('\n')
  const entries = []
  const re = /\bid:\s*'([a-z0-9-]+)',\s*\n\s*name:\s*'([^']+)',\s*\n\s*source:\s*'([^']*)',\s*\n\s*coverage:\s*'([a-z-]+)'/g
  let match
  const starts = []
  while ((match = re.exec(source)) !== null) {
    entries.push({ id: match[1], name: match[2], source: match[3], coverage: match[4], capture: 'element' })
    starts.push(match.index)
  }
  if (!entries.length) {
    throw new Error(`没有从 ${registryDir} 解析出任何状态——注册表格式变了，先修这把正则`)
  }
  // `capture` 只在本条注册项的范围内找（到下一条 `id:` 为止）——跨条找会把别人的取景方式记到自己头上。
  entries.forEach((entry, index) => {
    const segment = source.slice(starts[index], starts[index + 1] ?? source.length)
    if (/\bcapture:\s*'viewport'/.test(segment)) entry.capture = 'viewport'
  })
  const ids = entries.map((entry) => entry.id)
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index)
  if (duplicates.length) throw new Error(`状态 id 重复：${duplicates.join(', ')}`)
  return entries
}

export function readCalibration() {
  return JSON.parse(fs.readFileSync(CALIBRATION_FILE, 'utf8'))
}

/**
 * 「基线待用户拍板」登记表：屏 id → 一句为什么。
 *
 * 这**不是**逃生口。没有获批基线的屏本来就没有可回归的对象——逐像素比一张没人看过的图
 * 只会把「今天长这样」当成「应该长这样」，那才是真的假绿。登记是显式的、写在
 * calibration.json 里、门岗每次都醒目打印，拍板录完基线就必须删掉这一条。
 * 孤儿基线不受登记豁免：图在、状态没了，照红。
 */
export function pendingApprovalScreens() {
  return readCalibration().pendingApprovalScreens ?? {}
}
