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
import i18next from 'i18next'
import { describe, expect, it } from 'vitest'
import { enGenerationCommon, zhGenerationCommon } from '../i18n/locales/generationCommon'
import { sendCostUnitOptions } from '../workbench/generationCanvas/spend/sendCostFormat'

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

/**
 * 历史多段菜单 `min-w-[...]` 冻结登记（只减不增；新单组菜单一律内容派生宽度，0 豁免）：
 * 仅多分组带标题或 #1628 C11 像素冻结存量可登记，且必须写清多段对齐理由。
 */
const LEGACY_MIN_WIDTH_MENU_CALLERS: Readonly<Record<string, string>> = {
  'src/design/NomiOverflowRow.tsx': '窄窗多组工具溢出菜单（N4-creation-menu 拍板）：仅单个短按钮先溢出或跨多组分隔时保持溢出菜单最小可读宽度',
  'src/ui/app-shell/shell/ShellTopBar.tsx': '顶栏项目菜单含「最近项目」动态分组 + 两段分隔动作共三段，无最近项目或单字项目名时保持多段标题对齐',
}
const LEGACY_MIN_WIDTH_MAX = 2

export function findEmptyMenuGroups(source: string): string[] {
  const clean = stripComments(source)
  const re = /\bkind\s*:\s*['"]group['"][\s\S]{0,220}?\bitems\s*:\s*\[\s*\]/g
  return [...clean.matchAll(re)].map((m) => m[0])
}

export function findRepeatedTrailingPrefix(values: readonly string[]): string | null {
  const counts = new Map<string, number>()
  for (const raw of values) {
    const trimmed = raw.trim()
    // 提取开头非货币汉字词组（如「约 」「预计 」）或约号/波浪号前缀（`~` / `≈`）；货币符号（¥ / $ / € / £）本身不算重复词前缀。
    const match = /^(?:([~≈])\s*|([\u4e00-\u9fff]+)\s+)/.exec(trimmed)
    const prefix = (match?.[1] ?? match?.[2])?.trim()
    if (!prefix) continue
    const next = (counts.get(prefix) ?? 0) + 1
    counts.set(prefix, next)
    if (next >= 2) return prefix
  }
  return null
}

export function findLiteralRadioTrailingPrefixOffenders(source: string): string[] {
  const clean = stripComments(source)
  const offenders: string[] = []
  const radioBlocks = clean.matchAll(/\bkind\s*:\s*['"]radio['"][\s\S]{0,600}?\boptions\s*:\s*\[([\s\S]*?)\]/g)
  for (const block of radioBlocks) {
    const trailings = [...block[1].matchAll(/\btrailing\s*:\s*(['"`])((?:\\.|(?!\1).)*)\1/g)].map((m) => m[2])
    const repeated = findRepeatedTrailingPrefix(trailings)
    if (repeated) offenders.push(repeated)
  }
  return offenders
}

describe('WorkbenchMenu 排版与字段结构守卫（§1.5.2 第 4/5 条 & 会被数据撑开的地方 第 6 条）', () => {
  it('禁止 kind: "group" 传空字面量 items: [] 冒充菜单段落注脚', () => {
    expect(findEmptyMenuGroups("{ kind: 'group', id: 'note', label: '注脚', items: [] }")).toHaveLength(1)
    expect(findEmptyMenuGroups("{ kind: 'group', id: 'panels', label: '面板', items: [a] }")).toEqual([])
    const offenders = productionFiles
      .filter(({ source }) => findEmptyMenuGroups(source).length > 0)
      .map(({ file }) => file)
    expect(offenders, '空 group 不许冒充菜单底部说明段落；与某一项绑定的说明放进悬停提示或 description').toEqual([])
  })

  it('禁止 <WorkbenchMenu 调用方硬写 min-w-[...]（单组菜单一律内容派生宽度，历史多段菜单严格冻结）', () => {
    const minWidthCallers = menuFiles
      .filter(({ source }) => workbenchMenuTags(source).some((tag) => /\bmin-w-\[/.test(tag)))
      .map(({ file }) => file)
      .sort()
    const allowed = Object.keys(LEGACY_MIN_WIDTH_MENU_CALLERS)
    const unregistered = minWidthCallers.filter((file) => !allowed.includes(file))
    expect(unregistered, '菜单宽度由内容派生（必要时只设 max-w-[...] 截断超长名），禁止硬写 min-w-[...] 撑出大片空白').toEqual([])
    for (const [file, reason] of Object.entries(LEGACY_MIN_WIDTH_MENU_CALLERS)) {
      expect(reason.trim().length).toBeGreaterThan(10)
      expect(minWidthCallers, `${file} 已不再写 min-w-[...]，请从冻结表删掉`).toContain(file)
    }
    expect(allowed.length).toBeLessThanOrEqual(LEGACY_MIN_WIDTH_MAX)
  })

  it('禁止 radio 选项借用 shortcut 塞非快捷键数值，或 ≥2 项 trailing 重复同一非货币汉字/波浪号前缀', async () => {
    expect(findRepeatedTrailingPrefix(['约 1.95', '约 ¥1.31', '约 $0.195'])).toBe('约')
    expect(findRepeatedTrailingPrefix(['~1.95', '~¥1.31', '~$0.195'])).toBe('~')
    expect(findRepeatedTrailingPrefix(['1.95', '¥1.31', '$0.195'])).toBeNull()
    expect(findLiteralRadioTrailingPrefixOffenders(`{ kind: 'radio', options: [{ id: 'a', trailing: '约 1' }, { id: 'b', trailing: '约 ¥2' }] }`)).toEqual(['约'])

    // 1) radio options 里不许把数值塞进 shortcut（应用正牌 trailing 字段）。
    const radioShortcutAbusers = productionFiles
      .filter(({ source }) => /\bkind\s*:\s*['"]radio['"][\s\S]{0,500}?\boptions\s*:[\s\S]{0,400}?\bshortcut\s*:/.test(source))
      .map(({ file }) => file)
    expect(radioShortcutAbusers, 'radio 选项的数值/数量附注必须走 trailing，禁止借 shortcut 冒充').toEqual([])

    // 2) 源码字面量 radio options 不许 ≥2 项重复「约 / ~」等前缀。
    const literalPrefixOffenders = productionFiles
      .filter(({ source }) => findLiteralRadioTrailingPrefixOffenders(source).length > 0)
      .map(({ file }) => file)
    expect(literalPrefixOffenders).toEqual([])

    // 3) 数据驱动的约价单位菜单选项（中英双语）：组标题已统一写一次「预计 / Estimated」，每行 trailing 不许再重复前缀。
    for (const locale of ['zh-CN', 'en'] as const) {
      const inst = i18next.createInstance()
      await inst.init({ lng: locale, resources: { [locale]: { translation: { generationCommon: locale === 'en' ? enGenerationCommon : zhGenerationCommon } } } })
      const opts = sendCostUnitOptions({ credits: 1.95, usd: 0.195, source: 'https://api.apimart.ai/api/pricing/model' }, inst.t.bind(inst), locale)
      expect(findRepeatedTrailingPrefix(opts.map((o) => o.formatted)), `${locale} sendCostUnitOptions trailing 重复前缀`).toBeNull()
    }
  })
})
