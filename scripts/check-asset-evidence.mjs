#!/usr/bin/env node
// check:asset-evidence 棘轮门岗（P0-1 来源取证）。
//
// 这道门岗守住两条规则：
//   1. connector / browser / user 等非生成类素材写入路径必须带完整来源证据（sourceEvidence）；
//   2. 旧字段 rightsStatus 不得再出现在新代码路径（迁移后只留 usageStatus）。
//
// 为什么这两条要做成门岗而不是文档：
//   - 新路径写漏 sourceEvidence，用户层完全看不出来——素材卡静默缺署名信息；
//     只有审计/导出时才暴露，远迟于写入。
//   - rightsStatus 字段名和值毫无警示性，写的人不会察觉它已被弃用。
//   - 两条都能 grep，做棘轮代价低；靠 review 靠自觉管不住这种静默路径。
//
// 棘轮规则：基线只减不增（violations 数 ≤ baseline 数 才放行）。
//   - 新路径触发 → 立即红灯，不得以「先记到基线里」绕过。
//   - 存量清 0 后 baseline 对应计数降到 0，之后再引入即红。
//
// 基线文件：scripts/asset-evidence-baseline.json（与此脚本同目录）。
// 更新基线：node scripts/check-asset-evidence.mjs --update-baseline
//   （用于首次建立或存量缩减后下调基线，禁用于掩盖新引入的违规）。

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BASELINE_FILE = path.join(repoRoot, 'scripts/asset-evidence-baseline.json')
const UPDATE_BASELINE = process.argv.includes('--update-baseline')

// ── 抹注释（逐行等高，不改行号，防 file:line 偏移）────────────────────────
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ''))
    .replace(/^[^\S\n]*\/\/.*$/gm, '')
}

// ── 收集扫描文件 ─────────────────────────────────────────────────────────────
function collect() {
  const files = []
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'dist-electron') continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (/\.(tsx?|mts|cts)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) files.push(full)
    }
  }
  walk(path.join(repoRoot, 'electron'))
  // src/ 不包含 connector 写入路径，仅扫 electron/
  return files
}

// ── 规则定义 ─────────────────────────────────────────────────────────────────
const RULES = [
  {
    id: 'deprecated-rights-status',
    label: '旧字段 rightsStatus 不得出现在新写入路径（usageStatus 是取代字段）',
    hint: '将 rightsStatus: "unknown" 改为 usageStatus: "rights_unknown"；connectorDefinition.ts 的类型声明中的 @deprecated 注释和 sanitizeSourceEvidence 的迁移读取不计入。',
    // 允许豁免文件（这些文件是定义层/迁移读取层，不是新写入路径）
    exemptFiles: [
      'electron/connectors/connectorDefinition.ts',    // 类型声明含 @deprecated 注释
      'electron/assets/projectAssetStore.ts',          // sanitizeSourceEvidence 的迁移读取
    ],
    scan(code, file) {
      const hits = []
      // 过滤豁免文件
      if (this.exemptFiles.some(exempt => file.includes(exempt.replace(/\//g, path.sep)))) return hits
      code.split('\n').forEach((line, i) => {
        // 匹配 rightsStatus 字段赋值或字面量（排除纯字符串比较如 === 'unknown'）
        if (/rightsStatus\s*:\s*['"]/.test(line) || /['"]rightsStatus['"]\s*:/.test(line)) {
          hits.push({ line: i + 1, text: line.trim().slice(0, 120), file })
        }
      })
      return hits
    },
  },
  {
    id: 'missing-source-evidence',
    label: 'connector 来源写入 importRemoteAsset / moveAssetFile 缺少 sourceEvidence',
    hint: '非生成类（kind !== "generated"）的 importRemoteAsset / moveAssetFile 调用必须带 sourceEvidence 字段；浏览器/connector 来源的素材写入路径都需要取证字段。检查调用处是否传入了 { sourceEvidence: ... }。',
    // 已知豁免：
    //   - 生成类（kind: "generated"）不需要 sourceEvidence（AI 生成内容有 certificationEvidence）
    //   - IPC 转发层（main.ts）只是把渲染层 payload 转给 importRemoteAsset，
    //     该函数内部自己调用 sanitizeSourceEvidence 处理 sourceEvidence 字段——不是新写入路径
    exemptFiles: [
      'electron/image/decomposeLayers.ts',    // kind: "generated"，AI 合成层
      'electron/runtime.ts',                  // localizeTaskAsset，kind: "generated"
      'electron/main.ts',                     // IPC 转发层，importRemoteAsset 内部处理 sourceEvidence
    ],
    scan(code, file) {
      const hits = []
      if (this.exemptFiles.some(exempt => file.includes(exempt.replace(/\//g, path.sep)))) return hits
      const lines = code.split('\n')
      // 寻找 importRemoteAsset / moveAssetFile 调用块，检查是否有 sourceEvidence
      // 策略：找到函数调用起点后，向后扫 20 行（通常一个调用块不超过 20 行）看有没有 sourceEvidence
      lines.forEach((line, i) => {
        if (/\b(importRemoteAsset|moveAssetFile)\s*\(/.test(line)) {
          // 取接下来最多 25 行（含当前行）拼成一个窗口
          const window = lines.slice(i, i + 25).join('\n')
          // 跳过 generated 类型（这些不需要 sourceEvidence）
          if (/kind\s*:\s*['"]generated['"]/.test(window)) return
          // 跳过只是函数声明本身（定义处不是调用处）
          if (/^(export\s+)?(async\s+)?function\s+(importRemoteAsset|moveAssetFile)\s*\(/.test(lines[i])) return
          // 没有 sourceEvidence → 报告
          if (!/sourceEvidence/.test(window)) {
            hits.push({ line: i + 1, text: line.trim().slice(0, 120), file })
          }
        }
      })
      return hits
    },
  },
]

// ── 扫描主逻辑 ───────────────────────────────────────────────────────────────
const files = collect()
const results = {}
let totalHits = 0
let hasNewViolations = false

for (const rule of RULES) {
  const ruleHits = []
  for (const file of files) {
    let source
    try {
      source = fs.readFileSync(file, 'utf8')
    } catch {
      continue
    }
    const clean = stripComments(source)
    const hits = rule.scan(clean, file)
    ruleHits.push(...hits)
  }
  results[rule.id] = ruleHits
  totalHits += ruleHits.length
}

// ── 基线比对 ─────────────────────────────────────────────────────────────────
let baseline = {}
if (fs.existsSync(BASELINE_FILE)) {
  try {
    baseline = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'))
  } catch {
    baseline = {}
  }
}

if (UPDATE_BASELINE) {
  const newBaseline = {}
  for (const rule of RULES) {
    newBaseline[rule.id] = results[rule.id].length
  }
  fs.writeFileSync(BASELINE_FILE, JSON.stringify(newBaseline, null, 2) + '\n')
  console.log('✅ asset-evidence baseline 已更新：')
  for (const rule of RULES) {
    console.log(`   ${rule.id}: ${newBaseline[rule.id]} 处`)
  }
  process.exit(0)
}

// ── 报告与退出码 ─────────────────────────────────────────────────────────────
let exitCode = 0
for (const rule of RULES) {
  const hits = results[rule.id]
  const baselineCount = baseline[rule.id] ?? 0
  const isNew = hits.length > baselineCount
  if (isNew) hasNewViolations = true

  if (hits.length > 0) {
    const status = isNew ? '🔴 NEW VIOLATIONS' : '🟡 BASELINE'
    console.log(`\n${status} [${rule.id}] ${hits.length} 处（baseline ${baselineCount}）`)
    console.log(`  规则：${rule.label}`)
    console.log(`  修法：${rule.hint}`)
    for (const hit of hits.slice(0, 10)) {
      const rel = path.relative(repoRoot, hit.file)
      console.log(`    ${rel}:${hit.line}  ${hit.text}`)
    }
    if (hits.length > 10) {
      console.log(`    … 另 ${hits.length - 10} 处（运行 --update-baseline 后查看完整列表）`)
    }
    if (isNew) exitCode = 1
  } else {
    console.log(`✅ [${rule.id}] 0 处（baseline ${baselineCount}）`)
  }
}

if (exitCode !== 0) {
  console.log('\n❌ check:asset-evidence 失败：存在超出基线的违规（基线只减不增）。')
  console.log('   修复违规后再运行；禁止用 --update-baseline 掩盖新引入的违规。')
} else if (totalHits === 0) {
  console.log('\n✅ check:asset-evidence 全绿（0 处违规）')
} else {
  console.log('\n✅ check:asset-evidence 通过（存量在基线以内，继续清零中）')
}

process.exit(exitCode)
