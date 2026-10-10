// 门岗自检的**共用装置**：跑门岗、按变异改生产文件、无论成败都还原。
//
// 为什么它必须只有一份（2026-09-18 评审 评审点出来的）：这套东西原来在
// `check-verb-host-conformance.node-test.mjs` 里写过一遍，`check:model-face-frozen` 与
// `check:mcp-operation-constructible` 两道新门各抄了一遍——**同一份实现三个副本**，正是 P1 说的并行版。
// 更要命的是它抄的那部分恰好是「被中断时怎么把生产文件还原回去」：三份里任意一份改对了、另外两份没跟上，
// 表现出来的是「某次 CI 挂了之后工作区里留着一处变异」，而那种事没有人会第一时间联想到门岗自检。
//
// 提供两样东西：
//   · `runGate()`      跑一次门岗，返回 `{ red, output }`——**不抛**，因为「红了」是这里的正常结果；
//   · `withMutation()` 在一组 [文件, 找, 换] 上改生产代码、跑 body、`finally` 还原。
//
// 中断兜底：变异前先把原文落盘成恢复档（`recoveryFile`），下一次启动先看有没有上一轮留下的恢复档，
// 有就先还原。`finally` 兜得住抛异常那条路，兜不住 SIGKILL / 断电——恢复档兜的是那一条。
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { repoRoot } from './lib/repoPaths.mjs'

export { repoRoot }

/**
 * @param {object} input
 * @param {string} input.gate         门岗脚本的仓库相对路径
 * @param {string} input.recoveryFile 恢复档的仓库相对路径（每道门各一份，互不覆盖）
 */
export function createGateMutationHarness({ gate, recoveryFile }) {
  const gatePath = path.join(repoRoot, gate)
  const recoveryPath = path.join(repoRoot, recoveryFile)

  function runGate() {
    try {
      // 不经 pnpm：Windows 上 pnpm 是 pnpm.cmd，execFileSync('pnpm') 直接 ENOENT（输出为空，门岗自检于是在 Windows 上全红）。
      // 用当前 node + tsx 的 --import，与 `pnpm exec tsx <脚本>` 同一加载器，平台无关。
      execFileSync(process.execPath, ['--import', 'tsx', gatePath], { cwd: repoRoot, encoding: 'utf8', stdio: 'pipe' })
      return { red: false, output: '' }
    } catch (error) {
      return { red: true, output: `${error.stdout ?? ''}${error.stderr ?? ''}` }
    }
  }

  function restoreLeftoverMutation() {
    if (!fs.existsSync(recoveryPath)) return
    for (const [relative, content] of JSON.parse(fs.readFileSync(recoveryPath, 'utf8'))) {
      fs.writeFileSync(path.join(repoRoot, relative), content)
    }
    fs.rmSync(recoveryPath, { force: true })
    console.warn(`⚠ 上一轮变异测试被中断，已从恢复档还原生产文件（${recoveryFile}）`)
  }

  function withMutation(edits, body) {
    const originals = edits.map(([relative]) => [relative, fs.readFileSync(path.join(repoRoot, relative), 'utf8')])
    const restore = () => {
      for (const [relative, content] of originals) fs.writeFileSync(path.join(repoRoot, relative), content)
      fs.rmSync(recoveryPath, { force: true })
    }
    const onSignal = () => { restore(); process.exit(130) }
    fs.mkdirSync(path.dirname(recoveryPath), { recursive: true })
    fs.writeFileSync(recoveryPath, JSON.stringify(originals))
    process.on('SIGINT', onSignal)
    process.on('SIGTERM', onSignal)
    try {
      for (const [relative, find, replace] of edits) {
        const full = path.join(repoRoot, relative)
        const text = fs.readFileSync(full, 'utf8')
        assert.ok(text.includes(find), `变异目标不在 ${relative} 里了，这条变异已经过期：${find.slice(0, 70)}`)
        fs.writeFileSync(full, text.replace(find, replace))
      }
      return body()
    } finally {
      restore()
      process.off('SIGINT', onSignal)
      process.off('SIGTERM', onSignal)
    }
  }

  restoreLeftoverMutation()
  return { runGate, withMutation, repoRoot }
}

/** 「这道门进了 contracts 档」——三道门各自都要核的同一句话。 */
export function assertGateIsOnContracts(scriptName) {
  const scripts = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')).scripts
  assert.ok(scripts[scriptName], `package.json 里没有 ${scriptName} 这条 script`)
  assert.ok(scripts['gates:contracts'].includes(scriptName),
    `gates:contracts 里没有 ${scriptName} —— 门岗不在常跑档上等于没有门岗`)
}
