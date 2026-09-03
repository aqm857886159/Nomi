import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 「能力桥接槽」的注册者存在性回归。
 *
 * 机制（不是某一个 bug 的复现）：store 里有一类槽存的不是数据而是**能力**——某个组件挂载时
 * 把一个函数/接口注册进来，别处按需调用。这类槽天生可空（组件没挂载时就是 null），于是调用方
 * 普遍写成 `slot?.()` 或 `slot ? <按钮/> : null`。**一旦注册者被删掉或搬走，整个功能静默哑掉，
 * 而且长得和「这里本来就没东西」一模一样**——没有报错、没有日志、UI 上只是点了没反应。
 *
 * 真实事故：2026-09-01 的 agent-host 移植（d270d34e）用 ProjectAgentResidentShell 换掉旧的创作
 * AI 面板，而旧面板是 `storyboardPlannerLauncher` 的**唯一注册者**。拆镜头功能整条哑掉，两处
 * 调用方各自静默降级（侧栏按钮点了没反应、选中浮条按钮直接不渲染），直到 2026-09-03 一次真实
 * 付费闭环走查才撞见。全套 CI 门岗当时是绿的——因为「没有注册者」在类型上完全合法。
 *
 * 通用处置：这类槽逐个钉住「至少有一个注册者」。目前全仓只有两个（见下表），所以用一条测试而
 * 不是一个 check:* 脚本——为两个实例造门岗是过度工程（R20）。**新增此类槽时必须在这里登记**，
 * 否则下一次搬运还会静默丢掉它。
 */
const SRC = path.join(process.cwd(), 'src')

const CAPABILITY_BRIDGE_SLOTS = [
  {
    setter: 'setCreationDocumentTools',
    what: '文稿编辑桥（读全文/选区、按锚点写入）',
    registrar: 'src/workbench/creation/WorkbenchEditor.tsx',
  },
  {
    setter: 'setStoryboardPlannerLauncher',
    what: '拆镜头入口（侧栏「新建分镜方案」/ 选中浮条调用）',
    registrar: 'src/workbench/ai/ProjectAgentResidentShell.tsx',
  },
] as const

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return walk(full)
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : []
  })
}

const sources = walk(SRC).map((file) => ({ file, text: fs.readFileSync(file, 'utf8') }))

describe('能力桥接槽必须有注册者', () => {
  it.each(CAPABILITY_BRIDGE_SLOTS)('$setter（$what）', ({ setter, registrar }) => {
    // 注册 = 用**非 null** 实参调用 setter。清理路径的 `setter(null)` 不算注册者——
    // 只剩清理调用正是「注册者被删干净了」的样子。
    const registrations = sources.filter(({ text }) =>
      new RegExp(`${setter}\\((?!null\\))`).test(text)
      // Zustand 的 selector 取出后再调用也算：`const set = useStore(s => s.setX); ... set(value)`
      || new RegExp(`${setter}\\b[\\s\\S]{0,4000}?\\n\\s*(?:set[A-Za-z]*|launch|register)\\w*\\((?!null\\))`).test(text),
    )
    expect(
      registrations.map(({ file }) => path.relative(process.cwd(), file)),
    ).toContain(registrar)
  })
})
