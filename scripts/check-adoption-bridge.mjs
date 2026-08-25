#!/usr/bin/env node
// P5 E1 铁律：生成画布不能绕过 Proposal 直接写时间轴。
// 采纳桥本身和素材库/轴内编辑是受控例外；本门岗只扫生成模块的直写入口。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const roots = [
  path.join(repoRoot, 'src/workbench/generationCanvas'),
  path.join(repoRoot, 'src/workbench/timeline/addNodeToTimelineEnd.ts'),
]

function stripCommentsAndStrings(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/(['"`])(?:\\.|(?!\1)[\s\S])*\1/g, '')
}

function collect(entry) {
  if (!fs.existsSync(entry)) return []
  if (fs.statSync(entry).isFile()) return [entry]
  const files = []
  for (const child of fs.readdirSync(entry, { withFileTypes: true })) {
    const full = path.join(entry, child.name)
    if (child.isDirectory() && child.name !== 'node_modules') files.push(...collect(full))
    else if (child.isFile() && /\.(tsx?|jsx?)$/.test(child.name)) files.push(full)
  }
  return files
}

const hits = []
for (const file of roots.flatMap(collect)) {
  const code = stripCommentsAndStrings(fs.readFileSync(file, 'utf8'))
  code.split('\n').forEach((line, index) => {
    if (/\baddTimelineClipAtFrame\s*\(/.test(line)) hits.push(`${path.relative(repoRoot, file)}:${index + 1}`)
  })
}

if (hits.length > 0) {
  console.error('✖ 生成模块存在绕过 Adoption Proposal 的时间轴直写：')
  for (const hit of hits) console.error(`  ${hit}`)
  console.error('→ 请改为 adoption/adoptGenerationNode 或 adoption/adoptStoryboardBatch。')
  process.exit(1)
}
console.log('✅ adoption bridge 铁律通过：生成模块无 addTimelineClipAtFrame 直写')
