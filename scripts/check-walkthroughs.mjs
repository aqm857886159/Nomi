#!/usr/bin/env node
// 走查质量门岗（2026-08-18）。
//
// 为什么需要它：`eslint.config.mjs:28` 把 `tests/ux/**` 整个 ignore —— 现有所有门岗**没有一道看得见这片地**。
// 这不是新发现：`scripts/check-e2e-launch.mjs:6` 的注释里前人已经写下这句话，但当时只修了
// 「启动路径」这一个症状。结果是 143 个走查里长出了 80–94% 命中率的假绿模式，无人拦截。
//
// 本门岗抓四类**会让测试骗人**的写法，按棘轮运行（基线只减不增），
// 和仓库既有的 lint:ci --max-warnings / check:filesize 白名单 / check:tokens 棘轮同一套做法。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { collectAriaLabelLiterals, extractInterpolatedValues, isAriaLabelAlive } from './lib/ariaLabelLiterals.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BASELINE_FILE = path.join(repoRoot, 'scripts/walkthrough-baseline.json')

function repoRelative(file) {
  return path.relative(repoRoot, file).split(path.sep).join('/')
}

/** 只扫「跑得起来的走查/e2e」和「扫源码的结构测试」这两片。 */
function collect() {
  const files = []
  const uxDir = path.join(repoRoot, 'tests/ux')
  if (fs.existsSync(uxDir)) {
    for (const name of fs.readdirSync(uxDir)) {
      if (name.endsWith('.mjs') || name.endsWith('.cjs')) files.push(path.join(uxDir, name))
    }
  }
  const walkSrc = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules') continue
        walkSrc(full)
      } else if (/structure.*\.test\.ts$/i.test(entry.name) || /\.structure\.test\.ts$/.test(entry.name)) {
        files.push(full)
      }
    }
  }
  walkSrc(path.join(repoRoot, 'src'))
  return files
}

function stripComments(source) {
  return source.replace(/\r\n?/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

/**
 * 整个 src/ 的文本，用来判「这个类名到底存不存在」。
 *
 * 起因（2026-08-18）：3 个走查在等 `.react-flow__node`，而本仓**零图库依赖**、画布是自研的
 * `generation-canvas-v2`，节点真实锚点是 `[data-node-id]`。那个类名在 src/ 里零命中 →
 * 选择器永不匹配 → 配上 `.catch(() => {})` 就是「点了个寂寞还报绿」。
 */
const SRC_TEXT = (() => {
  const chunks = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules') continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (/\.(tsx?|css)$/.test(entry.name)) chunks.push(fs.readFileSync(full, 'utf8'))
    }
  }
  walk(path.join(repoRoot, 'src'))
  return chunks.join('\n')
})()

/** src/ 里带 `{{插值}}` 的字符串值（i18n 模板）——「添加视频节点」这类拼出来的 label 靠它判活。 */
const SRC_INTERPOLATED = extractInterpolatedValues(SRC_TEXT)

const RULES = [
  {
    id: 'absence-without-baseline',
    label: '「不存在」断言没有基线（和「探针根本没生效」无法区分）',
    appliesTo: (file) => file.includes(`${path.sep}tests${path.sep}ux${path.sep}`),
    scan(code, file) {
      // 用了共享的 expectAbsent 就天然带基线（它签名上强制 provenBy），整份文件豁免。
      if (code.includes('expectAbsent(')) return []
      const hits = []
      const lines = code.split('\n')
      const OBSERVES = /count\(\)|isVisible|toBeVisible|querySelectorAll|getByText|getByRole|locator\(/
      lines.forEach((line, i) => {
        // 形如：=== 0 / == 0 / toBe(0) / toHaveCount(0) / .length === 0
        const countsToZero = /(===?\s*0\b|toBe\(0\)|toHaveCount\(0\)|length\s*===?\s*0)/.test(line)
        if (!countsToZero) return
        // UI 观测常和归零比较**跨行**（先 const n = await x.count()，再 if (n === 0)）。
        // 只看同一行会漏掉绝大多数真实写法——负向测试首跑就漏了这一类，所以往回看几行。
        const window = lines.slice(Math.max(0, i - 5), i + 1).join('\n')
        if (OBSERVES.test(window)) hits.push({ line: i + 1, text: line.trim().slice(0, 120), file })
      })
      return hits
    },
  },
  {
    id: 'whole-page-text',
    label: '全页文本观测（脚本自己 seed 的数据会把断言污染成必然命中）',
    appliesTo: (file) => file.includes(`${path.sep}tests${path.sep}ux${path.sep}`),
    scan(code, file) {
      const hits = []
      code.split('\n').forEach((line, i) => {
        if (/document\.body\.innerText|document\.body\.textContent/.test(line)) {
          hits.push({ line: i + 1, text: line.trim().slice(0, 120), file })
        }
      })
      return hits
    },
  },
  {
    id: 'sleep-as-done-signal',
    label: '拿长 sleep 当「操作完成」信号（真实耗时会变，sleep 不够长就读到空 → 假绿）',
    appliesTo: (file) => file.includes(`${path.sep}tests${path.sep}ux${path.sep}`),
    scan(code, file) {
      const hits = []
      const lines = code.split('\n')
      lines.forEach((line, i) => {
        const m = line.match(/waitForTimeout\((\d{4,})\)/)
        if (!m) return
        if (Number(m[1]) < 1500) return
        // 紧随其后 3 行内就做断言 = 把 sleep 当完成信号
        const after = lines.slice(i + 1, i + 4).join('\n')
        // includes/match 也算观测：负向测试首跑漏过 `console.log(txt.includes(...))` 这一类。
        if (/count\(\)|isVisible|innerText|textContent|toBe|expect|record\(|\.includes\(|\.match\(/.test(after)) {
          hits.push({ line: i + 1, text: line.trim().slice(0, 120), file })
        }
      })
      return hits
    },
  },
  {
    id: 'dead-selector',
    label: '走查在等一个源码里根本不存在的类名（选择器永不匹配 → 那一步静默失效）',
    appliesTo: (file) => file.includes(`${path.sep}tests${path.sep}ux${path.sep}`),
    scan(code, file) {
      const hits = []
      // 只查**本仓自己的** BEM 风类名（含 `__`），第三方运行时类名（ProseMirror/mantine…）不在此列，
      // 否则误报会把这条规则变成噪音、没人再看。
      const re = /['"`.]([a-z][a-z0-9-]*__[a-z0-9_-]+)/g
      const seen = new Set()
      let m
      while ((m = re.exec(code)) !== null) {
        const cls = m[1]
        if (seen.has(cls)) continue
        seen.add(cls)
        if (SRC_TEXT.includes(cls)) continue
        // BEM 修饰符常由模板拼出来（`...__resize-zone--${direction}`），整串在源码里当然搜不到。
        // 去掉尾部 `--xxx` 再查基名：基名在 = 这个类是真实存在的动态修饰符，不算死选择器。
        // （首跑就把 `--se` 误报成死选择器，而它有硬断言、一直工作正常。）
        const base = cls.replace(/--[a-z0-9_-]+$/, '')
        if (base !== cls && SRC_TEXT.includes(base)) continue
        const line = code.slice(0, m.index).split('\n').length
        hits.push({ line, text: `.${cls} —— src/ 里零命中`, file })
      }
      return hits
    },
  },
  {
    id: 'dead-aria-label',
    label: '走查在等一个源码里已无人渲染的 aria-label 文案（同一个死锚点同时造假红与假绿）',
    appliesTo: (file) => file.includes(`${path.sep}tests${path.sep}ux${path.sep}`),
    // 与上面的 dead-selector 同源,但盯的是**文案锚点**:aria-label 多半来自 i18n,
    // 组件退役或文案改写后字面量就悬空。2026-09-05 实例:`[aria-label="生成区 AI 助手"]`
    // 的渲染者随 Agent Host cutover 被删,字面量却在两份走查里各留一处——一处假红、一处假绿。
    // 判活口径**故意宽**(整串命中 src 全文,或能由某条 i18n 模板拼出),宁可漏报也不误报:
    // 误报会让人把还在用的好断言删掉。
    scan(code, file) {
      return collectAriaLabelLiterals(code)
        .filter(({ literal }) => !isAriaLabelAlive(literal, { srcText: SRC_TEXT, templates: SRC_INTERPOLATED }))
        .map(({ literal, line }) => ({ line, text: `[aria-label="${literal}"] —— src/ 里零命中（含 i18n 译文与模板）`, file }))
    },
  },
  {
    id: 'source-scan-without-strip',
    label: '扫源码的结构测试没剥注释（会反噬文档：记录该 bug 的注释本身把门岗打红）',
    appliesTo: (file) => file.endsWith('.ts'),
    scan(code, file) {
      if (!/readFileSync\(/.test(code)) return []
      if (/stripComments|stripCommentsAndStrings/.test(code)) return []
      const hits = []
      code.split('\n').forEach((line, i) => {
        if (/readFileSync\(/.test(line)) hits.push({ line: i + 1, text: line.trim().slice(0, 120), file })
      })
      return hits
    },
  },
]

// ─────────────────────────────────────────────────────────────────────────────
// 断言密度（2026-08-26，第四个根因）
//
// 前三条根因都是「证据取早了」。这一条是**根本没有证据**：
// 一条走查可以几乎不含任何断言，照样 exit 0，照样在门岗眼里和一条严密的走查长得一模一样。
//
// 实证（不是推演）：修复前的 `tests/ux/model-onboarding.walk.mjs` 共 78 行，
// 全文**只有一条**失败路径——开面板那句 `if (!(await openPanel(win))) … process.exit(1)`。
// 面板一旦打开，**后面任何一步都不可能再让它变红**：它拍了 4 张字节完全相同的截图，
// 仍然 exit 0。它之所以曾经是红的，只是因为 2026-08-15 的改名把那唯一一道闸弄坏了。
//
// 所以上面四条规则查的是**形状**（有没有写出骗人的写法），这一条查的是**能力**
// （这份走查到底还有没有能力发现问题）。少了它，一条零检出力的走查是隐形的。
//
// 计数方向必须偏向**假红**：认不准的写法一律**不计入**（宁可少算 → 报红让人来看），
// 绝不为了少报而放宽——「假红看得见，假绿看不见」。
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 真正能把一条走查**变红**的写法。全部来自实扫 tests/ux（176 份），不是照着某一份猜的：
 * 这个仓库的习惯并不统一，四代写法叠在一起，漏掉任何一族都会把严密的走查误判成薄的。
 */
const FAILURE_PATH_PATTERNS = [
  // 官方断言 + _assert.mjs 的封装（expectVisible/Hidden/Count/Text/Absent）。
  [/\bexpect\s*\(/g, 'expect()'],
  [/\bexpect(?:Visible|Hidden|Count|Text|Absent)\s*\(/g, 'expectXxx()'],
  // proveProbe 自身就是一条硬断言（找不到就抛），不只是 expectAbsent 的前置。
  [/\bproveProbe\s*\(/g, 'proveProbe()'],
  // 点不到就抛 —— 走查里最常见的一族失败路径。
  [/\bclickOrFail\s*\(/g, 'clickOrFail()'],
  [/\bthrow\s+new\s+\w*Error\s*\(/g, 'throw'],
  [/process\.exit\s*\(\s*1\s*\)/g, 'process.exit(1)'],
  [/process\.exitCode\s*=\s*1/g, 'process.exitCode=1'],
  // 累加器一族：先 push 再在收尾按 length 决定退出码（model-onboarding 修好后就是这个形状）。
  // 只认**语义上是失败累加器**的名字：results/samples/nodes 这类是收集数据，算进来就成了过报。
  [/\b(?:failures?|fails?|errors?|problems?|issues?|findings?|friction|structFails|verdicts|violations|misses|bad)\s*\.push\s*\(/g, '失败累加器.push()'],
  // check(name, ok) / check(cond, msg) 判定助手：40 份走查、498 处调用，
  // 收尾统一 `results.filter(r => !r.ok)` → process.exit(1)。是本仓最大的一族判定写法。
  [/\bcheck\s*\(/g, 'check()'],
]

/** 低于这个数就算「几乎没有检出力」。model-onboarding 事故时是 1。 */
const MIN_FAILURE_PATHS = 2

function countFailurePaths(code) {
  const breakdown = {}
  let total = 0
  for (const [re, label] of FAILURE_PATH_PATTERNS) {
    const m = code.match(re)
    if (!m) continue
    breakdown[label] = m.length
    total += m.length
  }
  return { total, breakdown }
}

/**
 * 纯 helper 模块（只导出函数、自己不启动 app）不该被要求带断言——
 * 它们没有「跑一趟」的语义，断言属于调用方。判据用**行为**不用文件名：
 * 有没有真的拉起一个 app 才是「这是一趟走查」的证据。
 */
function isRunnableWalk(code) {
  return /launchNomiApp|_electron|electron\.launch|chromium\.launch/.test(code)
}

const files = collect()
const found = Object.fromEntries(RULES.map((r) => [r.id, []]))
/** 每份走查的失败路径条数：{ '相对路径': 条数 }。只收 tests/ux 下跑得起来的那些。 */
const density = {}
for (const file of files) {
  const raw = fs.readFileSync(file, 'utf8')
  const code = stripComments(raw)
  for (const rule of RULES) {
    if (!rule.appliesTo(file)) continue
    found[rule.id].push(...rule.scan(code, file))
  }
  if (file.includes(`${path.sep}tests${path.sep}ux${path.sep}`) && isRunnableWalk(code)) {
    density[repoRelative(file)] = countFailurePaths(code).total
  }
}

const counts = Object.fromEntries(RULES.map((r) => [r.id, found[r.id].length]))
/** 基线只记「薄的那些」：达标的走查不进基线，将来变薄自然会被抓（见下方比较逻辑）。 */
const thinNow = Object.fromEntries(Object.entries(density).filter(([, n]) => n < MIN_FAILURE_PATHS))
const writeBaseline = process.argv.includes('--update-baseline')
if (writeBaseline) {
  const payload = { ...counts, 'assertion-density-thin': thinNow }
  fs.writeFileSync(BASELINE_FILE, `${JSON.stringify(payload, null, 2)}\n`)
  console.log('已写入基线：', JSON.stringify(counts), `+ 薄走查 ${Object.keys(thinNow).length} 份`)
  process.exit(0)
}

if (!fs.existsSync(BASELINE_FILE)) {
  console.error(`缺基线文件 ${repoRelative(BASELINE_FILE)}，先跑：node scripts/check-walkthroughs.mjs --update-baseline`)
  process.exit(1)
}
const baseline = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'))

let failed = false
const improved = []
for (const rule of RULES) {
  const now = counts[rule.id]
  const was = baseline[rule.id] ?? 0
  if (now > was) {
    failed = true
    console.error(`\n✖ ${rule.label}`)
    console.error(`  基线 ${was} → 现在 ${now}（新增 ${now - was} 处，棘轮只减不增）`)
    // 只列前 8 处，够定位就行
    for (const hit of found[rule.id].slice(0, 8)) {
      console.error(`    ${repoRelative(hit.file)}:${hit.line}  ${hit.text}`)
    }
    if (rule.id === 'absence-without-baseline') {
      console.error('  → 改用 tests/ux/_assert.mjs 的 expectAbsent(locator, { provenBy })：')
      console.error('    它在签名上强制你先用 proveProbe() 证明「这个检查测得到东西」。')
    }
  } else if (now < was) {
    improved.push(`${rule.id} ${was}→${now}`)
  }
}

// ── 断言密度的棘轮 ──────────────────────────────────────────────────────────
// 两种红：① 新走查一出生就是薄的；② 基线里的薄走查**更薄了**（净删断言）。
// 存量薄走查留在基线里慢慢清零，本轮不做批量改写。
const thinBaseline = baseline['assertion-density-thin'] ?? {}
const newThin = []
const gotThinner = []
for (const [file, n] of Object.entries(thinNow)) {
  if (!(file in thinBaseline)) newThin.push({ file, n })
  else if (n < thinBaseline[file]) gotThinner.push({ file, n, was: thinBaseline[file] })
}
// 达标的走查后来掉到阈值以下 = 上面 newThin 已经抓到（它不在基线里）。
// 基线内的走查回到达标线以上则自动从 thinNow 消失 → 提示拧棘轮。
const healed = Object.keys(thinBaseline).filter((f) => !(f in thinNow))

if (newThin.length > 0 || gotThinner.length > 0) {
  failed = true
  console.error('\n✖ 走查检出力不足：这份走查几乎不可能变红（它能跑完，但发现不了问题）')
  for (const { file, n } of newThin) {
    console.error(`  ${file}  失败路径 ${n} 条（要求 ≥ ${MIN_FAILURE_PATHS}）— 新增/未登记`)
  }
  for (const { file, n, was } of gotThinner) {
    console.error(`  ${file}  失败路径 ${was} → ${n} 条 — 比基线更薄了（棘轮只减不增）`)
  }
  console.error(
    '\n  为什么拦这个：2026-08-26 修复前的 model-onboarding.walk.mjs 全文只有 1 条失败路径，\n'
      + '  面板一打开就再也不可能变红——它拍出 4 张字节完全相同的截图，exit 仍然是 0。\n'
      + '  一条零检出力的走查，在其它门岗眼里和一条严密的走查完全一样。',
  )
  console.error(
    '\n  → 正确的修法：想清楚这一趟**要证明什么**，把它写成断言——\n'
      + '    tests/ux/_assert.mjs 的 expectVisible / expectCount / clickOrFail（点不到就红）、\n'
      + '    expectAbsent（配 proveProbe 证明探针是活的）、或 failures.push(...) 累加后按 length 退出。\n'
      + '    截图是给人眼看的证据，不是断言：没有断言的截图不会拦住任何回归。',
  )
  console.error(
    '\n  → 别这么修：**为了凑数往走查里塞无意义的断言**（断言常量、断言 body 存在、\n'
      + '    重复断言同一个东西）。那样门岗变绿而检出力仍然是零，你还骗过了下一个读它的人——\n'
      + '    这比现在这条红线糟得多。凑不出真断言，说明这趟走查的目的没想清楚。',
  )
}

if (failed) {
  console.error('\n走查质量门岗未通过。这些写法会让测试报绿但什么都没验证到。')
  process.exit(1)
}
console.log(`✅ 走查质量门岗通过：${RULES.map((r) => `${r.id}=${counts[r.id]}`).join(' · ')}`)
console.log(
  `   检出力：${Object.keys(density).length} 份走查，其中薄的 ${Object.keys(thinNow).length} 份在基线内`
    + `（阈值 ≥ ${MIN_FAILURE_PATHS} 条失败路径）`,
)
if (healed.length > 0) {
  improved.push(`assertion-density 有 ${healed.length} 份补上了断言：${healed.slice(0, 5).join('、')}`)
}
if (improved.length > 0) {
  console.log(`   有改善：${improved.join('、')} —— 记得跑 --update-baseline 把棘轮拧紧`)
}
