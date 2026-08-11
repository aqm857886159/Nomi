#!/usr/bin/env node
// 门岗：走查/评测脚本不许自己调 electron.launch，一律走 tests/ux/_launchApp.mjs。
//
// 为什么要专门给它一道门（P2 的结构保证）：手抄 launch 样板抄漏 env 会**静默挂死**——
// 干等到超时、零截图、零提示，排查时像脚本自己写错了（两条死法见 tests/ux/_launchApp.mjs 文件头）。
// 而 eslint.config.js 把 tests/ux/** 整个 ignore 了，现有五门**没有任何一道**能看见这片地。
// 没有这道门，改完照样会有人再抄一份坏的进来。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
// 只守已经收敛完的两片。`scripts/` 下还有约 60 个同病的一次性走查脚本没迁——把它一起纳进来
// 会当场红门、逼出一个「一半迁了一半没迁」的中间态，那正是本次要避免的。等它们迁完再加进来。
const SCAN_DIRS = ['tests', 'evals']
/** 唯一允许调 electron.launch 的地方。 */
const LAUNCHER = path.join('tests', 'ux', '_launchApp.mjs')

function* walk(dir) {
  if (!fs.existsSync(dir)) return
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) yield* walk(full)
    else if (/\.(mjs|js|ts)$/.test(entry.name)) yield full
  }
}

const offenders = []
for (const scanDir of SCAN_DIRS) {
  for (const file of walk(path.join(repoRoot, scanDir))) {
    const rel = path.relative(repoRoot, file)
    if (rel === LAUNCHER) continue
    const source = fs.readFileSync(file, 'utf8')
    const lines = source.split('\n')
    lines.forEach((line, i) => {
      // 只认真实调用；注释里提到（讲解为什么要收敛）不算。
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) return
      if (/electron\.launch\s*\(/.test(line)) offenders.push(`${rel}:${i + 1}`)
    })
  }
}

if (offenders.length) {
  console.error(`\n❌ ${offenders.length} 处直接调用 electron.launch —— 请改用 tests/ux/_launchApp.mjs 的 launchNomiApp()：\n`)
  for (const spot of offenders) console.error(`   ${spot}`)
  console.error(
    '\n手抄 launch 样板容易漏 NOMI_E2E / NOMI_E2E_ALLOW_MULTI_INSTANCE，' +
      '漏了就是静默挂死到超时（零截图零提示）。启动器把这套 env 钉死了。\n',
  )
  process.exit(1)
}

console.log('✅ check:e2e-launch —— 无直接 electron.launch 调用（全部走 _launchApp.mjs）')
