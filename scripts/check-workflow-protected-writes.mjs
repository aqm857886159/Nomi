#!/usr/bin/env node
// 门岗：`.github/workflows/` 里的任何一处 push 都不许把写落到受保护分支上（硬零）。
//
// 抓的是一类**PR 上永远看不见、只在定时任务真跑起来才炸**的失效：机器人在 workflow 里
// 提交派生数据，然后推回当前 checkout 的分支。仓库还没上分支保护时它一路绿；
// 保护一开（Nomi 是 2026-08-16：main 必须走 PR + 2 个必需 check），每一次定时运行都被
// `GH006 protected branch hook declined` 拒绝——而没人看每日 cron 的红，快照就这么断了 20 天
// （2026-09-02 → 09-06 每天红，run 34012153754 的日志逐字记着那句 remote rejected）。
//
// 判据（只判「目的地能不能是受保护分支」，不猜别的）：
//   · 裸 `git push`（不带 refspec）——目的地就是当前 checkout 的分支，也就是主线。红。
//   · 目的地显式写成受保护分支：`... main`、`HEAD:main`、`X:refs/heads/main`。红。
//   · 目的地是别的显式 refspec（数据分支、tag、`$RELEASE_TAG`）。放行。
//
// 正确的写法是给派生数据一个自己的家：非保护数据分支（见 .github/workflows/download-stats.yml
// 与 docs/stats/README.md），或者走 peter-evans/create-pull-request 开 PR（docs-autosync / seo-radar）。
//
// 边界（诚实标注）：目的地写成 shell 变量时本门岗只能看见变量名——`$BRANCH` 在运行时等于 main
// 这一种它拦不住（记在根因合同的 residual_risks 里）。它拦的是「没写目的地」和「写死了主线」这两种。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export const WORKFLOW_DIR = '.github/workflows'
/** 受保护、只能走 PR 的分支。加分支保护时同步加到这里。 */
export const PROTECTED_BRANCHES = ['main']

/** `git push` 及其后面那串参数（同一行内）。 */
const GIT_PUSH = /\bgit\s+push\b([^\n]*)/g

function isProtectedDestination(refspec) {
  const destination = refspec.includes(':') ? refspec.slice(refspec.lastIndexOf(':') + 1) : refspec
  const branch = destination.replace(/^refs\/heads\//, '').replace(/^['"]|['"]$/g, '')
  return PROTECTED_BRANCHES.includes(branch)
}

/**
 * 一行 push 命令里的违规理由；没有违规回 null。
 * 参数里第一个不是 flag、不是 remote 名的 token 就是 refspec（`git push [flags] <remote> <refspec>`）。
 */
export function violationOf(args) {
  const tokens = args.trim().split(/\s+/).filter(Boolean)
  const positional = tokens.filter((token) => !token.startsWith('-'))
  if (positional.length === 0) return 'push 没写目的地：推的是当前 checkout 的分支，受保护主线首当其冲'
  const refspecs = positional.slice(1)
  if (refspecs.length === 0) return 'push 只写了 remote 没写 refspec：推的是当前 checkout 的分支'
  const offending = refspecs.find((refspec) => isProtectedDestination(refspec))
  return offending ? `push 的目的地是受保护分支 ${offending}：受保护分支只能走 PR` : null
}

export function listWorkflowFiles(root = repoRoot, { fsImpl = fs } = {}) {
  const dir = path.join(root, WORKFLOW_DIR)
  if (!fsImpl.existsSync(dir)) return []
  return fsImpl
    .readdirSync(dir)
    .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
    .map((name) => path.join(dir, name))
    .sort()
}

export function findProtectedWrites(files, { fsImpl = fs, root = repoRoot } = {}) {
  const offenders = []
  for (const file of files) {
    fsImpl
      .readFileSync(file, 'utf8')
      .split('\n')
      .forEach((line, index) => {
        if (line.trim().startsWith('#')) return // 注释里讲历史的那句 push 不算
        GIT_PUSH.lastIndex = 0
        let match
        while ((match = GIT_PUSH.exec(line)) !== null) {
          const reason = violationOf(match[1])
          if (reason) offenders.push({ file: path.relative(root, file).split(path.sep).join('/'), line: index + 1, reason })
        }
      })
  }
  return offenders
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const offenders = findProtectedWrites(listWorkflowFiles())
  if (offenders.length > 0) {
    console.error('✖ workflow 把写落到了受保护分支上（受保护分支只能走 PR）：')
    for (const offender of offenders) console.error(`  - ${offender.file}:${offender.line} ${offender.reason}`)
    console.error('  修法：派生数据推到自己的非保护数据分支（见 docs/stats/README.md），或用 peter-evans/create-pull-request 开 PR。')
    process.exit(1)
  }
  console.log(`✅ workflow 受保护分支写入门岗：${listWorkflowFiles().length} 份 workflow 无直推受保护分支`)
}
