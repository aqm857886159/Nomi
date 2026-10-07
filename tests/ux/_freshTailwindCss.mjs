// 浏览器夹具测试用的**现编** Tailwind 样式（Mantine 基础样式 + 本仓 Tailwind 产物），以字符串交给 `page.addStyleTag({ content })`。
//
// 为什么不用 `/tailwind.generated.css`：那个文件是 `scripts/build-tailwind.mjs` 的产物，不进 git；CI 的 Unit 车道
// 不跑它，于是这些测试在 Linux CI 上**整页没有 Tailwind 样式**——`addStyleTag({ url })` 遇到 404 也不报错，
// 测的是一张没排版的页面（2026-10-06 #1042：参考缩略图的 × 点不到、英文底栏「Generate」点不到，本机有旧产物所以绿）。
// 本机那份还可能是旧的（改了类名没重编）。所以每个测试进程现编一份、只放在内存里用，不写 public/，也不和别的进程抢同一个文件。
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
let cached = null

export function freshTailwindCss() {
  if (cached) return cached
  const require = createRequire(path.join(repoRoot, 'package.json'))
  const tailwindPackagePath = require.resolve('tailwindcss/package.json')
  const tailwindBin = path.join(path.dirname(tailwindPackagePath), require(tailwindPackagePath).bin?.tailwindcss ?? 'lib/cli.js')
  const outFile = path.join(os.tmpdir(), `nomi-tailwind-${process.pid}-${Date.now()}.css`)
  try {
    execFileSync(process.execPath, [tailwindBin, '-i', path.join(repoRoot, 'src', 'styles', 'index.css'), '-o', outFile, '--config', path.join(repoRoot, 'tailwind.config.ts')],
      { cwd: repoRoot, stdio: ['ignore', 'ignore', 'pipe'] })
    const mantine = path.join(repoRoot, 'node_modules', '@mantine', 'core', 'styles.css')
    cached = [fs.existsSync(mantine) ? fs.readFileSync(mantine, 'utf8') : '', fs.readFileSync(outFile, 'utf8')].join('\n')
    return cached
  } finally {
    fs.rmSync(outFile, { force: true })
  }
}

/**
 * 样式真的生效了吗：拿一个只有 Tailwind 才给的样式量一下。没生效就直接红、说清楚，
 * 不让后面的几何断言在一张没排版的页面上「碰巧过」或「莫名红」。
 */
export async function assertTailwindApplied(page, where) {
  const applied = await page.evaluate(() => {
    const probe = document.createElement('div')
    probe.className = 'hidden'
    document.body.appendChild(probe)
    const display = getComputedStyle(probe).display
    probe.remove()
    return display === 'none'
  })
  if (!applied) throw new Error(`${where}：Tailwind 样式没有生效（.hidden 不是 display:none），后面的几何断言没有意义`)
}
