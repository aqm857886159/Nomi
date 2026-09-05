// 视觉基线跑挂了以后**先分清是什么挂了**，再决定说哪句话（2026-09-06）。
//
// 立项根因：门岗此前把 Playwright 的任何非零退出都翻译成同一句
// 「❌ 视觉基线不符。差异图在 test-results/ 下……这是设计改动被拦住了，不是工具坏了」。
// 那句话里有两个断言，而它一个都没验证过：① 真的产出了差异图；② 真的是设计改动被拦住。
// 2026-09-06 实测（load ≈16 与 ≈30 各一次）：46 条用例全体
// `page.goto: net::ERR_CONNECTION_REFUSED`、**一张 -diff.png 都没有**，门岗照旧报「视觉基线不符」，
// 于是人被指去 test-results/ 找一批根本不存在的差异图。同一条命令在机器闲下来时 46/46 全绿。
//
// 判据不是「猜」，是**证据的有无**：
//   · 说「视觉基线不符」的**唯一**许可证是磁盘上真的躺着 -diff.png。没有图 = 没有这个结论。
//   · 连接类错误（ERR_CONNECTION_*、webServer 起不来）= 基础设施，跟设计没关系。
//   · 其余（超时、页面报错）且没有差异图 = 基础设施可疑，明说「没能得出像素结论」，
//     而不是把它冒充成一个像素结论。
//
// 与 docs/lessons/parallel-gates-thrash-the-machine.md 的分工：那条讲「超载会让超时类红灯不作数」，
// 这里是把那条判据**机器化**——门岗自己报 load，不再指望人每次记得去看 uptime。
import os from 'node:os'
import fs from 'node:fs'
import path from 'node:path'

export const LAB_VERDICT = {
  VISUAL: 'visual',
  SERVER_UNREACHABLE: 'server-unreachable',
  BASELINE_MISSING: 'baseline-missing',
  INFRASTRUCTURE: 'infrastructure',
}

/**
 * 「预览服务器不可达」的签名。全都取自 Chromium / Playwright 自己打印的原文，
 * 不是我们自己编的字符串——除了 warmUp 那条机器标记（见 warmUp.mjs），
 * 它存在的意义是：即便将来 Playwright 换了 globalSetup 的报错排版，这一条仍然认得出来。
 */
export const UNREACHABLE_SIGNATURES = [
  { tag: 'connection-refused', re: /net::ERR_CONNECTION_REFUSED/ },
  { tag: 'connection-reset', re: /net::ERR_CONNECTION_RESET/ },
  { tag: 'connection-closed', re: /net::ERR_CONNECTION_CLOSED/ },
  { tag: 'empty-response', re: /net::ERR_EMPTY_RESPONSE/ },
  { tag: 'aborted', re: /net::ERR_ABORTED/ },
  { tag: 'name-not-resolved', re: /net::ERR_NAME_NOT_RESOLVED/ },
  { tag: 'webserver-not-started', re: /Process from config\.webServer was not able to start/ },
  { tag: 'webserver-timeout', re: /Timed out waiting \d+ms from config\.webServer/ },
  { tag: 'port-taken', re: /is already used|EADDRINUSE/ },
  { tag: 'warmup-unreachable', re: /NOMI_LAB_WARMUP_UNREACHABLE/ },
]

const BASELINE_MISSING_RE = /A snapshot doesn't exist at/
const SCREENSHOT_MISMATCH_RE = /Screenshot comparison failed/

/** Playwright `list` reporter 的收尾统计。解析不出来就是 null，**不填 0 冒充「一条都没过」**。 */
export function parseRunTotals(output = '') {
  const read = (word) => {
    const match = new RegExp(`(\\d+)\\s+${word}\\b`).exec(output)
    return match ? Number(match[1]) : null
  }
  return { passed: read('passed'), failed: read('failed'), skipped: read('skipped'), didNotRun: read('did not run') }
}

/** 磁盘上真实存在的差异图——说「视觉基线不符」的唯一许可证。 */
export function collectDiffImages(resultsDir) {
  const found = []
  const walk = (dir) => {
    let entries
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name.endsWith('-diff.png')) found[found.length] = full
    }
  }
  walk(resultsDir)
  return found.sort()
}

/**
 * 分诊。**纯函数**——只看喂进来的输出文本与差异图清单，所以能用固定素材逐档验证，
 * 不用真把服务器杀掉才知道它会说什么。
 */
export function triageLabRun({ output = '', diffImages = [], exitCode = 1 }) {
  if (exitCode === 0) return null
  const totals = parseRunTotals(output)
  const unreachable = UNREACHABLE_SIGNATURES.filter(({ re }) => re.test(output)).map(({ tag }) => tag)
  const base = { diffImages, totals, unreachable, exitCode }

  if (unreachable.length) {
    // 「从未可达」和「跑到一半失联」要分开说：前者多半是服务器压根没起来或端口被人占了，
    // 后者多半是机器超载/别的进程把它收掉了。给的排查步骤不一样。
    const everReachable = (totals.passed ?? 0) > 0
    return { ...base, verdict: LAB_VERDICT.SERVER_UNREACHABLE, everReachable }
  }
  if (BASELINE_MISSING_RE.test(output)) return { ...base, verdict: LAB_VERDICT.BASELINE_MISSING }
  if (diffImages.length) return { ...base, verdict: LAB_VERDICT.VISUAL }
  // 报了「像素不符」却一张差异图都没落盘 = 这一趟没走到比对，别把它说成比对结论。
  return { ...base, verdict: LAB_VERDICT.INFRASTRUCTURE, claimedMismatch: SCREENSHOT_MISMATCH_RE.test(output) }
}

/** 机器负载：超载下的超时类红灯不作数（见 lessons/parallel-gates-thrash-the-machine.md）。 */
export function loadSnapshot() {
  const [one, five, fifteen] = os.loadavg()
  const cpus = os.cpus().length
  return { one, five, fifteen, cpus, overloaded: one > cpus * 1.5 }
}

/**
 * 人话。**刻意控制在 12 行以内**：gates 汇总只回放失败门岗输出的最后
 * FAILURE_TAIL_LINES(=15) 行，超出去的部分在汇总里看不见。
 */
export function formatLabFailure(triage, { resultsDir, origin, load = loadSnapshot(), updating = false } = {}) {
  const l = (value) => value.toFixed(1)
  const port = new URL(origin).port
  const machine = `本机 load ${l(load.one)} / ${l(load.five)} / ${l(load.fifteen)}（${load.cpus} 核）${load.overloaded ? ' ← 超载' : ''}`
  // 只报**解析到的**那几项：Playwright 的 list reporter 会整行省略计数为 0 的那一类，
  // 拿「没打印」当「等于 0」是猜，写成 `? 过` 又像解析坏了。没读到就不提这一项。
  const counted = [
    triage.totals.passed === null ? null : `${triage.totals.passed} 过`,
    triage.totals.failed === null ? null : `${triage.totals.failed} 挂`,
  ].filter(Boolean)
  const ran = `本趟用例：${counted.join(' / ') || '统计行没读到'} · 差异图 ${triage.diffImages.length} 张`

  if (triage.verdict === LAB_VERDICT.SERVER_UNREACHABLE) {
    return [
      `\n🚧 预览服务器不可达——**这不是视觉回归，是基础设施失败**（${triage.unreachable.join(', ')}）。`,
      `   ${triage.everReachable ? '服务器起来过，跑到一半失联了。' : '整趟跑下来服务器**从未可达**。'}`,
      `   ${machine}`,
      `   ${ran}（没有差异图 = 这一趟根本没比到像素，别去 test-results/ 找图）`,
      '   排查顺序：',
      `   1. 端口是不是被别的 worktree 占着：lsof -nP -iTCP:${port} -sTCP:LISTEN`,
      '   2. 机器是不是在超载：uptime；load 远超核数时先等它闲下来（docs/lessons/parallel-gates-thrash-the-machine.md）',
      `   3. 手工确认服务器：npx vite --host 127.0.0.1 --port ${port} --strictPort 然后开 ${origin}/design-lab.html`,
      '   机器闲下来再跑一次；这一趟对设计没有任何结论。',
    ].join('\n')
  }

  if (triage.verdict === LAB_VERDICT.BASELINE_MISSING) {
    return [
      '\n❌ 有状态**缺视觉基线**（不是像素不符）。',
      '   拍板后跑 pnpm run design-lab:update 补录；结构检查那一关本该先拦住它，没拦住就是结构检查漏了。',
      `   ${ran}`,
    ].join('\n')
  }

  if (triage.verdict === LAB_VERDICT.INFRASTRUCTURE) {
    return [
      '\n🚧 视觉道失败，但**一张差异图都没产出**——没有证据说这是视觉回归。',
      triage.claimedMismatch
        ? '   输出里有「Screenshot comparison failed」却没有落盘的 -diff.png：多半在写图之前就挂了。'
        : '   典型成因：用例超时、页面加载不完整、机器超载。',
      `   ${machine}`,
      `   ${ran}`,
      `   先看 ${path.basename(resultsDir)}/**/error-context.md 里的真实报错，机器闲下来再跑一次；`,
      '   只有真的出现 -diff.png，才轮到「视觉基线不符」这个结论。',
    ].join('\n')
  }

  return [
    updating ? '\n❌ 基线更新失败' : '\n❌ 视觉基线不符——差异图已产出，这是设计改动被拦住了，不是工具坏了。',
    `   差异图 ${triage.diffImages.length} 张（-expected/-actual/-diff）：`,
    ...triage.diffImages.slice(0, 3).map((file) => `     · ${path.relative(process.cwd(), file)}`),
    triage.diffImages.length > 3 ? `     …… 另有 ${triage.diffImages.length - 3} 张` : null,
    '   先看差异图确认改动是不是你要的，要的话给用户看接触表拍板，',
    '   再跑 pnpm run design-lab:update 更新基线并在 PR 里附前后对比。',
  ].filter(Boolean).join('\n')
}
