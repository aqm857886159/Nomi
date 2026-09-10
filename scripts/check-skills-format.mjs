#!/usr/bin/env node
/**
 * 技能格式门岗（2026-09-07）。判据住在 scripts/skills-format-lib.mjs；本文件只扫盘、报红。
 *
 * 硬零，不做棘轮：棘轮只管总数，管不住「删掉一个合法技能、加进一个非法技能」——
 * 这里要的是每个技能各自合规，是一一对应关系。
 *
 * 方案：docs/plan/2026-09-07-skill-format-convergence.md
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { checkPiLoader, checkSkillDirectory, collectSkillDirectories } from './skills-format-lib.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
/**
 * 两个技能根，**都要合规**，但它们是两件不同的东西：
 *   · `skills/`       = Nomi 自己的技能库（工作台选得到、带封面、由 skillCuration.test.ts 另判 curation）
 *   · `agent-skills/` = **交给别人的宿主装的**技能包（Claude Code / Codex / WorkBuddy…）。
 *     它不进 Nomi 的技能库，所以没有 curation/封面；但它比库里那些更需要这道门——
 *     格式一歪，别人那边整包读不出来，而我们这边一点感觉都没有。
 * 加根就在这里加一行；判据一份，两根共用（不是各写一套）。
 */
const SKILL_ROOTS = ['skills', 'agent-skills']

const errors = []
const summaries = []
for (const relativeRoot of SKILL_ROOTS) {
  const skillsRoot = path.join(repoRoot, relativeRoot)
  const directories = collectSkillDirectories(skillsRoot)
  if (directories.length === 0) {
    console.error(`✖ ${relativeRoot} 里一个技能都没有——门岗不该在空目录上通过`)
    process.exit(1)
  }
  for (const { dirName, files } of directories) {
    for (const error of checkSkillDirectory(dirName, files)) errors.push({ ...error, root: relativeRoot })
  }
  const piResult = await checkPiLoader(skillsRoot, repoRoot)
  if (piResult.skipped) {
    console.error(`✖ F6 ${piResult.reason}`)
    process.exit(1)
  }
  for (const error of piResult.errors) errors.push({ ...error, root: relativeRoot })
  summaries.push(`${relativeRoot} ${directories.length} 个（pi 加载器 ${piResult.loaded}/${piResult.expected}）`)
}

if (errors.length > 0) {
  console.error(`✖ 技能格式门岗：${errors.length} 处不合规\n`)
  for (const error of errors) {
    console.error(`  [${error.rule}] ${error.root}/${error.dirName}：${error.message}`)
  }
  console.error('\n  格式规范见 docs/skill-pack-format.md；为什么收敛成一份见 docs/plan/2026-09-07-skill-format-convergence.md')
  process.exit(1)
}

console.log(`✓ 技能格式门岗：${summaries.join(' · ')}，全部合规、零 diagnostics`)
