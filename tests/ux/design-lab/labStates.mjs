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
 * `pendingApproval` = 这一屏的样子还没给用户拍过板，因此**一张基线都不该有**（录一张没人认可过的
 * 图钉住，等于把「待定」伪装成「已定」）。它必须与 `labScreens.ts` 里同名字段一致，门岗会对。
 *
 * 注册表真身按主题拆在各自的 `states/` 里（单文件 ≤800 行，R12 巨壳门岗）。
 * 解析顺序 = 文件名排序，与汇总口的拼接顺序一一对应（文件名带数字前缀就是为了这个）。
 */
export const LAB_SCREENS = {
  'agent-panel': {
    registryDir: path.join(REPO_ROOT, 'src/devlab/designLab/states'),
    baselineDir: path.join(BASELINE_ROOT, 'agent-panel'),
    pendingApproval: false,
  },
  'vendor-order': {
    registryDir: path.join(REPO_ROOT, 'src/devlab/designLab/vendorOrder/states'),
    baselineDir: path.join(BASELINE_ROOT, 'vendor-order'),
    pendingApproval: true,
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

export function screenIsPendingApproval(screenId) {
  return screenConfig(screenId).pendingApproval === true
}

/** 注册项形如：`id: 'form-06-tool-line',` 紧跟 `name: '…'`, `source: '…'`, `coverage: '…'`。 */
export function readLabStates(screenId = 'agent-panel') {
  const registryDir = screenConfig(screenId).registryDir
  const files = fs.readdirSync(registryDir).filter((name) => name.endsWith('.tsx')).sort()
  if (!files.length) throw new Error(`${registryDir} 里一个注册表文件都没有`)
  const source = files.map((name) => fs.readFileSync(path.join(registryDir, name), 'utf8')).join('\n')
  const entries = []
  // `source` 允许是模板串（各屏常把公共来源抽成常量再拼一句），所以那一段用 [^,]* 而不是只认单引号。
  const re = /\bid:\s*'([a-z0-9-]+)',\s*\n\s*name:\s*'([^']+)',\s*\n\s*source:\s*([^,]*),\s*\n\s*coverage:\s*'([a-z-]+)'/g
  let match
  while ((match = re.exec(source)) !== null) {
    entries.push({ id: match[1], name: match[2], source: match[3].trim(), coverage: match[4] })
  }
  if (!entries.length) {
    throw new Error(`没有从 ${registryDir} 解析出任何状态——注册表格式变了，先修这把正则`)
  }
  const ids = entries.map((entry) => entry.id)
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index)
  if (duplicates.length) throw new Error(`状态 id 重复：${duplicates.join(', ')}`)
  return entries
}

export function readCalibration() {
  return JSON.parse(fs.readFileSync(CALIBRATION_FILE, 'utf8'))
}
