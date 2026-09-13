// 「数门」门岗的判据本体（R21 / R27，2026-09-11）。
//
// 守的不变量：**判为 recurring 的修复，必须有一张机器核对过的门表，而且派工/PR 指得到它。**
//
// 起因（这一族的类根因）：2026-09-11 一天里连着三簇 bug 同一个形状——不变量只在一扇门上实现，
// 另一个入口绕过去。三次都被当成独立的一处 bug 修了一遍，因为**修复工人被任务书框在一个文件里**：
// 任务书写的是「这里坏了，修这里」，于是他找不到、也不会去找跨结构的根因。
// 合同侧的 `doors` 字段（scripts/root-cause-contracts.mjs）逼作者写出门表；
// 本门岗补的是它的**派工侧**：PR 正文得指得到那份合同，门表不能是写完就沉进 docs/fixes 的一页纸。
//
// 判据形状（刻意可机读、不判内容质量，同 check-prior-art）：
//   · 本次 diff 里新增/修改、且日期 ≥ 阈值、且 recurrence.classification = recurring 的合同，
//     PR 正文必须引用它的路径，且它的 doors 非空。
//   · one_off 不在 PR 侧管辖内——它的门表由 check:root-cause-contracts 在合同侧验过了；
//     PR 侧要的是「这次复发类修复，派工链上的人看得见那张门表」。
// 老合同按日期阈值豁免：追溯只会让门岗一上线就是一片红，然后被无视（R17）。

/** 门表从这天（含）起必填。取合同文件名的日期前缀——本仓的棘轮一律按日期，不做并行版本。 */
export const DOOR_MAP_THRESHOLD_DATE = '2026-09-11'

const CONTRACT_DATE = /(?:^|\/)(\d{4}-\d{2}-\d{2})-/
const CONTRACT_REFERENCE = /docs\/fixes\/[\w./+-]+\.root-cause\.json/g

/** 合同文件名的日期前缀；没有前缀的一律当老合同（返回 null）。 */
export function contractDate(file) {
  const match = CONTRACT_DATE.exec(String(file).replaceAll('\\', '/'))
  return match ? match[1] : null
}

/** PR 正文里引用到的根因合同路径（去重，保序）。 */
export function referencedContracts(body) {
  const found = new Set()
  for (const match of String(body ?? '').matchAll(CONTRACT_REFERENCE)) found.add(match[0])
  return [...found]
}

/** 本次 diff 里受本门岗管辖的合同：日期 ≥ 阈值、且判为 recurring。 */
export function governedContracts({ contracts, threshold = DOOR_MAP_THRESHOLD_DATE }) {
  return contracts.filter((entry) => {
    const date = contractDate(entry?.file)
    return !!date && date >= threshold && entry?.contract?.recurrence?.classification === 'recurring'
  })
}

/**
 * PR 侧判据。`contracts` = [{ file, contract }]（本次 diff 中新增/修改的根因合同）。
 * 返回错误数组（空 = 通过）。
 */
export function evaluatePullRequest({ body, contracts, threshold = DOOR_MAP_THRESHOLD_DATE }) {
  const governed = governedContracts({ contracts, threshold })
  if (governed.length === 0) return []
  const referenced = new Set(referencedContracts(body))
  const errors = []
  for (const entry of governed) {
    const doors = entry?.contract?.doors
    if (!Array.isArray(doors) || doors.length === 0) {
      errors.push(`${entry.file}: 判为 recurring 却没有门表（doors 为空）`
        + ' —— 先跑 `node scripts/door-map.mjs <mutator 符号或文件>` 数门，再决定修在哪一层。')
    }
    if (!referenced.has(entry.file)) {
      errors.push(`PR 正文没有引用这份根因合同：${entry.file}`
        + '\n      —— recurring 类修复的门表必须在派工链上看得见，而不是写完就沉进 docs/fixes。')
    }
  }
  return errors
}
