// 助手面板里读原始选区字段只经选区主人的三道保险（设计卡 docs/plan/2026-11-17-agent-selection-one-home.md ★9）：
// ① 反例必红、正例必绿：选择器认语法树写法（点号、可选链、方括号、解构、选择器函数）；
// ② 接线：仓库 eslint 配置在助手面板目录的真实路径上报 resident-selection/no-restricted-syntax，主人两个文件、测试文件、别的目录不报；
// ③ 全仓现状（助手面板目录里除主人外一处都没有）由仓库的 eslint 运行本身守，这里不重复普查。
// 缺口照实写：换了名字自己重建成员、把整个状态传出去再读，这条规则看不见（见 scripts/resident-selection-owner.mjs 的说明）。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { ESLint } from 'eslint'
import tseslint from 'typescript-eslint'
import { describe, expect, it } from 'vitest'

import { RESIDENT_SELECTION_OWNER_FILES, RESIDENT_SELECTION_SELECTORS } from './resident-selection-owner.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const counter = new ESLint({
  cwd: root,
  overrideConfigFile: true,
  overrideConfig: {
    files: ['**/*.{ts,tsx}'],
    languageOptions: { parser: tseslint.parser, parserOptions: { ecmaFeatures: { jsx: true } } },
    rules: { 'no-restricted-syntax': ['error', ...RESIDENT_SELECTION_SELECTORS] },
  },
})
async function hits(source) {
  const [result] = await counter.lintText(source, { filePath: path.join(root, 'src/workbench/ai/probe.tsx') })
  const fatal = result.messages.find((message) => message.fatal)
  if (fatal) throw new Error(`探针解析失败：${fatal.message}`)
  return result.messages.filter((message) => message.ruleId === 'no-restricted-syntax').length
}

describe('写法：读原始选区字段必红，只拿主人的结果必绿', () => {
  const red = [
    // 发送端自己取选区再塞 target（修之前 useAgentPanelV4Actions 的写法）。
    'const ids = useWorkbenchStore.getState().selectedTimelineClipIds',
    'function f(workbench) { return Object.freeze([...workbench.selectedTimelineClipIds]) }',
    'function f(canvas) { return canvas.selectedNodeIds }',
    // 芯片端订阅（修之前 useAgentPanelV4Data 的写法）。
    'const ids = useWorkbenchStore((state) => state.selectedTimelineClipIds)',
    'const text = useWorkbenchStore((state) => state.selectedTextClipId)',
    // 改名 / 别名 / 可选链 / 方括号 / 解构。
    'const picked = state.selectedNodeIds; const copy = picked',
    'const ids = state?.selectedNodeIds',
    "const ids = state['selectedTimelineClipIds']",
    'const { selectedTimelineClipIds } = useWorkbenchStore.getState()',
    'const { selectedNodeIds: mine } = canvas',
    "const { 'selectedTextClipId': t } = state",
    'const f = (s) => s.selectedTextClipId',
  ]
  for (const source of red) {
    it(`必红：${source}`, async () => { expect(await hits(source)).toBeGreaterThan(0) })
  }

  const green = [
    // 只拿主人的结果。
    'const selection = resolveResidentSelection(residentSelectionInput(surface, sources)); const ids = selection.timelineClipIds',
    'const { members } = useResidentTimelineMembers(surface)',
    // 别的名字、类型声明里的字段名、对象字面量传值不算读。
    'type T = { selectedNodeIds: string[] }',
    'const x = { selectedNodeIds: ids }',
    'const clipIds = selection.timelineClipIds',
  ]
  for (const source of green) {
    it(`必绿：${source}`, async () => { expect(await hits(source)).toBe(0) })
  }
})

describe('接线：真实仓库配置', () => {
  const repo = new ESLint({ cwd: root })
  const lint = async (relative, source) => {
    const [result] = await repo.lintText(source, { filePath: path.join(root, relative) })
    return result.messages.filter((message) => message.ruleId === 'resident-selection/no-restricted-syntax').length
  }
  const probe = 'export const ids = (state: { selectedTimelineClipIds: string[] }) => state.selectedTimelineClipIds\n'

  it('助手面板目录里的普通文件报红', async () => {
    expect(await lint('src/workbench/ai/v4/probeSelection.ts', probe)).toBe(1)
    expect(await lint('src/workbench/ai/resident/probeSelection.tsx', probe)).toBe(1)
  })

  it('选区主人两个文件、测试文件、别的目录不报', async () => {
    for (const owner of RESIDENT_SELECTION_OWNER_FILES) expect(await lint(owner, probe), owner).toBe(0)
    expect(await lint('src/workbench/ai/v4/probeSelection.test.ts', probe)).toBe(0)
    expect(await lint('src/workbench/timeline/probeSelection.ts', probe)).toBe(0)
  })

  it('主人文件真实存在（改名搬家时这里先红）', () => {
    for (const owner of RESIDENT_SELECTION_OWNER_FILES) expect(fs.existsSync(path.join(root, owner)), owner).toBe(true)
  })
})
