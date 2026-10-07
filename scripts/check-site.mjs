#!/usr/bin/env node
// 官网静态检查的唯一入口（2026-10-02）：原来的 check:site-data / site-editorial / site-pricing / site-links /
// site-locales / site-schema / site-descriptions / site-attribution / sitemap 九个独立脚本名并进这里，
// 作为子项依次跑完再汇总（一次报全，不第一个红就停）。判据本身一行没改：每一项仍是原来的脚本。
// 门岗账本：这九个全部零红，单独占九个 check:* 名字只增加维护面，不增加防护。
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const node = (label, ...args) => ({ label, command: process.execPath, args })
const pair = (name, extraTests = []) => [
  node(`${name} (tests)`, '--test', `./scripts/${name}.node-test.mjs`, ...extraTests),
  node(name, `./scripts/${name}.mjs`),
]

export const SITE_STEPS = [
  {
    label: 'site-data',
    command: process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
    args: ['exec', 'tsx', 'scripts/site/export-site-data.mts', '--check'],
    shell: process.platform === 'win32',
  },
  node('marketing site', 'scripts/build-marketing-site.mjs', '--check'),
  node('sitemap', 'scripts/build-marketing-sitemap.mjs', '--check'),
  ...pair('check-site-editorial', ['./scripts/marketing/library/models-pages.node-test.mjs']),
  ...pair('check-site-pricing'),
  ...pair('check-site-links'),
  ...pair('check-site-locales'),
  ...pair('check-site-schema'),
  ...pair('check-site-descriptions'),
  ...pair('check-site-attribution'),
  node('marketing-home static', 'tests/ux/marketing-home.static.mjs'),
  node('marketing-libraries static', 'tests/ux/marketing-libraries.static.mjs'),
]

export function runSiteChecks(steps = SITE_STEPS, cwd = repoRoot) {
  const failed = []
  for (const step of steps) {
    console.log(`▶ check:site · ${step.label}`)
    const result = spawnSync(step.command, step.args, { cwd, stdio: 'inherit', shell: step.shell === true })
    if ((result.status ?? 1) !== 0) failed.push(step.label)
  }
  return failed
}

function main() {
  const failed = runSiteChecks()
  if (failed.length > 0) {
    console.error(`\n✖ check:site 红了（${failed.length} 项）：${failed.join('、')}`)
    return 1
  }
  console.log(`scanned=${SITE_STEPS.length}`)
  console.log(`\n✅ check:site：${SITE_STEPS.length} 个子项全部通过`)
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = main()
