#!/usr/bin/env node
// 正文门岗的**本地半场**（2026-09-18）：push 之前就把「PR 正文有没有引用方案 / 门表」判完。
//
// 为什么要它：这两条判据此前只在 CI 里跑，而 CI 一轮 40 分钟。于是「正文少了一行链接」
// 这种十秒能改的事，代价是一整轮 CI——最近 40 次 quality-gate 里 Contracts 红了 7 次
// （door-map 4、prior-art 2），几乎全是这一类。防线建在最早能拦住的那层（R17）：
// 能在 push 前拦的，别留给 CI。
//
// 它不是 CI 的替身：CI 侧仍然 fail-closed（正文现取，见 scripts/lib/prBody.mjs）。
// 本地这一遍是**早报**——本机没有 gh、没登录、这条分支还没有 PR，都只是「今天没查成」，
// 照常放行，绝不假装通过（旧分支/首次 push 的正常情况不该被一个网络调用拦住）。
//
// 用法：
//   node scripts/check-pr-body-gates.mjs          push 前跑（pre-push 钩子自动调）
//   NOMI_PR_BODY=... node scripts/check-pr-body-gates.mjs   用指定正文试判（不碰网络）
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { resolvePullRequestBody } from './lib/prBody.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// 判据本身一行都不重写：直接跑 CI 跑的那个门岗（2026-10-01 起只剩 prior-art——check:door-map 的「PR 正文引用合同」
// 那一半已删，门表合法性由 check:root-cause-contracts 的 doors 校验管），正文由 NOMI_PR_BODY 交给它们，
// 保证「本地说绿」和「CI 说绿」用的是同一份实现和同一份正文。
const GATES = [
  { name: 'check:prior-art', script: 'scripts/check-prior-art.mjs' },
  { name: 'check:pr-judgement', script: 'scripts/check-pr-judgement.mjs' },
]

function main() {
  const pr = resolvePullRequestBody({ cwd: repoRoot, argv: [...process.argv, '--pr'] })
  if (!pr.available) {
    console.error(`[pr-body] 跳过：${pr.reason}（CI 侧仍会查；这条分支还没有 PR 时这是正常的）`)
    return 0
  }

  // 一次跑完再汇总，不第一条红就停——各红一次 = 多轮 push，正是本批要治的形状。
  const results = GATES.map(({ name, script }) => {
    const run = spawnSync(process.execPath, [path.join(repoRoot, script), '--pr'], {
      cwd: repoRoot,
      encoding: 'utf8',
      env: { ...process.env, NOMI_PR_BODY: pr.body },
    })
    return { name, status: run.status ?? 1, output: `${run.stdout ?? ''}${run.stderr ?? ''}`.trimEnd() }
  })

  const failed = results.filter((result) => result.status !== 0)
  for (const result of results) {
    console.error(`[pr-body] ${result.status === 0 ? '✅' : '✖'} ${result.name}`)
    if (result.status !== 0 && result.output) console.error(result.output)
  }
  if (failed.length === 0) {
    console.error(`[pr-body] 正文门岗本地已过（正文取自 ${pr.source}）——push 后别再改正文的引用部分。`)
    return 0
  }
  console.error(`[pr-body] BLOCKED：${failed.length} 条正文判据没过。先把 PR 正文改好（十秒），`
    + '别推出去换一轮 40 分钟的 CI。改完重推即可，不必空提交。')
  return 1
}

process.exitCode = main()
