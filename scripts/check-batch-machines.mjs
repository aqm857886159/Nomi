// 批量机器门岗（P4 S7，2026-08-25）。守一条不变量：**批量生成只剩一台机器**（语义调度器）。
//
// 起因：P4 收敛审查发现三套并行批量机器长期共存（P1 违规存量）：
//   ① 语义调度器 multiShotBatchScheduler（正牌：无自有状态派生、合同/收据/预算/检查点/慢供应商韧性）；
//   ② brand.promo driveGeneration（legacy 顺序循环，已退役；未提交 job 只转 needs_attention）；
//   ③ GUI 画布 runner runGenerationNodesByPlan/Batch（渲染层自有派发，无 Run/receipt/observe）。
// S7a 的处置：#3 现役唯一 GUI 批量路径 → 显式冻结（不加新功能）；#2 已删除 provider 提交原语；
// #1 legacy MCP 路已 fail-closed。收敛计划见 docs/plan/2026-08-25-p4-s7-legacy-converge.md。
//
// 为什么值得一道门岗而不是写进文档（P2 通用性铁律）：「别再造第四台批量机器」「别给冻结的 legacy
// 路加新功能」「别把冻结判据再抄第三遍」——这三条**靠自觉记不住**，下一个 agent 想给画布批量塞个
// 新能力时压根不知道这条纪律。只能靠机器每次拦。判据都能 grep，所以做得成门岗；按棘轮跑（基线只减
// 不增），和 check:heavy-path / check:tokens / check:i18n 同一套做法。
//
// 判据设计（低噪音是命根子——heavy-path 的教训「宁可漏报，不要噪音」；噪音会让整条规则被无视）：
// 不去猜「这段像不像批量循环」（driveGeneration/reconcile/派生全在迭代 jobs，噪音爆炸），而是钉
// 「**谁能碰 provider-submit 原语**」——一台新批量机器要真发起生成，必然要碰这几个原语之一，
// 于是「原语调用点的文件集」就是可枚举、可棘轮的封闭集。census 见计划 §1。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BASELINE_FILE = path.join(repoRoot, 'scripts/batch-machines-baseline.json')

function collect() {
  const files = []
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'dist-electron') continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (/\.(tsx?|mts|cts)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) && !/\.test\.(mts|cts)$/.test(entry.name)) files.push(full)
    }
  }
  walk(path.join(repoRoot, 'src'))
  walk(path.join(repoRoot, 'electron'))
  return files
}

// 抹注释必须逐行等高（不改总行数，否则报出来的 file:line 点开是别的地方）。与 heavy-path 同款：
// 块注释只抹字符保留换行；行注释用 [^\S\n]* 只吃水平空白（\s 含换行会吞掉「空行+//」下一行）。
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ''))
    .replace(/^[^\S\n]*\/\/.*$/gm, '')
}

const rel = (file) => path.relative(repoRoot, file).split(path.sep).join('/')

// ── 白名单：允许碰各 submit 原语 / 承载各判据的文件（相对 repoRoot 的 POSIX 路径）。
// 新增一台批量机器 = 必然在某个白名单外的文件里碰到原语 → 报红。改这里 = 明知故犯地扩边界，
// 必须同 PR 更新计划的收敛映射表 + 说清为什么这台不是「第四台自有循环」。
const RUN_GENERATION_NODE_HOMES = new Set([
  'src/workbench/generationCanvas/runner/generationRunController.ts', // #1 GUI 批量的唯一家（worker 循环 + 单节点变体）
])
const PRODUCTION_GENERATE_NODE_HOMES = new Set([
  'electron/productionRun/productionRunE2eFixture.ts', // e2e 桩：模拟渲染层应答
])
const FROZEN_JUDGMENT_HOMES = new Set([
  'electron/capabilityCore/anchorBible.ts', // 权威判据
  'src/workbench/generationCanvas/model/anchorBibleKeys.ts', // 渲染层纯镜像（equivalence.test.ts 钉死等价）
])

// legacy MCP 路判据集：这六条必须恒在 LEGACY_GENERATION_ROUTES 里（挪走一条 → 语义 binding
// 可能从旧路穿透双写项目事实，runtime plan §7 铁律）。
const REQUIRED_LEGACY_ROUTES = ['generate', 'nomi_generate', 'production.start', 'production.control', 'production.decide-gate', 'nomi_start_playbook']
const LEGACY_ROUTES_FILE = 'electron/capabilityCore/mcpGenerationPolicy.ts'
const LF = String.fromCharCode(10)

const RULES = [
  {
    id: 'rogue-renderer-batch',
    label: '在白名单外调用 runGenerationNode()——新造的渲染层批量派发（第四台机器）',
    hint: '批量生成只有一台机器：语义调度器（multiShotBatchScheduler）。GUI 侧派发是冻结的 legacy'
      + '（generationRunController，不加新功能）。新批量能力走语义调度器，别在别处再起一条 runGenerationNode 循环。',
    scan(code, file) {
      const home = rel(file)
      if (RUN_GENERATION_NODE_HOMES.has(home)) return []
      const hits = []
      code.split(/\n/).forEach((line, i) => {
        // 只认「调用」形态 runGenerationNode(...)，不认定义/re-export/类型引用（那些不发起生成）。
        if (/(^|[^.\w])runGenerationNode\s*\(/.test(line) && !/function\s+runGenerationNode/.test(line)) {
          hits.push({ line: i + 1, text: line.trim().slice(0, 120), file })
        }
      })
      return hits
    },
  },
  {
    id: 'rogue-durable-submit',
    label: "在白名单外请求 'production.generate-node'——新造的主进程 durable 提交驱动（第四台机器）",
    hint: '主进程批量提交走语义 submission facade（createProductionGenerationSubmission），由'
      + ' multiShotBatchScheduler 驱动。别新造 production.generate-node 请求点另起一条自有提交循环。',
    scan(code, file) {
      const home = rel(file)
      if (PRODUCTION_GENERATE_NODE_HOMES.has(home)) return []
      const hits = []
      code.split(/\n/).forEach((line, i) => {
        if (/['"]production\.generate-node['"]/.test(line)) {
          hits.push({ line: i + 1, text: line.trim().slice(0, 120), file })
        }
      })
      return hits
    },
  },
  {
    id: 'legacy-routes-shrunk',
    label: 'LEGACY_GENERATION_ROUTES 少了某条 legacy 路——语义 binding 可能从旧路穿透双写项目事实',
    hint: 'runtime plan §7 铁律：legacy 生成路必须显式标 legacy 且不与新路径双写。六条 legacy 路'
      + '（generate/nomi_generate/production.start/production.control/production.decide-gate/nomi_start_playbook）必须全在集合里。',
    scan(code, file) {
      if (rel(file) !== LEGACY_ROUTES_FILE) return []
      // 只在声明 LEGACY_GENERATION_ROUTES 的那一段找（避免把类型 union 里的字面量也算上）。
      const anchor = code.indexOf('LEGACY_GENERATION_ROUTES')
      if (anchor < 0) return [] // 该文件本身没了 → 由 rogue 规则/typecheck 兜；本规则只管「集合缩水」
      const segment = code.slice(anchor, anchor + 600)
      const missing = REQUIRED_LEGACY_ROUTES.filter((route) => !new RegExp(`['"]${route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]`).test(segment))
      // 报在文件首行（集合缺失是「整体」问题，不绑具体行）。
      return missing.map((route) => ({ line: 1, text: `缺 legacy 路：'${route}'`, file }))
    },
  },
  {
    id: 'third-frozen-judgment',
    label: 'meta.frozen 冻结判据的第三份独立实现——两套冻结语义就此分叉（equivalence test 管不到第三处）',
    hint: '冻结判据（frozen.at>0）只准两处：electron/capabilityCore/anchorBible.ts（权威 isAnchorFrozen）+ '
      + 'src/workbench/generationCanvas/model/anchorBibleKeys.ts（渲染层镜像，equivalence.test.ts 钉死等价）。'
      + '别在第三个文件手写 frozen 的 at>0 数值门——import 这两处之一。',
    scan(code, file) {
      const home = rel(file)
      if (FROZEN_JUDGMENT_HOMES.has(home)) return []
      const hits = []
      const lines = code.split(/\n/)
      lines.forEach((line, i) => {
        // 只认 isAnchorFrozen 的**判据实现签名**：读 frozen 标记里的 .at 并做数值门（at > 0 且
        // typeof number / Number.isFinite）。这是唯一真实的漂移风险（重抄一遍冻结判据）。
        // 刻意**不**认 `referenceSheet === true`——那是个到处在用的合法标记读取（分镜编号/画布工具/
        // nodeKindDomain 都读它），认它 = 噪音爆炸 = 整条规则被无视（heavy-path 教训）。视觉锚判定的
        // 单源由 typecheck + isVisualAnchorNode 的调用点收敛兜，不靠本 grep。
        const window = lines.slice(i, i + 4).join(LF)
        if (/frozen/i.test(window) && /\bat\b[^\n]*>\s*0/.test(window) && /(typeof[^\n]*['"]number['"]|Number\.isFinite)/.test(window)) {
          hits.push({ line: i + 1, text: line.trim().slice(0, 120), file })
        }
      })
      return hits
    },
  },
]

// RULES / stripComments 导出供 check-batch-machines.test.mjs 直接单测每条规则的 scan（锁死「会红」
// 行为，防门岗悄悄烂成橡皮图章——dead-selector 教训：失效的门岗比没门岗更坏）。
export { RULES, stripComments, rel, REQUIRED_LEGACY_ROUTES }

function main() {
  const files = collect()
  const found = new Map(RULES.map((rule) => [rule.id, []]))
  for (const file of files) {
    const code = stripComments(fs.readFileSync(file, 'utf8'))
    for (const rule of RULES) {
      for (const hit of rule.scan(code, file)) found.get(rule.id).push(hit)
    }
  }

  const baseline = fs.existsSync(BASELINE_FILE) ? JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8')) : {}
  if (process.argv.includes('--update-baseline')) {
    const next = Object.fromEntries(RULES.map((rule) => [rule.id, found.get(rule.id).length]))
    fs.writeFileSync(BASELINE_FILE, `${JSON.stringify(next, null, 2)}\n`)
    console.log(`✅ 已写入基线：${JSON.stringify(next)}`)
    process.exit(0)
  }

  let failed = false
  const summary = []
  for (const rule of RULES) {
    const hits = found.get(rule.id)
    const allowed = Number.isFinite(baseline[rule.id]) ? baseline[rule.id] : 0
    summary.push(`${rule.id}=${hits.length}`)
    if (hits.length <= allowed) continue
    failed = true
    console.log(`\n✖ ${rule.label}`)
    console.log(`  基线 ${allowed} → 现在 ${hits.length}（新增 ${hits.length - allowed} 处，棘轮只减不增）`)
    for (const hit of hits.slice(0, 12)) {
      console.log(`    ${rel(hit.file)}:${hit.line}  ${hit.text}`)
    }
    console.log(`  → ${rule.hint}`)
  }

  if (failed) {
    console.log('\n批量机器门岗未通过。批量生成只剩一台机器（语义调度器）——别再造第四台、别给冻结的 legacy 路加新功能。')
    console.log('收敛纪律见 docs/plan/2026-08-25-p4-s7-legacy-converge.md。')
    process.exit(1)
  }
  console.log(`✅ 批量机器门岗通过：${summary.join(' · ')}（棘轮只减不增）`)
}

// 只有作为 CLI 直接跑时才扫仓 + 判退出码；被 import（测试）时只拿 RULES，不触发 process.exit。
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
}
