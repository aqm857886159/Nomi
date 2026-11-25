// WorkbenchMenu 的锚点：按钮点开的菜单给真触发器（trigger）或矩形（anchorRect），只有「没有单一触发元素」的菜单
// （画布 pointerup 和弦、连线落空、剪辑时间轴四目标命中）给点（point）。
//
// 2026-10-06 那一类：调用方拿按钮的 getBoundingClientRect() 算出一个点当 point 传进来。
// 有空间时看不出问题；放不下要翻边时，Radix 翻的是一个 0×0 的点，菜单整块压回按钮（「改图」盖住浮条那一排）。
// 2026-11-23 那一类（docs/engineering/direction-checks/2026-11-23-workbench-menu-trigger-contract.md）：
// 普通行右键也走 0×0 点位，Radix 的 data-state="open" 落在 body 里看不见的假按钮上，被右键的那一行没有打开态高亮；
// 导演台轨道「+」按钮经包装组件把点击坐标转传成 point，绕过了单文件检查。
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return walk(full)
    return /\.tsx$/.test(entry.name) && !/\.test\.tsx$/.test(entry.name) ? [full] : []
  })
}
const stripComments = (source: string): string => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

/** 生产源码：排除测试与设计实验室陈列页（`src/devlab/` 里的样本故意摆出每种锚点）。 */
const productionFiles = walk(path.join(process.cwd(), 'src'))
  .map((file) => ({ file: path.relative(process.cwd(), file).split(path.sep).join('/'), source: stripComments(fs.readFileSync(file, 'utf8')) }))
  .filter(({ file }) => !file.startsWith('src/devlab/'))

const menuFiles = productionFiles.filter(({ source }) => /<WorkbenchMenu\b/.test(source))

/** 一个文件里每个 `<WorkbenchMenu ...>` 开标签的属性文本（按花括号配对找到标签结尾，免得被 `=>` 里的 `>` 截断）。 */
function workbenchMenuTags(source: string): string[] {
  const tags: string[] = []
  const re = /<WorkbenchMenu\b/g
  let match: RegExpExecArray | null
  while ((match = re.exec(source))) {
    let depth = 0
    let end = match.index
    for (let i = match.index; i < source.length; i += 1) {
      const ch = source[i]
      if (ch === '{') depth += 1
      else if (ch === '}') depth -= 1
      else if (ch === '>' && depth === 0 && source[i - 1] !== '=') { end = i; break }
    }
    tags.push(source.slice(match.index, end + 1))
  }
  return tags
}

/**
 * 永久登记：真正没有单一触发元素、或带领域手势编排的点位菜单（方向检查 §6「换一种做法」②）。
 * 只认这 3 个文件；别的文件要给 `point`，先回答「被右键 / 被点的那个元素是谁」——有就用
 * `WorkbenchContextMenu`（行右键）或 `WorkbenchMenu trigger`（按钮下拉）。
 */
const PERMANENT_POINT_CALLERS = [
  'src/workbench/generationCanvas/components/NodeContextMenu.tsx', // 画布节点 / 框右键：pointerup 才提交，让右键平移和弦先否决
  'src/workbench/generationCanvas/quickActions/NodeDeriveMenu.tsx', // 连线拖到空白松手：没有触发元素
  'src/workbench/timeline/TimelineContextMenu.tsx', // 剪辑时间轴：4 种 target 坐标命中，空白处拒弹
]
/**
 * 存量冻结（只减不增）：镜头表自定义列表头右键（`ShotTableGrid` → `onColumnMenu(column, { x, y })`）。
 * 它有真实触发元素（`<th>`），属于该迁 `WorkbenchContextMenu` 的普通右键，不在 #1628 的三处范围内，待下一刀迁走后删掉这一行。
 */
const LEGACY_FROZEN_POINT_CALLERS = [
  'src/workbench/generationCanvas/nodes/shotTable/ShotTableNode.tsx',
]
const LEGACY_FROZEN_MAX = 1

describe('WorkbenchMenu 的锚点来源', () => {
  it('普查对象非空', () => {
    expect(menuFiles.map(({ file }) => file)).toContain('src/workbench/generationCanvas/nodes/ToolbarActionMenu.tsx')
  })

  it('给 point 的调用点不量按钮位置（按钮点开的菜单必须给 trigger / anchorRect）', () => {
    const offenders = menuFiles
      .filter(({ source }) => /<WorkbenchMenu\b[\s\S]*?\bpoint=\{/.test(source) && /getBoundingClientRect\(\)/.test(source))
      .map(({ file }) => file)
    expect(offenders).toEqual([])
  })

  it('按钮点击不把点击事件 / 坐标转交给菜单打开函数（跨文件转传 point 的形状，导演台「+」那一类）', () => {
    // 判据：`onClick={(event) => xxxMenu(event, ...)}` 把点击事件交给一个菜单打开函数（它在别的文件里取 clientX/Y 当 point）。
    // 按钮点开的菜单应把按钮本身交给 `WorkbenchMenu trigger`。（onClick 里读 clientX 本身不算：剪刀分割、拖拽判定都正当地读它。）
    const forwardsEvent = /onClick=\{\s*\(?\s*(\w+)\s*\)?\s*=>\s*[\w.]*[Mm]enu\w*\(\s*\1\b/
    const offenders = productionFiles
      .filter(({ source }) => forwardsEvent.test(source))
      .map(({ file }) => file)
    expect(offenders).toEqual([])
  })

  it('给 WorkbenchMenu 传 point 的生产文件只许是登记的 3 个永久手势文件 + 冻结存量（只减不增）', () => {
    const pointCallers = menuFiles
      .filter(({ source }) => workbenchMenuTags(source).some((tag) => /\bpoint=\{/.test(tag)))
      .map(({ file }) => file)
      .sort()
    const unregistered = pointCallers.filter((file) => !PERMANENT_POINT_CALLERS.includes(file) && !LEGACY_FROZEN_POINT_CALLERS.includes(file))
    expect(unregistered, '新的点位菜单：被右键 / 被点的元素是谁？行右键用 WorkbenchContextMenu，按钮下拉用 WorkbenchMenu trigger').toEqual([])
    // 登记表不许有过期项：文件迁走了就从表里删，免得白名单变成以后谁都能进的口子。
    for (const file of [...PERMANENT_POINT_CALLERS, ...LEGACY_FROZEN_POINT_CALLERS]) {
      expect(pointCallers, `${file} 已不再给 point，请从登记表删掉`).toContain(file)
    }
    expect(LEGACY_FROZEN_POINT_CALLERS.length).toBeLessThanOrEqual(LEGACY_FROZEN_MAX)
  })
})
