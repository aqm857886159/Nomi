// 设计实验室状态清单的**共享读取口**（走查、视觉基线 spec、门岗三处共用一份）。
//
// 为什么用源码正则而不是 import：注册表是 .tsx（含 JSX + TS 类型），node 直接 import 不了；
// 而把清单再抄一份 JSON 就是第二个真相源——正是本实验室要消灭的那种东西。
//
// 这把正则的活性由走查兜底：`design-lab-agent-panel.walk.mjs` 会拿活页面的
// `window.__designLabStates` 和这里的解析结果逐项比对，对不上当场红。
// 没有那道比对，一个解析漏项会静默地少截一张图、少比一条基线——典型的假绿。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
/**
 * 注册表真身按来源拆在 `states/`（单文件 ≤800 行，R12 巨壳门岗）。
 * 解析顺序 = 文件名排序，与 `agentPanelStates.tsx` 的拼接顺序一一对应（文件名带数字前缀就是为了这个）。
 */
export const REGISTRY_DIR = path.join(REPO_ROOT, 'src/devlab/designLab/states')
export const BASELINE_DIR = path.join(REPO_ROOT, 'tests/ux/design-lab/__baselines__/agent-panel')
export const CALIBRATION_FILE = path.join(REPO_ROOT, 'tests/ux/design-lab/calibration.json')

/** 注册项形如：`id: 'form-06-tool-line',` 紧跟 `name: '…'`, `coverage: '…'`。 */
export function readLabStates() {
  const files = fs.readdirSync(REGISTRY_DIR).filter((name) => name.endsWith('.tsx')).sort()
  if (!files.length) throw new Error(`${REGISTRY_DIR} 里一个注册表文件都没有`)
  const source = files.map((name) => fs.readFileSync(path.join(REGISTRY_DIR, name), 'utf8')).join('\n')
  const entries = []
  const re = /\bid:\s*'([a-z0-9-]+)',\s*\n\s*name:\s*'([^']+)',\s*\n\s*source:\s*'([^']*)',\s*\n\s*coverage:\s*'([a-z-]+)'/g
  let match
  while ((match = re.exec(source)) !== null) {
    entries.push({ id: match[1], name: match[2], source: match[3], coverage: match[4] })
  }
  if (!entries.length) {
    throw new Error(`没有从 ${REGISTRY_DIR} 解析出任何状态——注册表格式变了，先修这把正则`)
  }
  const ids = entries.map((entry) => entry.id)
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index)
  if (duplicates.length) throw new Error(`状态 id 重复：${duplicates.join(', ')}`)
  return entries
}

export function readCalibration() {
  return JSON.parse(fs.readFileSync(CALIBRATION_FILE, 'utf8'))
}
