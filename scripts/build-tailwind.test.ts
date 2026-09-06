import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * 类级回归测试：**Tailwind 的扫描面必须覆盖 `.ts`，不只是 `.tsx`。**
 *
 * 钉的不变量：一个只在 `.ts` 里出现过的类名，必须真的出现在生成的 CSS 里。
 *
 * 为什么值得一条测试：这个坑**完全静默**。类名住在哪个后缀里是 R9 分层的结果
 * （纯换算函数该从组件壳里搬出去，搬出去就落进 `.ts`），和「这段样式要不要生成」
 * 毫无关系；可 content 只列 `./src/**\/*.tsx` 时，函数一搬家，它拼出来的类就不再生成——
 * 不报错、不警告、类型检查全绿，只是那几条 CSS 不存在，界面掉回默认排版。
 * 2026-09-06 全仓盘点时，`.ts` 里有 4 处类名一直是死的（浮窗八个 resize 手柄的定位、
 * 画布分组的半透明底与拖放态描边、生成钮的禁用底色、预览控制条的禁用态 hover）。
 *
 * 防线为什么建在这里而不是门岗（R28）：能让构建自己做对的事，不该留给一条
 * 「禁止把带类名的函数搬进 .ts」的门岗——那种门岗会把纯函数钉死在组件壳里，
 * 和 R9/R12 的分层要求正面打架。构建扫描面对了，就没有门岗和人的事；这条测试
 * 只是守住「扫描面别再退回去」。
 */
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/**
 * 哨兵类名：必须是**只在 `.ts` 里出现**的类。下面的 vacuity 守卫会强制这一点——
 * 一旦它也出现在某个 `.tsx`，本测试就会靠 `.tsx` 那条通过，从此永远绿、什么也测不到
 * （`docs/lessons/vacuous-probe-passes-forever.md`）。
 */
const SENTINELS = [
  // src/workbench/generationCanvas/components/groupVisualContract.ts —— 分组框的半透明底
  { source: 'bg-nomi-paper/[0.32]', selector: '.bg-nomi-paper\\/\\[0\\.32\\]' },
  // src/ui/browser/popover/browserAssetPopoverConstants.ts —— 浮窗上/下边 resize 手柄的右锚
  { source: 'right-5', selector: '.right-5' },
  // 曾经还有第三条：`max-w-[86%]`（residentShellDisplay.ts，最早暴露这个坑的那条）。
  // 2026-09-06 退役 —— Agent 面板 v4 的用户气泡（AgentPanelV4Message.tsx）用的是同一个宽度上限，
  // 它一进 .tsx，这条哨兵就靠 .tsx 那条通过、从此永远绿（正是下面 vacuity 守卫要拦的那种空测）。
  // 换不动：全仓扫下来，`.ts` 里独有的类只剩上面这两条。退役而不是「找个别的类顶上」，
  // 也不是「把 v4 的气泡改成别的宽度」——哨兵是**测量仪器**，不该反过来约束产品代码写什么类。
  // 两条哨兵证的是同一个不变量（content 扫不扫 .ts），少一条不掉覆盖，只是少一份冗余。
] as const

function collectSources(dir: string, out: { tsx: string[]; ts: string[] }): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'vendor') continue
      collectSources(full, out)
      continue
    }
    if (/\.(test|spec)\.tsx?$/.test(entry.name) || entry.name.endsWith('.d.ts')) continue
    if (entry.name.endsWith('.tsx')) out.tsx.push(full)
    else if (entry.name.endsWith('.ts')) out.ts.push(full)
  }
}

function readCompiledCss(): string {
  const tailwindPackagePath = createRequire(import.meta.url).resolve('tailwindcss/package.json')
  const tailwindPackage = JSON.parse(fs.readFileSync(tailwindPackagePath, 'utf8')) as { bin?: Record<string, string> }
  const tailwindBin = path.join(path.dirname(tailwindPackagePath), tailwindPackage.bin?.tailwindcss ?? 'lib/cli.js')
  const outFile = path.join(repoRoot, '.tmp', `tailwind.content-scan.${process.pid}.css`)
  fs.mkdirSync(path.dirname(outFile), { recursive: true })
  try {
    execFileSync(
      process.execPath,
      [tailwindBin, '-i', path.join(repoRoot, 'src', 'styles', 'index.css'), '-o', outFile, '--config', path.join(repoRoot, 'tailwind.config.ts')],
      { cwd: repoRoot, stdio: ['ignore', 'ignore', 'pipe'] },
    )
    return fs.readFileSync(outFile, 'utf8')
  } finally {
    fs.rmSync(outFile, { force: true })
  }
}

describe('tailwind content scan', () => {
  const sources: { tsx: string[]; ts: string[] } = { tsx: [], ts: [] }
  collectSources(path.join(repoRoot, 'src'), sources)

  it.each(SENTINELS)('哨兵 $source 只住在 .ts 里（否则本测试会变成空测）', ({ source }) => {
    const inTs = sources.ts.filter((file) => fs.readFileSync(file, 'utf8').includes(source))
    const inTsx = sources.tsx.filter((file) => fs.readFileSync(file, 'utf8').includes(source))
    expect(inTs.length, `哨兵 ${source} 已从 .ts 里消失，请换一个仍然只在 .ts 出现的类名`).toBeGreaterThan(0)
    expect(inTsx.map((file) => path.relative(repoRoot, file)), `哨兵 ${source} 也出现在 .tsx 里，本测试将永远绿。请换哨兵`).toEqual([])
  })

  it(
    '只在 .ts 里出现的类名也会被生成（content 必须同时扫 .ts 和 .tsx）',
    () => {
      const css = readCompiledCss()
      for (const { source, selector } of SENTINELS) {
        expect(css, `类 ${source} 只在 .ts 里出现，却没进生成的 CSS——tailwind.config.ts 的 content 又漏掉 .ts 了`).toContain(selector)
      }
    },
    // 真跑一次 Tailwind CLI（本机 ~2s，20+ worktree 并行时会更久）。这是**超时上限**，
    // 不是墙钟断言：测试从不判断自己跑了多久，只判断 CSS 里有没有那几个类。
    180_000,
  )
})
