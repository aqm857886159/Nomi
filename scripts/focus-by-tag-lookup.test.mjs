// 聚焦输入框只经它的主人的三道保险（方向检查 docs/engineering/direction-checks/2026-10-27-focus-by-tag-lookup.md）：
// ① 反例必红、正例必绿：选择器认写法（语法树），修之前的 ShellAgentHost.tsx 原文件必须红；
// ② 全仓普查：同一组选择器扫 src，命中只许出现在登记的出口名单（FOCUS_BY_INPUT_IMPL_EXITS）里，且每个文件的处数等于登记的数（只减不增，少了也红）；
// ③ 接线：仓库 eslint 配置在名单外的真实路径上报 focus-owner/no-restricted-syntax，测试文件与名单里的文件不报。
// 走查侧（tests/ux、evals 判焦点不按标签名）同样三道：修之前那一句必红、普查与登记的出口名单（WALK_FOCUS_BY_TAG_EXITS）逐一相等、真实路径接线。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { ESLint } from 'eslint'
import tseslint from 'typescript-eslint'
import { beforeAll, describe, expect, it } from 'vitest'

import { FOCUS_BY_INPUT_IMPL_EXITS, FOCUS_BY_INPUT_IMPL_SELECTORS, WALK_FOCUS_BY_TAG_EXITS, WALK_FOCUS_BY_TAG_SELECTORS } from './focus-by-tag-lookup.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
/** 修之前的 src/ui/app-shell/shell/ShellAgentHost.tsx 原文（focusComposerSoon 按 textarea 找输入框那一版）。 */
const BEFORE_SHELL_HOST = fs.readFileSync(path.join(root, 'scripts/fixtures/focus-by-tag-lookup/ShellAgentHost.before.tsx.txt'), 'utf8')

// 只开这一条规则、不读仓库配置的计数器：名单里的文件也照数（同 ui-money-format.test.mjs 的做法）。
const counter = new ESLint({
  cwd: root,
  overrideConfigFile: true,
  overrideConfig: {
    files: ['**/*.{ts,tsx}'],
    languageOptions: { parser: tseslint.parser, parserOptions: { ecmaFeatures: { jsx: true } } },
    rules: { 'no-restricted-syntax': ['error', ...FOCUS_BY_INPUT_IMPL_SELECTORS] },
  },
})
async function hits(source, filePath) {
  const [result] = await counter.lintText(source, { filePath })
  const fatal = result.messages.find((message) => message.fatal)
  if (fatal) throw new Error(`${path.relative(root, filePath)} 解析失败，普查会漏数：${fatal.message}`)
  return result.messages.filter((message) => message.ruleId === 'no-restricted-syntax').length
}
const probe = (source) => hits(source, path.join(root, 'src/workbench/focusLookupProbe.tsx'))

describe('写法：按输入框的实现找它再聚焦必红，经主人 / 按主人声明的锚点必绿', () => {
  it('修之前的 ShellAgentHost.tsx 原文件必红（focusComposerSoon 找 #project-agent-resident textarea，一处）', async () => {
    expect(await hits(BEFORE_SHELL_HOST, path.join(root, 'src/ui/app-shell/shell/ShellAgentHost.tsx'))).toBe(1)
  })

  const red = [
    // 原 bug 的形状（变量 + if），以及「换个选择器接着猜」的几种修法。
    "function f() { const input = document.querySelector<HTMLTextAreaElement>('#project-agent-resident textarea'); if (input) input.focus() }",
    'function f() { const input = document.querySelector(\'#project-agent-resident [contenteditable="true"]\'); input?.focus() }',
    "function f() { const input = document.querySelector('#project-agent-resident .ProseMirror'); input?.focus() }",
    "function f() { document.querySelector<HTMLElement>('.tiptap')?.focus() }",
    // 链式、可选链、强转、非空断言、下标。
    "function f(ref) { ref.current?.querySelector('input')?.focus() }",
    "function f(root) { (root.querySelector('textarea') as HTMLElement).focus() }",
    "function f(root) { root.querySelector('select')!.focus() }",
    "function f(root) { root.querySelectorAll<HTMLElement>('input')[0].focus() }",
    "function f(el) { el.closest<HTMLElement>('textarea')?.focus() }",
    "function f(root) { root.getElementsByTagName('input')[0].focus() }",
    // 选择器列表 / 组合选择器 / 大写标签 / 模板字符串里的标签。
    "function f(section) { const target = section.querySelector<HTMLElement>('button, input, [tabindex]'); target?.focus() }",
    "function f(field) { const target = field.matches('input, textarea, button') ? field : field.querySelector<HTMLElement>('input, textarea, button'); target?.focus() }",
    "function f(root) { root.querySelector('form > INPUT')?.focus() }",
    'function f(id) { const box = document.querySelector(`#${id} textarea`); box?.focus() }',
    'function f(id) { document.querySelector<HTMLElement>(`[data-row="${id}"] [contenteditable]`)?.focus() }',
    // 在 effect / 回调里取、在同一个函数里聚焦。
    "export function useX(rootRef) { React.useEffect(() => { const el = rootRef.current?.querySelector<HTMLInputElement>('input'); el?.focus() }, [rootRef]) }",
  ]
  for (const source of red) {
    it(`红：${source.slice(0, 110)}`, async () => {
      expect(await probe(source)).toBe(1)
    })
  }

  const green = [
    // 经主人：ref、编辑器实例、请求。
    'function f(ref) { ref.current?.focus() }',
    "function f(editor) { editor.commands.focus('end') }",
    'function f() { requestResidentComposerFocus() }',
    // 区域里第一个能聚焦的控件：tabbable。
    'function f(section) { tabbable(section)[0]?.focus({ preventScroll: true }) }',
    // 按主人声明的 data 属性 / role / id 找。
    "function f(root) { root.querySelector<HTMLElement>('[data-model-settings-autofocus]')?.focus() }",
    'function f(root) { const box = root.querySelector<HTMLElement>(\'[data-v4-control="input"]\'); box?.focus() }',
    "function f(root) { root.querySelector<HTMLElement>('[role=\"textbox\"]')?.focus() }",
    "function f(root) { root.querySelector<HTMLElement>('.input-row')?.focus() }",
    "function f() { document.querySelector<HTMLElement>('#input')?.focus() }",
    "function f(root) { root.querySelector<HTMLElement>('[data-input]')?.focus() }",
    // 判断事件来自哪类控件（不聚焦它）。
    "function f(event, row) { if (event.target.closest('input, textarea, [contenteditable=\"true\"]')) return; row.focus() }",
    "function f(event, row) { const editable = event.target.closest('input, textarea'); if (editable) return; row.focus() }",
    // 查了标签但不聚焦。
    "function f(root) { return root.querySelectorAll('input[type=\"checkbox\"]').length }",
    // JSX 属性里的选择器字符串不是查询（react-rnd 的 cancel）。
    "export const A = () => <Rnd cancel=\"button, input, textarea, [contenteditable='true']\" />",
  ]
  for (const source of green) {
    it(`绿：${source.slice(0, 110)}`, async () => {
      expect(await probe(source)).toBe(0)
    })
  }
})

function sourceFiles(dir) {
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      // 设计实验室在 eslint 全局 ignores 里，不上生产界面；测试不在规则范围里。
      if (entry.name === '__tests__' || entry.name === 'node_modules' || full === path.join(root, 'src/devlab')) continue
      out.push(...sourceFiles(full))
    } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
      out.push(full)
    }
  }
  return out
}

describe('普查：现存的只在名单里，只减不增', () => {
  const census = {}
  // 全 src 逐个解析：2026-10-27 本机 1635 个文件约 6 秒，满载的机器上可能翻几倍，放宽到 120 秒（只放宽，不缩短）。
  beforeAll(async () => {
    for (const file of sourceFiles(path.join(root, 'src'))) {
      const count = await hits(fs.readFileSync(file, 'utf8'), file)
      if (count > 0) census[path.relative(root, file).replaceAll(path.sep, '/')] = count
    }
  }, 120_000)

  it('src 下每个文件的命中处数与名单逐一相等，名单外 0 处', () => {
    const expected = Object.fromEntries(Object.entries(FOCUS_BY_INPUT_IMPL_EXITS).map(([file, exit]) => [file, exit.count]))
    expect(census).toEqual(expected)
  })
})

// ── 走查侧：判焦点、认输入框不按标签名 ──
const walkCounter = new ESLint({
  cwd: root,
  overrideConfigFile: true,
  overrideConfig: [
    { files: ['**/*.{js,mjs,cjs}'], rules: { 'no-restricted-syntax': ['error', ...WALK_FOCUS_BY_TAG_SELECTORS] } },
    {
      files: ['**/*.{ts,tsx,mts,cts}'],
      languageOptions: { parser: tseslint.parser, parserOptions: { ecmaFeatures: { jsx: true } } },
      rules: { 'no-restricted-syntax': ['error', ...WALK_FOCUS_BY_TAG_SELECTORS] },
    },
  ],
})
async function walkHits(source, filePath) {
  const [result] = await walkCounter.lintText(source, { filePath })
  const fatal = result.messages.find((message) => message.fatal)
  if (fatal) throw new Error(`${path.relative(root, filePath)} 解析失败，普查会漏数：${fatal.message}`)
  return result.messages.filter((message) => message.ruleId === 'no-restricted-syntax').length
}
const walkProbe = (source) => walkHits(`${source}\n`, path.join(root, 'tests/ux/focusLookupProbe.walk.mjs'))
/** 修之前 tests/ux/shell-redesign.walk.mjs 判 ⌘J 焦点的那一句（原文，补成完整语句）。 */
const BEFORE_WALK_ASSERT = "await expect.poll(() => win.evaluate(() => Boolean(document.activeElement?.closest('#project-agent-resident') && document.activeElement?.tagName === 'TEXTAREA')),\n  { message: 'Ctrl+J 打开后焦点不在 Agent 输入框', timeout: stationTimeout() }).toBe(true)"

describe('走查：按标签名判焦点 / 认输入框必红，统一出口与按主人锚点判必绿', () => {
  it('修之前 shell-redesign 走查判 ⌘J 焦点的那一句必红', async () => {
    expect(await walkProbe(BEFORE_WALK_ASSERT)).toBe(1)
  })

  const red = [
    "const ok = await win.evaluate(() => document.activeElement?.nodeName !== 'INPUT')",
    "const ok = await win.evaluate(() => document.activeElement?.tagName.toLowerCase() === 'textarea')",
    "const ok = await win.evaluate(() => 'TEXTAREA' === document.activeElement?.tagName)",
    "const ok = await win.evaluate(() => { const active = document.activeElement; return active?.tagName === 'INPUT' })",
    'const ok = await win.evaluate(() => document.activeElement instanceof HTMLTextAreaElement)',
    'const ok = await win.evaluate(() => document.activeElement instanceof window.HTMLInputElement)',
    "const ok = await win.evaluate(() => Boolean(document.activeElement?.matches('#project-agent-resident textarea')))",
    "const ok = await win.evaluate(() => Boolean(document.activeElement?.closest('form')?.matches('select')))",
    "const ok = await win.evaluate(() => document.activeElement?.matches('button, input'))",
    "const ok = await win.evaluate((id) => document.activeElement?.matches(`#${id} textarea`), 'x')",
  ]
  for (const source of red) {
    it(`红：${source.slice(0, 110)}`, async () => {
      expect(await walkProbe(source)).toBe(1)
    })
  }

  const green = [
    "await expectComposerFocused(win, CANVAS_PANEL, 'm', stationTimeout())",
    // expectComposerFocused 自己：按 composer 锚点 + contenteditable 判。
    'const ok = await page.evaluate(({ panel, input }) => { const active = document.activeElement; return active instanceof HTMLElement && active.isContentEditable && active.matches(input) && Boolean(active.closest(panel)) }, {})',
    "const ok = await win.evaluate(() => Boolean(document.activeElement?.matches('[data-v4-control=\"input\"]')))",
    "const ok = await win.evaluate(() => Boolean(document.activeElement?.closest('.input-row')))",
    'await expect(prompt).toBeFocused()',
    // 别的标签、只读标签名打日志、事件来自哪类控件（不是判焦点）。
    "const small = rects.filter(({ el }) => el.tagName === 'A')",
    "console.error('Focused element:', await win.evaluate(() => ({ tag: document.activeElement?.tagName })))",
    "const decoded = await node.evaluate((el) => (el.tagName === 'IMG' ? el.naturalWidth : el.videoWidth))",
    "const inside = await row.evaluate((el) => Boolean(el.closest('input')))",
  ]
  for (const source of green) {
    it(`绿：${source.slice(0, 110)}`, async () => {
      expect(await walkProbe(source)).toBe(0)
    })
  }
})

function walkFiles(dir) {
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'shots') continue
      out.push(...walkFiles(full))
    } else if (/\.(?:js|mjs|cjs|ts|tsx|mts|cts)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
      out.push(full)
    }
  }
  return out
}

describe('普查：tests/ux 与 evals 里按标签名判焦点的写法只在名单里，只减不增', () => {
  const census = {}
  beforeAll(async () => {
    for (const dir of ['tests/ux', 'evals']) {
      for (const file of walkFiles(path.join(root, dir))) {
        const count = await walkHits(fs.readFileSync(file, 'utf8'), file)
        if (count > 0) census[path.relative(root, file).replaceAll(path.sep, '/')] = count
      }
    }
  }, 120_000)

  it('每个文件的命中处数与名单逐一相等，名单外 0 处', () => {
    expect(census).toEqual(Object.fromEntries(Object.entries(WALK_FOCUS_BY_TAG_EXITS).map(([file, exit]) => [file, exit.count])))
  })
})

describe('接线：仓库 eslint 配置真的在用这条规则', () => {
  const repoLint = new ESLint({ cwd: root })
  const source = "export function f() { const input = document.querySelector<HTMLTextAreaElement>('#project-agent-resident textarea'); input?.focus() }\n"
  const ruleHits = async (relativePath) => {
    const [result] = await repoLint.lintText(source, { filePath: path.join(root, relativePath) })
    return result.messages.filter((message) => message.ruleId === 'focus-owner/no-restricted-syntax').length
  }

  it.each(['src/ui/app-shell/shell/ShellAgentHost.tsx', 'src/workbench/ai/residentComposerFocus.ts', 'src/workbench/assets/FindReferencePanel.tsx'])('名单外的真实路径 %s 报', async (file) => {
    expect(await ruleHits(file)).toBe(1)
  })

  it.each(['src/workbench/ai/residentComposerFocus.test.tsx', ...Object.keys(FOCUS_BY_INPUT_IMPL_EXITS)])('测试文件与名单里的文件 %s 不报（名单里的处数由普查卡死）', async (file) => {
    expect(await ruleHits(file)).toBe(0)
  })

  const walkRuleHits = async (relativePath) => {
    const [result] = await repoLint.lintText(`${BEFORE_WALK_ASSERT}\n`, { filePath: path.join(root, relativePath) })
    return result.messages.filter((message) => message.ruleId === 'focus-owner/no-restricted-syntax').length
  }

  it.each(['tests/ux/shell-redesign.walk.mjs', 'tests/ux/agent-runtime-walk-support.mjs', 'evals/loop/appBridge.mjs'])('走查侧的真实路径 %s 报修之前那一句', async (file) => {
    expect(await walkRuleHits(file)).toBe(1)
  })

  it.each(Object.keys(WALK_FOCUS_BY_TAG_EXITS))('走查侧名单里的文件 %s 不报（处数由普查卡死）', async (file) => {
    expect(await walkRuleHits(file)).toBe(0)
  })
})
