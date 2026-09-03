#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const SOURCE_MEDIA_EXTENSIONS = new Set(['.mp4', '.mov', '.webm', '.mp3', '.wav', '.m4a', '.aac'])
const EVIDENCE_STATES = /\b(?:observed|documented|inferred|proposed|blocked)\b/

function collectFiles(directory) {
  const files = []
  if (!fs.existsSync(directory)) return files
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...collectFiles(file))
    else if (entry.isFile()) files.push(file)
  }
  return files
}

function markdownHasHeading(source, heading) {
  return new RegExp(`^##\\s+${heading}\\s*$`, 'mu').test(source)
}

function paragraphHasScreenshot(lines, actionIndex) {
  for (let index = actionIndex; index < lines.length && lines[index].trim() !== ''; index += 1) {
    if (/!\[[^\]]*\]\([^\n)]+\)/.test(lines[index])) return true
  }
  return false
}

function findActionsWithoutScreenshots(source, label) {
  const lines = source.split(/\r?\n/)
  const errors = []
  lines.forEach((line, index) => {
    if (!/^Action:\s*/u.test(line)) return
    if (!paragraphHasScreenshot(lines, index)) errors.push(`${label}:${index + 1} 的 Action 没有同段截图`)
  })
  return errors
}

export function validateReportDirectory(reportDirectory) {
  const errors = []
  const reportDir = path.resolve(reportDirectory)
  const readmePath = path.join(reportDir, 'README.md')
  const sourcePath = path.join(reportDir, 'report-source.md')
  const assetsPath = path.join(reportDir, 'assets')

  if (!fs.existsSync(reportDir) || !fs.statSync(reportDir).isDirectory()) {
    return { ok: false, errors: [`研究报告目录不存在：${reportDirectory}`] }
  }

  if (!fs.existsSync(readmePath)) errors.push('缺少 README.md')
  if (!fs.existsSync(sourcePath)) errors.push('缺少 report-source.md')
  if (!fs.existsSync(assetsPath) || !fs.statSync(assetsPath).isDirectory()) errors.push('缺少 assets/ 目录')

  const readme = fs.existsSync(readmePath) ? fs.readFileSync(readmePath, 'utf8') : ''
  const source = fs.existsSync(sourcePath) ? fs.readFileSync(sourcePath, 'utf8') : ''

  for (const heading of ['Scope', 'Evidence', 'Decision', 'Source ledger']) {
    if (!markdownHasHeading(readme, heading)) errors.push(`README.md 缺少 ## ${heading} 标题`)
  }

  if (!EVIDENCE_STATES.test(source)) errors.push('report-source.md 缺少证据状态：observed/documented/inferred/proposed/blocked')
  if (!/https:\/\//u.test(source)) errors.push('report-source.md 缺少 https:// 来源链接')

  errors.push(...findActionsWithoutScreenshots(readme, 'README.md'))
  errors.push(...findActionsWithoutScreenshots(source, 'report-source.md'))

  for (const file of collectFiles(reportDir)) {
    if (SOURCE_MEDIA_EXTENSIONS.has(path.extname(file).toLowerCase())) {
      errors.push(`禁止把源视频或源音频放进报告包：${path.relative(reportDir, file)}`)
    }
  }

  return { ok: errors.length === 0, errors }
}

function parseReportArgument(argv) {
  const reportFlags = argv.reduce((count, arg) => count + (arg === '--report' ? 1 : 0), 0)
  if (reportFlags !== 1) return null
  const index = argv.indexOf('--report')
  if (index !== 0 || !argv[index + 1] || argv.length !== 2) return null
  return argv[index + 1]
}

function runCli(argv) {
  const reportDirectory = parseReportArgument(argv)
  if (!reportDirectory) {
    console.error('用法：node scripts/check-competitive-research-report.mjs --report <报告目录>')
    return 2
  }

  const result = validateReportDirectory(reportDirectory)
  if (!result.ok) {
    console.error(`✖ 竞争研究报告门槛失败：${reportDirectory}`)
    for (const error of result.errors) console.error(`  - ${error}`)
    return 1
  }

  console.log(`✅ 竞争研究报告门槛通过：${reportDirectory}`)
  return 0
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null
if (invokedPath === import.meta.url) process.exitCode = runCli(process.argv.slice(2))

