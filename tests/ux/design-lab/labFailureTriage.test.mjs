// 「门岗把基础设施失败说成视觉基线不符」这一类的回归测试（2026-09-06）。
//
// 素材是**真实跑出来的输出片段**，不是我编的字符串：连接类那一组抄自当天把 spec
// 指向死端口跑出来的 46 条 `page.goto: net::ERR_CONNECTION_REFUSED`。
// 这样测的是「同样的输出进来，门岗会说哪句话」，而不是「我以为它会说哪句话」。
import net from 'node:net'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  LAB_VERDICT,
  collectDiffImages,
  formatLabFailure,
  parseRunTotals,
  triageLabRun,
} from './failureTriage.mjs'
import { LAB_ROLES, classifyPortHolder, labPortFor, portHolder } from './labServer.mjs'
import { REPO_ROOT } from './labStates.mjs'
import { FAILURE_TAIL_LINES } from '../../../scripts/run-gates-contracts.mjs'

const CONNECTION_REFUSED_RUN = `
Running 46 tests using 1 worker

  ✘   1 tests/ux/design-lab/design-lab.visual.spec.mjs:27:5 › design lab · agent-panel › 注册表与活页面一致 (1.1s)

  1) tests/ux/design-lab/design-lab.visual.spec.mjs:27:5 › design lab · agent-panel › 注册表与活页面一致

    Error: page.goto: net::ERR_CONNECTION_REFUSED at http://127.0.0.1:5197/design-lab.html?screen=agent-panel&frame=1

  46 failed
`

const PIXEL_MISMATCH_RUN = `
Running 46 tests using 1 worker

  1) design lab · agent-panel › 状态 form-07-reply

    Error: Screenshot comparison failed:

      840 pixels (ratio 0.01 of all image pixels) are different.

  1 failed
  45 passed (21.0s)
`

const FORMAT_CONTEXT = { resultsDir: '/repo/test-results', origin: 'http://127.0.0.1:5378' }

describe('视觉道失败分诊', () => {
  it('连接被拒 + 零差异图 → 基础设施失败，绝不叫「视觉基线不符」', () => {
    const triage = triageLabRun({ output: CONNECTION_REFUSED_RUN, diffImages: [], exitCode: 1 })
    expect(triage.verdict).toBe(LAB_VERDICT.SERVER_UNREACHABLE)
    expect(triage.unreachable).toContain('connection-refused')

    const message = formatLabFailure(triage, FORMAT_CONTEXT)
    expect(message).toContain('预览服务器不可达')
    // 这一条就是当天那个 bug 本身：旧门岗对着这份输出说的正是下面这句。
    expect(message).not.toContain('视觉基线不符')
    expect(message).not.toContain('设计改动被拦住')
  })

  it('一条都没过 → 说「从未可达」；过了几条才挂 → 说「跑到一半失联」', () => {
    const never = triageLabRun({ output: CONNECTION_REFUSED_RUN, diffImages: [], exitCode: 1 })
    expect(never.everReachable).toBe(false)
    expect(formatLabFailure(never, FORMAT_CONTEXT)).toContain('从未可达')

    const midRun = triageLabRun({
      output: `${CONNECTION_REFUSED_RUN}\n  1 passed (2.0s)`,
      diffImages: [],
      exitCode: 1,
    })
    expect(midRun.everReachable).toBe(true)
    expect(formatLabFailure(midRun, FORMAT_CONTEXT)).toContain('跑到一半失联')
  })

  it('webServer 压根没起来 → 同样是基础设施失败', () => {
    const triage = triageLabRun({
      output: 'Error: Process from config.webServer was not able to start. Exit code: 1',
      diffImages: [],
      exitCode: 1,
    })
    expect(triage.verdict).toBe(LAB_VERDICT.SERVER_UNREACHABLE)
  })

  it('预热阶段的机器标记也认得出来（globalSetup 挂掉那条路）', () => {
    const triage = triageLabRun({
      output: 'NOMI_LAB_WARMUP_UNREACHABLE http://127.0.0.1:5378 —— 预热阶段就没能加载实验室页面',
      diffImages: [],
      exitCode: 1,
    })
    expect(triage.verdict).toBe(LAB_VERDICT.SERVER_UNREACHABLE)
    expect(triage.unreachable).toContain('warmup-unreachable')
  })

  it('真的产出了差异图，才说「视觉基线不符」', () => {
    const triage = triageLabRun({
      output: PIXEL_MISMATCH_RUN,
      diffImages: ['/repo/test-results/form-07/form-07-diff.png'],
      exitCode: 1,
    })
    expect(triage.verdict).toBe(LAB_VERDICT.VISUAL)
    const message = formatLabFailure(triage, FORMAT_CONTEXT)
    expect(message).toContain('视觉基线不符')
    expect(message).toContain('design-lab:update')
  })

  it('说了 Screenshot comparison failed 却一张图都没落盘 → 不给像素结论', () => {
    const triage = triageLabRun({ output: PIXEL_MISMATCH_RUN, diffImages: [], exitCode: 1 })
    expect(triage.verdict).toBe(LAB_VERDICT.INFRASTRUCTURE)
    expect(triage.claimedMismatch).toBe(true)
    const message = formatLabFailure(triage, FORMAT_CONTEXT)
    expect(message).toContain('一张差异图都没产出')
    // 它可以在结尾解释「什么时候才轮到那个结论」，但不能把这一趟**断言成**设计被拦住。
    expect(message).not.toContain('设计改动被拦住')
  })

  it('超时且零差异图 → 基础设施可疑，并把 load 报出来', () => {
    const triage = triageLabRun({
      output: 'Error: Timeout of 30000ms exceeded.\n\n  46 failed',
      diffImages: [],
      exitCode: 1,
    })
    expect(triage.verdict).toBe(LAB_VERDICT.INFRASTRUCTURE)
    const message = formatLabFailure(triage, {
      ...FORMAT_CONTEXT,
      load: { one: 54.6, five: 29.4, fifteen: 22.7, cpus: 10, overloaded: true },
    })
    expect(message).toContain('54.6')
    expect(message).toContain('超载')
  })

  it('缺基线是另一档，不混进「不符」', () => {
    const triage = triageLabRun({
      output: "Error: A snapshot doesn't exist at __baselines__/agent-panel/form-99.png",
      diffImages: [],
      exitCode: 1,
    })
    expect(triage.verdict).toBe(LAB_VERDICT.BASELINE_MISSING)
  })

  it('退出码为 0 时没有失败可分诊', () => {
    expect(triageLabRun({ output: PIXEL_MISMATCH_RUN, diffImages: [], exitCode: 0 })).toBeNull()
  })

  it('每一档的说辞都塞得进 gates 汇总回放的行数', () => {
    // gates 汇总只回放失败门岗输出的最后 FAILURE_TAIL_LINES 行；说明超出去就等于没说。
    const cases = [
      triageLabRun({ output: CONNECTION_REFUSED_RUN, diffImages: [], exitCode: 1 }),
      triageLabRun({ output: PIXEL_MISMATCH_RUN, diffImages: [], exitCode: 1 }),
      triageLabRun({ output: "A snapshot doesn't exist at x.png", diffImages: [], exitCode: 1 }),
      triageLabRun({ output: PIXEL_MISMATCH_RUN, diffImages: ['/a/b-diff.png'], exitCode: 1 }),
    ]
    for (const triage of cases) {
      const lines = formatLabFailure(triage, FORMAT_CONTEXT).split('\n').filter((line) => line.length)
      expect(lines.length).toBeLessThanOrEqual(FAILURE_TAIL_LINES)
    }
  })

  it('统计行解析不出来时给 null，不拿 0 冒充「一条都没过」', () => {
    expect(parseRunTotals('看不懂的输出')).toEqual({ passed: null, failed: null, skipped: null, didNotRun: null })
    expect(parseRunTotals('  1 failed\n  45 passed (21.0s)')).toMatchObject({ passed: 45, failed: 1 })
  })

  it('没打印的计数不写进说明——不猜成 0，也不显示成解析坏了', () => {
    // Playwright 一条都没过时整行省略 passed，这是它的常态输出，不是解析失败。
    const triage = triageLabRun({ output: CONNECTION_REFUSED_RUN, diffImages: [], exitCode: 1 })
    const message = formatLabFailure(triage, FORMAT_CONTEXT)
    expect(message).toContain('46 挂')
    expect(message).not.toContain('? 过')
    expect(message).not.toContain('0 过')
  })

  it('差异图是从磁盘上数出来的，不是从输出文本里猜的', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-lab-diff-'))
    try {
      fs.mkdirSync(path.join(dir, 'form-07'))
      fs.writeFileSync(path.join(dir, 'form-07', 'form-07-diff.png'), 'x')
      fs.writeFileSync(path.join(dir, 'form-07', 'form-07-actual.png'), 'x')
      expect(collectDiffImages(dir)).toEqual([path.join(dir, 'form-07', 'form-07-diff.png')])
      expect(collectDiffImages(path.join(dir, 'nope'))).toEqual([])
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('实验室端口的 worktree 归属', () => {
  it('端口按 worktree 派生：同树恒定、跨树分开、角色之间不撞', () => {
    const here = '/Users/someone/Desktop/Nomi'
    const there = '/Users/someone/Desktop/Nomi-other-branch'
    for (const role of LAB_ROLES) {
      expect(labPortFor(role, here)).toBe(labPortFor(role, here))
      expect(labPortFor(role, here)).not.toBe(labPortFor(role, there))
      expect(labPortFor(role, here)).toBeGreaterThanOrEqual(5300)
      expect(labPortFor(role, here)).toBeLessThan(5300 + 64 * LAB_ROLES.length)
    }
    const ports = new Set(LAB_ROLES.map((role) => labPortFor(role, here)))
    expect(ports.size).toBe(LAB_ROLES.length)
  })

  it('没登记的角色当场抛，不静默给一个端口', () => {
    expect(() => labPortFor('walk-nonexistent')).toThrow(/未知的实验室角色/)
  })

  it('归属判定：cwd 对不上就是别人的，问不出 cwd 也不算自己的', () => {
    const repoRoot = fs.realpathSync(os.tmpdir())
    expect(classifyPortHolder(null, repoRoot)).toBe('free')
    expect(classifyPortHolder({ unknown: true }, repoRoot)).toBe('unknown')
    expect(classifyPortHolder({ pid: 1, cwd: repoRoot }, repoRoot)).toBe('ours')
    expect(classifyPortHolder({ pid: 1, cwd: '/somewhere/else' }, repoRoot)).toBe('foreign')
    expect(classifyPortHolder({ pid: 1, cwd: null }, repoRoot)).toBe('foreign')
  })

  it('真的去问一个真在监听的端口，问得出监听者的 cwd', async () => {
    const server = net.createServer()
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    try {
      const holder = portHolder(server.address().port)
      // 这台机器上没有 lsof（CI 的 linux runner 可能就没有）时只能得出 unknown——
      // 那不是失败，是「问不出来」。断言它诚实地这么说，而不是假装查到了。
      if (holder?.unknown) {
        expect(holder.reason).toMatch(/lsof/)
        return
      }
      expect(holder.pid).toBe(process.pid)
      expect(classifyPortHolder(holder, process.cwd())).toBe('ours')
      expect(classifyPortHolder(holder, '/definitely/not/this/worktree')).toBe('foreign')
    } finally {
      await new Promise((resolve) => server.close(resolve))
    }
  })

  // 立项根因（2026-09-06）：端口从写死改成 labPortFor(role) 派生后，两份走查入口
  // （host-config、agent-panel-v4）还留着 `port: 5202` / `port: 5241`、都没传 `role`。
  // 运行时 labPortFor(undefined) 会当场抛，但**走查本身不在 gates 里**——于是「这两条 npm
  // script 一次都跑不起来」只能等有人手动跑才暴露，中间隔了好几个 PR。
  // 这条测试是那道跑在 CI 里的防线：入口的声明对不对，静态读文本就能判，不用把浏览器拉起来。
  it('每份走查入口都认领了一个登记过的角色，且不再写死端口', () => {
    const uxDir = path.join(REPO_ROOT, 'tests/ux')
    const entries = fs.readdirSync(uxDir).filter((name) => /^design-lab-.*\.walk\.mjs$/.test(name))
    expect(entries.length).toBeGreaterThan(0)
    const claimed = []
    for (const entry of entries) {
      const source = fs.readFileSync(path.join(uxDir, entry), 'utf8')
      const body = source.replace(/^\s*\/\/.*$/gm, '')
      const role = body.match(/\brole:\s*'([^']+)'/)?.[1]
      expect(role, `${entry} 没有认领角色`).toBeTruthy()
      expect(LAB_ROLES, `${entry} 的角色 ${role} 没登记进 LAB_ROLES`).toContain(role)
      expect(body, `${entry} 还在写死端口，端口该由 labPortFor(role) 派生`).not.toMatch(/\bport:\s*\d/)
      claimed[claimed.length] = role
    }
    // 每个角色只能被一份入口认领：两份共用一个角色 = 并行跑时又撞回同一口。
    expect(new Set(claimed).size).toBe(claimed.length)
  })
})
