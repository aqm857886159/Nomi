// 功能地图的静态守卫（check:walkthroughs 里跑）：
//   ① 技能和地图里写的每个 `ui.mjs goto <名>` 都在 verifyFeatures.mjs 里；
//   ② 每个功能列的出口（模块#函数）都真实存在、是函数；
//   ③ verifyFeatures.mjs 自己不写选择器（只调出口，10-15 方向检查）；
//   ④ 地图每份功能文件有固定四节，README 索引列全；技能里写的每条 ui.mjs 命令都是驱动认的命令。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const UX = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(UX, '../..')
const SKILL_DIR = path.join(repoRoot, '.agents/skills/verify-nomi')
const FEATURE_DIR = path.join(SKILL_DIR, 'features')
const SECTIONS = ['Sub-features', 'How to get to it (user POV)', 'Driving it with ui.mjs', 'Gotchas']

const { FEATURES, EXIT_MODULES } = await import('./verifyFeatures.mjs')

/** 文本里所有 `ui.mjs goto <名>`。 */
export function gotoNames(text) {
  return [...text.matchAll(/ui\.mjs goto ([\w-]+)/g)].map((match) => match[1])
}

/** 一个出口串 `模块#函数` 在 EXIT_MODULES 里是不是真函数。 */
export function exitProblem(exit, modules = EXIT_MODULES) {
  const [file, name] = exit.split('#')
  const mod = modules[file]
  if (!mod) return `${exit}：模块 ${file} 不在出口模块表里`
  if (typeof mod[name] !== 'function') return `${exit}：${file} 没有导出函数 ${name}`
  return null
}

const docs = () => [path.join(SKILL_DIR, 'SKILL.md'), ...fs.readdirSync(FEATURE_DIR).filter((name) => name.endsWith('.md')).map((name) => path.join(FEATURE_DIR, name))]

test('every goto name in the skill and the feature map resolves to a feature', () => {
  const unknown = []
  for (const file of docs()) {
    for (const name of gotoNames(fs.readFileSync(file, 'utf8'))) {
      if (!Object.prototype.hasOwnProperty.call(FEATURES, name)) unknown.push(`${path.relative(repoRoot, file)}: goto ${name}`)
    }
  }
  assert.deepEqual(unknown, [])
})

test('every feature is mapped somewhere and every declared exit really exists', () => {
  const mapped = new Set(docs().flatMap((file) => gotoNames(fs.readFileSync(file, 'utf8'))))
  const problems = []
  for (const [name, feature] of Object.entries(FEATURES)) {
    if (!mapped.has(name)) problems.push(`${name}：地图里没有任何一份文件写 ui.mjs goto ${name}`)
    if (!Array.isArray(feature.exits) || !feature.exits.length) problems.push(`${name}：没列出口`)
    for (const exit of feature.exits ?? []) {
      const problem = exitProblem(exit)
      if (problem) problems.push(`${name}：${problem}`)
    }
  }
  assert.deepEqual(problems, [])
})

test('declared exits match what goto actually calls', () => {
  const source = fs.readFileSync(path.join(UX, 'verifyFeatures.mjs'), 'utf8')
  const aliases = { shell: '_shell.mjs', creationTree: '_creationResourceTree.mjs', modeMenu: '_modeMenu.mjs', lab: 'uiDriverLab.mjs' }
  const declared = new Set(Object.values(FEATURES).flatMap((feature) => feature.exits))
  const called = [...source.matchAll(/\b(shell|creationTree|modeMenu|lab)\.(\w+)\(/g)].map((match) => `${aliases[match[1]]}#${match[2]}`)
  const undeclared = [...new Set(called)].filter((exit) => !declared.has(exit) && exit !== '_shell.mjs#describeShellLocation')
  assert.deepEqual(undeclared, [], '调到了出口却没在任何功能的 exits 里登记（静态检查就看不见它被删）')
})

test('verifyFeatures.mjs writes no selectors of its own', () => {
  const code = fs.readFileSync(path.join(UX, 'verifyFeatures.mjs'), 'utf8').replace(/\/\/.*$/gm, '')
  const hits = ['.locator(', 'getByRole(', 'getByText(', 'querySelector', '[data-', '.click('].filter((needle) => code.includes(needle))
  assert.deepEqual(hits, [], '选择器只住出口模块（_shell.mjs 等），功能表只调出口')
})

test('feature files keep the four sections and the README lists them all', () => {
  const readme = fs.readFileSync(path.join(FEATURE_DIR, 'README.md'), 'utf8')
  const problems = []
  for (const name of fs.readdirSync(FEATURE_DIR).filter((file) => file.endsWith('.md') && file !== 'README.md')) {
    const text = fs.readFileSync(path.join(FEATURE_DIR, name), 'utf8')
    const h2 = [...text.matchAll(/^## (.+)$/gm)].map((match) => match[1].trim())
    if (JSON.stringify(h2) !== JSON.stringify(SECTIONS)) problems.push(`${name}：四节应为 ${SECTIONS.join(' / ')}，实际 ${h2.join(' / ')}`)
    if (!readme.includes(`(./${name})`)) problems.push(`${name}：README 索引里没有它`)
  }
  assert.deepEqual(problems, [])
})

test('every ui.mjs command the skill teaches is one the client accepts', () => {
  const client = fs.readFileSync(path.join(UX, 'ui.mjs'), 'utf8')
  const accepted = JSON.parse(client.match(/const ACTIONS = (\[[^\]]+\])/)[1].replace(/'/g, '"'))
  const unknown = []
  for (const file of docs()) {
    for (const match of fs.readFileSync(file, 'utf8').matchAll(/tests\/ux\/ui\.mjs ([a-z-]+)/g)) {
      if (!accepted.includes(match[1])) unknown.push(`${path.relative(repoRoot, file)}: ${match[1]}`)
    }
  }
  assert.deepEqual(unknown, [])
})
