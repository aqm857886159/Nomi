#!/usr/bin/env node
// 真实素材门岗（R13「四件真实」第④件，2026-09-14）。守一条不变量：
// **画布/性能/导入/导出/走查类测试必须用登记过的真实素材；缺素材时红，不是跳。**
//
// 起因：第一次拿用户真实素材（3840×2160 10-bit HEVC、1,380,939,031 字节）跑 Nomi，当场炸两件——
// ① 视频和图片导入不了画布；② S 规模（24 图 + 24 视频）20 秒进不了画布。而画布性能基准跑了
// 几十轮、留了 80 多份结果 JSON，一次都没红过：夹具是 ffmpeg testsrc2 合成的 960×540 平坦色块
// 与 2 秒 crf-35 的 720p，解码成本接近零，而且**直接写 project.json 快照**、导入一步都没走。
// 前三件真实（真实应用 / 真实页面输入 / 真实工具轨迹）全都拦不住它：走查可以完全「像人一样点」，
// 只要点的是合成素材，就照样测不出来。所以第④件必须单列，并且必须是机器判据。
// 详见 docs/lessons/2026-09-14-real-media-first-run-exposed-import-and-open-time.md
//
// 三层判据（和 check:standard-formats / check:framework-surface 同一套棘轮形状）：
//   (a) 覆盖面：画布性能 / 导入 / 导出 / 走查四类各至少一条登记测试；指到的文件必须存在、
//       必须真的读 NOMI_REAL_MEDIA_DIR、且不许带 skip 逃生口。还没建的登记成带到期日的债。
//   (b) 合成夹具棘轮：媒体相关测试里的合成素材构造（testsrc2 / lavfi / svg data URI / 硬写几何）
//       按**身份**冻结，只减不增——存身份不存裸数字，裸数字放过「删一处旧的、同 commit 加一处新的」。
//   (c) 债到期即红：CI 素材未就位期间只能登记为带到期日（≤30 天）的债，**不许在测试里 skip**
//       ——skip 就是 R17 说的「登记即放绿」，规则从第一天起就是装饰。
//
// 用法：
//   node scripts/check-real-media-fixture.mjs                  跑门岗
//   node scripts/check-real-media-fixture.mjs --update-baseline 重写合成夹具基线（只在**清掉**一处合成构造后用，且必须人工看 diff）
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import crypto from 'node:crypto'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const REGISTRY_FILE = 'tests/ux/real-media-fixtures.json'
const DEBT_FILE = 'docs/engineering/real-media-debt.json'
const BASELINE_FILE = 'scripts/real-media-fixture-baseline.json'

/** 扫哪些文件：媒体几何/解码成本敏感的那一族。名字是「这条测试碰不碰真实素材」的机器代理。 */
const IN_SCOPE_NAME =
  /(canvas-performance|canvas-real|real-media|perf-fixture|native-import|video-export|timeline-export|export-busy|imported-video|library-cover)/
const FIXTURE_DIR = 'tests/ux/fixtures/'
/**
 * 门岗自身、它的测试、真实素材 helper 与探针不进扫描范围：它们提到这些写法是为了**拦住**它们。
 * （同 check:standard-formats 的做法：门岗读的是自家判据与产物，不是被测对象。）
 */
const SELF_FILES = /(?:check-real-media-fixture|real-media-fixtures\.probe|fixtures\/realMedia)/
const SCAN_ROOTS = ['tests/ux', 'scripts']
const SOURCE_EXT = /\.(mjs|cjs|js|ts|mts|cts)$/

/** 合成素材的构造写法。每条都要给出替代写法，否则门岗只会让人困惑（R17）。 */
export const SYNTHETIC_RULES = Object.freeze([
  {
    id: 'synthetic-video-source',
    pattern: /testsrc2?\s*=/,
    hint: '合成测试图样。改用 requireRealMediaAssets() 从 NOMI_REAL_MEDIA_DIR 取登记素材',
  },
  {
    id: 'lavfi-source',
    pattern: /['"`]lavfi['"`]|-f\s+lavfi/,
    hint: 'ffmpeg 合成输入源（color= / testsrc= / smptebars=）。真实解码成本差两三个数量级',
  },
  {
    id: 'svg-data-uri',
    pattern: /data:image\/svg\+xml/,
    hint: 'SVG 占位图的解码成本接近零，证明不了真实图片链路',
  },
  {
    id: 'hardcoded-media-geometry',
    pattern: /(?:image|video)(?:Width|Height)\s*:\s*[^,\n]*?\b\d{2,}\b/,
    hint: '硬写媒体几何。尺寸要从文件探出来（这条同时违反「随输入 derive 不 hardcode」）',
  },
])

/** 逃生口：登记过的测试里出现这些，等于「素材缺了就悄悄不测」，直接红。 */
const SKIP_ESCAPES = Object.freeze([
  { id: 'test-skip', pattern: /\b(?:it|test|describe)\.skip\b/ },
  { id: 'skip-env', pattern: /SKIP_REAL_MEDIA/ },
  { id: 'silent-exit', pattern: /process\.exit\(0\)/ },
])

const rel = (file) => path.relative(repoRoot, file).split(path.sep).join('/')
const sha = (text) => crypto.createHash('sha1').update(text).digest('hex').slice(0, 12)

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, file), 'utf8'))
}

function walk(dir, onFile) {
  if (!fs.existsSync(dir)) return
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, onFile)
    else onFile(full)
  }
}

/** 收集在扫描范围内的文件正文。判据本体吃的是这张表，所以 node-test 能喂假仓库（R17）。 */
export function collectScopedSources({ root = repoRoot, roots = SCAN_ROOTS } = {}) {
  const sources = new Map()
  for (const r of roots) {
    walk(path.join(root, r), (full) => {
      const p = path.relative(root, full).split(path.sep).join('/')
      if (!SOURCE_EXT.test(p)) return
      if (!(IN_SCOPE_NAME.test(p) || p.startsWith(FIXTURE_DIR))) return
      if (SELF_FILES.test(p)) return
      sources.set(p, fs.readFileSync(full, 'utf8'))
    })
  }
  return sources
}

/** 抹注释必须逐行等高，否则报出来的 file:line 点开是别的地方（R17.1 踩过）。 */
function stripComments(text) {
  return text
    .split('\n')
    .map((line) => line.replace(/^\s*(\/\/|\*|\/\*).*$/, ''))
    .join('\n')
}

export function scanSynthetic(sources) {
  const found = []
  const seen = new Map()
  for (const [file, text] of sources) {
    const lines = stripComments(text).split('\n')
    lines.forEach((line, i) => {
      for (const rule of SYNTHETIC_RULES) {
        if (!rule.pattern.test(line)) continue
        const base = `${rule.id}::${file}::${sha(line.trim())}`
        const n = (seen.get(base) ?? 0) + 1
        seen.set(base, n)
        found.push({ identity: n === 1 ? base : `${base}#${n}`, rule: rule.id, file, line: i + 1, hint: rule.hint })
      }
    })
  }
  return found
}

/** 判据本体。吃纯数据，不碰盘——这样 node-test 才测得到「明天新增一条会不会红」而不是只测今天的存量。 */
export function evaluate({ registry, debt, baseline, synthetic, testFiles, today }) {
  const errors = []
  const warnings = []

  // ---- (a) 覆盖面 ----
  const required = registry.requiredClasses ?? []
  const byClass = new Map()
  for (const entry of registry.coverage ?? []) byClass.set(entry.class, entry)
  for (const cls of required) {
    const entry = byClass.get(cls)
    if (!entry) {
      errors.push(`覆盖面缺口：${cls} 类在 ${REGISTRY_FILE} 的 coverage 里没有任何登记。每类至少一条测试声明用真实素材`)
      continue
    }
    if (entry.status === 'live') {
      if (!entry.test) {
        errors.push(`${cls}：status=live 却没写 test 路径`)
        continue
      }
      const text = testFiles.get(entry.test)
      if (text === undefined) {
        errors.push(`${cls}：登记的测试 ${entry.test} 不存在`)
        continue
      }
      if (!text.includes(registry.mediaEnvVar) && !/realMedia|requireRealMediaAssets/.test(text)) {
        errors.push(
          `${cls}：${entry.test} 既没读 ${registry.mediaEnvVar} 也没用 requireRealMediaAssets()——登记了却没真的取真实素材`,
        )
      }
      for (const escape of SKIP_ESCAPES) {
        if (escape.pattern.test(text)) {
          errors.push(`${cls}：${entry.test} 出现逃生口 ${escape.id}——素材缺失时必须红，不许 skip/静默退出`)
        }
      }
    } else if (entry.status === 'debt') {
      if (!entry.debtId) errors.push(`${cls}：status=debt 却没写 debtId`)
    } else {
      errors.push(`${cls}：status 只能是 live 或 debt，收到 ${JSON.stringify(entry.status)}`)
    }
  }

  // ---- live 条目同样按上面的规矩验（非必需类也不许留逃生口）----
  for (const entry of registry.coverage ?? []) {
    if (entry.status !== 'live' || required.includes(entry.class)) continue
    const text = entry.test ? testFiles.get(entry.test) : undefined
    if (text === undefined) {
      errors.push(`${entry.class}：登记的测试 ${entry.test} 不存在`)
      continue
    }
    if (!text.includes(registry.mediaEnvVar) && !/realMedia|requireRealMediaAssets/.test(text)) {
      errors.push(`${entry.class}：${entry.test} 没有真的取真实素材`)
    }
  }

  // ---- 素材引用必须解析得到 ----
  const assetIds = new Set((registry.assets ?? []).map((a) => a.id))
  for (const entry of registry.coverage ?? []) {
    for (const id of entry.assets ?? []) {
      if (!assetIds.has(id)) errors.push(`${entry.class}：引用了登记表里不存在的素材 id="${id}"`)
    }
  }
  for (const asset of registry.assets ?? []) {
    if (!asset.whyThisOne) errors.push(`素材 ${asset.id} 缺 whyThisOne——说不出「为什么是这一份」的素材，换成别的也没人知道亏在哪`)
    if (!asset.derivedFrom && !asset.relativePath) errors.push(`素材 ${asset.id} 既不是派生素材，又没有 relativePath`)
  }

  // ---- (c) 债：绑到期日、≤maxDebtDays、到期即红 ----
  const debts = new Map((debt.debts ?? []).map((d) => [d.id, d]))
  const maxDays = debt.maxDebtDays ?? 30
  for (const entry of registry.coverage ?? []) {
    if (entry.status !== 'debt') continue
    const record = debts.get(entry.debtId)
    if (!record) {
      errors.push(`${entry.class}：debtId="${entry.debtId}" 在 ${DEBT_FILE} 里找不到。债必须有登记，否则「待建」就是永久放行`)
      continue
    }
    for (const field of ['why', 'plan', 'owner', 'registeredAt', 'due']) {
      if (!record[field]) errors.push(`债 ${record.id} 缺 ${field}`)
    }
    if (record.registeredAt && record.due) {
      const span = (Date.parse(record.due) - Date.parse(record.registeredAt)) / 86400000
      if (!Number.isFinite(span)) errors.push(`债 ${record.id} 的日期读不懂（registeredAt/due）`)
      else if (span > maxDays) errors.push(`债 ${record.id} 的到期日比登记日晚 ${span} 天，超过上限 ${maxDays} 天`)
    }
    if (record.due && Date.parse(record.due) < Date.parse(today)) {
      errors.push(`债 ${record.id} 已于 ${record.due} 到期（今天 ${today}）：要么把那条腿建起来，要么带理由重定到期日——不许续着不管`)
    } else if (record.due) {
      warnings.push(`债 ${record.id}（${record.class}）到期日 ${record.due}：${record.plan}`)
    }
  }
  for (const record of debt.debts ?? []) {
    const claimed = (registry.coverage ?? []).some((e) => e.debtId === record.id)
    if (!claimed) errors.push(`债 ${record.id} 没有任何 coverage 条目认领它——债还了要销账，否则登记漂移（R17）`)
  }

  // ---- (b) 合成夹具棘轮 ----
  const baseIds = new Set(baseline.entries ?? [])
  const foundIds = new Set(synthetic.map((s) => s.identity))
  const added = synthetic.filter((s) => !baseIds.has(s.identity))
  const removed = [...baseIds].filter((id) => !foundIds.has(id))
  for (const item of added) {
    errors.push(
      `新增合成素材构造：${item.file}:${item.line}（${item.rule}）——${item.hint}\n` +
        `    基线只减不增；确属合法例外（例如「解码失败时界面显示什么」需要一个故意损坏的文件）就写进 ${BASELINE_FILE} 的 exemptions 并说明理由`,
    )
  }
  for (const id of removed) {
    warnings.push(`合成素材构造已消失：${id}——跑 --update-baseline 收紧基线（只减不增的那一半要手动兑现）`)
  }

  return { errors, warnings, added, removed, synthetic }
}

function main() {
  const registry = readJson(REGISTRY_FILE)
  const debt = readJson(DEBT_FILE)
  const baselinePath = path.join(repoRoot, BASELINE_FILE)
  const baseline = fs.existsSync(baselinePath) ? JSON.parse(fs.readFileSync(baselinePath, 'utf8')) : { entries: [] }
  const sources = collectScopedSources()
  const synthetic = scanSynthetic(sources)
  const exempt = new Set(baseline.exemptions?.map((e) => e.identity) ?? [])
  const scanned = synthetic.filter((s) => !exempt.has(s.identity))

  if (process.argv.includes('--update-baseline')) {
    const next = { ...baseline, entries: scanned.map((s) => s.identity).sort() }
    fs.writeFileSync(baselinePath, `${JSON.stringify(next, null, 2)}\n`)
    console.log(`✔ 已重写 ${BASELINE_FILE}：${next.entries.length} 条。**人工看一眼 diff**——新增行意味着基线被抬高了`)
    return
  }

  const testFiles = new Map()
  for (const entry of registry.coverage ?? []) {
    if (!entry.test) continue
    const file = path.join(repoRoot, entry.test)
    if (fs.existsSync(file)) testFiles.set(entry.test, fs.readFileSync(file, 'utf8'))
  }

  const today = new Date().toISOString().slice(0, 10)
  const { errors, warnings } = evaluate({ registry, debt, baseline, synthetic: scanned, testFiles, today })

  for (const w of warnings) console.log(`· ${w}`)
  if (errors.length > 0) {
    console.error(`\n✖ check:real-media-fixture 红了（${errors.length} 条）：`)
    for (const e of errors) console.error(`  - ${e}`)
    console.error(
      `\n真实素材怎么配：export ${registry.mediaEnvVar}="${registry.localDefaultDir}"；登记表 ${REGISTRY_FILE}；规则 R13「四件真实」第④件。`,
    )
    process.exit(1)
  }
  console.log(
    `✔ check:real-media-fixture：${registry.requiredClasses.length} 类覆盖面在册，合成夹具构造 ${scanned.length} 条（基线只减不增）`,
  )
}

if (import.meta.url === `file://${process.argv[1]}`) main()
