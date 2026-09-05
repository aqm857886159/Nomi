// 「多项目 × 位置式项目卡选择」的判定逻辑（check-walkthroughs.mjs 的 positional-project-open 规则）。
//
// 抽成独立模块只有一个理由：check-walkthroughs.mjs 一 import 就会跑整道门岗，规则本身没法单测。
// 而 R17 要求「加规则先验它会红」——阳性对照住在 check-walkthroughs.node-test.mjs 里。
//
// 2026-09-06 实例：production-mcp 旅程自 c73db10ef 起在同一隔离库里有两个项目
// （GUI 建的制作项目 + MCP nomi_project_create 建的语义夹具），重启后仍按 `.first()` 点项目卡。
// 库卡顺序是「最近用过」派生量（src/workbench/library/libraryDiscovery.ts sortByLibraryUsage），
// 两者 updatedAt 同秒 → `.first()` 掷硬币 → 一半概率进错项目，任务中心是空的，
// 而报错出现在下游的「[data-production-task-card] 10s 超时」，把人引向「等太短」这个错方向。

/** 「这份走查的库里不止一个项目」的信号：它自己又通过 MCP 建了一个。 */
const MULTI_PROJECT_SIGNAL = /nomi_project_create/

/** 位置式选择：位置是派生坐标，多一个兄弟就换了含义。 */
const POSITIONAL = /\.first\(\)|\.nth\(|\.last\(\)/

/** 身份限定：按名字或 id 选中才是稳定坐标。 */
const IDENTITY_QUALIFIED = /hasText|\.filter\(|data-project-id/

/**
 * @param {string} code 走查源码（已剥注释）
 * @returns {{ line: number, text: string }[]} 命中的行
 */
export function findPositionalProjectOpens(code) {
  if (!MULTI_PROJECT_SIGNAL.test(code)) return []
  const hits = []
  code.split('\n').forEach((line, index) => {
    if (!line.includes('[data-project-card')) return
    if (IDENTITY_QUALIFIED.test(line)) return
    if (!POSITIONAL.test(line)) return
    hits.push({ line: index + 1, text: line.trim().slice(0, 120) })
  })
  return hits
}
