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
const skillsRoot = path.join(repoRoot, 'skills')

const directories = collectSkillDirectories(skillsRoot)
if (directories.length === 0) {
  console.error(`✖ ${path.relative(repoRoot, skillsRoot)} 里一个技能都没有——门岗不该在空目录上通过`)
  process.exit(1)
}

const errors = []
for (const { dirName, files } of directories) {
  errors.push(...checkSkillDirectory(dirName, files))
}

const piResult = await checkPiLoader(skillsRoot, repoRoot)
if (piResult.skipped) {
  console.error(`✖ F6 ${piResult.reason}`)
  process.exit(1)
}
errors.push(...piResult.errors)

if (errors.length > 0) {
  console.error(`✖ 技能格式门岗：${directories.length} 个技能里有 ${errors.length} 处不合规\n`)
  for (const error of errors) {
    console.error(`  [${error.rule}] skills/${error.dirName}：${error.message}`)
  }
  console.error('\n  格式规范见 docs/skill-pack-format.md；为什么收敛成一份见 docs/plan/2026-09-07-skill-format-convergence.md')
  process.exit(1)
}

console.log(`✓ 技能格式门岗：${directories.length} 个技能全部合规，pi 加载器 ${piResult.loaded}/${piResult.expected}、零 diagnostics`)
